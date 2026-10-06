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

import {
  type ApprovalDecision,
  type ApprovalDecisionOutcome,
  type ApprovalRequest,
  type ApprovalRequestStatus,
  type ApprovalRequestWithDecisions,
  type GatePolicy,
  TERMINAL_APPROVAL_REQUEST_STATUSES,
  tryNormaliseEntityRef,
} from '@ferin79/backstage-plugin-scaffolder-approvals-common';
import {
  assertSha256Hex,
  computeValuesHash,
} from '@ferin79/backstage-plugin-scaffolder-approvals-node';
import type { JsonObject } from '@backstage/types';
import type { Knex } from 'knex';
import { randomUUID } from 'node:crypto';
import {
  rowToApprovalDecision,
  rowToApprovalRequest,
  timestampToIso,
} from './rowMapping';
import {
  type ApprovalDecisionRow,
  type ApprovalGrantRow,
  type ApprovalRequestApproverRow,
  type ApprovalRequestRow,
  TABLE_DECISIONS,
  TABLE_GRANTS,
  TABLE_REQUEST_APPROVERS,
  TABLE_REQUESTS,
} from './tables';

/** A request to gate, as the service hands it over. */
export interface NewApprovalRequest {
  templateRef: string;
  values: JsonObject;
  valuesHash: string;
  requesterRef: string;
  summary?: string;
  policySnapshot: GatePolicy;
  /** When the timeout sweep should expire this. Omit for no timeout. */
  expiresAt?: Date;
  /** `metadata.uid` of the template as it was at submit. */
  templateUid?: string;
  /** SHA-256 of the template's `spec.steps` as they were at submit. */
  templateStepsHash?: string;
}

/** Outcome of {@link ApprovalStore.createOrCollapse}. */
export interface CreateApprovalRequestResult {
  id: string;
  /** True when an equivalent pending request already existed. */
  collapsed: boolean;
}

/** Columns a transition may set alongside the status. */
export interface TransitionFields {
  taskId?: string | null;
  decidedAt?: Date | null;
  expiresAt?: Date | null;
  /** Why the request failed, for a transition to `failed`. */
  failureReason?: string | null;
  /** Also require the request's timeout not to have passed. */
  notExpired?: boolean;
}

/** A vote to record. */
export interface NewApprovalDecision {
  requestId: string;
  approverRef: string;
  decision: ApprovalDecisionOutcome;
  comment?: string;
}

/** Outcome of {@link ApprovalStore.recordDecision}. */
export interface RecordDecisionResult {
  /** True if this call cast the vote; false if the approver had already voted. */
  recorded: boolean;
  /** The vote that stands, which is the earlier one when `recorded` is false. */
  decision: ApprovalDecision;
}

/** A grant to mint. */
export interface NewApprovalGrant {
  requestId: string;
  /** SHA-256 of the token. The token itself is never given to the store. */
  tokenHash: string;
  valuesHash: string;
  expiresAt: Date;
}

/** An attempt to redeem a grant. */
export interface ConsumeApprovalGrant {
  requestId: string;
  tokenHash: string;
  /**
   * Recomputed from the running task at redemption time; must match what was
   * approved.
   */
  valuesHash: string;
  taskId: string;
  /**
   * The template the task is running, normalised; must match the one the
   * request was raised against.
   */
  templateRef: string;
}

/** Filters for {@link ApprovalStore.listRequests}. */
export interface ListApprovalRequestRows {
  status?: ApprovalRequestStatus | ApprovalRequestStatus[];
  templateRef?: string;
  requesterRef?: string;
  /**
   * Restrict to requests any of these refs may decide on.
   *
   * Pass the caller's own ownership refs — their user ref plus their groups —
   * and the join matches whichever of them the policy happens to list.
   */
  approverRefs?: string[];
  /**
   * Keep only the requests this user can decide on right now: pending, not
   * past their deadline, not already decided by them, and not their own when
   * the gate forbids self-approval — the same rules as
   * `checkDecisionEligibility`, apart from approver membership, which is what
   * `approverRefs` is for.
   *
   * Pass the caller's user ref. `approverRefs` says whom a policy names; this
   * says whether that person can still act, and an inbox needs both.
   */
  actionableBy?: string;
  /** Restrict to these ids, as a permission filter would. */
  ids?: string[];
  limit?: number;
  offset?: number;
}

