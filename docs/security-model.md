# Security model and permissions

This page explains what an approval gate protects against, what it does not, and how to use Backstage permissions alongside it. Read it before relying on a gate for anything with real blast radius, such as granting access or creating production resources.

## In short

| Question                                                          | Answer                                                                                             |
| ----------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| Can someone skip the gate by calling the scaffolder API directly? | **No.** The gate is a step in the template; without an approval it fails and nothing after it runs |
| Can an approval be reused, or used for different inputs?          | **No.** It unlocks one run, of one template, with exactly the approved values                      |
| Can requesters approve their own requests?                        | Not unless the template sets `selfApprove: true`                                                   |
| Can a permission policy make someone an approver?                 | **No.** Policies can only narrow who may decide; the template's approver list always applies       |
| Does an approved run respect the requester's permissions?         | **No.** It runs as the approvals plugin, so the approver list is the real access boundary          |
| Can a template owner remove the gate?                             | **Yes.** Protect gated templates with code review, and deny dangerous actions to users (below)     |
| Who can see requests?                                             | Every signed-in user, as with the scaffolder's task list                                           |

## How the gate is enforced

The gate is a **step in the template**, not a check in the frontend.

Starting a scaffolder task is guarded by a basic permission that does not say which template is being run, so no permission policy can express "nobody may run template X directly". A gate that lived only in the UI could be skipped with a single `curl` to the scaffolder API.

But a task's steps are read from the catalog. Whoever starts a task supplies only the parameters and secrets; they cannot change the steps. So a step is the one part of a run the person starting it cannot alter.

A gated template's first step is `approval:gate`. It refuses to let the run continue unless the task holds a **grant**, and the approvals backend only mints a grant when a request is approved. Started directly, the task looks like this:

```text
task status: failed
  processing  Beginning step Await approval
  failed      Error: This template requires approval before it can run...
  skipped     Skipping step grant because a previous step failed
```

### What a grant is bound to

A grant is a random 256-bit token, stored only as a hash, handed to the approved task as a task secret. It is redeemed by the gate step, and it is only accepted if all of these hold:

