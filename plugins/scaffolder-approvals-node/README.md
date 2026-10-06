# @ferin79/backstage-plugin-scaffolder-approvals-node

Backend building blocks shared by the [Scaffolder Approvals](https://github.com/Ferin79/backstage-scaffolder-approvals) backend plugin and its two modules.

You do not install it yourself: the backend packages depend on it. Import from it when you write a **permission policy** with conditions on approval requests.

```sh
yarn --cwd packages/backend add @ferin79/backstage-plugin-scaffolder-approvals-node
```

## Permission rules

| Export                 | Rule name                | Parameters               | Matches a request when…                        |
| ---------------------- | ------------------------ | ------------------------ | ---------------------------------------------- |
| `isDesignatedApprover` | `IS_DESIGNATED_APPROVER` | `userRefs: string[]`     | any of the refs is one of the gate's approvers |
| `isNotRequester`       | `IS_NOT_REQUESTER`       | `userRef: string`        | that user did not submit it                    |
| `hasTemplateRef`       | `HAS_TEMPLATE_REF`       | `templateRefs: string[]` | it is for one of these templates               |

`approvalRequestResourceRef` is the resource ref they apply to, and `scaffolderApprovalsPermissionRules` lists all three. Build conditions with `createConditionExports` from `@backstage/plugin-permission-node`:

```ts
import { createConditionExports } from '@backstage/plugin-permission-node';
import {
  approvalRequestResourceRef,
  hasTemplateRef,
  isDesignatedApprover,
  isNotRequester,
} from '@ferin79/backstage-plugin-scaffolder-approvals-node';

const { conditions, createConditionalDecision } = createConditionExports({
  resourceRef: approvalRequestResourceRef,
  rules: { hasTemplateRef, isDesignatedApprover, isNotRequester },
});

// In a policy, for scaffolderApprovals.request.decide:
return createConditionalDecision(request.permission, {
  not: conditions.hasTemplateRef({
    templateRefs: ['template:default/provision-service'],
  }),
});
```

Conditions work for deciding, withdrawing and reading one request. Give listing (`scaffolderApprovals.request.read`) a plain allow or deny. A complete policy is in [Security model and permissions](https://github.com/Ferin79/backstage-scaffolder-approvals/blob/main/docs/security-model.md#example-policy).

## Other exports

These are used inside the plugin; they are public so the backend and both modules share one definition. Checks that do not need Node, such as `findGateStep` and `checkGatedTemplate`, live in [`-common`](https://github.com/Ferin79/backstage-scaffolder-approvals/tree/main/plugins/scaffolder-approvals-common) so the wizard can run them too.

| Export                                        | Used by              | Purpose                                                                                                                                 |
| --------------------------------------------- | -------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| `computeValuesHash`                           | Backend, gate action | SHA-256 of the canonical JSON of a template's parameters. Computed at submit and inside the task; they must match for a grant to redeem |
| `generateGrantToken`, `hashGrantToken`        | Backend              | A 256-bit single-use token, and the hash that is the only form stored                                                                   |
| `formatGrant`, `parseGrant`                   | Backend, gate action | The `<requestId>.<token>` string handed to a task as a secret                                                                           |
| `computeTemplateStepsHash`, `compareTemplate` | Backend              | Detecting that a template changed while a request waited                                                                                |
| `sha256Hex`, `isSha256Hex`, `assertSha256Hex` | Backend              | Guards that keep a raw token from ever being stored where a hash belongs                                                                |

## A note on BEP-0016

Backstage core may gain a way to pause and resume scaffolder tasks ([BEP-0016](https://github.com/backstage/backstage/pull/34966)), which would let a gate pause a running task instead of refusing to start it. Adopting it would change how approved requests are launched. That logic is in `ApprovalService.launch` in the backend package, not behind an interface here, so the change would touch the backend.

## Documentation

- [Security model and permissions](https://github.com/Ferin79/backstage-scaffolder-approvals/blob/main/docs/security-model.md)
- [All documentation](https://github.com/Ferin79/backstage-scaffolder-approvals/blob/main/docs/README.md)
