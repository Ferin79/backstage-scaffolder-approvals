# @backstage-community/plugin-scaffolder-approvals-backend

Stores approval requests, decisions and grants; exposes the REST API the frontend and the `approval:gate` action talk to; and runs the scheduled sweeps that reconcile task status, time out stale requests and redact old request payloads.

## Installation

```ts
// packages/backend/src/index.ts
backend.add(import('@backstage-community/plugin-scaffolder-approvals-backend'));
```

Pair it with the gate action, which belongs in whichever backend runs the scaffolder:

```ts
backend.add(
  import('@backstage-community/plugin-scaffolder-backend-module-approvals'),
);
```

## Configuration

```yaml
scaffolderApprovals:
  # How long an approval grant stays redeemable after a request is approved.
  # Short by design: it is a single-use capability that only has to survive the
  # launch. Default: 1 hour.
  grantTtl: { hours: 1 }

  retention:
    # How long submitted values and the rendered summary are kept before being
    # redacted. Default: 180 days.
    redactAfter: { days: 180 }
```

That is the entire config surface. **Gate policy — who approves, how many, self-approval, timeout — is declared per template** in the `approval:gate` step, never here, so the people who own a template own its gate.

## API

| Route                         | Who                         | Notes                                                                                         |
| ----------------------------- | --------------------------- | --------------------------------------------------------------------------------------------- |
| `POST /requests`              | Any signed-in user          | `{ templateRef, values }`. 201, or 200 when an identical pending request was returned instead |
| `GET /requests`               | Any signed-in user          | `status`, `role`, `templateRef`, `requesterRef`, `limit`, `offset`                            |
| `GET /requests/:id`           | Any signed-in user          | The request plus its decision history                                                         |
| `POST /requests/:id/decision` | A designated approver       | `{ decision, comment? }`                                                                      |
| `POST /requests/:id/cancel`   | The requester               | Pending requests only                                                                         |
| `POST /grants/consume`        | **Service principals only** | The gate action redeems a grant here                                                          |

Reads are open to any signed-in user, matching the scaffolder's own task list. A deployment that configures a _conditional_ read policy gets a clear 403 rather than having the condition silently ignored.

## Sweeps

Three scheduled jobs, each capped per tick so a backlog built up during an outage drains steadily instead of arriving at the scaffolder all at once.

| Job            | Every | What it does                                                                                                                                 |
| -------------- | ----- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| Reconciliation | 2 min | Retries a launch that never happened, recovers a task id that was lost, fails a request whose grant expired unused, and syncs finished tasks |
| Timeouts       | 5 min | Expires pending requests nobody decided in time                                                                                              |
| Retention      | 6 h   | Redacts the values and summary of long-settled requests                                                                                      |

Scaffolder task events are the fast path for status; the reconciliation sweep is the backstop. A dropped event costs a request one sweep interval of staleness, not correctness.

**Retention redacts, never deletes.** What goes is the submitted values and the rendered summary, which can carry personal data such as an access justification. The request row and every decision on it are kept indefinitely — that audit trail is what this feature exists to produce. The values hash stays too, so a grant could still be checked.

## Optional integrations

Notifications and signals are soft dependencies: the backend starts and works with neither installed. What you lose is the notifications themselves and live-updating request pages. Delivery failures are logged and never undo a state change that has already been committed.

Four notifications are sent, each deep-linking to the request:

| Event     | Who hears about it      |
| --------- | ----------------------- |
| Submitted | Approvers               |
| Decided   | Requester               |
| Failed    | Requester and approvers |
| Expired   | Requester and approvers |

## Permissions

Four permissions, and three rules an RBAC policy can build conditions from: `IS_DESIGNATED_APPROVER`, `IS_NOT_REQUESTER` and `HAS_TEMPLATE_REF`. The permission check on a decision runs _in addition to_ the gate's own terms — either can refuse.

## Documentation

- [Design and decision record](../../docs/GATED_SCAFFOLDER_WORKFLOWS.md)
- [Implementation guide](../../docs/GATED_SCAFFOLDER_IMPLEMENTATION.md)
- [Plugin guide](../../docs/README.md)
