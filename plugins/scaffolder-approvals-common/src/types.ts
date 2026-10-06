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

import type { HumanDuration, JsonObject } from '@backstage/types';

/**
 * The lifecycle of an approval request.
 *
 * The request, not the scaffolder task, is the system of record. A task exists
 * only from `running` onwards, and is joined to the request by `taskId`.
 *
 * - `pending` — awaiting decisions; quorum not yet met.
 * - `approved` — quorum met and a grant minted; the launch is in flight. This
 *   is a durable state rather than a transient one, so that a launch lost to a
 *   crash or a scaffolder outage can be retried.
 * - `running` — a scaffolder task exists and is executing.
 * - `completed` — the task finished successfully.
 * - `failed` — the task ran and errored, or the grant expired before the launch
 *   succeeded. Terminal: re-running requires a fresh approval.
 * - `rejected` — an approver denied the request.
 * - `cancelled` — the requester withdrew before a decision.
 * - `expired` — the timeout swept the request before quorum was met.
 *
 * @public
 */
export type ApprovalRequestStatus =
  | 'pending'
  | 'approved'
  | 'running'
  | 'completed'
  | 'failed'
  | 'rejected'
  | 'cancelled'
  | 'expired';

/**
 * Every status an approval request can reach, in rough lifecycle order.
 *
 * @public
 */
export const APPROVAL_REQUEST_STATUSES: readonly ApprovalRequestStatus[] = [
  'pending',
  'approved',
  'running',
  'completed',
  'failed',
  'rejected',
  'cancelled',
  'expired',
];

/**
 * Statuses from which no further transition is possible.
 *
 * @public
 */
export const TERMINAL_APPROVAL_REQUEST_STATUSES: readonly ApprovalRequestStatus[] =
  ['completed', 'failed', 'rejected', 'cancelled', 'expired'];

/**
 * Whether a status is one this plugin recognises.
 *
 * Useful when reading a status back out of the database or off the wire, where
 * the value is a bare string.
 *
 * @public
 */
export function isApprovalRequestStatus(
  value: unknown,
): value is ApprovalRequestStatus {
  return (
    typeof value === 'string' &&
    (APPROVAL_REQUEST_STATUSES as readonly string[]).includes(value)
  );
}

/**
 * The terms a request was submitted under.
 *
 * This is snapshotted from the template's gate step when the request is
 * created, and never re-read afterwards. Editing the template — or moving an
 * approver group around — therefore cannot change the terms of a request that
 * is already in flight.
 *
 * Group membership is the deliberate exception: `approvers` holds entity refs,
 * and a caller's own group refs are matched against them at decision time.
 * Those refs come from the caller's token, so somebody added to an approver
 * group can decide from their next sign-in — not from the moment they are
 * added.
 *
 * @public
 */
export interface GatePolicy {
  /**
   * Who may decide, as entity refs. `group:` and `user:` refs may be mixed.
   */
  approvers: string[];

  /**
   * How many *distinct* principals must approve.
   *
   * A single denial rejects the request outright regardless of this value — a
   * quorum is a threshold for assent, not a tally.
   *
   * May legitimately exceed `approvers.length`, since one group ref can expand
   * to many members.
   */
  quorum: number;

  /**
   * Whether the requester may count towards their own request's quorum.
   */
  selfApprove: boolean;

  /**
   * How long the request may stay `pending` before the timeout sweep expires
   * it. Omitted means no timeout.
   */
  timeout?: HumanDuration;

  /**
   * A short, human-readable description of what is being requested, shown to
   * approvers. Rendered by the scaffolder's templating, so it may reference
   * `parameters`.
   */
  summary?: string;
}

/**
 * An approval request: a template someone wants to run, and its decision state.
 *
 * @public
 */
export interface ApprovalRequest {
  id: string;

  /** The gated template, as an entity ref. */
  templateRef: string;

  /**
   * The submitted template parameters, or `null` once redacted.
   *
   * Values may carry personal data (an access justification, say), so the
   * retention sweep nulls this while keeping the request and its decisions.
   * Consumers must handle `null` — a redacted request is still a valid one.
   */
  values: JsonObject | null;

  /**
   * A canonical hash of the submitted values.
   *
   * Survives redaction, and binds a grant to exactly the values that were
   * approved: the gate action recomputes it from the running task and refuses
   * on mismatch, so "approved for X, executed as Y" cannot happen.
   */
  valuesHash: string;

