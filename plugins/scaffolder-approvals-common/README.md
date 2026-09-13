# @backstage-community/plugin-scaffolder-approvals-common

Types, permissions and pure helpers shared by every scaffolder-approvals package. Isomorphic — safe to import from frontend and backend code alike, with no Node-only dependencies.

Most apps never import it directly. It is worth knowing about if you are writing an RBAC policy, a notification consumer, or a UI that has to agree with the backend.

## What is in it

**Types.** `ApprovalRequest`, `ApprovalDecision`, `GatePolicy`, `ApprovalRequestStatus`, and the request and response shapes of the backend API — including `ConsumeGrantRequest` and `ConsumeGrantResponse`, which the gate action and the backend router are both typed against so that neither can drift from the other.

**Permissions.** Four, for use in a permission policy:

| Permission                           | Type     | Guards                       |
| ------------------------------------ | -------- | ---------------------------- |
| `scaffolderApprovals.request.create` | basic    | Submitting a request         |
| `scaffolderApprovals.request.read`   | resource | Listing and reading requests |
| `scaffolderApprovals.request.decide` | resource | Approving or denying         |
| `scaffolderApprovals.request.cancel` | resource | Withdrawing a request        |

**Helpers**, each shared because two sides of the system must agree on the answer:

- `checkDecisionEligibility` — whether someone may decide on a request, and if not, why: not an approver, self-approval, already voted, or no longer pending. The backend refuses with these reasons and the UI explains a withheld button with the same ones.
- `computeQuorumProgress` — "1 of 2 approvals". A single denial rejects a request outright; a quorum is a threshold for assent, not a tally.
- `readGatePolicy` — parses and normalises an `approval:gate` step's input. Entity refs are normalised, so `Group:DevX` and `group:default/devx` match.
- `canonicalJson` — deterministic JSON, the input to the values hash that binds a grant to the parameters that were approved. It throws rather than coercing values JSON cannot represent, since coercion would let two different inputs share a hash.
- `renderGateSummary` — fills `${{ parameters.<path> }}` in a gate's summary. The scaffolder's own templating has not run when an approver reads it, so without this they would see the literal expression. Deliberately not a templating engine: anything other than that one form is left exactly as written.

## Documentation

- [Design and decision record](../../../../GATED_SCAFFOLDER_WORKFLOWS.md)
- [Implementation guide](../../../../GATED_SCAFFOLDER_IMPLEMENTATION.md)
- [Workspace README](../../README.md)