/** A page of requests. */
export interface ListApprovalRequestRowsResult {
  items: ApprovalRequest[];
  totalItems: number;
}

/** Construction options for {@link ApprovalStore}. */
export interface ApprovalStoreOptions {
  db: Knex;
  /**
   * Injectable clock, so tests drive expiry deterministically instead of
   * sleeping.
   */
  now?: () => Date;
}

/**
 * Persistence for approval requests, decisions and grants.
 *
 * Two rules hold throughout, and both exist because more than one backend
 * replica will be doing this at once:
 *
 * 1. **Every state change is compare-and-set.** A write names the state it
 *    expects to find, and reports whether it was the one that moved the row.
 *    Read-then-write is a bug here rather than a style preference: two replicas
 *    that both read `pending` would both launch the task.
 *
 * 2. **No `CURRENT_TIMESTAMP` in a predicate.** Postgres stores `timestamptz`,
 *    MySQL a naive `datetime` and SQLite a number, and their notions of "now"
 *    do not line up. Comparisons bind an explicit JavaScript `Date` instead, so
 *    both sides of every comparison go through the same driver conversion.
 */
export class ApprovalStore {
  private readonly db: Knex;
  private readonly now: () => Date;

  constructor(options: ApprovalStoreOptions) {
    this.db = options.db;
    this.now = options.now ?? (() => new Date());
  }

  /**
   * Create a request, or return the equivalent one already awaiting a decision.
   *
   * Collapsing keeps an impatient requester from filling the approvers'
   * inbox with the same ask. Equivalence is the same requester, the same
   * template and the same values — and the existing request must still be live:
   * collapsing into one that has already timed out would hand back a request
   * nothing will ever act on.
   *
   * A transaction rather than a unique constraint, because the constraint would
   * have to be partial (`WHERE status = 'pending'`) and partial indexes are not
   * portable. Two replicas racing can therefore still both insert; the cost is
   * one duplicate inbox entry, which is a presentation problem and not a
   * security one.
   */
  async createOrCollapse(
    input: NewApprovalRequest,
  ): Promise<CreateApprovalRequestResult> {
    assertSha256Hex(input.valuesHash, 'valuesHash');

    // The values and their hash must never disagree. The hash is what binds a
    // grant to what was approved, so a mismatch stored here would mean
    // approving one thing while being able to run another.
    if (computeValuesHash(input.values) !== input.valuesHash) {
      throw new TypeError(
        'valuesHash does not match values; refusing to store a broken binding',
      );
    }

    const now = this.now();

    return await this.db.transaction(async tx => {
      const existing = await tx<ApprovalRequestRow>(TABLE_REQUESTS)
        .where({
          requester_ref: input.requesterRef,
          template_ref: input.templateRef,
          values_hash: input.valuesHash,
          status: 'pending',
        })
        .where(builder =>
          builder.whereNull('expires_at').orWhere('expires_at', '>', now),
        )
        // Oldest wins, so repeated submissions always land on the same request
        // and decisions accumulate in one place.
        .orderBy('created_at', 'asc')
        .first();

      if (existing) {
        return { id: existing.id, collapsed: true };
      }

      const id = randomUUID();
      const pending: ApprovalRequestStatus = 'pending';

      await tx(TABLE_REQUESTS).insert({
        id,
        template_ref: input.templateRef,
        values_json: JSON.stringify(input.values),
        values_hash: input.valuesHash,
        requester_ref: input.requesterRef,
        status: pending,
        summary: input.summary ?? null,
        policy_snapshot: JSON.stringify(input.policySnapshot),
        self_approve: input.policySnapshot.selfApprove,
        task_id: null,
        template_uid: input.templateUid ?? null,
        template_steps_hash: input.templateStepsHash ?? null,
        created_at: now,
        updated_at: now,
        expires_at: input.expiresAt ?? null,
        decided_at: null,
        redacted_at: null,
      });

      const approverRows: ApprovalRequestApproverRow[] = [
        ...new Set(input.policySnapshot.approvers),
      ].map(approver_ref => ({ request_id: id, approver_ref }));

      if (approverRows.length) {
        await tx(TABLE_REQUEST_APPROVERS).insert(approverRows);
      }

      return { id, collapsed: false };
    });
  }

