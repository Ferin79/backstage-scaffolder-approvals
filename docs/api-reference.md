# API reference

The approvals backend serves a small REST API. The frontend plugin uses it, and you can call it from scripts, other plugins or CI.

- **Base URL:** `<backend.baseUrl>/api/scaffolder-approvals`, for example `http://localhost:7007/api/scaffolder-approvals`.
- **Authentication:** a Backstage user token, as `Authorization: Bearer <token>`. Every route except `/grants/consume` needs a **user** token, because who is asking matters: requests record the requester, and decisions record the approver.
- **Content type:** JSON in and out.
- **Errors** use Backstage's standard error body: `{ "error": { "name": "InputError", "message": "…" }, "response": { "statusCode": 400 } }`.

From frontend code, use the plugin's client instead of raw HTTP:

```ts
import { approvalsApiRef } from '@ferin79/backstage-plugin-scaffolder-approvals';
import { useApi } from '@backstage/core-plugin-api';

const approvals = useApi(approvalsApiRef);
```

| Route                                              | Who may call it       |
| -------------------------------------------------- | --------------------- |
| [`POST /requests`](#submit-a-request)              | Any signed-in user    |
| [`GET /requests`](#list-requests)                  | Any signed-in user    |
| [`GET /requests/:id`](#get-a-request)              | Any signed-in user    |
| [`POST /requests/:id/decision`](#approve-or-deny)  | A designated approver |
| [`POST /requests/:id/cancel`](#withdraw-a-request) | The requester         |
| [`POST /grants/consume`](#redeem-a-grant)          | The scaffolder only   |

"Any signed-in user" is subject to your [permission policy](security-model.md#permissions) when permissions are enabled.

## Submit a request

`POST /requests`

```json
{
  "templateRef": "template:default/request-github-admin",
  "values": {
    "repository": "acme/payments-api",
    "justification": "On call for payments this quarter."
  }
}
```

| Field         | Description                                                                                            |
| ------------- | ------------------------------------------------------------------------------------------------------ |
| `templateRef` | The gated template. The kind and namespace may be left out: `request-github-admin` works               |
| `values`      | The template's parameters, exactly as the scaffolder would receive them. Nested at most 64 levels deep |

The values are validated against the template's parameter schema before anything is stored.

**Responses**

| Status | Body                                | Meaning                                                                                                                          |
| ------ | ----------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| `201`  | `{ "id": "…", "collapsed": false }` | A new request was created and the approvers notified                                                                             |
| `200`  | `{ "id": "…", "collapsed": true }`  | You already have a pending request for this template with the same values; that one is returned                                  |
| `400`  |                                     | The values do not fit the template, the template is not a template or not gated, or its gate is unusable. The message says which |
| `403`  |                                     | Your permission policy denies `scaffolderApprovals.request.create`                                                               |
| `404`  |                                     | No such template                                                                                                                 |

## List requests

`GET /requests`

| Query parameter | Description                                                                                                                   |
| --------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| `status`        | Only these statuses. Repeat it or comma-separate: `status=pending,approved`                                                   |
| `role`          | `requester`: requests you submitted. `approver`: requests naming you, or one of your groups, as an approver                   |
| `actionable`    | `true` with `role=approver`: only requests you can still decide on (pending, not yours, not already voted). This is the inbox |
| `templateRef`   | Only requests for this template                                                                                               |
| `requesterRef`  | Only requests from this user. `requester` is read as `user:default/requester`                                                 |
| `limit`         | Page size, 1–200. Default 50                                                                                                  |
| `offset`        | How many to skip                                                                                                              |

Refs match however they are spelled: case, and a missing kind or namespace, do not matter.

**Response** `200`

```json
{
  "items": [
    {
      "id": "89a6b6cd-c47d-4c13-aa68-518980b102c5",
      "templateRef": "template:default/request-github-admin",
      "requesterRef": "user:default/requester",
      "status": "pending",
      "summary": "Admin on acme/payments-api",
      "…": "see the request object below"
    }
  ],
  "totalItems": 1
}
```

Examples:

```sh
# My inbox
curl -H "Authorization: Bearer $TOKEN" \
  "$BASE/api/scaffolder-approvals/requests?role=approver&actionable=true"

# Everything that failed for one template
curl -H "Authorization: Bearer $TOKEN" \
  "$BASE/api/scaffolder-approvals/requests?status=failed&templateRef=request-github-admin"
```

## Get a request

`GET /requests/:id`

Returns the [request object](#the-request-object) with its decisions and, if the template has changed since submission, a `templateDrift` field.

| Status | Meaning                          |
| ------ | -------------------------------- |
| `200`  | The request                      |
| `400`  | The id is not a valid request id |
| `404`  | No such request                  |

## Approve or deny

`POST /requests/:id/decision`

```json
{ "decision": "approve", "comment": "Fine for the on-call rotation." }
```

| Field      | Description                                        |
| ---------- | -------------------------------------------------- |
| `decision` | `approve` or `deny`                                |
| `comment`  | Optional, up to 4096 characters. Shown to everyone |

When this approval meets the quorum, the template is started straight away.

| Status | Meaning                                                                                                                                   |
| ------ | ----------------------------------------------------------------------------------------------------------------------------------------- |
| `200`  | Recorded. The body is the updated request                                                                                                 |
| `403`  | You are not an approver for this request, you cannot approve your own request, or your policy denies `scaffolderApprovals.request.decide` |
| `409`  | It is no longer pending, it has expired, or you have already decided                                                                      |

## Withdraw a request

`POST /requests/:id/cancel`

No body. Only the requester can withdraw, and only while the request is pending.

| Status | Meaning                                                     |
| ------ | ----------------------------------------------------------- |
| `200`  | Withdrawn. The body is the updated request, now `cancelled` |
| `403`  | You are not the requester, or your policy denies it         |
| `409`  | It is no longer pending, or its timeout has passed          |

## Redeem a grant

`POST /grants/consume`

Used by the `approval:gate` action inside an approved task. Only service principals listed in [`grantConsumers`](configuration.md#grantconsumers-split-deployments) (the scaffolder, by default) may call it; you should never need to.

## The request object

| Field               | Type             | Description                                                                                                                                  |
| ------------------- | ---------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| `id`                | string (UUID)    | The request's id                                                                                                                             |
| `templateRef`       | string           | The template, as a full entity ref                                                                                                           |
| `requesterRef`      | string           | Who asked                                                                                                                                    |
| `status`            | string           | `pending`, `approved`, `running`, `completed`, `failed`, `rejected`, `cancelled` or `expired`                                                |
| `values`            | object or `null` | The submitted parameters. `null` once redacted                                                                                               |
| `valuesHash`        | string           | SHA-256 of the values; kept after redaction                                                                                                  |
| `summary`           | string or `null` | The gate's rendered summary. `null` once redacted, or if the gate has none                                                                   |
| `policySnapshot`    | object           | The gate's terms when submitted: `approvers`, `quorum`, `selfApprove`, `timeout`, `summary`                                                  |
| `taskId`            | string           | The scaffolder task, once the template has started                                                                                           |
| `failureReason`     | string           | Why it failed, when `status` is `failed`                                                                                                     |
| `createdAt`         | ISO 8601         | When it was submitted                                                                                                                        |
| `updatedAt`         | ISO 8601         | When it last changed                                                                                                                         |
| `expiresAt`         | ISO 8601         | When it expires if nobody decides; absent if the gate has no timeout                                                                         |
| `decidedAt`         | ISO 8601         | When the quorum was met, or a denial landed                                                                                                  |
| `redactedAt`        | ISO 8601         | When the values and summary were redacted                                                                                                    |
| `templateUid`       | string           | The template entity's uid at submit time, for drift detection                                                                                |
| `templateStepsHash` | string           | A hash of the template's steps at submit time, for drift detection                                                                           |
| `decisions`         | array            | On `GET /requests/:id` only: `{ id, requestId, approverRef, decision, comment?, createdAt }`, oldest first                                   |
| `templateDrift`     | object           | On `GET /requests/:id` only, when present: `{ changed, reasons }`, with reasons from `missing`, `replaced`, `steps`, `parameters`, `unknown` |

The TypeScript types (`ApprovalRequest`, `ApprovalDecision`, `ListApprovalRequestsResponse` and so on) are exported from `@ferin79/backstage-plugin-scaffolder-approvals-common`.

## Scheduler endpoints

The backend's [scheduled jobs](configuration.md#scheduled-jobs) can be listed and triggered through Backstage's standard scheduler routes, with a user token:

```sh
curl -H "Authorization: Bearer $TOKEN" \
  "$BASE/api/scaffolder-approvals/.backstage/scheduler/v1/tasks"

curl -X POST -H "Authorization: Bearer $TOKEN" \
  "$BASE/api/scaffolder-approvals/.backstage/scheduler/v1/tasks/scaffolder-approvals-reconcile/trigger"
```
