# Notifications, events and signals

Every change to a request is sent out three ways, each through an optional Backstage plugin:

| Channel                         | For                                       | Needs                            |
| ------------------------------- | ----------------------------------------- | -------------------------------- |
| [Notifications](#notifications) | People: "a request is waiting on you"     | Notifications backend + frontend |
| [Events](#events)               | Other backend code: Slack, audit, metrics | Events backend                   |
| [Signals](#signals)             | Open pages, so they refresh themselves    | Signals backend + frontend       |

None of them is required. A delivery that fails is logged and never undoes a decision that has already been recorded.

## Notifications

![Notifications from the approvals plugin](images/notifications.png)

Four outcomes notify people, plus one clean-up notification:

| Notification                   | Sent to                           | When                                                                  | Severity |
| ------------------------------ | --------------------------------- | --------------------------------------------------------------------- | -------- |
| **Approval requested**         | The approvers (not the requester) | A request is submitted                                                | normal   |
| **Request approved**           | The requester                     | The approval that meets the quorum lands                              | normal   |
| **Request denied**             | The requester                     | An approver denies it                                                 | high     |
| **Approved request failed**    | The requester and the approvers   | The task failed or was refused, or the approval expired before it ran | high     |
| **Approval request expired**   | The requester and the approvers   | Nobody decided before the timeout                                     | normal   |
| **Approval request withdrawn** | The approvers                     | The requester withdrew it. **Replaces** their "Approval requested"    | low      |

Every notification:

- has the topic `scaffolder-approvals`, so people can filter or mute it in their notification settings;
- links to the request: `<app.baseUrl>/scaffolder-approvals/requests/<id>`;
- names people by their entity name ("alice approved your request…") rather than their display name, so a slow catalog never delays a decision;
- includes the approver's comment, when there is one.

Approvers are usually groups. The notifications backend sends a group notification to the group's members.

Approvals that leave a request still waiting (the first of two, say) do not notify the requester: "Request approved" while another approval is still needed would be untrue. They are still published as events and signals.

**Nothing reminds an approver a second time.** If a request might wait while someone is away, install the [home-page card](getting-started.md#35-add-the-home-page-card) and set a `timeout` on the gate.

## Events

If the [events backend](https://backstage.io/docs/plugins/events/) is installed, every state change is published on the topic **`scaffolder-approvals`**.

Every payload carries:

| Field          | Example                                     |
| -------------- | ------------------------------------------- |
| `action`       | `decided`                                   |
| `requestId`    | `89a6b6cd-c47d-4c13-aa68-518980b102c5`      |
| `templateRef`  | `template:default/request-github-admin`     |
| `requesterRef` | `user:default/requester`                    |
| `status`       | `approved`: the status **after** the change |

and, depending on the action:

| `action`    | When                                                   | Also carries              | Notifies                               |
| ----------- | ------------------------------------------------------ | ------------------------- | -------------------------------------- |
| `requested` | A request is submitted                                 |                           | Approvers                              |
| `decided`   | An approver approves or denies                         | `decision`, `approverRef` | Requester, when it settles the request |
| `launched`  | The template starts                                    | `taskId`                  | Nobody                                 |
| `completed` | The task finished successfully                         | `taskId`                  | Nobody                                 |
| `failed`    | The task failed or was refused, or the approval lapsed | `reason`                  | Both                                   |
| `expired`   | Nobody decided in time                                 |                           | Both                                   |
| `withdrawn` | The requester withdrew it                              |                           | Approvers                              |

Every vote is published, including ones that leave the request `pending`, so a subscriber sees the whole history. `launched` and `completed` notify nobody, because "your request started" adds nothing to "your request was approved" in an inbox; they exist for subscribers that need the full lifecycle.

### Subscribing

A backend module that logs every decision, as a starting point for a Slack message or an audit pipeline:

```ts
// packages/backend/src/approvalsAudit.ts
import {
  coreServices,
  createBackendModule,
} from '@backstage/backend-plugin-api';
import { eventsServiceRef } from '@backstage/plugin-events-node';

type ApprovalEvent = {
  action:
    | 'requested'
    | 'decided'
    | 'launched'
    | 'completed'
    | 'failed'
    | 'expired'
    | 'withdrawn';
  requestId: string;
  templateRef: string;
  requesterRef: string;
  status: string;
  decision?: 'approve' | 'deny';
  approverRef?: string;
  taskId?: string;
  reason?: string;
};

export default createBackendModule({
  pluginId: 'events',
  moduleId: 'approvals-audit',
  register(reg) {
    reg.registerInit({
      deps: { events: eventsServiceRef, logger: coreServices.logger },
      async init({ events, logger }) {
        await events.subscribe({
          id: 'approvals-audit',
          topics: ['scaffolder-approvals'],
          async onEvent({ eventPayload }) {
            const event = eventPayload as ApprovalEvent;
            if (event.action === 'decided') {
              logger.info(
                `${event.approverRef} ${event.decision}d request ${event.requestId} (${event.templateRef})`,
              );
            }
          },
        });
      },
    });
  },
});
```

```ts
// packages/backend/src/index.ts
backend.add(import('@backstage/plugin-events-backend'));
backend.add(import('./approvalsAudit'));
```

The payload carries refs and ids, not the submitted values. To show more, fetch the request from the [API](api-reference.md#get-a-request) with the module's own credentials.

### Task status

The approvals backend also **subscribes** to the scaffolder's `scaffolder.task` topic. That is how a request moves to **Completed** or **Failed** the moment its task finishes. Without the events backend, the reconciliation job picks the change up instead, within two minutes.

## Signals

If the [signals plugin](https://backstage.io/docs/notifications/#optional-add-signals) is installed, every change is also broadcast on the signals channel **`scaffolder-approvals`** as:

```json
{ "action": "decided", "requestId": "89a6b6cd-…", "status": "pending" }
```

The request page, the approvals inbox and the home-page card listen on this channel and fetch fresh data when anything changes, so somebody else's vote, the template starting and its task finishing all appear without a reload.

It is a broadcast rather than a message to specific users, because signals can only be addressed to users while approvers are usually groups. Nothing in it is private: any signed-in user can already read any request.

Your own frontend code can listen too:

```tsx
import { useSignal } from '@backstage/plugin-signals-react';
import { APPROVALS_SIGNAL_CHANNEL } from '@ferin79/backstage-plugin-scaffolder-approvals-common';
import { useEffect } from 'react';

type ApprovalSignal = { action: string; requestId: string; status: string };

export function useApprovalChanges(onChange: (signal: ApprovalSignal) => void) {
  const { lastSignal } = useSignal<ApprovalSignal>(APPROVALS_SIGNAL_CHANNEL);
  useEffect(() => {
    if (lastSignal) onChange(lastSignal);
  }, [lastSignal, onChange]);
}
```

Treat a signal as "something changed", not as the new state: fetch the request to see what it is now.