  /**
   * Load many requests by id, in the order asked for.
   *
   * This is what the permission framework calls to resolve a conditional
   * decision, so the contract is exact: one slot per requested id, in the same
   * order, `undefined` where there is no such request.
   */
  async getManyByIds(
    ids: string[],
  ): Promise<Array<ApprovalRequest | undefined>> {
    if (ids.length === 0) {
      return [];
    }

    const rows = await this.db<ApprovalRequestRow>(TABLE_REQUESTS).whereIn(
      'id',
      ids,
    );

    const byId = new Map(
      rows.map(row => [row.id, rowToApprovalRequest(row)] as const),
    );
    return ids.map(id => byId.get(id));
  }

  async getRequest(id: string): Promise<ApprovalRequest | undefined> {
    const row = await this.db<ApprovalRequestRow>(TABLE_REQUESTS)
      .where({ id })
      .first();
    return row ? rowToApprovalRequest(row) : undefined;
  }

  async getRequestWithDecisions(
    id: string,
  ): Promise<ApprovalRequestWithDecisions | undefined> {
    const request = await this.getRequest(id);
    if (!request) {
      return undefined;
    }
    return { ...request, decisions: await this.listDecisions(id) };
  }

  async listRequests(
    options: ListApprovalRequestRows = {},
  ): Promise<ListApprovalRequestRowsResult> {
    // Read once, so the count and the page agree about what has expired.
    const now = this.now();

    const filtered = () => {
      const query = this.db<ApprovalRequestRow>(TABLE_REQUESTS);
      if (options.status !== undefined) {
        const statuses = Array.isArray(options.status)
          ? options.status
          : [options.status];
        query.whereIn('status', statuses);
      }
      if (options.templateRef !== undefined) {
        query.where({ template_ref: options.templateRef });
      }
      if (options.requesterRef !== undefined) {
        query.where({ requester_ref: options.requesterRef });
      }
      if (options.ids !== undefined) {
        query.whereIn('id', options.ids);
      }
      if (options.approverRefs !== undefined) {
        // A subquery rather than a join, so a request listing two refs the
        // caller holds is still counted once.
        query.whereIn(
          'id',
          this.db<ApprovalRequestApproverRow>(TABLE_REQUEST_APPROVERS)
            .select('request_id')
            .whereIn('approver_ref', options.approverRefs),
        );
      }
      if (options.actionableBy !== undefined) {
        // Both spellings, because the refs this is compared with are not all
        // stored the same way: `requester_ref` is normalised at submit, while a
        // decision stores the caller's ref as their token gave it.
        // `checkDecisionEligibility` normalises both sides, and this has to
        // agree with it.
        const self = refSpellings(options.actionableBy);
        query
          .where('status', 'pending')
          .where(builder =>
            builder.whereNull('expires_at').orWhere('expires_at', '>', now),
          )
          .whereNotIn(
            'id',
            this.db<ApprovalDecisionRow>(TABLE_DECISIONS)
              .select('request_id')
              .whereIn('approver_ref', self),
          )
          // `self_approve` is never null (see its migration), so this cannot
          // turn into an unknown that drops rows it should keep.
          .whereNot(builder =>
            builder.whereIn('requester_ref', self).where('self_approve', false),
          );
      }
      return query;
    };

    // Counted before paging, so a caller can render "showing 20 of 340".
    const [counted] = await filtered().count({ total: '*' });

    const rows = await filtered()
      // Newest first is what an inbox wants. `id` breaks ties, so that paging
      // stays stable when several requests share a timestamp.
      .orderBy([
        { column: 'created_at', order: 'desc' },
        { column: 'id', order: 'desc' },
      ])
      .limit(options.limit ?? 50)
      .offset(options.offset ?? 0);

    return {
      items: rows.map(rowToApprovalRequest),
      // Postgres returns bigint counts as strings.
      totalItems: Number(counted.total),
    };
  }

