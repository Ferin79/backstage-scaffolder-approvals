# @backstage-community/plugin-scaffolder-approvals

The approvals UI: an inbox of requests awaiting your decision, a list of your own requests with their state, a request detail page with the decision history, and a homepage card showing what is pending.

Also ships a `scaffolderApiRef` decorator that diverts submission of a gated template to the approvals API. That decorator is a convenience only — the gate is enforced in the backend, so removing it changes the experience but not the guarantee.

## Documentation

- [Design and decision record](../../../../GATED_SCAFFOLDER_WORKFLOWS.md)
- [Implementation guide](../../../../GATED_SCAFFOLDER_IMPLEMENTATION.md)
- [Workspace README](../../README.md)
