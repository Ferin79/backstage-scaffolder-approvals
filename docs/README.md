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
      required: [repository, justification]
      properties:
        repository:
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

    # Runs only after approval. The task was started by the approvals plugin,
    # not by a person, so use the gate's outputs to record who actually asked
    # and who agreed.
    - id: grant
      name: Grant admin
      action: github:repo:collaborator:add
      input:
        repository: ${{ parameters.repository }}
        requestedBy: ${{ steps.gate.output.requestedBy }}
        approvedBy: ${{ steps.gate.output.approvedBy }}
```

That is all a template author writes. Nothing marks the template as gated by hand — a catalog module derives the `scaffolder-approvals.backstage.io/gated` annotation from the step, so the two cannot drift apart.

What happens next:

1. The requester submits the template from the **approvals page**. Their values are checked against the template's parameter schema straight away, so an approver's time is never spent on a request that could not run.
2. The approvers are notified. Each approves or denies, optionally with a comment. The requester cannot approve their own request, even though they are in the group.
3. When two have approved, the template starts. A single denial rejects the request outright, whatever the approval count.
4. The request moves to `running`, then `completed` or `failed`. Nobody deciding within 72 hours moves it to `expired`.

## Things to know before you rely on it

Two consequences of this design will otherwise turn up as support questions.

### The task runs as the plugin, not as the person who asked

An approval can land days after the request was made, with no session from the requester still in flight, and Backstage offers no way to act as an arbitrary user from their entity ref. So an approved template is launched with **the approvals plugin's own service credentials**.

What that means in practice:

- **The requester will not see the task under "my tasks"** in the scaffolder, because the task's `createdBy` names the plugin. The approvals page is the place to follow a gated request — it shows who asked, who agreed, and links to the task.
- **Templates that use the task's creator get the wrong answer.** Use `${{ steps.gate.output.requestedBy }}` and `${{ steps.gate.output.approvedBy }}` instead, which carry the real people.
- **The audit trail is the approvals database, not the task.** It records the request, every decision and the task that consumed the grant — the decision as well as the execution.

Launching as the approver instead was considered and rejected: it misattributes the work, fails whenever an approver lacks the access being granted, and makes a task's identity depend on who happened to click first.

### User OAuth tokens will have expired

The scaffolder's `requestUserCredentials` option puts a short-lived token belonging to the requester into the task's secrets. Across an approval window of hours or days, that token is long dead by the time the template runs.

**A gated template must not depend on `${{ secrets.USER_OAUTH_TOKEN }}`.** Use the backend's integration credentials instead. The catalog module logs a warning when it sees a gated template whose later steps reference that secret.

### The gate can be removed by whoever owns the template

Nothing forces a template to stay gated. Anyone who can change the template's YAML can delete the gate step. That is an accepted risk, not an oversight; mitigate it with CODEOWNERS on gated template files, and alert when the derived `gated` annotation disappears from a template.

## Installation

### Backend

```ts
// packages/backend/src/index.ts
backend.add(import('@backstage-community/plugin-scaffolder-approvals-backend'));

// In whichever backend runs the scaffolder:
backend.add(
  import('@backstage-community/plugin-scaffolder-backend-module-approvals'),
);

// In whichever backend runs the catalog:
backend.add(
  import('@backstage-community/plugin-catalog-backend-module-approvals'),
);
```

Your catalog also needs **`@backstage/plugin-catalog-backend-module-scaffolder-entity-model`**, if it does not have it already. Without it the catalog does not recognise the `Template` kind and drops those entities **silently** — no error, just no template.

Notifications and signals are optional. With the notifications plugin installed, approvers and requesters are notified; with signals, an open request page updates live. The backend starts and works with neither.

### Frontend

For the new frontend system:

```ts
import approvalsPlugin from '@backstage-community/plugin-scaffolder-approvals/alpha';
```

For the legacy frontend system:

```tsx
import { ApprovalsIndexPage } from '@backstage-community/plugin-scaffolder-approvals';

<Route path="/scaffolder-approvals" element={<ApprovalsIndexPage />} />;
```

Add a sidebar link to `/scaffolder-approvals` so approvers can find their inbox.

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
```

## Packages

| Package                                                                              | What it is                                                               |
| ------------------------------------------------------------------------------------ | ------------------------------------------------------------------------ |
| [scaffolder-approvals](./plugins/scaffolder-approvals)                               | The approvals page: an inbox, your requests, and a request detail view   |
| [scaffolder-approvals-backend](./plugins/scaffolder-approvals-backend)               | Requests, decisions and grants; launching; sweeps; the API               |
| [scaffolder-backend-module-approvals](./plugins/scaffolder-backend-module-approvals) | The `approval:gate` action                                               |
| [catalog-backend-module-approvals](./plugins/catalog-backend-module-approvals)       | Derives the `gated` annotation, and warns about gates that will not work |
| [scaffolder-approvals-common](./plugins/scaffolder-approvals-common)                 | Shared types, permissions and helpers                                    |
| [scaffolder-approvals-node](./plugins/scaffolder-approvals-node)                     | Node-side helpers shared by the backend and its modules                  |

## Not yet

- **A homepage card and an entity card on Templates.** Neither exists yet; the approvals page is the only UI.
- **Sending a gated template to the approvals page from the scaffolder's own form.** Today a person who runs a gated template from the regular template list meets the gate as a failed task, with a message telling them to use the approvals page. The gate itself is unaffected.
- **Pausing a template partway through.** The gate has to be the first step. Parking a task mid-run needs a suspend/resume primitive in core ([BEP-0016](https://github.com/backstage/backstage/pull/34966)).
- **Restricting who can read requests.** Any signed-in user can read every request, matching the scaffolder's own task list. The permission rules needed to narrow it already exist.

## Local development

This workspace includes a backend that wires everything together, with an example gated template in `examples/`:

```sh
yarn install
cd packages/backend && yarn start
```

Then, from the workspace root, in another terminal:

```sh
./scripts/verify-gate.sh
```

It checks that the example template is marked gated, that invalid values are rejected before anything is stored, and that calling the scaffolder directly fails at the gate with every later step skipped.

There is no frontend app in this workspace. To work on the approvals page, run `yarn start` inside `plugins/scaffolder-approvals`, which serves it against a mock API.

The example backend uses guest sign-in, and a guest belongs to no groups, so it cannot act as an approver. Exercising approvals end to end needs a real sign-in provider; the automated tests cover that path against a real backend instead.

## Documentation

- [Design and decision record](../../GATED_SCAFFOLDER_WORKFLOWS.md)
- [Implementation guide](../../GATED_SCAFFOLDER_IMPLEMENTATION.md)
