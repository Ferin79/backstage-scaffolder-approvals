import { GATE_ACTION_ID } from '@ferin79/backstage-plugin-scaffolder-approvals-common';
import {
  hashGrantToken,
  parseGrant,
} from '@ferin79/backstage-plugin-scaffolder-approvals-node';
import { resolvePackagePath } from '@backstage/backend-plugin-api';
import {
  mockCredentials,
  mockServices,
  TestDatabases,
} from '@backstage/backend-test-utils';
import type { Entity } from '@backstage/catalog-model';
import { ResponseError } from '@backstage/errors';
import type { CatalogService } from '@backstage/plugin-catalog-node';
import type { ScaffolderService } from '@backstage/plugin-scaffolder-node';
import type { Knex } from 'knex';
import { ApprovalStore } from '../database';
import type { ApprovalNotifier } from './ApprovalNotifier';
import { ApprovalService } from './ApprovalService';
import { ApprovalSweeps } from './ApprovalSweeps';

jest.setTimeout(60_000);

const migrationsDir = resolvePackagePath(
  '@ferin79/backstage-plugin-scaffolder-approvals-backend',
  'migrations',
);

const TEMPLATE_REF = 'template:default/request-github-admin';
const REQUESTER = 'user:default/requester';
const VALUES = { repository: 'backstage', justification: 'on-call rotation' };

const TEMPLATE: Entity = {
  apiVersion: 'scaffolder.backstage.io/v1beta3',
  kind: 'Template',
  metadata: { name: 'request-github-admin' },
  spec: {
    type: 'service',
    steps: [
      {
        id: 'gate',
        action: GATE_ACTION_ID,
        input: {
          approvers: ['group:default/devx-team'],
          values: '${{ parameters }}',
        },
      },
    ],
  },
} as Entity;

const ALICE = {
  credentials: mockCredentials.user('user:default/alice'),
  info: {
    userEntityRef: 'user:default/alice',
    ownershipEntityRefs: ['user:default/alice', 'group:default/devx-team'],
  },
};
const REQUESTER_CALLER = {
  credentials: mockCredentials.user(REQUESTER),
  info: { userEntityRef: REQUESTER, ownershipEntityRefs: [REQUESTER] },
};

