import {
  type ApprovalDecision,
  type ApprovalDecisionOutcome,
  type ApprovalRequest,
  type ApprovalRequestStatus,
  type GatePolicy,
  isApprovalRequestStatus,
} from '@ferin79/backstage-plugin-scaffolder-approvals-common';
import type { JsonObject } from '@backstage/types';
import type {
  ApprovalDecisionRow,
  ApprovalRequestRow,
  DbTimestamp,
} from './tables';

/** A naive `YYYY-MM-DD HH:MM:SS[.sss]` datetime, with no zone designator. */
const NAIVE_DATETIME = /^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2}(\.\d+)?$/;

/**
 * Normalise whatever a driver returns for a `dateTime` column into an ISO-8601
 * UTC string.
 *
 * The three supported engines disagree: better-sqlite3 hands back epoch
 * milliseconds, pg and mysql2 hand back a `Date`, and a deployment that sets
 * `dateStrings` on mysql2 hands back a naive datetime string. A naive string is
 * read as UTC, because that is what was written — left to `new Date(...)` it
 * would be read in the server's local zone and silently shift the time.
 */
export function timestampToIso(value: DbTimestamp, field: string): string {
  if (value instanceof Date) {
    return value.toISOString();
  }

  if (typeof value === 'number') {
    return new Date(value).toISOString();
  }

  if (typeof value === 'string') {
    const withZone = NAIVE_DATETIME.test(value)
      ? `${value.replace(' ', 'T')}Z`
      : value;
    const parsed = new Date(withZone);
    if (Number.isNaN(parsed.getTime())) {
      throw new TypeError(`Unparseable timestamp in ${field}: ${value}`);
    }
    return parsed.toISOString();
  }

  throw new TypeError(`Unexpected timestamp type in ${field}: ${typeof value}`);
}

function optionalTimestampToIso(
  value: DbTimestamp | null | undefined,
  field: string,
): string | undefined {
  return value === null || value === undefined
    ? undefined
    : timestampToIso(value, field);
}

function parseJsonColumn<T>(value: string, field: string): T {
  try {
    return JSON.parse(value) as T;
  } catch (error) {
    throw new TypeError(`Malformed JSON in ${field}`);
  }
}

function readStatus(value: string, id: string): ApprovalRequestStatus {
  // A status the code does not recognise means a newer version of the plugin
  // wrote this row. Guessing would drive the state machine off a state it has
  // no rules for, so refuse instead.
  if (!isApprovalRequestStatus(value)) {
    throw new TypeError(`Unknown status '${value}' on approval request ${id}`);
  }
  return value;
}

/** Map a row of `approval_requests` onto the wire type. */
export function rowToApprovalRequest(row: ApprovalRequestRow): ApprovalRequest {
  const request: ApprovalRequest = {
    id: row.id,
    templateRef: row.template_ref,
    values:
      row.values_json === null
        ? null
        : parseJsonColumn<JsonObject>(row.values_json, 'values_json'),
    valuesHash: row.values_hash,
    requesterRef: row.requester_ref,
    status: readStatus(row.status, row.id),
    summary: row.summary,
    policySnapshot: parseJsonColumn<GatePolicy>(
      row.policy_snapshot,
      'policy_snapshot',
    ),
    createdAt: timestampToIso(row.created_at, 'created_at'),
    updatedAt: timestampToIso(row.updated_at, 'updated_at'),
  };

  // Optional fields are omitted rather than set to undefined, so that a
  // round-trip through JSON is a fixed point.
  if (row.task_id !== null) {
    request.taskId = row.task_id;
  }
  if (row.template_uid !== null) {
    request.templateUid = row.template_uid;
  }
  if (row.template_steps_hash !== null) {
    request.templateStepsHash = row.template_steps_hash;
  }
  // `?? null`, because a row built before the column existed has no key at all.
  const failureReason = row.failure_reason ?? null;
  if (failureReason !== null) {
    request.failureReason = failureReason;
  }
  const expiresAt = optionalTimestampToIso(row.expires_at, 'expires_at');
  if (expiresAt) {
    request.expiresAt = expiresAt;
  }
  const decidedAt = optionalTimestampToIso(row.decided_at, 'decided_at');
  if (decidedAt) {
    request.decidedAt = decidedAt;
  }
  const redactedAt = optionalTimestampToIso(row.redacted_at, 'redacted_at');
  if (redactedAt) {
    request.redactedAt = redactedAt;
  }

  return request;
}

/** Map a row of `approval_decisions` onto the wire type. */
export function rowToApprovalDecision(
  row: ApprovalDecisionRow,
): ApprovalDecision {
  if (row.decision !== 'approve' && row.decision !== 'deny') {
    throw new TypeError(
      `Unknown decision '${row.decision}' on decision ${row.id}`,
    );
  }

  const decision: ApprovalDecision = {
    id: row.id,
    requestId: row.request_id,
    approverRef: row.approver_ref,
    decision: row.decision as ApprovalDecisionOutcome,
    createdAt: timestampToIso(row.created_at, 'created_at'),
  };

  if (row.comment !== null) {
    decision.comment = row.comment;
  }

  return decision;
}