- it belongs to **the request** that was approved;
- the task is running **the template** that request was for;
- the task's parameters hash to **the same value** as the approved ones;
- it has **not expired** (one hour by default, see [`grantTtl`](configuration.md#grantttl-how-long-an-approval-stays-usable));
- it has **not been used** or revoked.

All of these are checked in one database update that must change exactly one row, so two tasks racing for the same grant cannot both succeed. Every refusal gives the same message, so someone holding a token cannot learn which condition failed.

Only the scaffolder's own service principal may redeem grants (configurable through [`grantConsumers`](configuration.md#grantconsumers-split-deployments)).

### Template shapes the plugin refuses

"The gate fails, so nothing after it runs" is only true for templates whose shape allows it. The scaffolder will happily run steps around a failing gate in some cases, so the plugin refuses requests for these shapes, and the catalog module warns about them:

| Shape                                                                        | What the scaffolder would do                                     |
| ---------------------------------------------------------------------------- | ---------------------------------------------------------------- |
| `if:` on the gate                                                            | Skip the gate when the condition is false, so the caller decides |
| `each:` on the gate                                                          | Run the gate once per item: zero times for an empty list         |
| A later step with `if: ${{ always() }}` or `${{ failure() }}`                | Run that step even after the gate fails                          |
| A later step tagged with a `backstage:permissions.tags` value the gate lacks | A step-read policy could hide the gate but keep that step        |
| A step before the gate                                                       | Run it before anyone approved                                    |

Refusing a request stops these shapes being approved, but the template still exists. Someone could start it straight through the scaffolder API, and a step with `always()` would run. That is an **accepted risk** of a design where the gate lives in a file the template's owners can edit, and it is why [defence in depth](#defence-in-depth-deny-dangerous-actions-to-users) matters.

## Who runs an approved template

An approval can arrive days after a request, with no session from the requester still active, and Backstage has no way to act as an arbitrary user. So **an approved template is started with the approvals plugin's own service credentials.**

That has consequences worth understanding:

- **An approved run is not permission-checked.** Backstage allows everything for a service principal without consulting the policy. So an approved run executes every step and every parameter, including ones the requester's own `scaffolder.template.step.read`, `scaffolder.template.parameter.read` or `scaffolder.action.execute` policy would have blocked.
- **An approval can therefore grant more than the requester could do alone.** That is deliberate: the approvers' agreement is the authority, and an approval that quietly did less than it said would be worse. But it means **the approver list is the real access-control boundary** for a gated template. Choose it as carefully as you would a permission policy.
- **`${{ user.* }}` is empty** and the task has no `createdBy`. Templates should use the gate's `requestedBy` and `approvedBy` outputs (see [Writing gated templates](writing-gated-templates.md#what-an-approved-run-can-and-cannot-see)).
- **Calls to other Backstage plugins** from the task are made as the approvals plugin.

Running the template as the approver was considered and rejected: it attributes the work to the wrong person, fails whenever an approver lacks the access being granted, and makes a task's identity depend on who clicked last.

## Permissions

The plugin defines four permissions. With [`permission.enabled: true`](https://backstage.io/docs/permissions/getting-started) your policy decides them; without it they are all allowed. Either way, **the gate's own rules always apply too**: approvers, quorum and self-approval are checked by the backend whatever the policy says.

| Permission                           | Type     | Guards                       | Supports conditions |
| ------------------------------------ | -------- | ---------------------------- | ------------------- |
| `scaffolderApprovals.request.create` | Basic    | Submitting a request         | No (basic)          |
| `scaffolderApprovals.request.read`   | Resource | Listing and reading requests | Allow or deny only¹ |
| `scaffolderApprovals.request.decide` | Resource | Approving or denying         | Yes                 |
| `scaffolderApprovals.request.cancel` | Resource | Withdrawing a request        | Yes                 |

¹ A conditional read decision is answered with 403 on the list endpoint rather than being silently ignored, so give `read` a plain allow or deny.

The resource type is `scaffolder-approval-request`, and three rules are available for conditional decisions:

| Rule                     | Parameters               | Matches a request when…                              |
| ------------------------ | ------------------------ | ---------------------------------------------------- |
| `IS_DESIGNATED_APPROVER` | `userRefs: string[]`     | any of the given refs is one of the gate's approvers |
| `IS_NOT_REQUESTER`       | `userRef: string`        | the given user did not submit it                     |
| `HAS_TEMPLATE_REF`       | `templateRefs: string[]` | it was raised against one of the given templates     |

The permissions and rules are exported from `@ferin79/backstage-plugin-scaffolder-approvals-common` and `@ferin79/backstage-plugin-scaffolder-approvals-node`, and appear in permission-management UIs that discover plugin permissions.

### Example policy

This policy, for the new backend system:

- lets only the security team decide on requests for the `provision-service` template (on top of the template's own approvers);
- stops contractors submitting requests at all;
- denies two high-risk actions to users, so they only ever run in an approved run (see [Defence in depth](#defence-in-depth-deny-dangerous-actions-to-users)).

```ts
// packages/backend/src/permissionPolicy.ts
import { createBackendModule } from '@backstage/backend-plugin-api';
import {
  AuthorizeResult,
  isPermission,
} from '@backstage/plugin-permission-common';
import {
  createConditionExports,
  type PermissionPolicy,
  type PolicyQuery,
  type PolicyQueryUser,
} from '@backstage/plugin-permission-node';
import { policyExtensionPoint } from '@backstage/plugin-permission-node/alpha';
import { actionExecutePermission } from '@backstage/plugin-scaffolder-common/alpha';
import {
  createScaffolderActionConditionalDecision,
  scaffolderActionConditions,
} from '@backstage/plugin-scaffolder-backend/alpha';
import {
  approvalRequestCreatePermission,
  approvalRequestDecidePermission,
} from '@ferin79/backstage-plugin-scaffolder-approvals-common';
import {
  approvalRequestResourceRef,
  hasTemplateRef,
  isDesignatedApprover,
  isNotRequester,
} from '@ferin79/backstage-plugin-scaffolder-approvals-node';

const { conditions: approvalConditions, createConditionalDecision } =
  createConditionExports({
    resourceRef: approvalRequestResourceRef,
    rules: { hasTemplateRef, isDesignatedApprover, isNotRequester },
  });

class ApprovalsPolicy implements PermissionPolicy {
  async handle(request: PolicyQuery, user?: PolicyQueryUser) {
    // Only the security team may decide on production service requests,
    // on top of the template's own approver list.
    if (isPermission(request.permission, approvalRequestDecidePermission)) {
      if (user?.info.ownershipEntityRefs.includes('group:default/security')) {
        return { result: AuthorizeResult.ALLOW };
      }
      return createConditionalDecision(request.permission, {
        not: approvalConditions.hasTemplateRef({
          templateRefs: ['template:default/provision-service'],
        }),
      });
    }

    // Contractors may not submit approval requests at all.
    if (isPermission(request.permission, approvalRequestCreatePermission)) {
      if (
        user?.info.ownershipEntityRefs.includes('group:default/contractors')
      ) {
        return { result: AuthorizeResult.DENY };
      }
    }

    // Defence in depth: these actions only ever run in an approved run.
    if (isPermission(request.permission, actionExecutePermission)) {
      return createScaffolderActionConditionalDecision(request.permission, {
        not: {
          anyOf: [
            scaffolderActionConditions.hasActionId({
              actionId: 'github:repo:create',
            }),
            scaffolderActionConditions.hasActionId({
              actionId: 'github:deployKey:create',
            }),
          ],
        },
      });
    }

    return { result: AuthorizeResult.ALLOW };
  }
}

export default createBackendModule({
  pluginId: 'permission',
  moduleId: 'approvals-policy',
  register(reg) {
    reg.registerInit({
      deps: { policy: policyExtensionPoint },
      async init({ policy }) {
        policy.setPolicy(new ApprovalsPolicy());
      },
    });
  },
});
```

Register it in place of any other policy module (such as the allow-all policy):

```ts
// packages/backend/src/index.ts
backend.add(import('@backstage/plugin-permission-backend'));
backend.add(import('./permissionPolicy'));
```

and make sure permissions are on:

```yaml
# app-config.yaml
permission:
  enabled: true
```

Two things to get right:

- **`permission.enabled: true` must be set.** Without it, every permission is allowed and your policy never runs.
- **`anyOf` needs at least one condition.** Building the list with `.map()` over a plain `string[]` does not type-check, because it is not a non-empty array. Write the conditions out, or assert the tuple type.

## Defence in depth: deny dangerous actions to users

The refused template shapes, and deleting the gate entirely, are all under the control of whoever can edit the template's YAML. If a gated template does something with real blast radius, do not rely on the template alone.

**`scaffolder.action.execute` is the permission that helps.** Unlike starting a task, it is a resource permission whose rules see the action id. And a permission policy is only consulted for **users**: an approved run is started by the approvals plugin's service principal, which is always allowed.

So a policy that denies an action to users, like the `actionExecutePermission` branch above, means:

- a direct `POST /api/scaffolder/v2/tasks` using that action is refused with "Unauthorized action: github:repo:create", whatever the template's shape;
- the same template's approved run completes normally.

This was verified against a real scaffolder, where such a policy stopped an `always()` bypass.

The cost is that the action can no longer be used from ungated templates. That is the point: it makes "this action only ever runs with an approval" a property of your deployment rather than of a YAML file.

## Break-glass

A `scaffolderApprovals.request.decide` policy can only **narrow** who may decide. It cannot make someone an approver for a request whose template did not name them.

That is deliberate. If an explicit ALLOW could bypass the approver check, then in a deployment with `permission.enabled` unset (the default), every signed-in user could approve every request, because Backstage answers ALLOW for everything when permissions are disabled. A four-eyes control that disappears with one default setting is not a control.

For an emergency path, add the break-glass group to the template's `approvers`, and manage its membership where you manage your other emergency access.

## Who can read requests

Every signed-in user can list and read every request, its values and its decisions, matching the scaffolder's own task list. This is why [gated templates cannot have secret fields](writing-gated-templates.md#rules-a-gated-template-must-follow): a password typed into a gated template would otherwise be visible to the whole organisation.

To restrict reading, deny `scaffolderApprovals.request.read` to the users who should not see requests. Submitted values are redacted after the [retention window](configuration.md#retentionredactafter-how-long-submitted-values-are-kept).

## Audit trail

| Where                                        | What is recorded                                                                                                                                |
| -------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| The approvals database                       | Every request, every decision with its comment, the grant's use, and the task it unlocked. Kept indefinitely                                    |
| Backstage audit events                       | `request-submit` (medium), `request-decide` (high), `request-cancel` (medium) and `grant-consume` (high), through the Backstage auditor service |
| The task log                                 | The gate logs who asked and who approved; later steps can record `requestedBy` and `approvedBy` too                                             |
| [Events](notifications-and-events.md#events) | Every state change, for forwarding to a SIEM or other audit pipeline                                                                            |

## Accepted risks

- **A template's owners can remove its gate.** Nothing forces a template to stay gated, and there is no list of templates that must be gated. Mitigate it with CODEOWNERS on gated template files, by alerting when the `scaffolder-approvals.backstage.io/gated` annotation disappears from a template, and with the action policy above.
- **Refused shapes can still be started directly.** See [Template shapes the plugin refuses](#template-shapes-the-plugin-refuses). The action policy closes this for the actions you list.
- **Group membership is read from the user's Backstage token.** A change to an approver group takes effect when that person's token is next issued, and at the latest at their next sign-in. Until then, someone just removed from the group can still decide. A catalog lookup on every decision would close that window at the cost of a catalog read on the decision path; it is not built.