  /**
   * Move a request from one status to another, atomically.
   *
   * Returns true only if *this* call performed the transition. False means the
   * row was not in `from` — already moved by another replica, in some other
   * state, or absent. Callers must read false as "someone else owns this now"
   * and must not retry blindly.
   *
   * `notExpired` adds `expires_at > now` to the guard. A decision and the
   * timeout sweep can land on the same row at the same moment, and without it
   * both would succeed: the sweep would mark the request `expired` and the
   * decision would mark it `approved`, with whichever wrote last deciding
   * whether the template runs.
   */
  async transition(
    id: string,
    from: ApprovalRequestStatus,
    to: ApprovalRequestStatus,
    fields: TransitionFields = {},
  ): Promise<boolean> {
    const patch: Partial<ApprovalRequestRow> = {
      status: to,
      updated_at: this.now(),
    };

    // Distinguish "not supplied" from an explicit null, which clears a column.
    if (fields.taskId !== undefined) {
      patch.task_id = fields.taskId;
    }
    if (fields.decidedAt !== undefined) {
      patch.decided_at = fields.decidedAt;
    }
    if (fields.expiresAt !== undefined) {
      patch.expires_at = fields.expiresAt;
    }
    if (fields.failureReason !== undefined) {
      patch.failure_reason = fields.failureReason;
    }

    let query = this.db<ApprovalRequestRow>(TABLE_REQUESTS).where({
      id,
      status: from,
    });

    if (fields.notExpired) {
      query = query.where(builder =>
        builder
          .whereNull('expires_at')
          .orWhere('expires_at', '>', patch.updated_at!),
      );
    }

    const affected = await query.update(patch);

    return affected === 1;
  }

  /**
   * Record a vote, or report the one that already stands.
   *
   * The `(request_id, approver_ref)` unique index is what makes a quorum count
   * trustworthy: the database refuses a second vote, so the service never has
   * to read-then-write to check for one.
   *
   * The outcome is settled by reading the stored row back and seeing whose id
   * won, rather than by trusting an affected-row count —
   * `onConflict().ignore()` compiles to `INSERT IGNORE` on MySQL, whose counts
   * also swallow unrelated failures.
   */
  async recordDecision(
    input: NewApprovalDecision,
  ): Promise<RecordDecisionResult> {
    const id = randomUUID();

    await this.db(TABLE_DECISIONS)
      .insert({
        id,
        request_id: input.requestId,
        approver_ref: input.approverRef,
        decision: input.decision,
        comment: input.comment ?? null,
        created_at: this.now(),
      })
      .onConflict(['request_id', 'approver_ref'])
      .ignore();

    const row = await this.db<ApprovalDecisionRow>(TABLE_DECISIONS)
      .where({ request_id: input.requestId, approver_ref: input.approverRef })
      .first();

    if (!row) {
      // MySQL's INSERT IGNORE also swallows a foreign key violation, so an
      // absent row here means the request does not exist, rather than that
      // somebody else voted first.
      throw new Error(
        `Failed to record a decision on approval request ${input.requestId}; the request may not exist`,
      );
    }

    return { recorded: row.id === id, decision: rowToApprovalDecision(row) };
  }

  async listDecisions(requestId: string): Promise<ApprovalDecision[]> {
    const rows = await this.db<ApprovalDecisionRow>(TABLE_DECISIONS)
      .where({ request_id: requestId })
      .orderBy([
        { column: 'created_at', order: 'asc' },
        { column: 'id', order: 'asc' },
      ]);
    return rows.map(rowToApprovalDecision);
  }

