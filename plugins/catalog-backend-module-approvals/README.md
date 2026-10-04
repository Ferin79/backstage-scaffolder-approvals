# @ferin79/backstage-plugin-catalog-backend-module-approvals

A catalog backend module, part of [Scaffolder Approvals](https://github.com/Ferin79/backstage-scaffolder-approvals), that marks gated templates and warns about gates that cannot work.

A template counts as gated because it has an `approval:gate` step, not because someone wrote an annotation. This module derives the annotation from the step, so the two cannot get out of step:

```yaml
metadata:
  annotations:
    scaffolder-approvals.backstage.io/gated: 'true'
```

The frontend uses this annotation to show approvers on the Create page and to turn the wizard's last step into **Request approval**.

## Installation

Install it in the **same backend as the catalog**:

```sh
yarn --cwd packages/backend add @ferin79/backstage-plugin-catalog-backend-module-approvals
```

```ts
// packages/backend/src/index.ts
backend.add(import('@backstage/plugin-catalog-backend'));
backend.add(
  import('@backstage/plugin-catalog-backend-module-scaffolder-entity-model'),
);
backend.add(
  import('@ferin79/backstage-plugin-catalog-backend-module-approvals'),
);
```

The catalog also needs `@backstage/plugin-catalog-backend-module-scaffolder-entity-model`, which most apps with a scaffolder already have. Without it the catalog does not recognise the `Template` kind and drops templates **silently**.

Without this module, gated templates are still gated (the step enforces that), but the UI cannot tell which templates need approval, so people meet the gate as a failed task instead of a request form.

## What it does

- **Adds** `scaffolder-approvals.backstage.io/gated: 'true'` to any Template with an `approval:gate` step.
- **Removes** it from any Template without one, including a hand-written one, so a template can never look gated without being gated.
- **Leaves everything else alone.** Other kinds, and ungated templates without the annotation, are returned unchanged.

A template with a broken gate (not the first step, or two gates) still counts as gated: a template trying to be gated must never look freely runnable.

The annotation does not enforce anything. The gate step does.

## Warnings

The module logs a warning, and never blocks ingestion, when a gated template will not work as intended:

| Warning                                                                                 | Why it matters                                                                         |
| --------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| `has an unusable gate:` the gate is not first, or there are two                         | Steps before the gate would run before anyone approved                                 |
| `has an unusable gate:` about `values`                                                  | The gate cannot check the run against the approval, so it can never pass               |
| `has an unusable gate:` about `if:`, `each:`, `always()`/`failure()` or permission tags | The scaffolder could run steps without the gate passing                                |
| `has an unusable gate policy:`                                                          | `approvers`, `quorum`, `selfApprove` or `timeout` is invalid                           |
| `is gated but declares secret-typed parameter(s)`                                       | Secrets cannot survive the wait; requests are refused                                  |
| `is gated but a later step uses secrets.USER_OAUTH_TOKEN`                               | The requester's token will have expired by the time the run starts                     |
| `is gated but a later step reads '${{ user.* }}'`                                       | Approved runs have no user, so those render empty. Use `steps.gate.output.requestedBy` |

They are warnings on purpose. An error that kept a template out of the catalog would make _deleting the gate_ the way to get it back, which is the wrong incentive.

## Accepted risk

Nothing here stops a template's owners from removing its gate, and there is no list of templates that must be gated. Protect gated templates with CODEOWNERS, alert when the annotation disappears from a template, and deny high-risk actions to users with a permission policy. See [Security model](https://github.com/Ferin79/backstage-scaffolder-approvals/blob/main/docs/security-model.md#accepted-risks).

## Documentation

- [Writing gated templates](https://github.com/Ferin79/backstage-scaffolder-approvals/blob/main/docs/writing-gated-templates.md)
- [Troubleshooting](https://github.com/Ferin79/backstage-scaffolder-approvals/blob/main/docs/troubleshooting.md#templates)
- [All documentation](https://github.com/Ferin79/backstage-scaffolder-approvals/blob/main/docs/README.md)
