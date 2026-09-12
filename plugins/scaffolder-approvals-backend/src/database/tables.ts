/*
 * Copyright 2026 The Backstage Authors
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

export const TABLE_REQUESTS = 'approval_requests';
export const TABLE_DECISIONS = 'approval_decisions';
export const TABLE_GRANTS = 'approval_grants';

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
  task_id: string | null;
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

/** A row of {@link TABLE_GRANTS}. */
export interface ApprovalGrantRow {
  id: string;
  request_id: string;
  token_hash: string;
  values_hash: string;
  expires_at: DbTimestamp;
  consumed_at: DbTimestamp | null;
  consumed_by_task_id: string | null;
}
