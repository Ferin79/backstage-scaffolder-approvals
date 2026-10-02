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

import { resolvePackagePath } from '@backstage/backend-plugin-api';
import { TestDatabases } from '@backstage/backend-test-utils';
import {
  checkDecisionEligibility,
  type GatePolicy,
} from '@ferin79/backstage-plugin-scaffolder-approvals-common';
import {
  computeValuesHash,
  generateGrantToken,
  hashGrantToken,
} from '@ferin79/backstage-plugin-scaffolder-approvals-node';
import type { JsonObject } from '@backstage/types';
import type { Knex } from 'knex';
import { ApprovalStore, type NewApprovalRequest } from './ApprovalStore';

jest.setTimeout(60_000);

const migrationsDir = resolvePackagePath(
  '@ferin79/backstage-plugin-scaffolder-approvals-backend',
  'migrations',
);

const POLICY: GatePolicy = {
  approvers: ['group:default/devx-team'],
  quorum: 2,
  selfApprove: false,
};

const VALUES = { repository: 'backstage', justification: 'on-call' };

const TEMPLATE_REF = 'template:default/request-github-admin';

function newRequest(
  overrides: Partial<NewApprovalRequest> = {},
): NewApprovalRequest {
  const values = overrides.values ?? VALUES;
  return {
    templateRef: TEMPLATE_REF,
    values,
    valuesHash: computeValuesHash(values),
    requesterRef: 'user:default/requester',
    summary: 'Admin on backstage',
    policySnapshot: POLICY,
    ...overrides,
  };
}

/**
 * What the "concurrent" cases here do and do not prove.
 *
 * `Promise.all` interleaves the two calls at their `await` boundaries, which is
 * enough to catch the mistake that matters: a read-then-write, where both
 * callers read the old state before either writes. Both such tests were
 * confirmed to fail against a deliberately read-then-write implementation.
 *
 * It is not true parallelism — better-sqlite3 is synchronous, so the statements
 * themselves serialise. Genuine simultaneous execution is only exercised where
 * Postgres and MySQL run, which needs a container runtime and therefore happens
 * in CI.
 */
