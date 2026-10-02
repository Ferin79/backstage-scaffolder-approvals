# @ferin79/backstage-plugin-catalog-backend-module-approvals

Derives the `scaffolder-approvals.backstage.io/gated` annotation on Template entities.

A template is marked as gated because it carries an `approval:gate` step — not because anyone wrote an annotation. Template authors declare the step and nothing else, so there is no second place to keep in sync and the annotation cannot drift away from the gate it describes.

## Installation

```ts
// packages/backend/src/index.ts
backend.add(
  import('@ferin79/backstage-plugin-catalog-backend-module-approvals'),
);
```

The catalog also needs `@backstage/plugin-catalog-backend-module-scaffolder-entity-model`, which most apps with a scaffolder already have. Without it the catalog does not recognise the `Template` kind and drops those entities **silently**. Nothing reaches this processor, and nothing reports an error either.

This module is optional. Without it, gated templates are still gated — the gate step is what enforces that — but the UI cannot tell which templates need an approval, so it will offer to launch them directly and people will meet the gate as a failure rather than as a form.

## What it does

- **Stamps** `gated: 'true'` on any Template with an `approval:gate` step.
- **Strips** the annotation from a Template without one, including a hand-written one. Only adding it would leave the mismatch that matters open: an annotated-but-ungated template would send people through an approval flow for something they could simply run.
- **Leaves everything else alone.** Non-Template kinds and ungated templates come back as the exact same object, so a refresh cycle does no work.

A template with a _malformed_ gate — one that is not the first step, or a second gate — still counts as gated. A template trying to be gated and failing must not read as freely runnable.

## What the annotation is not

It is not what enforces anything. It tells the UI which templates to route through the approvals page. The enforcement is the gate step itself, and a template that somehow lost its annotation but kept its step is still gated.

## Warnings

The processor logs, and never blocks ingestion, when a gated template looks wrong:

| Warning                                      | Why it matters                                                                            |
| -------------------------------------------- | ----------------------------------------------------------------------------------------- |
| Gate is not the first step                   | Steps before it run before anyone has approved, while the template looks gated            |
| More than one gate                           | Which policy applies is ambiguous, and the second grant could never be satisfied          |
| Gate has no `values` input                   | The gate cannot check the run against what was approved, so it refuses every run          |
| A later step uses `secrets.USER_OAUTH_TOKEN` | That token belongs to the requester and expires long before a multi-day approval finishes |

These are warnings on purpose. An error that kept a template out of the catalog would make _deleting the gate_ the way to make it appear again, which is the wrong incentive for the one step that enforces anything.

> **Accepted risk.** Nothing here prevents a template owner from removing a gate; there is no allowlist of templates that must be gated. Mitigate with CODEOWNERS on gated template files, and by alerting when the derived annotation disappears from an entity. This was a deliberate decision — see the design record before adding enforcement.

## Documentation

- [Design and decision record](../../docs/GATED_SCAFFOLDER_WORKFLOWS.md)
- [Implementation guide](../../docs/GATED_SCAFFOLDER_IMPLEMENTATION.md)
- [Plugin guide](../../docs/README.md)
