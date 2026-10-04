# Plugins

The six Scaffolder Approvals packages. See the [package overview](../docs/README.md#packages) for how they fit together.

| Package                                                                      | Role              | What it does                                                        |
| ---------------------------------------------------------------------------- | ----------------- | ------------------------------------------------------------------- |
| [`scaffolder-approvals`](scaffolder-approvals)                               | Frontend plugin   | Approvals page, home-page card, gated review step and template card |
| [`scaffolder-approvals-backend`](scaffolder-approvals-backend)               | Backend plugin    | Requests, decisions and grants; starts approved templates; REST API |
| [`scaffolder-backend-module-approvals`](scaffolder-backend-module-approvals) | Scaffolder module | The `approval:gate` action                                          |
| [`catalog-backend-module-approvals`](catalog-backend-module-approvals)       | Catalog module    | Marks gated templates, and warns about gates that cannot work       |
| [`scaffolder-approvals-common`](scaffolder-approvals-common)                 | Common library    | Shared types, permissions and helpers                               |
| [`scaffolder-approvals-node`](scaffolder-approvals-node)                     | Node library      | Backend helpers and permission rules                                |

To add a new package, run `yarn new` from the repository root.