  /** Mint a grant. Returns its id. */
  async createGrant(input: NewApprovalGrant): Promise<string> {
    assertSha256Hex(input.tokenHash, 'tokenHash');
    assertSha256Hex(input.valuesHash, 'valuesHash');

    const id = randomUUID();
    await this.db(TABLE_GRANTS).insert({
      id,
      request_id: input.requestId,
      token_hash: input.tokenHash,
      values_hash: input.valuesHash,
      expires_at: input.expiresAt,
      consumed_at: null,
      consumed_by_task_id: null,
      revoked_at: null,
    });
    return id;
  }

  /**
   * Claim the right to launch a request, so that exactly one caller does.
   *
   * Deciding a request launches it, and so does the reconciliation sweep.
   * Reading the grants table and then writing to it would let two replicas
   * interleave: each sees no live grant, each mints one, and the template runs
   * twice. Every launch goes through this compare-and-set first instead.
   *
   * `staleBefore` is how the claim is also a retry window. A claim held by an
   * attempt that has not finished is honoured until it is that old; after that
   * the next caller may take over, which is what makes a launcher that crashed
   * mid-flight recoverable rather than permanent.
   *
   * Returns true for exactly one caller.
   */
  async claimLaunch(requestId: string, staleBefore: Date): Promise<boolean> {
    const now = this.now();

    const affected = await this.db<ApprovalRequestRow>(TABLE_REQUESTS)
      .where({
        id: requestId,
        status: 'approved' satisfies ApprovalRequestStatus,
      })
      .whereNull('task_id')
      .where(builder =>
        builder
          .whereNull('launch_attempted_at')
          .orWhere('launch_attempted_at', '<=', staleBefore),
      )
      .update({
        launch_attempt: this.db.raw('launch_attempt + 1'),
        launch_attempted_at: now,
        updated_at: now,
      });

    return affected === 1;
  }

  /**
   * Withdraw an unconsumed grant, so a new one can be minted.
   *
   * Compare-and-set, because the task this grant was minted for may be
   * redeeming it at this very moment. Losing that race is the point: zero rows
   * changed means a task holds the grant, and the caller must recover its id
   * rather than launch the template a second time.
   */
  async revokeGrant(grantId: string): Promise<boolean> {
    const affected = await this.db<ApprovalGrantRow>(TABLE_GRANTS)
      .where({ id: grantId })
      .whereNull('consumed_at')
      .whereNull('revoked_at')
      .update({ revoked_at: this.now() });

    return affected === 1;
  }

  /**
   * The grant a task redeemed, if any.
   *
   * A request has at most one, since consuming is single-use and a new grant is
   * only ever minted once the previous one is dead. Recovering
   * `consumed_by_task_id` from it is how a launch that crashed after
   * `scaffold()` returned finds the task it started.
   */
  async findConsumedGrant(
    requestId: string,
  ): Promise<ApprovalGrantRow | undefined> {
    return await this.db<ApprovalGrantRow>(TABLE_GRANTS)
      .where({ request_id: requestId })
      .whereNotNull('consumed_at')
      .orderBy('consumed_at', 'asc')
      .first();
  }

  /** The grant that is still redeemable, if any. */
  async findLiveGrant(
    requestId: string,
  ): Promise<ApprovalGrantRow | undefined> {
    return await this.db<ApprovalGrantRow>(TABLE_GRANTS)
      .where({ request_id: requestId })
      .whereNull('consumed_at')
      .whereNull('revoked_at')
      .where('expires_at', '>', this.now())
      .first();
  }

