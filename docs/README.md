# Scaffolder Approvals

Approval gates for Backstage software templates. A gated template does not run when someone submits it. It creates an **approval request**, and runs only once the designated approvers agree. If they deny it, it never runs at all.

The motivating case is self-service that needs a second pair of eyes: _Request GitHub admin access_ should wait for `devx-github-team` to say yes, and every request should have a state someone can go and look at — pending, approved, running, completed, failed, denied, withdrawn or expired.

## Why this exists

The scaffolder runs a template from start to finish, with no way to pause for a human decision. Gated workflows have been among the most requested unbuilt scaffolder features since [February 2023](https://github.com/backstage/backstage/issues/16622), and core still has no suspend/resume primitive — [BEP-0016](https://github.com/backstage/backstage/pull/34966) proposes one but is unmerged. That BEP names an interim community plugin as the right answer for adopters in the meantime. This is that plugin.

## How the gate is enforced

The gate is a **step in the template**, not a check in the frontend, and that is the whole design.

Starting a scaffolder task is guarded by a basic permission that carries no template reference, so no permission policy can express "deny running template X". A gate that lived only in the UI could be skipped with one `curl` to the scaffolder API. But a task's steps are read from the catalog, and whoever starts a task supplies only the parameters and secrets. A step is therefore the one part of a run the person starting it cannot change.

So a gated template's first step is `approval:gate`. It refuses to let the run continue unless it holds a single-use grant, and the approvals backend only mints one when a request is approved. The grant is bound to a hash of the exact parameters that were approved, so it cannot be redeemed to run anything else.

**This has been verified against a running backend.** Calling the scaffolder directly with a gated template:

```text
task status: failed
  processing  Beginning step Await approval
  failed      Error: This template requires approval before it can run...
  skipped     Skipping step grant because a previous step failed
```

`scripts/verify-gate.sh` repeats that check against any running instance.

### Template shapes that are refused

"The gate throws, so nothing after it runs" is only true of a template whose shape allows it. Scaffolder 4.1.0 will happily run real steps around a gate that throws, so the plugin refuses four shapes outright — at submit, and with a warning at catalog ingestion:

| Shape                                                         | What the runner does                                            |
| ------------------------------------------------------------- | --------------------------------------------------------------- |
| `if:` on the gate                                             | Skips a step whose condition is falsy, so the caller chooses    |
| `each:` on the gate                                           | Runs the step once per entry — an empty list runs it zero times |
| A later step with `if: ${{ always() }}` or `${{ failure() }}` | Runs it anyway after the gate throws                            |
| A later step tagged where the gate is not                     | A `HAS_TAG` step-read policy drops the gate but keeps that step |

The last one is why a gated template's gate must carry every `backstage:permissions.tags` value any other step carries: then no step-read policy can admit a real step without also admitting the gate.

### What a grant is bound to

A grant is a single-use capability, and it unlocks exactly one run:

- **the request** it was minted for;
- **the template** that request was raised against, so a grant cannot redeem inside a different gated template that happens to take the same parameters;
- **a hash of the parameters** that were approved, so it cannot unlock a run with different inputs;
- **a TTL**, and it is refused once revoked or consumed.

All six conditions are checked in a single `UPDATE` whose affected-row count must be exactly one, so two tasks racing on the same grant cannot both win.

`POST /grants/consume` is also restricted to the scaffolder's own service principal. Any service principal could already be refused a forged grant, but one that had _seen_ a grant could spend it, and a spent grant makes the legitimate task fail at its own gate. See `grantConsumers` under [Configuration](#configuration) for split deployments.

### Defence in depth: deny the actions to user principals

These four shapes are author-controlled, as is deleting the gate altogether. The plugin refuses them, but all four live in a file the template's own team can edit. If a gated template grants something with real blast radius, do not rely on the template's shape alone.

**`scaffolder.action.execute` is the one permission that carries enough context to help.** Unlike `scaffolder.task.create`, it is a resource permission and its rules see the action id and the resolved input. And a policy is only ever consulted for **user** principals: `ServerPermissionClient` answers ALLOW for a service principal without asking one. An approved run launches as the approvals plugin's own service principal, so a policy that denies an action reaches every direct run and no approved run.

Register a policy that denies the high-blast-radius actions:

```ts
import {
  AuthorizeResult,
  isPermission,
} from '@backstage/plugin-permission-common';
import type {
  PermissionPolicy,
  PolicyQuery,
} from '@backstage/plugin-permission-node';
import { actionExecutePermission } from '@backstage/plugin-scaffolder-common/alpha';
import {
  createScaffolderActionConditionalDecision,
  scaffolderActionConditions,
} from '@backstage/plugin-scaffolder-backend/alpha';

export class ApprovalOnlyActionsPolicy implements PermissionPolicy {
  async handle(request: PolicyQuery) {
    if (isPermission(request.permission, actionExecutePermission)) {
      return createScaffolderActionConditionalDecision(request.permission, {
        not: {
          anyOf: [
            scaffolderActionConditions.hasActionId({
              actionId: 'github:repo:collaborator:add',
            }),
            scaffolderActionConditions.hasActionId({
              actionId: 'github:repo:create',
            }),
          ],
        },
      });
    }

    return { result: AuthorizeResult.ALLOW };
  }
}
```

Two things to get right:

- **`permission.enabled: true` must be set in app-config.** Without it every request is allowed and no policy runs at all.
- **`anyOf` needs at least one condition.** Building it with `.map()` over a plain `string[]` does not type-check, because the array is not a `NonEmptyArray`. Write the conditions out, or assert the tuple.

A direct `POST /v2/tasks` is then refused with "Unauthorized action: github:repo:collaborator:add" whatever the template's shape, while the approved run of the same template completes. This was verified against a real scaffolder, where the policy stopped an `always()` bypass.

The cost is that the action becomes unusable from an ungated template too. That is the point — it is what makes "this action only ever runs with an approval" a property of the deployment rather than of a YAML file.

## A worked example

A template that needs two members of `devx-github-team` to agree before it grants admin access:

```yaml
apiVersion: scaffolder.backstage.io/v1beta3
kind: Template
metadata:
  name: request-github-admin
  title: Request GitHub admin access
spec:
  type: service
  owner: group:default/devx-github-team

  parameters:
    - title: What do you need?
      required: [repository, githubUsername, justification]
      properties:
        repository:
          type: string
        # Asked for rather than derived. An approved run has no user on it, so
        # `${{ user.entity.metadata.name }}` would render empty here.
        githubUsername:
          type: string
        justification:
          type: string
          minLength: 10

  steps:
    # Must be the first step, and there must be only one.
    - id: gate
      name: Await approval
      action: approval:gate
      input:
        approvers:
          - group:default/devx-github-team
        quorum: 2
        selfApprove: false
        timeout: { hours: 72 }
        summary: 'Admin on ${{ parameters.repository }}'
        # Required. This is what lets the gate check that the run matches what
        # was approved. Without it the gate refuses every run.
        values: ${{ parameters }}

    # Runs only after approval. Check the input schema of whichever action you
    # use; these are `github:repo:collaborator:add`'s, from the GitHub module.
    - id: grant
      name: Grant admin
      action: github:repo:collaborator:add
      input:
        repoUrl: 'github.com?repo=${{ parameters.repository }}&owner=acme'
        username: ${{ parameters.githubUsername }}
        permission: admin
```

The gate also publishes `${{ steps.gate.output.requestedBy }}`,
`${{ steps.gate.output.approvedBy }}` and `${{ steps.gate.output.requestId }}`. Use those wherever a
later step wants to record who asked and who agreed — the task itself cannot say, because it was
started by this plugin rather than by a person.

That is all a template author writes. Nothing marks the template as gated by hand — a catalog module derives the `scaffolder-approvals.backstage.io/gated` annotation from the step, so the two cannot drift apart.

What happens next:

1. The requester opens the template in the scaffolder as usual and presses **Request approval** on the last screen. Their values are checked against the template's parameter schema straight away, so an approver's time is never spent on a request that could not run. (That last screen is `GatedReviewStep`; without it the button still says Create, and pressing it produces a failed task saying the template needs approval and that the app has not installed the review step.)
2. The approvers are notified. Each approves or denies, optionally with a comment. The requester cannot approve their own request, even though they are in the group.
3. When two have approved, the template starts. A single denial rejects the request outright, whatever the approval count.
4. The request moves to `running`, then `completed` or `failed`. Nobody deciding within 72 hours moves it to `expired`.

The request page is the canonical view throughout, and links to the task log once there is a task. With the signals plugin installed it updates itself: somebody else's vote, the template starting and its task finishing all appear without a reload, and so do the inbox and the home-page card.

## Things to know before you rely on it

These turn up as support questions otherwise. The first two are consequences of the design; the rest are limits worth knowing before a gated template is holding up somebody's access.

### The task runs as the plugin, not as the person who asked

An approval can land days after the request was made, with no session from the requester still in flight, and Backstage offers no way to act as an arbitrary user from their entity ref. So an approved template is launched with **the approvals plugin's own service credentials**.

What that means in practice:

- **`${{ user.* }}` renders empty.** The task has no user on it at all — `spec.user` is `{}` and there is no `createdBy` — so `${{ user.entity.metadata.name }}` passes an empty string rather than the requester's name. This bites silently: the step succeeds and writes nothing. Use `${{ steps.gate.output.requestedBy }}` and `${{ steps.gate.output.approvedBy }}`, which carry the real people. The catalog module warns when it sees a gated template whose later steps read the `user` context.
- **An approved run is not permission-checked.** `ServerPermissionClient` answers ALLOW for a service principal without consulting any policy, so an approved run executes every step and every parameter — including ones the requester's own `scaffolder.template.step.read` or `scaffolder.template.parameter.read` policy would have removed, and regardless of any `scaffolder.action.execute` policy. **An approval can therefore grant more than the requester could have run themselves.** That is deliberate: the approvers' assent is the authority, and an approval that silently did less than it said would be worse. But it means the approver list is the real access-control boundary for a gated template — choose it accordingly.
- **Downstream calls run as the plugin.** A step that calls another Backstage plugin "on behalf of the person who started this" acts as the approvals plugin, not as the requester.
- **The requester will not see the task under "my tasks"** in the scaffolder, because there is no `createdBy` to match. The approvals page is the place to follow a gated request — it shows who asked, who agreed, and links to the task.
- **The audit trail is the approvals database, not the task.** It records the request, every decision and the task that consumed the grant — the decision as well as the execution.

Launching as the approver instead was considered and rejected: it misattributes the work, fails whenever an approver lacks the access being granted, and makes a task's identity depend on who happened to click first.

### User OAuth tokens will have expired

The scaffolder's `requestUserCredentials` option puts a short-lived token belonging to the requester into the task's secrets. Across an approval window of hours or days, that token is long dead by the time the template runs.

**A gated template must not depend on `${{ secrets.USER_OAUTH_TOKEN }}`.** Use the backend's integration credentials instead. The catalog module logs a warning when it sees a gated template whose later steps reference that secret.

### The template can change while a request waits

The values and the gate policy are frozen when a request is submitted, so editing a template cannot change the terms of a request already in flight. **The steps are not frozen**: the scaffolder reads the template from the catalog when the task starts, so a template edited during the wait runs in its edited form, and a step added in the meantime runs like any other.

The request page warns an approver when this has happened. Two things are recorded at submit and compared when the request is read:

- `metadata.uid`, which catches a template deleted and recreated — same name, different entity;
- a hash of `spec.steps`, which catches steps edited in place, where the uid never changes.

The hash covers the steps only. A template repo takes commits for all sorts of reasons, and a warning that fired on an owner or description edit is one people would learn to click past.

Drift is **shown, not enforced**. Failing every in-flight request whenever its template took an unrelated commit would make the feature unusable, so an approver is told and decides. A drifted launch is also logged by the backend, so the run can be tied to the template it actually ran.

### A secret cannot survive the wait

A gated template must not declare a `ui:field: Secret` parameter, and the approvals backend refuses one at submit rather than warning about it.

The reason is not only disclosure. The scaffolder puts a secret-typed value into the task's **secrets**, never its values — so there is nothing to carry it across a three-day approval. The request would be approved and the template would run without it. The disclosure risk is the sharper one, though: a value that did arrive as an ordinary parameter would be stored in the request and every signed-in user can read every request, so a password typed into a gated template would be published to the whole organisation until retention redacted it months later.

Pass whatever the step needs from the deployment's own integration credentials instead. The catalog module warns about this at ingestion, so an author finds out before a requester does.

### Approver group changes apply from the next sign-in

`approvers` holds entity refs and a caller's own group refs are matched against them, so a group's membership can change without rewriting any request. Those refs come from the caller's token, which is minted at sign-in — so somebody added to an approver group can decide **from their next sign-in**, not from the moment they are added.

The design (Q11) asked for a catalog lookup to close that window. It is not built. What it would buy is a few hours in an unusual case; what it costs is a catalog read on the decision path and a cache whose staleness is its own source of surprise. Every other Backstage plugin reads group membership the same way, and an approver who cannot see a request can sign out and back in. If that window matters to you, the request page is the place to add the lookup.

### Break-glass cannot be granted by a permission policy

A `scaffolderApprovals.request.decide` policy can only **narrow** who may decide. The service always applies the gate's own terms as well, so a policy cannot make somebody an approver for a request whose template did not name them.

That is deliberate, and the alternative is worse than it looks. Treating an explicit ALLOW as authority to bypass the approver check would mean that in a deployment with `permission.enabled` unset — the default — every signed-in user could approve every request, because `ServerPermissionClient` answers ALLOW for everything when permissions are disabled. A four-eyes control that evaporates on a default config setting is not a control.

For a genuine break-glass path, name the break-glass group in the template's `approvers` and control its membership where you control your other emergency access.

### Gated templates must not opt into task recovery

`EXPERIMENTAL_recovery` with `EXPERIMENTAL_strategy: startOver` keeps a task's secrets in the scaffolder's database for the whole run, the approval grant among them, and re-runs the task from the beginning on recovery. A recovered gated task therefore runs its gate a second time and fails, because the grant it is holding was consumed by the first attempt.

There is no recovery strategy that would help. A grant is single-use on purpose: that is what stops a leaked one from running the template twice. A template that fails after a restart needs a fresh request, which is the same answer as any other failed run (Q5).

### Notification links assume the default mount path

Deep links in notifications are built as `<app.baseUrl>/scaffolder-approvals/requests/<id>`. If you mount the page somewhere else, those links break — the page itself works, but every "Approval requested" email points at a 404. Mount it at `/scaffolder-approvals`, or expect to fix the links.

### The gate can be removed by whoever owns the template

Nothing forces a template to stay gated. Anyone who can change the template's YAML can delete the gate step. That is an accepted risk, not an oversight; mitigate it with CODEOWNERS on gated template files, and alert when the derived `gated` annotation disappears from a template.

## Installation

The packages are published to npm under `@ferin79`. `-common` and `-node` come in as dependencies of the others.

### Backend

```sh
yarn --cwd packages/backend add \
  @ferin79/backstage-plugin-scaffolder-approvals-backend \
  @ferin79/backstage-plugin-scaffolder-backend-module-approvals \
  @ferin79/backstage-plugin-catalog-backend-module-approvals
```

```ts
// packages/backend/src/index.ts
backend.add(import('@ferin79/backstage-plugin-scaffolder-approvals-backend'));

// In whichever backend runs the scaffolder:
backend.add(
  import('@ferin79/backstage-plugin-scaffolder-backend-module-approvals'),
);

// In whichever backend runs the catalog:
backend.add(
  import('@ferin79/backstage-plugin-catalog-backend-module-approvals'),
);
```

Your catalog also needs **`@backstage/plugin-catalog-backend-module-scaffolder-entity-model`**, if it does not have it already. Without it the catalog does not recognise the `Template` kind and drops those entities **silently** — no error, just no template.

Notifications and signals are optional. With the notifications plugin installed, approvers and requesters are notified. With the signals plugin installed, an open request page, inbox or home-page card refreshes itself when anything changes; without it, they show what they loaded until reloaded. The backend starts and works with neither.

### Frontend

```sh
yarn --cwd packages/app add @ferin79/backstage-plugin-scaffolder-approvals
```

For the new frontend system:

```ts
import approvalsPlugin from '@ferin79/backstage-plugin-scaffolder-approvals/alpha';
```

For the legacy frontend system:

```tsx
import { ApprovalsIndexPage } from '@ferin79/backstage-plugin-scaffolder-approvals';

<Route path="/scaffolder-approvals" element={<ApprovalsIndexPage />} />;
```

The new frontend system builds the sidebar entry from the page itself, so there is nothing to add. In the legacy system, add a sidebar link to `/scaffolder-approvals` by hand so approvers can find their inbox.

#### The home-page card

How many requests are waiting on you, somewhere people already look. Nothing notifies an approver a second time, so a request that arrives while somebody is away otherwise waits until it expires.

```tsx
import { PendingApprovalsHomePageCard } from '@ferin79/backstage-plugin-scaffolder-approvals';

<PendingApprovalsHomePageCard />;
```

On the new frontend system the same card is a home-page widget and needs no wiring — it appears in the widget catalogue as **Approvals**.

#### Submitting from the scaffolder's own wizard

Without this step a requester who opens a gated template in the scaffolder and presses **Create** gets a failed task, and no way to ask for approval from the UI: the approvals page lists requests but cannot create one. Pass `GatedReviewStep` as the wizard's review step and the wizard ends in a request instead:

```tsx
import { GatedReviewStep } from '@ferin79/backstage-plugin-scaffolder-approvals';

<Route
  path="/create"
  element={
    <ScaffolderPage
      components={{
        ReviewStepComponent: props => (
          <GatedReviewStep {...props}>
            <YourReviewStep {...props} />
          </GatedReviewStep>
        ),
      }}
    />
  }
/>;
```

Setting `ReviewStepComponent` replaces the scaffolder's built-in review step entirely, and the scaffolder does not export that built-in one. So `YourReviewStep` has to be a complete review step: the review table plus Back and Create buttons. [`packages/app/src/components/scaffolder/ReviewStep.tsx`](../packages/app/src/components/scaffolder/ReviewStep.tsx) has one that mirrors the scaffolder's own, built from `ReviewState` in `@backstage/plugin-scaffolder-react/alpha`.

This works on the **legacy frontend system only.** In the new frontend system (Backstage 1.55) the scaffolder's templates page passes the wizard field extensions, layouts and form props, but no review-step component, so there is nowhere to install this. That is why this repository's app uses the legacy system.

It renders the review step you pass as `children` for every template that is not gated, so installing it changes nothing about the other ones. For a gated template it shows who will be asked and how many of them, and its button creates a request rather than a task.

**This is convenience, not enforcement.** Remove it and the gate still holds — a gated template started any other way fails at step one. What it removes is the dead end, not the bypass.

It is a review step rather than a decorator on `scaffolderApiRef` because of what `scaffold()` has to return. A decorator diverting a gated submit would have no task id to hand back, so it would have to invent one or throw, turning a successful request into something the UI reports as a failure.

`ReviewStepProps` does not carry the template ref, so the component reads it from the scaffolder's route parameters. If your app mounts the wizard somewhere else, pass `templateRef` explicitly; without it the component renders your ordinary review step rather than a broken screen.

#### Marking gated templates on Create…

Without this, a requester finds out that a template needs approval on the wizard's last step. `GatedTemplateCard` is the scaffolder's own template card with one link per approver added, "Approver: DevX team", each to that approver's catalog page. Every other template's card is unchanged.

```tsx
import { GatedTemplateCard } from '@ferin79/backstage-plugin-scaffolder-approvals';

<ScaffolderPage
  components={{
    ReviewStepComponent: YourGatedReviewStep,
    TemplateCardComponent: GatedTemplateCard,
  }}
/>;
```

It reads a template's gate the same way `GatedReviewStep` does, so a card never promises an approval that the last step does not ask for. A gate the backend would refuse shows **Needs approval** instead of approvers; the review step says what is wrong with it. Legacy frontend system only, like the review step: the new system's templates page takes a swappable card, and one that wraps the scaffolder's own would render itself.

#### Names and links

People, groups and templates appear by the name the catalog gives them, "Riley Requester" or "Request GitHub admin access", and link to their catalog pages, so the app needs the catalog's entity page mounted, as any app with the scaffolder has. Until the catalog answers, and for an entity it does not know, the name comes from the ref. Notifications say "alice approved your request …": they go out in the middle of a decision, so they name people from their refs rather than waiting on the catalog.

#### Matching BUI to an MUI theme

The plugin's pages are Backstage UI (BUI) inside core-components page chrome. BUI draws its text in `system-ui`; Backstage's Material UI themes use `"Helvetica Neue", Helvetica, Roboto, Arial, sans-serif`. In an app that keeps an MUI theme, the home-page card then sits beside MUI cards in a different typeface, and every page mixes the two under its header. Point BUI at the theme's font in a stylesheet loaded after BUI's own, as [`packages/app/src/bui-theme.css`](../packages/app/src/bui-theme.css) does:

```css
:root,
[data-theme-mode] {
  --bui-font-regular: 'Helvetica Neue', Helvetica, Roboto, Arial, sans-serif;
}
```

Unlayered, so it beats BUI's own `@layer tokens` without `!important`.

### Configuration

Gate policy lives in each template. The global configuration is only this:

```yaml
scaffolderApprovals:
  # How long an approval stays redeemable once granted. Default: 1 hour.
  grantTtl: { hours: 1 }
  retention:
    # How long submitted values are kept before being redacted. The request and
    # its decisions are kept indefinitely. Default: 180 days.
    redactAfter: { days: 180 }
  # Which service principals may redeem an approval grant. Default:
  # ['plugin:scaffolder'], which is the only caller that should ever need to.
  # Widen it only for a split deployment that presents a different subject.
  grantConsumers: ['plugin:scaffolder']
```

### Events and signals

If the events backend is installed, every state change is published on the `scaffolder-approvals` topic. The payload always carries `action`, `requestId`, `templateRef`, `requesterRef` and `status`, plus a little more for some actions:

| `action`    | When                                    | Notification | Also carries              |
| ----------- | --------------------------------------- | ------------ | ------------------------- |
| `requested` | A request is submitted                  | Approvers    | —                         |
| `decided`   | An approver approves or denies          | Requester¹   | `decision`, `approverRef` |
| `launched`  | The template starts                     | None         | `taskId`                  |
| `completed` | The task finished successfully          | None         | `taskId`                  |
| `failed`    | The task failed, or the approval lapsed | Both         | `reason`                  |
| `expired`   | Nobody decided in time                  | Both         | —                         |
| `withdrawn` | The requester withdrew it               | Approvers²   | —                         |

¹ Only when the vote settles the request — a denial, or the approval that meets the quorum. A vote that leaves it pending is still published, with `status: pending`, so a subscriber sees every vote; it notifies nobody, because "Request approved" with an approval still missing would be untrue.

² Not a new item: it replaces each approver's "Approval requested" for that request, at `low` severity, so their inbox no longer asks them to decide something that is gone.

`launched` and `completed` carry no notification on purpose: four kinds of notification is the v1 decision, and "your request started" is redundant with "your request was approved" in an inbox. They exist because a subscriber — a Slack integration, an audit pipeline — needs the whole lifecycle, not just the part worth interrupting a person for.

`status` is the status the request has **after** the change, so a `decided` event on an approved request says `approved`, not `pending`.

If the signals backend is installed, the same changes are broadcast on the `scaffolder-approvals` channel as `{ action, requestId, status }`. The request page, the inbox and the home-page card subscribe to them and refetch, so they never trust a signal's own status; anything else can subscribe too. It is a broadcast rather than an addressed signal because signals can only be addressed to `user:` refs while approvers are normally groups. Nothing in the payload is privileged: any signed-in user can already read any request, and the page fetches it once told to.

## Packages

| Package                                                                               | What it is                                                               |
| ------------------------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| [scaffolder-approvals](../plugins/scaffolder-approvals)                               | The approvals page: an inbox, your requests, and a request detail view   |
| [scaffolder-approvals-backend](../plugins/scaffolder-approvals-backend)               | Requests, decisions and grants; launching; sweeps; the API               |
| [scaffolder-backend-module-approvals](../plugins/scaffolder-backend-module-approvals) | The `approval:gate` action                                               |
| [catalog-backend-module-approvals](../plugins/catalog-backend-module-approvals)       | Derives the `gated` annotation, and warns about gates that will not work |
| [scaffolder-approvals-common](../plugins/scaffolder-approvals-common)                 | Shared types, permissions and helpers                                    |
| [scaffolder-approvals-node](../plugins/scaffolder-approvals-node)                     | Node-side helpers shared by the backend and its modules                  |

## Not yet

- **An entity card on Templates.** Additive later; the approvals page and the home-page card are the UI today.
- **Pausing a template partway through.** The gate has to be the first step. Parking a task mid-run needs a suspend/resume primitive in core ([BEP-0016](https://github.com/backstage/backstage/pull/34966)).
- **Restricting who can read requests.** Any signed-in user can read every request, matching the scaffolder's own task list. The permission rules needed to narrow it already exist.

## Local development

See the [repository README](../README.md) for running the app, trying an approval end to end as several different people, and running `scripts/verify-gate.sh`.

To work on the approvals page on its own, run `yarn start` inside `plugins/scaffolder-approvals`, which serves it against a mock API. With no backend running, sign in as a guest and accept the fallback to the legacy guest token. The mock makes whoever signs in an approver, and applies the backend's rules, so approving, denying and withdrawing can all be tried; its requests start over when the page reloads. A **Home card** page shows the home-page card, whose count follows your votes, and people's names link to a stand-in for the catalog page.

## Documentation

- [Design and decision record](./GATED_SCAFFOLDER_WORKFLOWS.md)
- [Implementation guide](./GATED_SCAFFOLDER_IMPLEMENTATION.md)
- [Review](./GATED_SCAFFOLDER_REVIEW.md)
- [Browser review](./GATED_SCAFFOLDER_BROWSER_REVIEW.md): every feature exercised in the running app, with screenshots

These three were written while the plugins lived in a `backstage/community-plugins` workspace, so paths in them such as `workspaces/scaffolder-approvals/plugins/...` refer to that layout. In this repository the same files are under `plugins/...`.