  /** Who submitted the request, as a user entity ref. */
  requesterRef: string;

  status: ApprovalRequestStatus;

  /** Rendered summary from the gate step, or `null` once redacted. */
  summary: string | null;

  /** The terms this request was submitted under. See {@link GatePolicy}. */
  policySnapshot: GatePolicy;

  /** The scaffolder task, once one has been launched. */
  taskId?: string;

  /**
   * `metadata.uid` of the template when the request was submitted.
   *
   * Undefined for a request submitted before drift was tracked, which is not
   * the same as "unchanged".
   */
  templateUid?: string;

  /**
   * SHA-256 of the template's `spec.steps` when the request was submitted.
   *
   * The steps are what execute, so this is what an approver is really
   * agreeing to. Hashing the whole spec would flag an owner or description
   * edit as drift, and a warning that fires on everything stops being read.
   */
  templateStepsHash?: string;

  createdAt: string;
  updatedAt: string;

  /** When the timeout sweep should expire this request, if it has a timeout. */
  expiresAt?: string;

  /** When quorum was met, or when a denial landed. */
  decidedAt?: string;

  /** When the retention sweep redacted `values` and `summary`. */
  redactedAt?: string;

  /**
   * Why the request failed, when its status is `failed`: the scaffolder
   * refusing to start the template, the task failing, or the approval lapsing
   * before a launch got through. Undefined for any other status, and for a
   * request that failed before reasons were recorded.
   */
  failureReason?: string;
}

/**
 * Which way an approver went.
 *
 * @public
 */
export type ApprovalDecisionOutcome = 'approve' | 'deny';

/**
 * One approver's decision on one request.
 *
 * Decisions are append-only and never updated, so they double as the audit
 * trail. At most one per approver per request.
 *
 * @public
 */
export interface ApprovalDecision {
  id: string;
  requestId: string;

  /** Who decided, as a user entity ref. */
  approverRef: string;

  decision: ApprovalDecisionOutcome;

  /** Optional free-text rationale, shown to the requester. */
  comment?: string;

  createdAt: string;
}

/**
 * A request together with its decision history.
 *
 * @public
 */
export interface ApprovalRequestWithDecisions extends ApprovalRequest {
  decisions: ApprovalDecision[];

  /**
   * Whether the template has changed since the request was submitted.
   *
   * Computed against the catalog when the request is read, not stored:
   * the template is loaded live at launch time, so the only honest answer is
   * the one from the moment somebody asked. Absent when the check could not be
   * made — an unreachable catalog must not look like "unchanged".
   */
  templateDrift?: TemplateDrift;
}

/**
 * How the template a request was raised against has changed since submit.
 *
 * @public
 */
export interface TemplateDrift {
  /** True when something an approver should know about has changed. */
  changed: boolean;

  /**
   * What changed, for the UI to show. Empty when nothing has.
   *
   * `missing` — the template is no longer in the catalog.
   * `replaced` — same name, different entity: deleted and recreated.
   * `steps` — the steps that will run have been edited.
   * `parameters` — the template's parameters have changed so that the
   * submitted values no longer fit them, and the scaffolder will refuse to
   * start it.
   * `unknown` — the request predates drift tracking, so there is nothing to
   * compare against.
   */
  reasons: TemplateDriftReason[];
}

/**
 * A single way a template can have drifted.
 *
 * @public
 */
export type TemplateDriftReason =
  | 'missing'
  | 'replaced'
  | 'steps'
  | 'parameters'
  | 'unknown';

/**
 * How far a pending request has got towards its quorum.
 *
 * @public
 */
export interface QuorumProgress {
  /** Distinct principals who have approved. */
  approvals: number;

  /** How many are needed. */
  quorum: number;

  /** Whether any approver denied, which rejects the request outright. */
  denied: boolean;

  /** Whether the quorum has been reached and nobody denied. */
  satisfied: boolean;
}

/**
 * Summarise a decision history against the request's quorum.
 *
 * Pure and shared so that the backend's gate logic and the UI's progress
 * indicator can never disagree about what "1 of 2" means.
 *
 * @public
 */