  /**
   * When the approval stops being redeemable, whatever happens to the launch.
   *
   * The *first* grant's expiry, not the newest one's. A launch is retried while
   * the approval is valid and the request fails once it lapses; if each retry
   * minted a grant with a fresh TTL, a scaffolder that stayed down would be
   * retried forever and the request would never reach `failed`. Every grant
   * after the first therefore expires when the first one would have.
   *
   * Undefined means nothing has been minted yet, so the launch has its full
   * TTL ahead of it.
   */
  async launchDeadline(requestId: string): Promise<Date | undefined> {
    const row = await this.db<ApprovalGrantRow>(TABLE_GRANTS)
      .where({ request_id: requestId })
      .orderBy('expires_at', 'asc')
      .first();

    return row
      ? new Date(timestampToIso(row.expires_at, 'expires_at'))
      : undefined;
  }

  /**
   * Redeem a grant, exactly once.
   *
   * This is the enforcement point for the whole feature, so all five guards sit
   * in one `UPDATE` and the affected-row count has to be exactly 1:
   *
   * - `request_id` and `token_hash` — the grant exists and belongs to this
   *   request.
   * - `values_hash` — the task is running the values that were approved.
   *   Without this, an approved request could be redeemed to run different
   *   parameters.
   * - `template_ref` — the task is running the template that was approved.
   *   Checked with a sub-select against the request rather than a
   *   denormalised copy, so there is one source of truth and the whole check
   *   stays inside the one statement. Without it a leaked grant would redeem
   *   inside any gated template that took the same values.
   * - `consumed_at IS NULL` — single use, so a leaked token cannot be replayed.
   * - `expires_at > now` — the grant TTL.
   *
   * Anything else fails closed. There is deliberately no variant that reports
   * *which* guard failed: the caller is presenting a bearer token, and telling
   * "wrong token" apart from "wrong values" or "already used" would be an
   * oracle.
   */
  async consumeGrant(input: ConsumeApprovalGrant): Promise<boolean> {
    assertSha256Hex(input.tokenHash, 'tokenHash');
    assertSha256Hex(input.valuesHash, 'valuesHash');

    const now = this.now();

    const affected = await this.db<ApprovalGrantRow>(TABLE_GRANTS)
      .where({
        request_id: input.requestId,
        token_hash: input.tokenHash,
        values_hash: input.valuesHash,
      })
      .whereNull('consumed_at')
      .whereNull('revoked_at')
      .where('expires_at', '>', now)
      .whereIn('request_id', builder =>
        builder
          .select('id')
          .from(TABLE_REQUESTS)
          .where({ id: input.requestId, template_ref: input.templateRef }),
      )
      .update({
        consumed_at: now,
        consumed_by_task_id: input.taskId,
      });

    return affected === 1;
  }

  /**
   * Whether a request has a grant that is still redeemable.
   *
   * This is what makes relaunching safe. A crash between `scaffold()` returning
   * and the status transition leaves a running task whose id was never
   * recorded; without this check a retry would mint a second grant and run the
   * template again. An outstanding grant means either that task is on its way
   * to the gate, or nothing started and the grant should be left to expire.
   */
  async hasLiveGrant(requestId: string): Promise<boolean> {
    return (await this.findLiveGrant(requestId)) !== undefined;
  }

  /**
   * The request a scaffolder task belongs to.
   *
   * Used by the task-event subscription, which knows a task id and nothing
   * else. An event for a task this plugin did not launch finds nothing, which
   * is the correct outcome rather than an error.
   */
  async findRequestByTaskId(
    taskId: string,
  ): Promise<ApprovalRequest | undefined> {
    const row = await this.db<ApprovalRequestRow>(TABLE_REQUESTS)
      .where({ task_id: taskId })
      .first();
    return row ? rowToApprovalRequest(row) : undefined;
  }

  /**
   * Approved requests whose task has not been recorded.
   *
   * Either the launch never happened, or it happened and the status transition
   * was lost. The reconciliation sweep tells those apart from the grant.
   */
  async findApprovedAwaitingLaunch(limit: number): Promise<ApprovalRequest[]> {
    const rows = await this.db<ApprovalRequestRow>(TABLE_REQUESTS)
      .where({ status: 'approved' satisfies ApprovalRequestStatus })
      .whereNull('task_id')
      // Oldest first: whatever has been stuck longest deserves the attention.
      .orderBy('updated_at', 'asc')
      .limit(limit);
    return rows.map(rowToApprovalRequest);
  }

