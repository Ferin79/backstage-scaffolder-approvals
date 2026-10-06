export const TABLE_REQUESTS = 'approval_requests';
export const TABLE_DECISIONS = 'approval_decisions';
export const TABLE_GRANTS = 'approval_grants';
export const TABLE_REQUEST_APPROVERS = 'approval_request_approvers';

/**
 * What a `dateTime` column actually hands back, which depends on the driver.
 *
 * Measured, not assumed: better-sqlite3 returns epoch milliseconds as a
 * `number`, while pg and mysql2 return a `Date`. A `string` is included because
 * mysql2 returns one if a deployment sets `dateStrings`. Everything reading
 * these columns goes through `timestampToIso`.
 */
export type DbTimestamp = Date | number | string;

/** A row of {@link TABLE_REQUESTS}. */
export interface ApprovalRequestRow {
  id: string;
  template_ref: string;
  /** JSON, or null once redacted. */
  values_json: string | null;
  values_hash: string;
  requester_ref: string;
  status: string;
  summary: string | null;
  /** JSON. */
  policy_snapshot: string;
  /**
   * `selfApprove` from the snapshot, unpacked for the inbox query. Drivers
   * return a boolean, or 0/1 where the engine has no boolean type.
   */
  self_approve: boolean | number;
  task_id: string | null;
  /** `metadata.uid` of the template at submit; null if never recorded. */
  template_uid: string | null;
  /** SHA-256 of `spec.steps` at submit; null if never recorded. */
  template_steps_hash: string | null;
  /** When the sweep last read this request's task status; null means never. */
  last_checked_at: DbTimestamp | null;
  /** How many times a launch has been claimed, for diagnostics. */
  launch_attempt: number;
  /** When a launch was last claimed; null means never. */
  launch_attempted_at: DbTimestamp | null;
  /** Why the request failed; null unless it has. */
  failure_reason: string | null;
  created_at: DbTimestamp;
  updated_at: DbTimestamp;
  expires_at: DbTimestamp | null;
  decided_at: DbTimestamp | null;
  redacted_at: DbTimestamp | null;
}

/** A row of {@link TABLE_DECISIONS}. */
export interface ApprovalDecisionRow {
  id: string;
  request_id: string;
  approver_ref: string;
  decision: string;
  comment: string | null;
  created_at: DbTimestamp;
}

/** A row of {@link TABLE_REQUEST_APPROVERS}. */
export interface ApprovalRequestApproverRow {
  request_id: string;
  approver_ref: string;
}

/** A row of {@link TABLE_GRANTS}. */
export interface ApprovalGrantRow {
  id: string;
  request_id: string;
  token_hash: string;
  values_hash: string;
  expires_at: DbTimestamp;
  consumed_at: DbTimestamp | null;
  consumed_by_task_id: string | null;
  /** When a failed launch withdrew this grant; null means live. */
  revoked_at: DbTimestamp | null;
}
