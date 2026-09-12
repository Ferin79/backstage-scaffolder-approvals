# Scaffolder Approvals

Approval gates for Backstage software templates. A gated template does not run when a developer
submits it — it creates an **approval request** that designated approvers must accept first. On
approval the template runs unchanged; on denial it never runs at all.

The motivating case is self-service that needs a second pair of eyes: _Request GitHub Admin Access_
should wait for the `devx-github-team` to say yes, and every request should have a state someone can
see.

## Why this exists

Backstage's scaffolder runs a template start-to-finish with no way to pause for a human decision.
Gated workflows have been the most-requested unbuilt scaffolder feature since
[February 2023](https://github.com/backstage/backstage/issues/16622), and core still has no
suspend/resume primitive — [BEP-0016](https://github.com/backstage/backstage/pull/34966) proposes one
but is unmerged. That BEP explicitly names an interim community plugin as the right answer for
adopters today. This is that plugin.

## How a gate is enforced

The gate is a step in the template's **catalog entity**, not a check in the frontend. That matters:
`scaffolder.task.create` is a basic permission carrying no template reference, so no permission policy
can express "deny running template X". A frontend-only gate is bypassable with one `curl`.

Because a task's steps come from the catalog and the caller supplies only `values` and `secrets`, a
step is the one surface that is plugin-controlled and user-tamper-proof.

```yaml
spec:
  steps:
    - id: gate
      name: Await approval
      action: approval:gate
      input:
        approvers:
          - group:default/devx-github-team
          - user:default/platform-lead
        quorum: 2
        selfApprove: false
        timeout: { hours: 72 }
        summary: 'Admin on ${{ parameters.repository }}'

    - id: grant
      name: Grant admin
      action: github:repo:collaborator:add
      # ... runs only after approval
```

No `gated` annotation is written by hand — a catalog processor derives it from the presence of the
`approval:gate` step, so the annotation cannot drift out of sync with the gate.

Running the template directly, bypassing the approvals UI, fails at step 1 before any real step
executes.

## Packages

| Package                                                                              | Role                                           |
| ------------------------------------------------------------------------------------ | ---------------------------------------------- |
| [scaffolder-approvals](./plugins/scaffolder-approvals)                               | Frontend: approvals page, home card, decorator |
| [scaffolder-approvals-backend](./plugins/scaffolder-approvals-backend)               | Requests, decisions, grants, sweeps            |
| [scaffolder-approvals-common](./plugins/scaffolder-approvals-common)                 | Shared types and permissions                   |
| [scaffolder-approvals-node](./plugins/scaffolder-approvals-node)                     | Backend-shared types and service refs          |
| [scaffolder-backend-module-approvals](./plugins/scaffolder-backend-module-approvals) | The `approval:gate` action                     |
| [catalog-backend-module-approvals](./plugins/catalog-backend-module-approvals)       | Derives the `gated` annotation                 |

## Configuration

Gate policy lives per-template. Only two global settings exist:

```yaml
scaffolderApprovals:
  grantTtl: { hours: 1 }
  retention:
    redactAfter: { days: 180 }
```

## Getting started

```sh
yarn install
yarn start
```

## Documentation

- [Design and decision record](../../GATED_SCAFFOLDER_WORKFLOWS.md)
- [Implementation guide](../../GATED_SCAFFOLDER_IMPLEMENTATION.md)