describe('ApprovalStore', () => {
  const databases = TestDatabases.create();

  describe.each(databases.eachSupportedId())('%s', databaseId => {
    let knex: Knex;
    let store: ApprovalStore;
    // The clock the store sees, so expiry is driven rather than waited out.
    let clock: Date;

    beforeEach(async () => {
      knex = await databases.init(databaseId);
      await knex.migrate.latest({ directory: migrationsDir });
      clock = new Date('2026-09-12T10:00:00.000Z');
      store = new ApprovalStore({ db: knex, now: () => clock });
    });

    afterEach(async () => {
      await knex.destroy();
    });

    describe('createOrCollapse', () => {
      it('stores a request and reads it back as the wire type', async () => {
        const { id, collapsed } = await store.createOrCollapse(
          newRequest({ expiresAt: new Date('2026-09-15T10:00:00.000Z') }),
        );
        expect(collapsed).toBe(false);

        const stored = await store.getRequest(id);
        expect(stored).toEqual({
          id,
          templateRef: 'template:default/request-github-admin',
          values: VALUES,
          valuesHash: computeValuesHash(VALUES),
          requesterRef: 'user:default/requester',
          status: 'pending',
          summary: 'Admin on backstage',
          policySnapshot: POLICY,
          createdAt: '2026-09-12T10:00:00.000Z',
          updatedAt: '2026-09-12T10:00:00.000Z',
          expiresAt: '2026-09-15T10:00:00.000Z',
        });
      });

      it('returns the same id for an identical pending request', async () => {
        const first = await store.createOrCollapse(newRequest());
        const second = await store.createOrCollapse(newRequest());

        expect(second.id).toBe(first.id);
        expect(second.collapsed).toBe(true);
        expect((await store.listRequests()).totalItems).toBe(1);
      });

      it('collapses regardless of the key order the values arrived in', async () => {
        // The hash is canonical, so re-submitting the same parameters built in
        // a different order must not create a second request.
        const first = await store.createOrCollapse(
          newRequest({ values: { a: 1, b: 2 } }),
        );
        const second = await store.createOrCollapse(
          newRequest({ values: { b: 2, a: 1 } }),
        );

        expect(second).toEqual({ id: first.id, collapsed: true });
      });

      it('does not collapse across requesters, templates or values', async () => {
        const base = await store.createOrCollapse(newRequest());

        const otherRequester = await store.createOrCollapse(
          newRequest({ requesterRef: 'user:default/someone-else' }),
        );
        const otherTemplate = await store.createOrCollapse(
          newRequest({ templateRef: 'template:default/other' }),
        );
        const otherValues = await store.createOrCollapse(
          newRequest({ values: { repository: 'something-else' } }),
        );

        for (const result of [otherRequester, otherTemplate, otherValues]) {
          expect(result.collapsed).toBe(false);
          expect(result.id).not.toBe(base.id);
        }
        expect((await store.listRequests()).totalItems).toBe(4);
      });

      it('does not collapse into a request that is no longer pending', async () => {
        const first = await store.createOrCollapse(newRequest());
        await store.transition(first.id, 'pending', 'rejected');

        const second = await store.createOrCollapse(newRequest());
        expect(second.collapsed).toBe(false);
        expect(second.id).not.toBe(first.id);
      });

      it('does not collapse into a pending request that has already timed out', async () => {
        // Otherwise an impatient requester is handed back a request that the
        // timeout sweep is about to bin, and waits forever.
        const first = await store.createOrCollapse(
          newRequest({ expiresAt: new Date('2026-09-12T11:00:00.000Z') }),
        );

        clock = new Date('2026-09-12T12:00:00.000Z');

        const second = await store.createOrCollapse(newRequest());
        expect(second.collapsed).toBe(false);
        expect(second.id).not.toBe(first.id);
      });

      it('refuses values and a hash that disagree', async () => {
        // This binding is what stops "approved for X, executed as Y", so a
        // mismatch is a programming error and must not reach the database.
        await expect(
          store.createOrCollapse(
            newRequest({ valuesHash: computeValuesHash({ different: true }) }),
          ),
        ).rejects.toThrow(/does not match values/);

        await expect(
          store.createOrCollapse(newRequest({ valuesHash: 'not-a-hash' })),
        ).rejects.toThrow(/valuesHash must be a lowercase hex SHA-256 digest/);

        expect((await store.listRequests()).totalItems).toBe(0);
      });
    });

    describe('transition', () => {
      it('moves a request and stamps the extra fields', async () => {
        const { id } = await store.createOrCollapse(newRequest());

        clock = new Date('2026-09-12T11:00:00.000Z');
        const moved = await store.transition(id, 'pending', 'approved', {
          decidedAt: new Date('2026-09-12T10:59:00.000Z'),
        });
        expect(moved).toBe(true);

        const after = await store.getRequest(id);
        expect(after).toMatchObject({
          status: 'approved',
          decidedAt: '2026-09-12T10:59:00.000Z',
          updatedAt: '2026-09-12T11:00:00.000Z',
          // Untouched.
          createdAt: '2026-09-12T10:00:00.000Z',
        });
      });

      it('lets exactly one of two concurrent callers win', async () => {
        // Two replicas both seeing quorum met. If both won, the template would
        // run twice.
        const { id } = await store.createOrCollapse(newRequest());

        const results = await Promise.all([
          store.transition(id, 'pending', 'approved'),
          store.transition(id, 'pending', 'approved'),
        ]);

        expect(results.filter(Boolean)).toHaveLength(1);
        expect((await store.getRequest(id))?.status).toBe('approved');
      });

      it('lets exactly one caller win a race to differing outcomes', async () => {
        // An approval and a timeout sweep landing together must not both apply.
        const { id } = await store.createOrCollapse(newRequest());

        const results = await Promise.all([
          store.transition(id, 'pending', 'approved'),
          store.transition(id, 'pending', 'expired'),
        ]);

        expect(results.filter(Boolean)).toHaveLength(1);
        expect(['approved', 'expired']).toContain(
          (await store.getRequest(id))?.status,
        );
      });

      it('refuses to move a request that is not in the expected state', async () => {
        const { id } = await store.createOrCollapse(newRequest());
        await store.transition(id, 'pending', 'rejected');

        // Wrong `from`, so no transition — this is what keeps a terminal
        // request terminal without a separate guard.
        expect(await store.transition(id, 'pending', 'approved')).toBe(false);
        expect(await store.transition(id, 'approved', 'running')).toBe(false);
        expect((await store.getRequest(id))?.status).toBe('rejected');
      });

      it('reports false for a request that does not exist', async () => {
        expect(
          await store.transition(
            '3f1e4c8a-0000-4000-8000-00000000dead',
            'pending',
            'approved',
          ),
        ).toBe(false);
      });

      it('can clear a column with an explicit null', async () => {
        const { id } = await store.createOrCollapse(
          newRequest({ expiresAt: new Date('2026-09-15T10:00:00.000Z') }),
        );

        // Once approved there is nothing left for the timeout sweep to expire.
        await store.transition(id, 'pending', 'approved', { expiresAt: null });
        expect((await store.getRequest(id))?.expiresAt).toBeUndefined();
      });
    });

    describe('recordDecision', () => {
      it('records a vote and returns it', async () => {
        const { id } = await store.createOrCollapse(newRequest());

        const result = await store.recordDecision({
          requestId: id,
          approverRef: 'user:default/alice',
          decision: 'approve',
          comment: 'on-call rotation checks out',
        });

        expect(result.recorded).toBe(true);
        expect(result.decision).toMatchObject({
          requestId: id,
          approverRef: 'user:default/alice',
          decision: 'approve',
          comment: 'on-call rotation checks out',
          createdAt: '2026-09-12T10:00:00.000Z',
        });
      });

      it('keeps the first vote when an approver votes twice', async () => {
        const { id } = await store.createOrCollapse(newRequest());

        const first = await store.recordDecision({
          requestId: id,
          approverRef: 'user:default/alice',
          decision: 'approve',
        });
        const second = await store.recordDecision({
          requestId: id,
          approverRef: 'user:default/alice',
          decision: 'deny',
          comment: 'changed my mind',
        });

        expect(second.recorded).toBe(false);
        // The standing vote is returned, so the caller can tell the approver
        // what they already decided rather than silently dropping it.
        expect(second.decision).toEqual(first.decision);
        expect(await store.listDecisions(id)).toHaveLength(1);
      });

      it('counts one approver once under concurrent double submission', async () => {
        const { id } = await store.createOrCollapse(newRequest());

        const results = await Promise.all([
          store.recordDecision({
            requestId: id,
            approverRef: 'user:default/alice',
            decision: 'approve',
          }),
          store.recordDecision({
            requestId: id,
            approverRef: 'user:default/alice',
            decision: 'approve',
          }),
        ]);

        expect(results.filter(r => r.recorded)).toHaveLength(1);
        expect(await store.listDecisions(id)).toHaveLength(1);
      });

      it('keeps distinct approvers apart, in order', async () => {
        const { id } = await store.createOrCollapse(newRequest());

        await store.recordDecision({
          requestId: id,
          approverRef: 'user:default/alice',
          decision: 'approve',
        });
        clock = new Date('2026-09-12T10:05:00.000Z');
        await store.recordDecision({
          requestId: id,
          approverRef: 'user:default/bob',
          decision: 'deny',
        });

        const decisions = await store.listDecisions(id);
        expect(decisions.map(d => d.approverRef)).toEqual([
          'user:default/alice',
          'user:default/bob',
        ]);
        expect(decisions[1].comment).toBeUndefined();
      });
    });

    describe('consumeGrant', () => {
      const taskId = 'task-1';

      async function approvedRequestWithGrant(
        options: { expiresAt?: Date; values?: JsonObject } = {},
      ) {
        const request = newRequest(
          options.values ? { values: options.values } : {},
        );
        const { id } = await store.createOrCollapse(request);
        await store.transition(id, 'pending', 'approved');

        const token = generateGrantToken();
        const grantId = await store.createGrant({
          requestId: id,
          tokenHash: hashGrantToken(token),
          valuesHash: request.valuesHash,
          expiresAt: options.expiresAt ?? new Date('2026-09-12T11:00:00.000Z'),
        });

        return { id, token, grantId, valuesHash: request.valuesHash };
      }

      it('redeems a valid grant and records the task', async () => {
        const { id, token, grantId, valuesHash } =
          await approvedRequestWithGrant();

        expect(
          await store.consumeGrant({
            requestId: id,
            tokenHash: hashGrantToken(token),
            valuesHash,
            taskId,
            templateRef: TEMPLATE_REF,
          }),
        ).toBe(true);

        const grant = await store.getGrant(grantId);
        expect(grant?.consumed_by_task_id).toBe(taskId);
        expect(grant?.consumed_at).not.toBeNull();
      });

      it('lets exactly one of two concurrent redemptions succeed', async () => {
        // The single most important test here: a replayed token must not launch
        // the template twice.
        const { id, token, valuesHash } = await approvedRequestWithGrant();

        const results = await Promise.all([
          store.consumeGrant({
            requestId: id,
            tokenHash: hashGrantToken(token),
            valuesHash,
            taskId: 'task-a',
            templateRef: TEMPLATE_REF,
          }),
          store.consumeGrant({
            requestId: id,
            tokenHash: hashGrantToken(token),
            valuesHash,
            taskId: 'task-b',
            templateRef: TEMPLATE_REF,
          }),
        ]);

        expect(results.filter(Boolean)).toHaveLength(1);
      });

      it('refuses a second redemption of an already consumed grant', async () => {
        const { id, token, valuesHash } = await approvedRequestWithGrant();
        const consume = () =>
          store.consumeGrant({
            requestId: id,
            tokenHash: hashGrantToken(token),
            valuesHash,
            taskId,
            templateRef: TEMPLATE_REF,
          });

        expect(await consume()).toBe(true);
        expect(await consume()).toBe(false);
      });

      it('refuses a mismatched values hash', async () => {
        // Q10: the grant is bound to what was approved. Running other
        // parameters under an approval for these ones is the attack this stops.
        const { id, token } = await approvedRequestWithGrant();

        expect(
          await store.consumeGrant({
            requestId: id,
            tokenHash: hashGrantToken(token),
            valuesHash: computeValuesHash({ repository: 'something-else' }),
            taskId,
            templateRef: TEMPLATE_REF,
          }),
        ).toBe(false);
      });

      it('refuses a grant past its expiry', async () => {
        const { id, token, valuesHash } = await approvedRequestWithGrant({
          expiresAt: new Date('2026-09-12T10:30:00.000Z'),
        });

        clock = new Date('2026-09-12T10:30:01.000Z');

        expect(
          await store.consumeGrant({
            requestId: id,
            tokenHash: hashGrantToken(token),
            valuesHash,
            taskId,
            templateRef: TEMPLATE_REF,
          }),
        ).toBe(false);
      });

      it('refuses a grant belonging to another request', async () => {
        const first = await approvedRequestWithGrant();
        const second = await approvedRequestWithGrant({
          values: { repository: 'other' },
        });

        expect(
          await store.consumeGrant({
            requestId: second.id,
            tokenHash: hashGrantToken(first.token),
            valuesHash: second.valuesHash,
            taskId,
            templateRef: TEMPLATE_REF,
          }),
        ).toBe(false);
      });

      it('refuses an unknown token', async () => {
        const { id, valuesHash } = await approvedRequestWithGrant();

        expect(
          await store.consumeGrant({
            requestId: id,
            tokenHash: hashGrantToken(generateGrantToken()),
            valuesHash,
            taskId,
            templateRef: TEMPLATE_REF,
          }),
        ).toBe(false);
      });

      it('rejects a raw token where a hash is expected', async () => {
        // Without this guard the caller would store a usable token in
        // plaintext and everything would still appear to work.
        const { id, valuesHash } = await approvedRequestWithGrant();

        await expect(
          store.consumeGrant({
            requestId: id,
            tokenHash: generateGrantToken(),
            valuesHash,
            taskId,
            templateRef: TEMPLATE_REF,
          }),
        ).rejects.toThrow(/tokenHash must be a lowercase hex SHA-256 digest/);
      });
    });

    describe('listRequests', () => {
      beforeEach(async () => {
        const templates = ['template:default/a', 'template:default/b'];
        for (let index = 0; index < 5; index++) {
          clock = new Date(Date.UTC(2026, 8, 12, 10, index));
          const { id } = await store.createOrCollapse(
            newRequest({
              templateRef: templates[index % 2],
              requesterRef:
                index < 3 ? 'user:default/alice' : 'user:default/bob',
              values: { index },
            }),
          );
          if (index === 0) {
            await store.transition(id, 'pending', 'rejected');
          }
        }
        clock = new Date('2026-09-12T12:00:00.000Z');
      });

      it('returns everything newest first by default', async () => {
        const { items, totalItems } = await store.listRequests();

        expect(totalItems).toBe(5);
        expect(items.map(i => i.createdAt)).toEqual([
          '2026-09-12T10:04:00.000Z',
          '2026-09-12T10:03:00.000Z',
          '2026-09-12T10:02:00.000Z',
          '2026-09-12T10:01:00.000Z',
          '2026-09-12T10:00:00.000Z',
        ]);
      });

      it('filters by status, template, requester and id', async () => {
        expect(
          (await store.listRequests({ status: 'pending' })).totalItems,
        ).toBe(4);
        expect(
          (await store.listRequests({ status: ['rejected', 'pending'] }))
            .totalItems,
        ).toBe(5);
        expect(
          (await store.listRequests({ templateRef: 'template:default/a' }))
            .totalItems,
        ).toBe(3);
        expect(
          (await store.listRequests({ requesterRef: 'user:default/bob' }))
            .totalItems,
        ).toBe(2);

        const all = await store.listRequests();
        const ids = [all.items[0].id, all.items[1].id];
        const restricted = await store.listRequests({ ids });
        expect(restricted.items.map(i => i.id).sort()).toEqual([...ids].sort());
      });

      it('reports the unpaged total alongside a page', async () => {
        const page = await store.listRequests({ limit: 2, offset: 1 });

        expect(page.items).toHaveLength(2);
        // So a caller can render "showing 2 of 5" without a second query.
        expect(page.totalItems).toBe(5);
        expect(page.items.map(i => i.createdAt)).toEqual([
          '2026-09-12T10:03:00.000Z',
          '2026-09-12T10:02:00.000Z',
        ]);
      });

      it('combines a filter with paging', async () => {
        const page = await store.listRequests({
          requesterRef: 'user:default/alice',
          limit: 1,
        });

        expect(page.totalItems).toBe(3);
        expect(page.items).toHaveLength(1);
      });
    });

    describe('listRequests with actionableBy', () => {
      // B2 in the browser review: the inbox listed every request that named
      // the caller, so an approver's count never fell when they voted, and a
      // requester in the approver group saw their own request as work to do.
      const ALICE = 'user:default/alice';
      const ALICE_REFS = [ALICE, 'group:default/devx-team'];
      const ids: Record<string, string> = {};

      beforeEach(async () => {
        const create = async (
          name: string,
          overrides: Partial<NewApprovalRequest> = {},
        ) => {
          const values = { name };
          ids[name] = (
            await store.createOrCollapse(
              newRequest({ values, policySnapshot: POLICY, ...overrides }),
            )
          ).id;
        };

        clock = new Date('2026-09-12T10:00:00.000Z');
        await create('waiting');
        await create('votedOn');
        await create('ownForbidden', { requesterRef: ALICE });
        await create('ownAllowed', {
          requesterRef: ALICE,
          policySnapshot: { ...POLICY, selfApprove: true },
        });
        await create('othersVoted');
        await create('deadlinePassed', {
          expiresAt: new Date('2026-09-12T11:00:00.000Z'),
        });
        await create('deadlineAhead', {
          expiresAt: new Date('2026-09-13T10:00:00.000Z'),
        });
        await create('settled');
        await create('notNamed', {
          policySnapshot: { ...POLICY, approvers: ['group:default/other'] },
        });

        await store.recordDecision({
          requestId: ids.votedOn,
          approverRef: ALICE,
          decision: 'approve',
        });
        await store.recordDecision({
          requestId: ids.othersVoted,
          approverRef: 'user:default/bob',
          decision: 'approve',
        });
        await store.transition(ids.settled, 'pending', 'rejected');

        // Past one deadline, not the other, and the sweep has not run: the
        // request is still `pending` in the table.
        clock = new Date('2026-09-12T12:00:00.000Z');
      });

      it('keeps only what the caller can still decide', async () => {
        const { items, totalItems } = await store.listRequests({
          approverRefs: ALICE_REFS,
          actionableBy: ALICE,
        });

        const byId = new Map(Object.entries(ids).map(([k, v]) => [v, k]));
        expect(items.map(item => byId.get(item.id)).sort()).toEqual([
          'deadlineAhead',
          'othersVoted',
          'ownAllowed',
          'waiting',
        ]);
        // Counted the same way, so "4 waiting on you" and the list agree.
        expect(totalItems).toBe(4);
      });

      it('agrees with checkDecisionEligibility, request by request', async () => {
        // The inbox and the decide buttons answer the same question; if they
        // ever disagree, somebody is shown work they cannot do, or not shown
        // work they can. Checked both ways over everything that names her.
        const named = await store.listRequests({ approverRefs: ALICE_REFS });
        const actionable = new Set(
          (
            await store.listRequests({
              approverRefs: ALICE_REFS,
              actionableBy: ALICE,
            })
          ).items.map(item => item.id),
        );

        for (const request of named.items) {
          const eligibility = checkDecisionEligibility(
            request,
            { userEntityRef: ALICE, ownershipEntityRefs: ALICE_REFS },
            await store.listDecisions(request.id),
            clock,
          );
          expect([request.id, actionable.has(request.id)]).toEqual([
            request.id,
            eligibility.allowed,
          ]);
        }
      });

      it('pages and counts after filtering', async () => {
        const page = await store.listRequests({
          approverRefs: ALICE_REFS,
          actionableBy: ALICE,
          limit: 1,
        });

        expect(page.items).toHaveLength(1);
        expect(page.totalItems).toBe(4);
      });

      it('matches a caller ref however it is spelled', async () => {
        // Requester refs are stored normalised; a token can carry another
        // spelling of the same user.
        const { items } = await store.listRequests({
          approverRefs: ALICE_REFS,
          actionableBy: 'User:default/alice',
        });

        expect(items.map(item => item.id)).not.toContain(ids.ownForbidden);
      });
    });

    describe('getManyByIds', () => {
      it('returns requests in the order asked for', async () => {
        // The permission framework's contract: one slot per requested id, in
        // the same order, so it can line results up with its own requests.
        const first = await store.createOrCollapse(newRequest());
        const second = await store.createOrCollapse(
          newRequest({ values: { other: true } }),
        );

        const ids = [second.id, first.id];
        const loaded = await store.getManyByIds(ids);

        expect(loaded.map(r => r?.id)).toEqual(ids);
      });

      it('leaves a gap for an id that does not exist', async () => {
        // A hole rather than a shorter array, or the caller's indices shift.
        const { id } = await store.createOrCollapse(newRequest());

        const loaded = await store.getManyByIds([
          '3f1e4c8a-0000-4000-8000-00000000dead',
          id,
        ]);

        expect(loaded).toHaveLength(2);
        expect(loaded[0]).toBeUndefined();
        expect(loaded[1]?.id).toBe(id);
      });

      it('returns nothing for an empty request', async () => {
        expect(await store.getManyByIds([])).toEqual([]);
      });
    });

    describe('approverRefs filter', () => {
      it('finds the requests a set of refs may decide on', async () => {
        const devx = await store.createOrCollapse(
          newRequest({
            policySnapshot: {
              approvers: ['group:default/devx-team'],
              quorum: 1,
              selfApprove: false,
            },
          }),
        );
        const platform = await store.createOrCollapse(
          newRequest({
            values: { other: true },
            policySnapshot: {
              approvers: ['group:default/platform'],
              quorum: 1,
              selfApprove: false,
            },
          }),
        );

        const asDevx = await store.listRequests({
          approverRefs: ['user:default/alice', 'group:default/devx-team'],
        });
        expect(asDevx.items.map(i => i.id)).toEqual([devx.id]);
        expect(asDevx.totalItems).toBe(1);

        const asOutsider = await store.listRequests({
          approverRefs: ['user:default/outsider'],
        });
        expect(asOutsider).toEqual({ items: [], totalItems: 0 });

        const asBoth = await store.listRequests({
          approverRefs: ['group:default/devx-team', 'group:default/platform'],
        });
        expect(asBoth.items.map(i => i.id).sort()).toEqual(
          [devx.id, platform.id].sort(),
        );
      });

      it('counts a request once even when several of the caller refs match', async () => {
        // A subquery rather than a join, precisely so this cannot double-count.
        const { id } = await store.createOrCollapse(
          newRequest({
            policySnapshot: {
              approvers: ['group:default/devx-team', 'user:default/alice'],
              quorum: 1,
              selfApprove: false,
            },
          }),
        );

        const page = await store.listRequests({
          approverRefs: ['user:default/alice', 'group:default/devx-team'],
        });

        expect(page.items.map(i => i.id)).toEqual([id]);
        expect(page.totalItems).toBe(1);
      });

      it('combines with a status filter and paging', async () => {
        const approvers = ['group:default/devx-team'];
        const policySnapshot = { approvers, quorum: 1, selfApprove: false };

        for (const index of [0, 1, 2]) {
          clock = new Date(Date.UTC(2026, 8, 12, 10, index));
          const { id } = await store.createOrCollapse(
            newRequest({ values: { index }, policySnapshot }),
          );
          if (index === 0) {
            await store.transition(id, 'pending', 'rejected');
          }
        }

        const pending = await store.listRequests({
          approverRefs: approvers,
          status: 'pending',
          limit: 1,
        });
        expect(pending.items).toHaveLength(1);
        expect(pending.totalItems).toBe(2);
      });

      it('records the approvers of a collapsed request only once', async () => {
        const first = await store.createOrCollapse(newRequest());
        const second = await store.createOrCollapse(newRequest());
        expect(second.id).toBe(first.id);

        expect(
          await knex('approval_request_approvers').where({
            request_id: first.id,
          }),
        ).toHaveLength(1);
      });
    });

    describe('findRunning', () => {
      /**
       * Three running requests, each a minute apart.
       *
       * Distinct timestamps on purpose: with all three tied, SQLite happens to
       * return them in the order of the `(status, last_checked_at)` index,
       * which makes the wrong ordering look right.
       */
      async function threeRunning(): Promise<string[]> {
        const ids: string[] = [];
        for (const index of [0, 1, 2]) {
          clock = new Date(Date.UTC(2026, 8, 12, 10, index));
          const { id } = await store.createOrCollapse(
            newRequest({
              values: { repository: `repo-${index}` },
              valuesHash: computeValuesHash({ repository: `repo-${index}` }),
            }),
          );
          await store.transition(id, 'pending', 'approved');
          await store.transition(id, 'approved', 'running', {
            taskId: `task-${index}`,
          });
          ids.push(id);
        }
        return ids;
      }

      it('rotates, so a batch that changes nothing still yields', async () => {
        // C6: ordering by `updated_at` sounds like "longest waiting" and is
        // not. A task still running never changes status, so nothing moves its
        // `updated_at` and it holds its place in every batch — with a batch of
        // two, the third request is never returned again however long it has
        // been finished.
        const ids = await threeRunning();

        const first = await store.findRunning(2);
        expect(first.map(r => r.id)).toEqual([ids[0], ids[1]]);

        // Looked at, nothing changed. That is the case that used to starve the
        // queue, so it is exactly the one that has to move them along.
        clock = new Date('2026-09-12T10:05:00.000Z');
        await store.markChecked(first.map(r => r.id));

        // The one never looked at is now at the front. Ordering by
        // `updated_at` would hand back the same two and never reach it.
        const second = await store.findRunning(2);
        expect(second[0].id).toBe(ids[2]);
      });

      it('puts a request never looked at before one already checked', async () => {
        const ids = await threeRunning();
        clock = new Date('2026-09-12T10:05:00.000Z');
        await store.markChecked([ids[0]]);

        expect((await store.findRunning(3)).map(r => r.id)).toEqual([
          ids[1],
          ids[2],
          ids[0],
        ]);
      });
    });

    describe('getRequestWithDecisions', () => {
      it('joins the decision history onto the request', async () => {
        const { id } = await store.createOrCollapse(newRequest());
        await store.recordDecision({
          requestId: id,
          approverRef: 'user:default/alice',
          decision: 'approve',
        });

        const full = await store.getRequestWithDecisions(id);
        expect(full?.decisions).toHaveLength(1);
        expect(full?.decisions[0].approverRef).toBe('user:default/alice');
      });

      it('returns undefined for an unknown request', async () => {
        await expect(
          store.getRequestWithDecisions('3f1e4c8a-0000-4000-8000-00000000dead'),
        ).resolves.toBeUndefined();
      });
    });
  });
});
