# @backstage-community/plugin-scaffolder-approvals-node

Backend-shared building blocks for scaffolder-approvals: the permission resource reference and rules, and the launcher interface that the backend uses to start an approved template.

The launcher is kept behind a single interface deliberately. It is the one seam that changes if Backstage core gains a suspend/resume primitive ([BEP-0016](https://github.com/backstage/backstage/pull/34966)) — "launch a new task" becomes "resume a parked task", and nothing else in the plugin moves.

## Documentation

- [Design and decision record](../../../../GATED_SCAFFOLDER_WORKFLOWS.md)
- [Implementation guide](../../../../GATED_SCAFFOLDER_IMPLEMENTATION.md)
- [Workspace README](../../README.md)