export function computeQuorumProgress(
  decisions: readonly ApprovalDecision[],
  policy: Pick<GatePolicy, 'quorum'>,
): QuorumProgress {
  const denied = decisions.some(d => d.decision === 'deny');

  // Distinct principals, not distinct decisions: the store enforces one vote
  // per approver, but a caller may hand us anything.
  const approvers = new Set(
    decisions.filter(d => d.decision === 'approve').map(d => d.approverRef),
  );

  return {
    approvals: approvers.size,
    quorum: policy.quorum,
    denied,
    satisfied: !denied && approvers.size >= policy.quorum,
  };
}

/**
 * Which side of a request the caller is asking about.
 *
 * @public
 */
export type ApprovalRequestRole = 'requester' | 'approver';

/**
 * Query parameters for listing approval requests.
 *
 * @public
 */
export interface ListApprovalRequestsOptions {
  /** Restrict to these statuses. Omitted means all. */
  status?: ApprovalRequestStatus | ApprovalRequestStatus[];

  /**
   * Restrict to requests the caller submitted (`requester`), or whose policy
   * names the caller or one of their groups as an approver (`approver`).
   *
   * `approver` is about who is named, not who can still act: it includes
   * requests the caller has already voted on, and their own. Add `actionable`
   * for an inbox.
   */
  role?: ApprovalRequestRole;

  /**
   * With `role: 'approver'`, keep only the requests the caller can decide on
   * right now — exactly the ones `checkDecisionEligibility` would allow:
   * pending, not past their deadline, not already decided by the caller, and
   * not the caller's own when the gate forbids self-approval.
   *
   * This is what "waiting on you" means. Without it an approver's count never
   * falls when they vote, and a requester who is also an approver sees their
   * own request as work to do.
   */
  actionable?: boolean;

  templateRef?: string;
  requesterRef?: string;

  limit?: number;
  offset?: number;
}

/**
 * A page of approval requests.
 *
 * @public
 */
export interface ListApprovalRequestsResponse {
  items: ApprovalRequest[];

  /** Total matching the filter, ignoring `limit` and `offset`. */
  totalItems: number;
}

/**
 * Body for submitting a new approval request.
 *
 * @public
 */
export interface SubmitApprovalRequestOptions {
  templateRef: string;
  values: JsonObject;
}

/**
 * Result of submitting an approval request.
 *
 * @public
 */
export interface SubmitApprovalRequestResponse {
  id: string;

  /**
   * True when an identical pending request from the same requester already
   * existed and was returned instead of creating a duplicate. Approvers should
   * not see the same request twice in their inbox.
   */
  collapsed: boolean;
}

/**
 * Body of a request to redeem an approval grant.
 *
 * Shared between the gate action, which sends it, and the approvals router,
 * which validates it. Both sides being typed from here is what stops the two
 * from drifting apart — a mismatch would not fail loudly, it would make every
 * gated run fail or, worse, stop checking what it is meant to check.
 *
 * @public
 */
export interface ConsumeGrantRequest {
  /** The opaque grant handed to the task as a secret. */
  grant: string;

  /**
   * A hash of the parameters the task is *actually* running, recomputed by the
   * gate action rather than taken from anything the backend said.
   */
  valuesHash: string;

  /** The scaffolder task presenting the grant. */
  taskId: string;

  /**
   * The template the task is running, as the scaffolder knows it.
   *
   * A grant is bound to its request, its template and its values. Without
   * this a leaked grant would redeem inside *any* gated template that happened
   * to take the same values, which is a real possibility when several
   * access-request templates share a parameter shape.
   *
   * Like `valuesHash`, it describes what is actually running and is therefore
   * taken from the task rather than from anything the backend said.
   */
  templateRef: string;
}

/**
 * What redeeming a grant reveals about the request behind it.
 *
 * The task cannot say who asked or who agreed: it was launched by the service
 * principal, so `task.createdBy` names the plugin rather than a person. The
 * gate action puts these into the task output so later steps can record the
 * real actors.
 *
 * @public
 */
export interface ConsumeGrantResponse {
  requestId: string;
  requesterRef: string;
  /** Distinct principals who approved, oldest decision first. */
  approvedBy: string[];
}

/**
 * Body for recording a decision.
 *
 * @public
 */
export interface DecideApprovalRequestOptions {
  decision: ApprovalDecisionOutcome;
  comment?: string;
}
