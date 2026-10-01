# @backstage-community/plugin-scaffolder-approvals-node

Node-side building blocks shared by the scaffolder-approvals backend and its two modules. Not something an app installs directly — it is a dependency of those packages.

## What is in it

| Export                                                      | Used by                 | Purpose                                                                                                                                                   |
| ----------------------------------------------------------- | ----------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `computeValuesHash`                                         | backend, gate action    | SHA-256 of the canonical JSON of a template's parameters. Computed at submit and again inside the running task; the two must agree for a grant to redeem. |
| `generateGrantToken`, `hashGrantToken`                      | backend                 | A 256-bit single-use token, and the hash that is the only form ever stored.                                                                               |
| `formatGrant`, `parseGrant`                                 | backend                 | The `<requestId>.<token>` string handed to a task as a secret.                                                                                            |
| `findGateStep`, `isGated`                                   | backend, catalog module | One definition of "this template is gated", so the service and the derived annotation cannot disagree.                                                    |
| `approvalRequestResourceRef` and the three permission rules | backend                 | `IS_DESIGNATED_APPROVER`, `IS_NOT_REQUESTER`, `HAS_TEMPLATE_REF`, for RBAC policies.                                                                      |
| `assertSha256Hex`, `isSha256Hex`, `sha256Hex`               | backend                 | Guards on the store boundary, so a raw token can never be persisted where a hash belongs.                                                                 |

`findGateStep` rejects a gate that is not the first step and a template with more than one gate. `isGated` is deliberately laxer: a template with a malformed gate still counts as gated, because reading it as ungated would make it freely runnable.

## A note on BEP-0016

Core Backstage may eventually gain a suspend/resume primitive for scaffolder tasks ([BEP-0016](https://github.com/backstage/backstage/pull/34966)), which would let a gate park a running task instead of refusing to start it. Adopting that would change how an approved request is launched. **That logic currently lives in `ApprovalService.launch` in the backend package, not behind an interface here** — so the migration would touch the backend, not only this package.

## Documentation

- [Design and decision record](../../docs/GATED_SCAFFOLDER_WORKFLOWS.md)
- [Implementation guide](../../docs/GATED_SCAFFOLDER_IMPLEMENTATION.md)
- [Plugin guide](../../docs/README.md)
