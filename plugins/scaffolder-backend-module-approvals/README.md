# @backstage-community/plugin-scaffolder-backend-module-approvals

Provides the `approval:gate` scaffolder action.

This action is the enforcement point. A gated template carries it as its first step; the action demands a single-use grant, minted by the approvals backend only once a request has been approved, and throws without one. Running a gated template directly — bypassing the approvals UI — therefore fails before any real step executes.

## Installation

```ts
// packages/backend/src/index.ts
backend.add(
  import('@backstage-community/plugin-scaffolder-backend-module-approvals'),
);
```

Install it in the same backend as the scaffolder. It needs the approvals backend (`@backstage-community/plugin-scaffolder-approvals-backend`) to be reachable through discovery.

## Gating a template

Add the step first, before anything that has an effect:

```yaml
apiVersion: scaffolder.backstage.io/v1beta3
kind: Template
metadata:
  name: request-github-admin
spec:
  type: service
  parameters:
    - title: Access
      required: [repository, justification]
      properties:
        repository:
          type: string
        justification:
          type: string

  steps:
    - id: gate
      name: Await approval
      action: approval:gate
      input:
        approvers:
          - group:default/devx-team
        quorum: 2
        summary: 'Admin on ${{ parameters.repository }}'
        values: ${{ parameters }}

    - id: grant
      name: Grant access
      action: github:admin:grant
      input:
        repository: ${{ parameters.repository }}
        requestedBy: ${{ steps.gate.output.requestedBy }}
```

Nothing else is needed. The `gated` annotation is derived from the presence of this step, so there is no second place to keep in sync.

### `values: ${{ parameters }}` is not optional

It is how the gate checks that the run matches what was approved. The action hashes these and the backend compares that against the hash it bound the grant to when the request was submitted, so a grant cannot be redeemed against a task running different parameters.

A gate step without it fails rather than running unchecked. `${{ parameters }}` is the same whole-object form `fetch:template` uses.

### The gate must be first, and there may be only one

Any step before the gate would run before anyone had approved, while the template still looked gated. Both shapes are rejected outright rather than interpreted.

## Input

| Field         | Required | Description                                                                                                                         |
| ------------- | -------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| `approvers`   | yes      | Group or user entity refs that may decide. Case and namespace are normalised.                                                       |
| `values`      | yes      | Always `${{ parameters }}`. See above.                                                                                              |
| `quorum`      | no       | How many **distinct** principals must approve. Default 1. May exceed `approvers.length`, since one group can expand to many people. |
| `selfApprove` | no       | Whether the requester may approve their own request. Default `false`.                                                               |
| `timeout`     | no       | How long the request may stay pending, as a `HumanDuration` such as `{ hours: 72 }`. Default: forever.                              |
| `summary`     | no       | A short description of the ask, shown to approvers. Templated, so it can reference `parameters`.                                    |

A single denial rejects the request outright, whatever the approval count — a quorum is a threshold for assent, not a tally.

## Output

The task is launched by this plugin's service principal, so `task.createdBy` names the plugin rather than a person. These outputs are the only record of who actually asked and who agreed, and later steps should use them wherever they would otherwise reach for the task's creator.

| Field         | Description                                          |
| ------------- | ---------------------------------------------------- |
| `requestId`   | The approval request that unlocked this run          |
| `requestedBy` | Entity ref of the person who asked                   |
| `approvedBy`  | Entity refs of the people who approved, oldest first |

## Notes

- **Dry runs do not exercise the gate.** A dry run has no grant, and pretending to hold one would make the gate look passable.
- **An unreachable approvals backend fails the step.** Treating an outage as a pass would turn it into an ungated execution.
- **Every refusal reads the same.** Whether the grant was already used, expired, or bound to different parameters, the answer is identical — distinguishing them would tell a token holder which part to change.

## Documentation

- [Design and decision record](../../docs/GATED_SCAFFOLDER_WORKFLOWS.md)
- [Implementation guide](../../docs/GATED_SCAFFOLDER_IMPLEMENTATION.md)
- [Plugin guide](../../docs/README.md)
