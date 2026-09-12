# @backstage-community/plugin-scaffolder-backend-module-approvals

Provides the `approval:gate` scaffolder action.

This action is the enforcement point. A gated template carries it as its first step; the action demands a single-use grant, minted by the approvals backend only once a request has been approved, and throws without one. Running a gated template directly — bypassing the approvals UI — therefore fails before any real step executes.

## Documentation

- [Design and decision record](../../../../GATED_SCAFFOLDER_WORKFLOWS.md)
- [Implementation guide](../../../../GATED_SCAFFOLDER_IMPLEMENTATION.md)
- [Workspace README](../../README.md)
