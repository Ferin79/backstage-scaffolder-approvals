# @backstage-community/plugin-catalog-backend-module-approvals

Derives the `scaffolder-approvals.backstage.io/gated` annotation on Template entities from the presence of an `approval:gate` step.

Template authors declare the gate step and nothing else. Because the annotation is computed rather than authored, it cannot drift out of sync with the gate — an annotated-but-ungated template, which would look protected in the UI while running unprotected, cannot exist.

## Documentation

- [Design and decision record](../../../../GATED_SCAFFOLDER_WORKFLOWS.md)
- [Implementation guide](../../../../GATED_SCAFFOLDER_IMPLEMENTATION.md)
- [Workspace README](../../README.md)
