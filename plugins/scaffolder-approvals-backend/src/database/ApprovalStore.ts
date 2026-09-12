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

import type {
  ApprovalDecision,
  ApprovalDecisionOutcome,
  ApprovalRequest,
  ApprovalRequestStatus,
  ApprovalRequestWithDecisions,
  GatePolicy,
} from '@backstage-community/plugin-scaffolder-approvals-common';
import {
  assertSha256Hex,
  computeValuesHash,
} from '@backstage-community/plugin-scaffolder-approvals-node';
import type { JsonObject } from '@backstage/types';
import type { Knex } from 'knex';
import { v4 as uuid } from 'uuid';
import { rowToApprovalDecision, rowToApprovalRequest } from './rowMapping';
import {
  type ApprovalDecisionRow,
  type ApprovalGrantRow,
  type ApprovalRequestRow,
  TABLE_DECISIONS,
  TABLE_GRANTS,
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
}

/** Filters for {@link ApprovalStore.listRequests}. */
export interface ListApprovalRequestRows {
  status?: ApprovalRequestStatus | ApprovalRequestStatus[];
  templateRef?: string;
  requesterRef?: string;
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
   * Collapsing (Q13) keeps an impatient requester from filling the approvers'
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

      const id = uuid();
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
        task_id: null,
        created_at: now,
        updated_at: now,
        expires_at: input.expiresAt ?? null,
        decided_at: null,
        redacted_at: null,
      });

      return { id, collapsed: false };
    });
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

    const affected = await this.db<ApprovalRequestRow>(TABLE_REQUESTS)
      .where({ id, status: from })
      .update(patch);

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
    const id = uuid();

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

    const id = uuid();
    await this.db(TABLE_GRANTS).insert({
      id,
      request_id: input.requestId,
      token_hash: input.tokenHash,
      values_hash: input.valuesHash,
      expires_at: input.expiresAt,
      consumed_at: null,
      consumed_by_task_id: null,
    });
    return id;
  }

  /**
   * Redeem a grant, exactly once.
   *
   * This is the enforcement point for the whole feature, so all five guards sit
   * in one `UPDATE` and the affected-row count has to be exactly 1:
   *
   * - `request_id` and `token_hash` — the grant exists and belongs to this
   *   request.
   * - `values_hash` — the task is running the values that were approved (Q10).
   *   Without this, an approved request could be redeemed to run different
   *   parameters.
   * - `consumed_at IS NULL` — single use, so a leaked token cannot be replayed.
   * - `expires_at > now` — the grant TTL (Q7).
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
      .where('expires_at', '>', now)
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
    const row = await this.db<ApprovalGrantRow>(TABLE_GRANTS)
      .where({ request_id: requestId })
      .whereNull('consumed_at')
      .where('expires_at', '>', this.now())
      .first();
    return row !== undefined;
  }

  /** Read a grant back, for tests and operator introspection. */
  async getGrant(id: string): Promise<ApprovalGrantRow | undefined> {
    return await this.db<ApprovalGrantRow>(TABLE_GRANTS).where({ id }).first();
  }
}
