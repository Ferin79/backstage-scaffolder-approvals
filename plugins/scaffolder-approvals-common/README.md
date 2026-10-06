# @ferin79/backstage-plugin-scaffolder-approvals-common

Types, permissions, constants and helpers shared by every [Scaffolder Approvals](https://github.com/Ferin79/backstage-scaffolder-approvals) package. It has no Node-only dependencies, so it is safe to import from frontend and backend code.

You do not install it yourself: the other packages depend on it. Import from it when you write a permission policy, an events subscriber, or UI that needs to agree with the backend.

```sh
yarn --cwd packages/backend add @ferin79/backstage-plugin-scaffolder-approvals-common
```

## Permissions

| Export                            | Name                                 | Type     | Guards                       |
| --------------------------------- | ------------------------------------ | -------- | ---------------------------- |
| `approvalRequestCreatePermission` | `scaffolderApprovals.request.create` | Basic    | Submitting a request         |
| `approvalRequestReadPermission`   | `scaffolderApprovals.request.read`   | Resource | Listing and reading requests |
| `approvalRequestDecidePermission` | `scaffolderApprovals.request.decide` | Resource | Approving or denying         |
| `approvalRequestCancelPermission` | `scaffolderApprovals.request.cancel` | Resource | Withdrawing a request        |

`scaffolderApprovalsPermissions` lists all four. The resource type is `RESOURCE_TYPE_APPROVAL_REQUEST` (`scaffolder-approval-request`). The permission rules are in [`-node`](https://github.com/Ferin79/backstage-scaffolder-approvals/tree/main/plugins/scaffolder-approvals-node).

```ts
import { isPermission } from '@backstage/plugin-permission-common';
import { approvalRequestDecidePermission } from '@ferin79/backstage-plugin-scaffolder-approvals-common';

if (isPermission(request.permission, approvalRequestDecidePermission)) {
  // ...
}
```

A full example policy is in [Security model and permissions](https://github.com/Ferin79/backstage-scaffolder-approvals/blob/main/docs/security-model.md#example-policy).

## Types

`ApprovalRequest`, `ApprovalRequestWithDecisions`, `ApprovalDecision`, `ApprovalRequestStatus`, `GatePolicy`, `TemplateDrift`, and the request and response shapes of the backend API (`ListApprovalRequestsOptions`, `ListApprovalRequestsResponse`, `SubmitApprovalRequestOptions`, `SubmitApprovalRequestResponse`, `ConsumeGrantRequest`, `ConsumeGrantResponse`, and so on).

`APPROVAL_REQUEST_STATUSES` and `TERMINAL_APPROVAL_REQUEST_STATUSES` list the statuses.

## Constants

| Export                           | Value                                     | Use                                                  |
| -------------------------------- | ----------------------------------------- | ---------------------------------------------------- |
| `SCAFFOLDER_APPROVALS_PLUGIN_ID` | `scaffolder-approvals`                    | Plugin id; also the events topic                     |
| `APPROVALS_SIGNAL_CHANNEL`       | `scaffolder-approvals`                    | The signals channel request changes are broadcast on |
| `GATE_ACTION_ID`                 | `approval:gate`                           | The gate action's id                                 |
| `GATED_ANNOTATION`               | `scaffolder-approvals.backstage.io/gated` | The annotation the catalog module derives            |
| `APPROVAL_GRANT_SECRET`          | `APPROVAL_GRANT`                          | The task secret carrying the grant                   |
| `DEFAULT_QUORUM`                 | `1`                                       |                                                      |
| `DEFAULT_SELF_APPROVE`           | `false`                                   |                                                      |

## Helpers

Each is shared because two sides of the system must give the same answer:

| Helper                     | What it does                                                                                                                                                                                                                                                                  |
| -------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `checkDecisionEligibility` | Whether someone may decide on a request and, if not, why: not an approver, their own request, already voted, or no longer pending. `DECISION_INELIGIBILITY_MESSAGES` words each reason; the backend refuses with them and the UI explains a missing button with the same ones |
| `computeQuorumProgress`    | "1 of 2 approvals", and whether a denial has rejected the request                                                                                                                                                                                                             |
| `readGatePolicy`           | Parses and normalises an `approval:gate` step's input, so `Group:DevX` and `group:default/devx` match                                                                                                                                                                         |
| `checkGatedTemplate`       | Whether a template is gated and, if its gate is unusable, why. The backend runs it at submit, the catalog module at ingestion and the wizard before it offers "Request approval"                                                                                              |
| `findGateStep`             | A template's `approval:gate` step, refusing the shapes a direct run could slip past                                                                                                                                                                                           |
| `isSameEntityRef`          | Whether two entity refs name the same entity, whatever their casing or namespace spelling; `tryNormaliseEntityRef` is the single-ref form                                                                                                                                     |
| `canonicalJson`            | Deterministic JSON, the input to the values hash that binds a grant to the approved values. Throws rather than coercing values JSON cannot represent                                                                                                                          |
| `renderGateSummary`        | Fills `${{ parameters.<path> }}` in a gate's summary for display; everything else is left as written                                                                                                                                                                          |
| `findSecretParameters`     | The parameters a template declares as `ui:field: Secret`                                                                                                                                                                                                                      |

## Documentation

- [All documentation](https://github.com/Ferin79/backstage-scaffolder-approvals/blob/main/docs/README.md)
- [API reference](https://github.com/Ferin79/backstage-scaffolder-approvals/blob/main/docs/api-reference.md)
