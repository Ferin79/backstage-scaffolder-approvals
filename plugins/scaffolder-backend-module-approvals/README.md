# @ferin79/backstage-plugin-scaffolder-backend-module-approvals

A scaffolder backend module that provides the **`approval:gate`** action, part of [Scaffolder Approvals](https://github.com/Ferin79/backstage-scaffolder-approvals).

The gate is where approval is enforced. A gated template has `approval:gate` as its first step. The step only lets the run continue if the task holds a single-use grant, which the approvals backend mints only when a request has been approved. Started any other way, including by calling the scaffolder API directly, the template fails at this step and nothing after it runs.

## Installation

Install it in the **same backend as the scaffolder**, together with the approvals backend:

```sh
yarn --cwd packages/backend add \
  @ferin79/backstage-plugin-scaffolder-backend-module-approvals \
  @ferin79/backstage-plugin-scaffolder-approvals-backend
```

```ts
// packages/backend/src/index.ts
backend.add(import('@backstage/plugin-scaffolder-backend'));
backend.add(
  import('@ferin79/backstage-plugin-scaffolder-backend-module-approvals'),
);
backend.add(import('@ferin79/backstage-plugin-scaffolder-approvals-backend'));
```

The action reaches the approvals backend through discovery, so in a split deployment the scaffolder's backend must be able to resolve the `scaffolder-approvals` plugin.

## Gating a template

Add the gate as the first step:

```yaml
apiVersion: scaffolder.backstage.io/v1beta3
kind: Template
metadata:
  name: request-github-admin
  title: Request GitHub admin access
spec:
  type: service
  owner: group:default/devx-team
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
        approvers: [group:default/devx-team]
        quorum: 2
        timeout: { hours: 72 }
        summary: 'Admin on ${{ parameters.repository }}'
        values: ${{ parameters }}

    # Runs only after approval. Replace with the action that does the work.
    - id: grant
      name: Grant access
      action: debug:log
      input:
        message: >-
          Admin on ${{ parameters.repository }} for
          ${{ steps.gate.output.requestedBy }}, approved by
          ${{ steps.gate.output.approvedBy }}
```

Nothing else is needed: the catalog module ([`@ferin79/backstage-plugin-catalog-backend-module-approvals`](https://github.com/Ferin79/backstage-scaffolder-approvals/tree/main/plugins/catalog-backend-module-approvals)) marks the template as gated because it has this step.

## Input

| Field         | Required | Default        | Description                                                                                                                                                           |
| ------------- | -------- | -------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `approvers`   | Yes      |                | Group or user entity refs whose members may decide. Must include the kind (`group:` or `user:`); the namespace defaults to `default`. Cannot be a template expression |
| `values`      | Yes      |                | Always exactly `${{ parameters }}`. The gate checks these against the approved values                                                                                 |
| `quorum`      | No       | `1`            | How many different people must approve. May exceed the number of `approvers` entries, since a group has many members                                                  |
| `selfApprove` | No       | `false`        | Whether the requester may approve their own request                                                                                                                   |
| `timeout`     | No       | No timeout     | How long the request may wait, such as `{ hours: 72 }`. Must be greater than zero                                                                                     |
| `summary`     | No       | Template title | What approvers see. `${{ parameters.<path> }}` is filled in                                                                                                           |

One denial rejects a request, whatever the approval count.

## Output

An approved run is started by the approvals plugin's service principal, so the task does not know who asked. Use these instead:

| Output        | Description                                          |
| ------------- | ---------------------------------------------------- |
| `requestId`   | The approval request that unlocked this run          |
| `requestedBy` | Entity ref of the person who asked                   |
| `approvedBy`  | Entity refs of the people who approved, oldest first |

`${{ user.* }}` is empty in an approved run, and `secrets.USER_OAUTH_TOKEN` will have expired; use these outputs and integration credentials instead.

## Rules

The approvals backend refuses requests for a template that breaks any of these, and the catalog module warns about it:

- the gate is the **first** step, and there is **only one**;
- `values` is exactly `${{ parameters }}`;
- the gate has no `if:` or `each:`;
- no later step runs on `always()` or `failure()`;
- the gate carries every `backstage:permissions.tags` value that another step carries;
- the template has no `ui:field: Secret` parameters.

[Writing gated templates](https://github.com/Ferin79/backstage-scaffolder-approvals/blob/main/docs/writing-gated-templates.md) explains each one.

## Behaviour

- **Dry runs fail at the gate.** A dry run has no grant, and pretending it had one would make the gate look passable.
- **An unreachable approvals backend fails the step.** An outage never turns into an ungated run.
- **Every refusal reads the same,** whether the grant was used, expired, or bound to different values, so a token holder cannot learn which part to change.

## Documentation

- [Writing gated templates](https://github.com/Ferin79/backstage-scaffolder-approvals/blob/main/docs/writing-gated-templates.md)
- [Security model](https://github.com/Ferin79/backstage-scaffolder-approvals/blob/main/docs/security-model.md)
- [All documentation](https://github.com/Ferin79/backstage-scaffolder-approvals/blob/main/docs/README.md)