  /**
   * Requests with a task in flight, least recently checked first.
   *
   * Not by `updated_at`: a request whose task is still running never changes
   * status, so its `updated_at` never moves, and the oldest rows would hold the
   * batch forever. `last_checked_at` makes it a rotation instead: `markChecked`
   * moves a request to the back of the queue whether or not anything changed.
   * A request never checked has been waiting since it was created.
   */
  async findRunning(limit: number): Promise<ApprovalRequest[]> {
    const rows = await this.db<ApprovalRequestRow>(TABLE_REQUESTS)
      .where({ status: 'running' satisfies ApprovalRequestStatus })
      .whereNotNull('task_id')
      // COALESCE rather than plain `orderBy`, because the engines disagree
      // about where nulls sort: Postgres puts them last ascending, SQLite and
      // MySQL put them first. Falling back to `created_at` makes the order the
      // same everywhere and is the honest answer anyway — a request never
      // checked has been waiting since it was created.
      .orderByRaw('coalesce(last_checked_at, created_at) asc')
      .limit(limit);
    return rows.map(rowToApprovalRequest);
  }

  /**
   * Note that the sweep has looked at these requests.
   *
   * Deliberately separate from `transition`: the point is to record the look
   * itself, including when it found nothing to change, so an unresolvable
   * request cannot starve the rest of the queue.
   */
  async markChecked(ids: string[]): Promise<void> {
    if (ids.length === 0) {
      return;
    }
    await this.db<ApprovalRequestRow>(TABLE_REQUESTS)
      .whereIn('id', ids)
      .update({ last_checked_at: this.now() });
  }

  /** Pending requests whose timeout has passed. */
  async findPendingPastExpiry(
    now: Date,
    limit: number,
  ): Promise<ApprovalRequest[]> {
    const rows = await this.db<ApprovalRequestRow>(TABLE_REQUESTS)
      .where({ status: 'pending' satisfies ApprovalRequestStatus })
      .whereNotNull('expires_at')
      .where('expires_at', '<=', now)
      .orderBy('expires_at', 'asc')
      .limit(limit);
    return rows.map(rowToApprovalRequest);
  }

  /**
   * Requests eligible for redaction: settled, old enough, not yet redacted.
   *
   * Only terminal requests, because redacting the values of something still in
   * flight would leave a request that can never be launched.
   */
  async findRedactable(
    before: Date,
    limit: number,
  ): Promise<ApprovalRequest[]> {
    const rows = await this.db<ApprovalRequestRow>(TABLE_REQUESTS)
      .whereIn('status', TERMINAL_APPROVAL_REQUEST_STATUSES as string[])
      .whereNull('redacted_at')
      .where('updated_at', '<', before)
      .orderBy('updated_at', 'asc')
      .limit(limit);
    return rows.map(rowToApprovalRequest);
  }

  /**
   * Drop the personal data from a settled request, keeping the request itself.
   *
   * Redacts, never deletes. The row and every decision on it are the audit
   * trail this plugin exists to produce; what goes is the submitted values and
   * the rendered summary, which may carry personal data such as an access
   * justification. The values *hash* stays, so a grant could still be checked.
   *
   * Guarded on `redacted_at IS NULL` so two replicas sweeping at once do not
   * both count it.
   */
  async redact(id: string): Promise<boolean> {
    const now = this.now();
    const affected = await this.db<ApprovalRequestRow>(TABLE_REQUESTS)
      .where({ id })
      .whereNull('redacted_at')
      .update({
        values_json: null,
        summary: null,
        redacted_at: now,
        updated_at: now,
      });
    return affected === 1;
  }
}

/**
 * A user ref as given, and normalised, for matching refs stored either way. An
 * unparseable ref can only match itself, if it matches anything at all.
 */
function refSpellings(ref: string): string[] {
  return [...new Set([ref, tryNormaliseEntityRef(ref) ?? ref])];
}