describe('ApprovalSweeps', () => {
  const databases = TestDatabases.create();

  describe.each(databases.eachSupportedId())('%s', databaseId => {
    let knex: Knex;
    let store: ApprovalStore;
    let service: ApprovalService;
    let sweeps: ApprovalSweeps;
    let clock: Date;
    let scaffold: jest.Mock;
    let getTask: jest.Mock;
    let notifier: {
      onSubmitted: jest.Mock;
      onDecided: jest.Mock;
      onLaunched: jest.Mock;
      onCompleted: jest.Mock;
      onFailed: jest.Mock;
      onExpired: jest.Mock;
    };

    beforeEach(async () => {
      knex = await databases.init(databaseId);
      await knex.migrate.latest({ directory: migrationsDir });

      clock = new Date('2026-09-13T10:00:00.000Z');
      store = new ApprovalStore({ db: knex, now: () => clock });

      scaffold = jest.fn().mockResolvedValue({ taskId: 'task-1' });
      getTask = jest.fn();
      notifier = {
        onSubmitted: jest.fn(),
        onDecided: jest.fn(),
        onLaunched: jest.fn(),
        onCompleted: jest.fn(),
        onFailed: jest.fn(),
        onExpired: jest.fn(),
      };

      const userInfo = {
        getUserInfo: jest.fn(async (credentials: unknown) =>
          credentials === ALICE.credentials
            ? ALICE.info
            : REQUESTER_CALLER.info,
        ),
      };

      service = new ApprovalService({
        store,
        catalog: {
          getEntityByRef: jest.fn(async () => TEMPLATE),
        } as unknown as CatalogService,
        scaffolder: { scaffold, getTask } as unknown as ScaffolderService,
        auth: mockServices.auth(),
        userInfo,
        logger: mockServices.logger.mock(),
        grantTtl: { hours: 1 },
        now: () => clock,
      });

      sweeps = new ApprovalSweeps({
        store,
        service,
        scaffolder: { scaffold, getTask } as unknown as ScaffolderService,
        auth: mockServices.auth(),
        logger: mockServices.logger.mock(),
        notifier: notifier as unknown as ApprovalNotifier,
        retention: { days: 180 },
        now: () => clock,
      });
    });

    afterEach(async () => {
      await knex.destroy();
      jest.resetAllMocks();
    });

    /** Submit and approve, leaving the request wherever `scaffold` put it. */
    async function approved(): Promise<string> {
      const { id } = await service.submit({
        templateRef: TEMPLATE_REF,
        values: VALUES,
        credentials: REQUESTER_CALLER.credentials,
      });
      await service.decide({
        requestId: id,
        decision: 'approve',
        credentials: ALICE.credentials,
      });
      return id;
    }

    describe('reconciling a request awaiting its task', () => {
      it('retries a launch that never minted a grant', async () => {
        scaffold.mockRejectedValueOnce(new Error('scaffolder unreachable'));
        const id = await approved();
        expect((await store.getRequest(id))?.status).toBe('approved');

        // Model the crash-before-mint case: the launch was claimed and then
        // died without leaving a grant behind.
        await knex('approval_grants').where({ request_id: id }).delete();

        // A tick after the claim has gone stale, which is when another caller
        // may take the launch over.
        clock = new Date('2026-09-13T10:15:00.000Z');
        await sweeps.reconcile();

        expect(scaffold).toHaveBeenCalledTimes(2);
        expect((await store.getRequest(id))?.status).toBe('running');
      });

      it('waits out the grace period before touching a launch in flight', async () => {
        // A task may have started and be on its way to its gate holding this
        // grant. Relaunching now is exactly the double execution the grant
        // guard exists to prevent.
        scaffold.mockRejectedValueOnce(new Error('scaffolder unreachable'));
        const id = await approved();

        await sweeps.reconcile();

        expect(scaffold).toHaveBeenCalledTimes(1);
        expect((await store.getRequest(id))?.status).toBe('approved');
      });

      it('revokes the grant and relaunches once the grace period has passed', async () => {
        // The launch is retried while the approval is still
        // redeemable. Before this, the live grant made the sweep wait until it
        // expired and then fail the request, so a failed launch was never
        // retried at all.
        scaffold.mockRejectedValueOnce(new Error('scaffolder unreachable'));
        const id = await approved();

        clock = new Date('2026-09-13T10:15:00.000Z');
        await sweeps.reconcile();

        expect(scaffold).toHaveBeenCalledTimes(2);
        expect((await store.getRequest(id))?.status).toBe('running');

        const grants = await knex('approval_grants').where({ request_id: id });
        expect(grants).toHaveLength(2);
        expect(grants.filter(g => g.revoked_at !== null)).toHaveLength(1);
      });

      it('recovers a lost task id from the consumed grant', async () => {
        // The crash this defends against: `scaffold()` returned and the task
        // started, but the status write was lost. Relaunching would run the
        // template twice; the grant records which task consumed it.
        const id = await approved();
        const grant = scaffold.mock.calls[0][0].secrets.APPROVAL_GRANT;
        const request = await store.getRequest(id);

        await store.consumeGrant({
          requestId: id,
          tokenHash: hashGrantToken(parseGrant(grant).token),
          valuesHash: request!.valuesHash,
          taskId: 'task-actually-running',
          templateRef: TEMPLATE_REF,
        });

        // Model the lost write.
        await knex('approval_requests')
          .where({ id })
          .update({ status: 'approved', task_id: null });

        clock = new Date('2026-09-13T10:15:00.000Z');
        await sweeps.reconcile();

        const healed = await store.getRequest(id);
        expect(healed?.status).toBe('running');
        expect(healed?.taskId).toBe('task-actually-running');
        // Crucially, without launching anything else.
        expect(scaffold).toHaveBeenCalledTimes(1);
      });

      it('fails the request once the grant expires unused', async () => {
        scaffold.mockRejectedValueOnce(new Error('scaffolder unreachable'));
        const id = await approved();

        // Past the one-hour grant TTL.
        clock = new Date('2026-09-13T11:30:00.000Z');
        await sweeps.reconcile();

        const failed = await store.getRequest(id);
        expect(failed?.status).toBe('failed');
        // The page says why, not only that it failed.
        expect(failed?.failureReason).toMatch(
          /grant expired before the template could start/,
        );
        // Terminal: the approval is spent and a fresh one is needed.
        expect(notifier.onFailed).toHaveBeenCalledWith(
          expect.objectContaining({ id }),
          expect.stringMatching(
            /grant expired before the template could start/,
          ),
        );
        expect(scaffold).toHaveBeenCalledTimes(1);
      });

      it('keeps going when one request cannot be reconciled', async () => {
        scaffold.mockRejectedValue(new Error('scaffolder unreachable'));
        const first = await approved();
        await knex('approval_grants').where({ request_id: first }).delete();

        // A second, healthy one behind it.
        const { id: second } = await service.submit({
          templateRef: TEMPLATE_REF,
          values: { ...VALUES, justification: 'other' },
          credentials: REQUESTER_CALLER.credentials,
        });
        await service.decide({
          requestId: second,
          decision: 'approve',
          credentials: ALICE.credentials,
        });
        await knex('approval_grants').where({ request_id: second }).delete();

        clock = new Date('2026-09-13T10:15:00.000Z');
        await expect(sweeps.reconcile()).resolves.toBeUndefined();
        // Both were attempted, neither stopped the other.
        expect(scaffold.mock.calls.length).toBeGreaterThanOrEqual(3);
      });
    });

    describe('reconciling a running task', () => {
      it.each([
        ['completed', 'completed'],
        ['failed', 'failed'],
        ['cancelled', 'failed'],
        ['skipped', 'completed'],
      ])('maps a %s task onto a %s request', async (task, expected) => {
        const id = await approved();
        expect((await store.getRequest(id))?.status).toBe('running');

        getTask.mockResolvedValue({ id: 'task-1', status: task });
        await sweeps.reconcile();

        expect((await store.getRequest(id))?.status).toBe(expected);
      });

      it.each([
        ['failed', 'the task failed'],
        ['cancelled', 'the task was cancelled'],
        ['completed', undefined],
      ])('records why a %s task ended the request', async (task, reason) => {
        const id = await approved();
        getTask.mockResolvedValue({ id: 'task-1', status: task });
        await sweeps.reconcile();

        expect((await store.getRequest(id))?.failureReason).toBe(reason);
      });

      it('leaves a task that is still going alone', async () => {
        const id = await approved();

        for (const status of ['open', 'processing']) {
          getTask.mockResolvedValue({ id: 'task-1', status });
          await sweeps.reconcile();
          expect((await store.getRequest(id))?.status).toBe('running');
        }
      });

      it('notifies on a failure but not on success', async () => {
        const id = await approved();
        getTask.mockResolvedValue({ id: 'task-1', status: 'failed' });
        await sweeps.reconcile();

        expect(notifier.onFailed).toHaveBeenCalledWith(
          expect.objectContaining({ id, status: 'failed' }),
          'the task failed',
        );

        notifier.onFailed.mockClear();
        const other = await (async () => {
          const { id: second } = await service.submit({
            templateRef: TEMPLATE_REF,
            values: { ...VALUES, justification: 'other' },
            credentials: REQUESTER_CALLER.credentials,
          });
          await service.decide({
            requestId: second,
            decision: 'approve',
            credentials: ALICE.credentials,
          });
          return second;
        })();
        getTask.mockResolvedValue({ id: 'task-1', status: 'completed' });
        await sweeps.reconcile();

        expect((await store.getRequest(other))?.status).toBe('completed');
        expect(notifier.onFailed).not.toHaveBeenCalled();
      });

      it('survives the scaffolder being unreachable', async () => {
        const id = await approved();
        getTask.mockRejectedValue(new Error('scaffolder unreachable'));

        await expect(sweeps.reconcile()).resolves.toBeUndefined();
        // Still running, to be retried next tick.
        expect((await store.getRequest(id))?.status).toBe('running');
      });

      it('announces a completed run, without notifying anyone', async () => {
        // G4: the lifecycle an external subscriber sees has to include the end
        // of it. Still no notification for this one.
        const id = await approved();
        getTask.mockResolvedValue({ id: 'task-1', status: 'completed' });

        await sweeps.reconcile();

        expect(notifier.onCompleted).toHaveBeenCalledWith(
          expect.objectContaining({ id, status: 'completed' }),
        );
        expect(notifier.onFailed).not.toHaveBeenCalled();
      });

      it('rotates, so a slow batch cannot starve what is behind it', async () => {
        // Ordering by `updated_at` sounds like "longest waiting" and is
        // not. A task that is still running never changes status, so nothing
        // moves its `updated_at` and it holds its place in every batch. With a
        // batch of 2, the third request was never looked at again.
        const capped = new ApprovalSweeps({
          store,
          service,
          scaffolder: { scaffold, getTask } as unknown as ScaffolderService,
          auth: mockServices.auth(),
          logger: mockServices.logger.mock(),
          notifier: notifier as unknown as ApprovalNotifier,
          retention: { days: 180 },
          batchSize: 2,
          now: () => clock,
        });

        const ids: string[] = [];
        for (const index of [0, 1, 2]) {
          const { id } = await service.submit({
            templateRef: TEMPLATE_REF,
            values: { ...VALUES, index },
            credentials: REQUESTER_CALLER.credentials,
          });
          await service.decide({
            requestId: id,
            decision: 'approve',
            credentials: ALICE.credentials,
          });
          ids.push(id);
        }
        expect(
          (await Promise.all(ids.map(id => store.getRequest(id)))).map(
            r => r?.status,
          ),
        ).toEqual(['running', 'running', 'running']);

        // The first two never settle; the third finished long ago.
        getTask.mockImplementation(async () => ({
          id: 'task-1',
          status: 'processing',
        }));
        // Time has to move, or `last_checked_at` lands on the same instant as
        // `created_at` and the ordering is a tie rather than a rotation.
        clock = new Date('2026-09-13T10:01:00.000Z');
        await capped.reconcile();

        getTask.mockImplementation(async () => ({
          id: 'task-1',
          status: 'completed',
        }));
        // One more tick is all it should take: the first two have been looked
        // at, so the third is now at the front of the queue.
        clock = new Date('2026-09-13T10:05:00.000Z');
        await capped.reconcile();

        expect((await store.getRequest(ids[2]))?.status).toBe('completed');
      });

      it('fails a request whose task the scaffolder has forgotten', async () => {
        // Nothing will ever resolve it: no event can arrive for a task that
        // does not exist, and every later sweep reads the same 404. Leaving it
        // `running` forever is worse, because the requester is still waiting.
        const id = await approved();
        getTask.mockRejectedValue(
          await ResponseError.fromResponse(
            new Response(
              JSON.stringify({
                error: { name: 'NotFoundError', message: 'No such task' },
              }),
              { status: 404, statusText: 'Not Found' },
            ),
          ),
        );

        await sweeps.reconcile();

        expect((await store.getRequest(id))?.status).toBe('failed');
        expect(notifier.onFailed).toHaveBeenCalledWith(
          expect.objectContaining({ id }),
          expect.stringMatching(/no longer has a record of the task/),
        );
      });

      it('leaves a request alone when the scaffolder is merely unwell', async () => {
        // A 5xx or a dropped connection says nothing about whether the task
        // exists, and failing a request over a restart would be worse than
        // waiting.
        const id = await approved();
        getTask.mockRejectedValue(new Error('ECONNREFUSED'));

        await sweeps.reconcile();

        expect((await store.getRequest(id))?.status).toBe('running');
        expect(notifier.onFailed).not.toHaveBeenCalled();
      });

      it('applies a task status exactly once, however many signals arrive', async () => {
        // The sweep and the event subscription both call this; whichever is
        // second must do nothing, because the transition is compare-and-set.
        const id = await approved();
        const request = await store.getRequest(id);

        await sweeps.applyTaskStatus(request!, 'completed');
        await sweeps.applyTaskStatus(request!, 'failed');

        expect((await store.getRequest(id))?.status).toBe('completed');
      });
    });

    describe('expiring requests nobody decided', () => {
      async function pendingWithTimeout(justification: string) {
        const gated = {
          ...TEMPLATE,
          spec: {
            ...(TEMPLATE as any).spec,
            steps: [
              {
                id: 'gate',
                action: GATE_ACTION_ID,
                input: {
                  approvers: ['group:default/devx-team'],
                  timeout: { hours: 2 },
                  values: '${{ parameters }}',
                },
              },
            ],
          },
        } as Entity;

        const scoped = new ApprovalService({
          store,
          catalog: {
            getEntityByRef: jest.fn(async () => gated),
          } as unknown as CatalogService,
          scaffolder: { scaffold, getTask } as unknown as ScaffolderService,
          auth: mockServices.auth(),
          userInfo: {
            getUserInfo: jest.fn(async () => REQUESTER_CALLER.info),
          },
          logger: mockServices.logger.mock(),
          grantTtl: { hours: 1 },
          now: () => clock,
        });

        const { id } = await scoped.submit({
          templateRef: TEMPLATE_REF,
          values: { ...VALUES, justification },
          credentials: REQUESTER_CALLER.credentials,
        });
        return id;
      }

      it('expires a pending request past its timeout, and notifies', async () => {
        const id = await pendingWithTimeout('one');

        clock = new Date('2026-09-13T11:00:00.000Z');
        await sweeps.expireTimedOut();
        expect((await store.getRequest(id))?.status).toBe('pending');

        clock = new Date('2026-09-13T12:00:01.000Z');
        await sweeps.expireTimedOut();

        const expired = await store.getRequest(id);
        expect(expired?.status).toBe('expired');
        expect(expired?.decidedAt).toBe('2026-09-13T12:00:01.000Z');
        expect(notifier.onExpired).toHaveBeenCalledWith(
          expect.objectContaining({ id, status: 'expired' }),
        );
      });

      it('never touches a request with no timeout', async () => {
        const id = await (async () => {
          const { id: submitted } = await service.submit({
            templateRef: TEMPLATE_REF,
            values: VALUES,
            credentials: REQUESTER_CALLER.credentials,
          });
          return submitted;
        })();

        clock = new Date('2027-09-13T10:00:00.000Z');
        await sweeps.expireTimedOut();

        expect((await store.getRequest(id))?.status).toBe('pending');
      });

      it('does not expire a request that was decided first', async () => {
        // The transition is guarded on `pending`, so a decision landing at the
        // same moment wins or loses cleanly rather than both applying.
        const id = await pendingWithTimeout('two');
        await service.decide({
          requestId: id,
          decision: 'deny',
          credentials: ALICE.credentials,
        });

        clock = new Date('2026-09-13T12:00:01.000Z');
        await sweeps.expireTimedOut();

        expect((await store.getRequest(id))?.status).toBe('rejected');
        expect(notifier.onExpired).not.toHaveBeenCalled();
      });
    });

    describe('redacting settled requests', () => {
      it('nulls the values and summary but keeps the row and its decisions', async () => {
        const id = await approved();
        getTask.mockResolvedValue({ id: 'task-1', status: 'completed' });
        await sweeps.reconcile();

        clock = new Date('2027-09-13T10:00:00.000Z');
        await sweeps.redactOld();

        const redacted = await store.getRequestWithDecisions(id);
        expect(redacted?.values).toBeNull();
        expect(redacted?.summary).toBeNull();
        expect(redacted?.redactedAt).toBe('2027-09-13T10:00:00.000Z');

        // The audit trail is the whole point, so it outlives the personal data.
        expect(redacted?.status).toBe('completed');
        expect(redacted?.requesterRef).toBe(REQUESTER);
        expect(redacted?.decisions).toHaveLength(1);
        expect(redacted?.decisions[0].approverRef).toBe('user:default/alice');
        // Kept so a grant could still be checked against it.
        expect(redacted?.valuesHash).toMatch(/^[0-9a-f]{64}$/);
      });

      it('leaves a request that has not settled alone, however old', async () => {
        // Redacting something still in flight would leave a request that can
        // never be launched.
        const id = await approved();

        clock = new Date('2028-09-13T10:00:00.000Z');
        await sweeps.redactOld();

        expect((await store.getRequest(id))?.values).toEqual(VALUES);
      });

      it('leaves a settled request inside the retention window alone', async () => {
        const id = await approved();
        getTask.mockResolvedValue({ id: 'task-1', status: 'completed' });
        await sweeps.reconcile();

        // 179 days, one short of the window.
        clock = new Date('2027-03-11T10:00:00.000Z');
        await sweeps.redactOld();

        expect((await store.getRequest(id))?.values).toEqual(VALUES);
      });

      it('redacts once, not on every tick', async () => {
        const id = await approved();
        getTask.mockResolvedValue({ id: 'task-1', status: 'completed' });
        await sweeps.reconcile();

        clock = new Date('2027-09-13T10:00:00.000Z');
        await sweeps.redactOld();
        const first = await store.getRequest(id);

        clock = new Date('2027-09-14T10:00:00.000Z');
        await sweeps.redactOld();

        expect((await store.getRequest(id))?.redactedAt).toBe(
          first?.redactedAt,
        );
      });

      it('works through a backlog larger than one batch', async () => {
        const capped = new ApprovalSweeps({
          store,
          service,
          scaffolder: { scaffold, getTask } as unknown as ScaffolderService,
          auth: mockServices.auth(),
          logger: mockServices.logger.mock(),
          retention: { days: 180 },
          batchSize: 2,
          now: () => clock,
        });

        const ids: string[] = [];
        for (const index of [0, 1, 2, 3, 4]) {
          const { id } = await service.submit({
            templateRef: TEMPLATE_REF,
            values: { ...VALUES, index },
            credentials: REQUESTER_CALLER.credentials,
          });
          await service.cancel({
            requestId: id,
            credentials: REQUESTER_CALLER.credentials,
          });
          ids.push(id);
        }

        clock = new Date('2027-09-13T10:00:00.000Z');
        await capped.redactOld();

        for (const id of ids) {
          expect((await store.getRequest(id))?.values).toBeNull();
        }
      });
    });

    describe('batching', () => {
      it('touches no more than the batch size in one tick', async () => {
        const capped = new ApprovalSweeps({
          store,
          service,
          scaffolder: { scaffold, getTask } as unknown as ScaffolderService,
          auth: mockServices.auth(),
          logger: mockServices.logger.mock(),
          retention: { days: 180 },
          batchSize: 2,
          now: () => clock,
        });

        // A backlog of five, as an outage would leave behind.
        for (const index of [0, 1, 2, 3, 4]) {
          const { id } = await service.submit({
            templateRef: TEMPLATE_REF,
            values: { ...VALUES, index },
            credentials: REQUESTER_CALLER.credentials,
          });
          await service.decide({
            requestId: id,
            decision: 'approve',
            credentials: ALICE.credentials,
          });
          await knex('approval_requests').where({ id }).update({
            status: 'approved',
            task_id: null,
            launch_attempted_at: null,
          });
          await knex('approval_grants').where({ request_id: id }).delete();
        }

        scaffold.mockClear();
        await capped.reconcile();

        // A mass retry must not arrive at the scaffolder all at once.
        expect(scaffold).toHaveBeenCalledTimes(2);
      });
    });
  });
});
