# @ferin79/backstage-plugin-scaffolder-approvals-backend

The backend for [Scaffolder Approvals](https://github.com/Ferin79/backstage-scaffolder-approvals): approval gates for Backstage software templates.

It stores approval requests and decisions, mints the single-use grant that lets an approved template run, starts approved templates, and serves the REST API used by the frontend and by the `approval:gate` action. Scheduled jobs keep request status in step with the scaffolder, expire requests nobody decided on, and redact old submitted values.

## Installation

This plugin works together with two backend modules. Install all three:

```sh
yarn --cwd packages/backend add \
  @ferin79/backstage-plugin-scaffolder-approvals-backend \
  @ferin79/backstage-plugin-scaffolder-backend-module-approvals \
  @ferin79/backstage-plugin-catalog-backend-module-approvals
```

```ts
// packages/backend/src/index.ts
backend.add(import('@ferin79/backstage-plugin-scaffolder-approvals-backend'));

// In the backend that runs the scaffolder:
backend.add(
  import('@ferin79/backstage-plugin-scaffolder-backend-module-approvals'),
);

// In the backend that runs the catalog:
backend.add(
  import('@ferin79/backstage-plugin-catalog-backend-module-approvals'),
);
```

Requirements: the new backend system, the scaffolder and catalog backends, and `@backstage/plugin-catalog-backend-module-scaffolder-entity-model`. The plugin creates and migrates its own database tables on start-up.

### Optional integrations

The plugin starts and works without these; each one improves the experience:

| Plugin                                    | Adds                                                                                           |
| ----------------------------------------- | ---------------------------------------------------------------------------------------------- |
| `@backstage/plugin-notifications-backend` | Notifications to approvers and requesters                                                      |
| `@backstage/plugin-signals-backend`       | Live-updating request pages, inbox and home-page card                                          |
| `@backstage/plugin-events-backend`        | Immediate task status, and approval events on the `scaffolder-approvals` topic for other tools |

## Configuration

Everything is optional. The defaults:

```yaml
scaffolderApprovals:
  # How long an approval stays usable once granted. Also '1h' or 'PT1H'.
  grantTtl: { hours: 1 }
  retention:
    # How long submitted values and the summary are kept after a request
    # settles, before being redacted. The request and its decisions are kept.
    redactAfter: { days: 180 }
  # Service principals allowed to redeem grants. Widen only for split deployments.
  grantConsumers: ['plugin:scaffolder']
```

Durations are checked at start-up; an invalid one stops the backend with an error naming the key.

**Gate policy is not configured here.** Who approves, how many, self-approval and timeout are set in each template's `approval:gate` step, so the people who own a template own its gate.

See [Configuration](https://github.com/Ferin79/backstage-scaffolder-approvals/blob/main/docs/configuration.md) for details.

## REST API

Mounted at `/api/scaffolder-approvals`.

| Route                         | Who                   | Purpose                                                                                                     |
| ----------------------------- | --------------------- | ----------------------------------------------------------------------------------------------------------- |
| `POST /requests`              | Any signed-in user    | Submit a request: `{ templateRef, values }`                                                                 |
| `GET /requests`               | Any signed-in user    | List requests, filtered by `status`, `role`, `actionable`, `templateRef`, `requesterRef`, `limit`, `offset` |
| `GET /requests/:id`           | Any signed-in user    | One request, its decisions, and any template drift                                                          |
| `POST /requests/:id/decision` | A designated approver | Approve or deny: `{ decision, comment? }`                                                                   |
| `POST /requests/:id/cancel`   | The requester         | Withdraw a pending request                                                                                  |
| `POST /grants/consume`        | The scaffolder only   | Redeem a grant, from the `approval:gate` action                                                             |

Full request and response shapes are in the [API reference](https://github.com/Ferin79/backstage-scaffolder-approvals/blob/main/docs/api-reference.md).

## Scheduled jobs

| Job id                           | Every     | What it does                                                                                          |
| -------------------------------- | --------- | ----------------------------------------------------------------------------------------------------- |
| `scaffolder-approvals-reconcile` | 2 minutes | Retries launches that did not happen, fails requests whose grant expired unused, syncs finished tasks |
| `scaffolder-approvals-timeouts`  | 5 minutes | Expires pending requests past their gate's timeout                                                    |
| `scaffolder-approvals-retention` | 6 hours   | Redacts the values and summary of long-settled requests                                               |

Each run handles a capped batch, so a backlog built up during an outage drains steadily. Scaffolder task events are the fast path for status; the reconciliation job is the backstop.

**Retention redacts, never deletes.** The request, who asked, every decision and the values hash are kept indefinitely: that is the audit trail.

## Notifications

| Notification               | Sent to                                   |
| -------------------------- | ----------------------------------------- |
| Approval requested         | Approvers                                 |
| Request approved / denied  | Requester                                 |
| Approved request failed    | Requester and approvers                   |
| Approval request expired   | Requester and approvers                   |
| Approval request withdrawn | Approvers (replaces "Approval requested") |

Each links to `<app.baseUrl>/scaffolder-approvals/requests/<id>`. See [Notifications, events and signals](https://github.com/Ferin79/backstage-scaffolder-approvals/blob/main/docs/notifications-and-events.md).

## Permissions

Four permissions, registered with the permission framework: `scaffolderApprovals.request.create`, `.read`, `.decide` and `.cancel`, on the resource type `scaffolder-approval-request`, with the rules `IS_DESIGNATED_APPROVER`, `IS_NOT_REQUESTER` and `HAS_TEMPLATE_REF`. A policy can narrow who may decide, but never adds approvers: the gate's own terms always apply as well.

See [Security model and permissions](https://github.com/Ferin79/backstage-scaffolder-approvals/blob/main/docs/security-model.md) for an example policy.

## Audit events

Through the Backstage auditor service: `request-submit`, `request-decide`, `request-cancel` and `grant-consume`.

## Documentation

- [Getting started](https://github.com/Ferin79/backstage-scaffolder-approvals/blob/main/docs/getting-started.md)
- [Configuration](https://github.com/Ferin79/backstage-scaffolder-approvals/blob/main/docs/configuration.md)
- [Security model and permissions](https://github.com/Ferin79/backstage-scaffolder-approvals/blob/main/docs/security-model.md)
- [All documentation](https://github.com/Ferin79/backstage-scaffolder-approvals/blob/main/docs/README.md)
