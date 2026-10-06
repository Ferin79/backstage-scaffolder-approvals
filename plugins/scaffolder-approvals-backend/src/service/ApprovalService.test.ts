import { GATE_ACTION_ID } from '@ferin79/backstage-plugin-scaffolder-approvals-common';
import {
  computeTemplateStepsHash,
  parseGrant,
} from '@ferin79/backstage-plugin-scaffolder-approvals-node';
import { resolvePackagePath } from '@backstage/backend-plugin-api';
import {
  mockCredentials,
  mockServices,
  TestDatabases,
} from '@backstage/backend-test-utils';
import type { Entity } from '@backstage/catalog-model';
import type { CatalogService } from '@backstage/plugin-catalog-node';
import type { ScaffolderService } from '@backstage/plugin-scaffolder-node';
import type { JsonObject } from '@backstage/types';
import type { Knex } from 'knex';
import { ApprovalStore } from '../database';
import { type ApprovalObserver, ApprovalService } from './ApprovalService';

jest.setTimeout(60_000);

const migrationsDir = resolvePackagePath(
  '@ferin79/backstage-plugin-scaffolder-approvals-backend',
  'migrations',
);

const TEMPLATE_REF = 'template:default/request-github-admin';
const REQUESTER = 'user:default/requester';
const VALUES = { repository: 'backstage', justification: 'on-call rotation' };

/** A gated template whose gate policy the test can vary. */
function gatedTemplate(gateInput: JsonObject, parameters?: unknown): Entity {
  return {
    apiVersion: 'scaffolder.backstage.io/v1beta3',
    kind: 'Template',
    metadata: { name: 'request-github-admin' },
    spec: {
      type: 'service',
      ...(parameters ? { parameters } : {}),
      steps: [
        {
          id: 'gate',
          action: GATE_ACTION_ID,
          // Required of every usable gate; a test can still override it.
          input: { values: '${{ parameters }}', ...gateInput },
        },
        { id: 'grant', action: 'github:admin:grant' },
      ],
    },
  } as Entity;
}

/**
 * A gated template carrying one of the shapes that let a direct scaffolder
 * call reach a real step without an approval.
 */
function bypassTemplate(extra: {
  gate?: JsonObject;
  grant?: JsonObject;
}): Entity {
  return {
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
          ...extra.gate,
        },
        { id: 'grant', action: 'github:admin:grant', ...extra.grant },
      ],
    },
  } as Entity;
}

/**
 * A caller, as `UserInfoService` would describe them.
 *
 * Group membership is resolved by the catalog rather than expanded by the
 * service, so a test states it the same way the real service would see it.
 */
function caller(userEntityRef: string, groups: string[] = []) {
  return {
    credentials: mockCredentials.user(userEntityRef),
    info: {
      userEntityRef,
      ownershipEntityRefs: [userEntityRef, ...groups],
    },
  };
}

describe('ApprovalService', () => {
  const databases = TestDatabases.create();

  describe.each(databases.eachSupportedId())('%s', databaseId => {
    let knex: Knex;
    let store: ApprovalStore;
    let service: ApprovalService;
    let clock: Date;

    let entity: Entity | undefined;
    let catalogFails: boolean;
    let scaffold: jest.Mock;
    let observer: {
      onSubmitted: jest.Mock;
      onDecided: jest.Mock;
      onLaunched: jest.Mock;
      onWithdrawn: jest.Mock;
      onFailed: jest.Mock;
    };

    const requester = caller(REQUESTER, ['group:default/devx-team']);
    const alice = caller('user:default/alice', ['group:default/devx-team']);
    const bob = caller('user:default/bob', ['group:default/devx-team']);
    const outsider = caller('user:default/outsider');

    const known = [requester, alice, bob, outsider];

    beforeEach(async () => {
      knex = await databases.init(databaseId);
      await knex.migrate.latest({ directory: migrationsDir });

      clock = new Date('2026-09-12T10:00:00.000Z');
      store = new ApprovalStore({ db: knex, now: () => clock });

      entity = gatedTemplate({ approvers: ['group:default/devx-team'] });
      scaffold = jest.fn().mockResolvedValue({ taskId: 'task-1' });
      observer = {
        onSubmitted: jest.fn(),
        onDecided: jest.fn(),
        onLaunched: jest.fn(),
        onWithdrawn: jest.fn(),
        onFailed: jest.fn(),
      };

      catalogFails = false;
      const catalog = {
        getEntityByRef: jest.fn(async (ref: unknown) => {
          if (catalogFails) {
            throw new Error('catalog unreachable');
          }
          return ref === TEMPLATE_REF ? entity : undefined;
        }),
      } as unknown as CatalogService;

      const scaffolder = { scaffold } as unknown as ScaffolderService;

      const userInfo = {
        getUserInfo: jest.fn(async (credentials: unknown) => {
          const match = known.find(c => c.credentials === credentials);
          if (!match) {
            throw new Error('Unexpected credentials in test');
          }
          return match.info;
        }),
      };

      service = new ApprovalService({
        store,
        catalog,
        scaffolder,
        auth: mockServices.auth(),
        userInfo,
        logger: mockServices.logger.mock(),
        grantTtl: { hours: 1 },
        observer: observer as unknown as ApprovalObserver,
        now: () => clock,
      });
    });

    afterEach(async () => {
      await knex.destroy();
      jest.resetAllMocks();
    });

    async function submit(values: JsonObject = VALUES) {
      return await service.submit({
        templateRef: TEMPLATE_REF,
        values,
        credentials: requester.credentials,
      });
    }

    describe('submit', () => {
      it('stores a pending request with the policy snapshotted', async () => {
        entity = gatedTemplate({
          approvers: ['Group:DevX-Team'],
          quorum: 2,
          summary: 'Admin on backstage',
        });

        const { id, collapsed } = await submit();
        expect(collapsed).toBe(false);

        const stored = await store.getRequest(id);
        expect(stored).toMatchObject({
          templateRef: TEMPLATE_REF,
          requesterRef: REQUESTER,
          status: 'pending',
          values: VALUES,
          summary: 'Admin on backstage',
          policySnapshot: {
            // Normalised on the way in, so it matches catalog ownership refs.
            approvers: ['group:default/devx-team'],
            quorum: 2,
            selfApprove: false,
          },
        });
        expect(observer.onSubmitted).toHaveBeenCalledTimes(1);
      });

      it('derives expiresAt from the gate timeout', async () => {
        entity = gatedTemplate({
          approvers: ['group:default/devx-team'],
          timeout: { hours: 72 },
        });

        const { id } = await submit();
        expect((await store.getRequest(id))?.expiresAt).toBe(
          '2026-09-15T10:00:00.000Z',
        );
      });

      it('leaves expiresAt unset when the gate has no timeout', async () => {
        const { id } = await submit();
        expect((await store.getRequest(id))?.expiresAt).toBeUndefined();
      });

      it('collapses a duplicate and does not notify again', async () => {
        const first = await submit();
        const second = await submit();

        expect(second).toEqual({ id: first.id, collapsed: true });
        // Approvers must not see the same ask twice.
        expect(observer.onSubmitted).toHaveBeenCalledTimes(1);
      });

      it('refuses an unknown template', async () => {
        await expect(
          service.submit({
            templateRef: 'template:default/nope',
            values: VALUES,
            credentials: requester.credentials,
          }),
        ).rejects.toThrow(/No such template/);
      });

      it('stores the requester ref in one spelling', async () => {
        // MySQL's default collation compares strings case-insensitively
        // while SQLite and Postgres compare bytes, so a ref stored as the
        // identity happened to spell it makes "is this the requester?" and
        // duplicate collapse answer differently per engine.
        const odd = caller('User:Default/Requester', [
          'group:default/devx-team',
        ]);
        known.push(odd);

        const { id } = await service.submit({
          templateRef: TEMPLATE_REF,
          values: VALUES,
          credentials: odd.credentials,
        });

        expect((await store.getRequest(id))?.requesterRef).toBe(
          'user:default/requester',
        );
      });

      it('collapses a duplicate submitted under a differently spelled identity', async () => {
        const odd = caller('User:Default/Requester', [
          'group:default/devx-team',
        ]);
        known.push(odd);

        const first = await submit();
        const second = await service.submit({
          templateRef: TEMPLATE_REF,
          values: VALUES,
          credentials: odd.credentials,
        });

        expect(second).toEqual({ id: first.id, collapsed: true });
      });

      it('records what the template looked like at submit', async () => {
        // Without these two columns an approver deciding days later has
        // no way to know the steps changed underneath them.
        (entity!.metadata as { uid?: string }).uid = 'uid-1';

        const { id } = await submit();

        const stored = await store.getRequest(id);
        expect(stored?.templateUid).toBe('uid-1');
        expect(stored?.templateStepsHash).toBe(
          computeTemplateStepsHash(entity!),
        );
      });

      it('reports drift once the steps change under a pending request', async () => {
        (entity!.metadata as { uid?: string }).uid = 'uid-1';
        const { id } = await submit();

        // The template is read live at launch, so editing it here is exactly
        // what an unlucky approver would be deciding against.
        (entity as any).spec.steps.push({ id: 'extra', action: 'debug:log' });

        const request = await store.getRequest(id);
        await expect(
          service.templateDrift(request!, requester.credentials),
        ).resolves.toEqual({ changed: true, reasons: ['steps'] });
      });

      it('reports drift once the parameters change so the values no longer fit', async () => {
        // The steps hash cannot see this, and it is the change that makes
        // the scaffolder refuse the launch.
        entity = gatedTemplate(
          { approvers: ['group:default/devx-team'] },
          { required: ['repository'], properties: { repository: {} } },
        );
        (entity!.metadata as { uid?: string }).uid = 'uid-1';
        const { id } = await submit();

        (entity as any).spec.parameters = {
          required: ['repository', 'ticket'],
          properties: { repository: {}, ticket: { type: 'string' } },
        };

        const request = await store.getRequest(id);
        await expect(
          service.templateDrift(request!, requester.credentials),
        ).resolves.toEqual({ changed: true, reasons: ['parameters'] });

        // Only while it can still launch: a settled request has nothing left
        // for an approver to act on.
        await knex('approval_requests')
          .where({ id })
          .update({ status: 'completed' });
        const settled = await store.getRequest(id);
        await expect(
          service.templateDrift(settled!, requester.credentials),
        ).resolves.toEqual({ changed: false, reasons: [] });
      });

      it('reports no drift while the template is untouched', async () => {
        (entity!.metadata as { uid?: string }).uid = 'uid-1';
        const { id } = await submit();

        const request = await store.getRequest(id);
        await expect(
          service.templateDrift(request!, requester.credentials),
        ).resolves.toEqual({ changed: false, reasons: [] });
      });

      it('reports nothing rather than "unchanged" when the catalog fails', async () => {
        // An unreachable catalog is not evidence that a template is unchanged,
        // and saying so would be the one answer that misleads an approver.
        (entity!.metadata as { uid?: string }).uid = 'uid-1';
        const { id } = await submit();
        const request = await store.getRequest(id);

        catalogFails = true;
        await expect(
          service.templateDrift(request!, requester.credentials),
        ).resolves.toBeUndefined();
      });

      it('refuses a template with a secret-typed parameter', async () => {
        // The scaffolder puts a `ui:field: Secret` value into the task's
        // secrets, not its values, so it cannot survive the wait: the request
        // would be approved and the template would run without it. And if such
        // a value did arrive it would be stored in `values`, which every
        // signed-in user can read.
        entity = gatedTemplate(
          { approvers: ['group:default/devx-team'] },
          {
            required: ['token'],
            properties: {
              token: { type: 'string', 'ui:field': 'Secret' },
            },
          },
        );

        await expect(submit({ token: 'hunter2' })).rejects.toThrow(
          /secret-typed/,
        );
        expect((await store.listRequests()).totalItems).toBe(0);
      });

      it('refuses an ungated template', async () => {
        entity = {
          apiVersion: 'scaffolder.backstage.io/v1beta3',
          kind: 'Template',
          metadata: { name: 'plain' },
          spec: { type: 'service', steps: [{ id: 'p', action: 'x' }] },
        } as Entity;

        await expect(submit()).rejects.toThrow(/is not gated/);
      });

      it('refuses a template whose gate is not the first step', async () => {
        // Steps before the gate would run unapproved, so this template is
        // dangerous rather than merely odd.
        entity = {
          apiVersion: 'scaffolder.backstage.io/v1beta3',
          kind: 'Template',
          metadata: { name: 'late-gate' },
          spec: {
            type: 'service',
            steps: [
              { id: 'first', action: 'github:admin:grant' },
              {
                id: 'gate',
                action: GATE_ACTION_ID,
                input: { approvers: ['group:default/devx-team'] },
              },
            ],
          },
        } as Entity;

        await expect(submit()).rejects.toThrow(/must be the first step/);
        expect((await store.listRequests()).totalItems).toBe(0);
      });

      it('refuses the template shapes that let a direct run past the gate', async () => {
        // Each of these still looks gated — the step is there, the derived
        // annotation is there — while a direct POST /v2/tasks runs real steps
        // with no approval. Refusing them at submit is what stops the
        // approvals API from blessing a template that cannot actually be
        // gated.
        const shapes: Array<[string, Entity, RegExp]> = [
          [
            'a falsy `if:` switches the gate off',
            bypassTemplate({ gate: { if: '${{ parameters.gate }}' } }),
            /must not carry an 'if:'/,
          ],
          [
            'an empty `each:` runs the gate zero times',
            bypassTemplate({ gate: { each: '${{ parameters.items }}' } }),
            /must not carry an 'each:'/,
          ],
          [
            'a later step runs after the gate throws',
            bypassTemplate({ grant: { if: '${{ always() }}' } }),
            /run even after an earlier step fails/,
          ],
          [
            'a step-read policy can drop the gate but keep the step',
            bypassTemplate({
              grant: { 'backstage:permissions': { tags: ['admin'] } },
            }),
            /missing the 'backstage:permissions.tags'/,
          ],
        ];

        for (const [, shape, message] of shapes) {
          entity = shape;
          await expect(submit()).rejects.toThrow(message);
        }
        expect((await store.listRequests()).totalItems).toBe(0);
      });

      it('refuses a gate whose policy is malformed, storing nothing', async () => {
        entity = gatedTemplate({ approvers: [] });

        await expect(submit()).rejects.toThrow(/unusable gate policy/);
        expect((await store.listRequests()).totalItems).toBe(0);
      });

      // These were once accepted and approved,
      // and then every run failed at the gate.
      it.each([
        ['no values', { values: undefined }, /no 'values' input/],
        [
          'a subset of the values',
          { values: { repository: '${{ parameters.repository }}' } },
          /passes something other than/,
        ],
      ])(
        'refuses a gate given %s, storing nothing',
        async (_, input, reason) => {
          entity = gatedTemplate({
            approvers: ['group:default/devx-team'],
            ...input,
          });

          await expect(submit()).rejects.toThrow(reason);
          expect((await store.listRequests()).totalItems).toBe(0);
          expect(observer.onSubmitted).not.toHaveBeenCalled();
        },
      );

      it('rejects invalid values and stores nothing', async () => {
        entity = gatedTemplate(
          { approvers: ['group:default/devx-team'] },
          {
            required: ['repository', 'justification'],
            properties: {
              repository: { type: 'string' },
              justification: { type: 'string', minLength: 10 },
            },
          },
        );

        await expect(submit({ repository: 'backstage' })).rejects.toThrow(
          /do not match the template's parameters/,
        );
        expect((await store.listRequests()).totalItems).toBe(0);
        expect(observer.onSubmitted).not.toHaveBeenCalled();
      });
    });

    describe('decide', () => {
      it('stays pending until the quorum is met, then approves and launches', async () => {
        entity = gatedTemplate({
          approvers: ['group:default/devx-team'],
          quorum: 2,
        });
        const { id } = await submit();

        const afterFirst = await service.decide({
          requestId: id,
          decision: 'approve',
          credentials: alice.credentials,
        });
        expect(afterFirst.status).toBe('pending');
        expect(scaffold).not.toHaveBeenCalled();
        // Announced although nothing changed status, with the status
        // the request really has, so an open page shows "1 of 2".
        expect(observer.onDecided).toHaveBeenCalledWith(
          expect.objectContaining({ id, status: 'pending' }),
          expect.objectContaining({
            approverRef: 'user:default/alice',
            decision: 'approve',
          }),
        );

        const afterSecond = await service.decide({
          requestId: id,
          decision: 'approve',
          comment: 'looks fine',
          credentials: bob.credentials,
        });

        expect(afterSecond.status).toBe('running');
        expect(afterSecond.decisions).toHaveLength(2);
        expect(afterSecond.taskId).toBe('task-1');
        expect(scaffold).toHaveBeenCalledTimes(1);
      });

      it('counts distinct principals, not votes', async () => {
        entity = gatedTemplate({
          approvers: ['group:default/devx-team'],
          quorum: 2,
        });
        const { id } = await submit();

        await service.decide({
          requestId: id,
          decision: 'approve',
          credentials: alice.credentials,
        });

        // A second vote from the same person must not reach the quorum.
        await expect(
          service.decide({
            requestId: id,
            decision: 'approve',
            credentials: alice.credentials,
          }),
        ).rejects.toThrow(/already decided/);

        expect((await store.getRequest(id))?.status).toBe('pending');
        expect(scaffold).not.toHaveBeenCalled();
      });

      it('rejects on the first denial, whatever the approval count', async () => {
        entity = gatedTemplate({
          approvers: ['group:default/devx-team'],
          quorum: 3,
        });
        const { id } = await submit();

        await service.decide({
          requestId: id,
          decision: 'approve',
          credentials: alice.credentials,
        });

        // Advanced so the two decisions have a real chronological order;
        // same-millisecond votes fall back to the row id, which is arbitrary.
        clock = new Date('2026-09-12T10:05:00.000Z');
        const denied = await service.decide({
          requestId: id,
          decision: 'deny',
          comment: 'not while the incident is open',
          credentials: bob.credentials,
        });

        // A quorum is a threshold for assent, not a tally.
        expect(denied.status).toBe('rejected');
        expect(denied.decidedAt).toBe('2026-09-12T10:05:00.000Z');
        expect(scaffold).not.toHaveBeenCalled();

        // The denial and its reason survive as the audit trail.
        expect(denied.decisions.map(d => [d.approverRef, d.decision])).toEqual([
          ['user:default/alice', 'approve'],
          ['user:default/bob', 'deny'],
        ]);
        expect(denied.decisions[1].comment).toBe(
          'not while the incident is open',
        );
      });

      it('blocks the requester when selfApprove is off, even inside the group', async () => {
        // The requester is a member of devx-team, so a plain membership check
        // would let them approve their own request.
        const { id } = await submit();

        await expect(
          service.decide({
            requestId: id,
            decision: 'approve',
            credentials: requester.credentials,
          }),
        ).rejects.toThrow(/cannot approve your own request/);

        expect((await store.getRequest(id))?.status).toBe('pending');
        expect(await store.listDecisions(id)).toHaveLength(0);
      });

      it('allows the requester when selfApprove is on', async () => {
        entity = gatedTemplate({
          approvers: ['group:default/devx-team'],
          selfApprove: true,
        });
        const { id } = await submit();

        const decided = await service.decide({
          requestId: id,
          decision: 'approve',
          credentials: requester.credentials,
        });
        expect(decided.status).toBe('running');
      });

      it('refuses someone outside the approver list', async () => {
        const { id } = await submit();

        await expect(
          service.decide({
            requestId: id,
            decision: 'approve',
            credentials: outsider.credentials,
          }),
        ).rejects.toThrow(/not an approver/);
        expect(await store.listDecisions(id)).toHaveLength(0);
      });

      it('refuses a decision once the timeout has passed', async () => {
        // The sweep that marks a request `expired` runs every few minutes.
        // Without this, an approval landing in that window launched the
        // template after the deadline the approvers were given.
        entity = gatedTemplate({
          approvers: ['group:default/devx-team'],
          timeout: { hours: 2 },
        });
        const { id } = await submit();

        clock = new Date('2026-09-12T12:00:01.000Z');

        await expect(
          service.decide({
            requestId: id,
            decision: 'approve',
            credentials: alice.credentials,
          }),
        ).rejects.toThrow(/timed out before anyone decided/);

        // Nothing was recorded and nothing was launched.
        expect(await store.listDecisions(id)).toEqual([]);
        expect(scaffold).not.toHaveBeenCalled();
        expect((await store.getRequest(id))?.status).toBe('pending');
      });

      it('lets the sweep and a decision race to exactly one winner', async () => {
        // The guard is on the UPDATE as well as in the eligibility check, so a
        // decision arriving as the sweep expires the request cannot leave it
        // both `expired` and `approved`.
        entity = gatedTemplate({
          approvers: ['group:default/devx-team'],
          timeout: { hours: 2 },
        });
        const { id } = await submit();

        clock = new Date('2026-09-12T12:00:01.000Z');
        expect(
          await store.transition(id, 'pending', 'approved', {
            notExpired: true,
          }),
        ).toBe(false);
        expect(await store.transition(id, 'pending', 'expired')).toBe(true);
      });

      it('still allows a decision inside the timeout', async () => {
        entity = gatedTemplate({
          approvers: ['group:default/devx-team'],
          timeout: { hours: 2 },
        });
        const { id } = await submit();

        clock = new Date('2026-09-12T11:59:59.000Z');
        const decided = await service.decide({
          requestId: id,
          decision: 'approve',
          credentials: alice.credentials,
        });

        expect(decided.status).toBe('running');
      });

      it('refuses a decision on a request that already left pending', async () => {
        const { id } = await submit();
        await service.decide({
          requestId: id,
          decision: 'approve',
          credentials: alice.credentials,
        });

        await expect(
          service.decide({
            requestId: id,
            decision: 'deny',
            credentials: bob.credentials,
          }),
        ).rejects.toThrow(/already been decided/);
      });

      it('refuses an unknown request', async () => {
        await expect(
          service.decide({
            requestId: '3f1e4c8a-0000-4000-8000-00000000dead',
            decision: 'approve',
            credentials: alice.credentials,
          }),
        ).rejects.toThrow(/No such approval request/);
      });

      it('tells the observer the status the request now has', async () => {
        // The request was loaded before the transition, so passing it
        // straight through announced every approval and every rejection as
        // `pending`. An external subscriber acting on `status` would act on a
        // decision that looked undecided.
        const { id } = await submit();
        await service.decide({
          requestId: id,
          decision: 'approve',
          credentials: alice.credentials,
        });

        expect(observer.onDecided).toHaveBeenCalledWith(
          expect.objectContaining({ id, status: 'approved' }),
          expect.objectContaining({ decision: 'approve' }),
        );
      });

      it('tells the observer about a rejection as rejected', async () => {
        const { id } = await submit();
        await service.decide({
          requestId: id,
          decision: 'deny',
          comment: 'not this quarter',
          credentials: alice.credentials,
        });

        expect(observer.onDecided).toHaveBeenCalledWith(
          expect.objectContaining({ id, status: 'rejected' }),
          expect.objectContaining({ decision: 'deny' }),
        );
      });

      it('announces the launch once the request is running', async () => {
        // G4: `approval.launched` is in the design's event list and never
        // existed.
        const { id } = await submit();
        await service.decide({
          requestId: id,
          decision: 'approve',
          credentials: alice.credentials,
        });

        expect(observer.onLaunched).toHaveBeenCalledWith(
          expect.objectContaining({ id, status: 'running', taskId: 'task-1' }),
        );
      });

      it('announces no launch when the launch failed', async () => {
        scaffold.mockRejectedValue(new Error('scaffolder unreachable'));
        const { id } = await submit();
        await service.decide({
          requestId: id,
          decision: 'approve',
          credentials: alice.credentials,
        });

        expect(observer.onDecided).toHaveBeenCalled();
        expect(observer.onLaunched).not.toHaveBeenCalled();
      });

      it('does not let an observer failure undo a committed decision', async () => {
        // Notifications are a soft dependency; a state change that is already
        // committed must not be reported as failed.
        observer.onDecided.mockRejectedValue(new Error('notifications down'));
        const { id } = await submit();

        const decided = await service.decide({
          requestId: id,
          decision: 'approve',
          credentials: alice.credentials,
        });
        expect(decided.status).toBe('running');
      });
    });

    describe('launch', () => {
      it('passes the grant as a task secret, never as a value', async () => {
        const { id } = await submit();
        await service.decide({
          requestId: id,
          decision: 'approve',
          credentials: alice.credentials,
        });

        const [request, options] = scaffold.mock.calls[0];
        expect(request.templateRef).toBe(TEMPLATE_REF);
        expect(request.values).toEqual(VALUES);

        // Values are echoed back to the requester by the scaffolder API;
        // secrets are not.
        // The request id travels with the token, since the gate action needs it
        // to redeem the grant and cannot learn it any other way.
        const grant = request.secrets.APPROVAL_GRANT;
        expect(parseGrant(grant).requestId).toBe(id);
        expect(parseGrant(grant).token).toMatch(/^[A-Za-z0-9_-]{43}$/);
        expect(JSON.stringify(request.values)).not.toContain(grant);

        // Service credentials, since AuthService cannot mint credentials for an
        // arbitrary user days after the fact.
        expect(options.credentials.principal).toMatchObject({
          type: 'service',
        });
      });

      it('stores only the hash of the grant token', async () => {
        const { id } = await submit();
        await service.decide({
          requestId: id,
          decision: 'approve',
          credentials: alice.credentials,
        });

        const { token } = parseGrant(
          scaffold.mock.calls[0][0].secrets.APPROVAL_GRANT,
        );
        const grants = await knex('approval_grants').where({ request_id: id });

        expect(grants).toHaveLength(1);
        expect(grants[0].token_hash).toMatch(/^[0-9a-f]{64}$/);
        // A database leak must not yield usable grants.
        expect(grants[0].token_hash).not.toBe(token);
        expect(JSON.stringify(grants[0])).not.toContain(token);
      });

      it('binds the grant to the approved values and the TTL', async () => {
        const { id } = await submit();
        await service.decide({
          requestId: id,
          decision: 'approve',
          credentials: alice.credentials,
        });

        const request = await store.getRequest(id);
        const [grant] = await knex('approval_grants').where({ request_id: id });
        expect(grant.values_hash).toBe(request?.valuesHash);
      });

      it('leaves the request approved with no task id when the launch fails', async () => {
        // A launch failure is not a task failure. Nothing executed and the
        // grant is unconsumed, so a retry is safe — unlike a task that ran and
        // failed, which is terminal.
        scaffold.mockRejectedValue(new Error('scaffolder unreachable'));
        const { id } = await submit();

        const decided = await service.decide({
          requestId: id,
          decision: 'approve',
          credentials: alice.credentials,
        });

        expect(decided.status).toBe('approved');
        expect(decided.taskId).toBeUndefined();
      });

      it('fails at once, with the reason, when the scaffolder refuses the launch', async () => {
        // The template's parameters changed
        // under the request, the scaffolder answered 400 on every attempt,
        // and the request sat at "Starting" for the whole grant TTL before
        // failing as "the approval grant expired".
        scaffold.mockRejectedValue(
          new Error(
            'Backend request failed, 400 Bad Request {"errors":[{"property":"instance","message":"requires property \\"ticket\\"","instance":{"repository":"backstage"}}]}',
          ),
        );
        const { id } = await submit();

        const decided = await service.decide({
          requestId: id,
          decision: 'approve',
          credentials: alice.credentials,
        });

        const reason =
          'the scaffolder refused to start the template (400 Bad Request): requires property "ticket"';
        expect(decided).toMatchObject({
          status: 'failed',
          failureReason: reason,
        });
        expect(decided.taskId).toBeUndefined();
        expect(observer.onFailed).toHaveBeenCalledWith(
          expect.objectContaining({ id, status: 'failed' }),
          reason,
        );
        expect(observer.onLaunched).not.toHaveBeenCalled();

        // Nothing left that could redeem it.
        const grants = await knex('approval_grants').where({ request_id: id });
        expect(grants).toHaveLength(1);
        expect(grants[0].revoked_at).not.toBeNull();

        // And a later sweep tick does not try again.
        clock = new Date('2026-09-12T10:15:00.000Z');
        await service.launch(id);
        expect(scaffold).toHaveBeenCalledTimes(1);
      });

      it('still retries a launch whose outcome is unknown', async () => {
        // A 5xx says nothing about whether a task exists.
        scaffold.mockRejectedValueOnce(
          new Error('Backend request failed, 503 Service Unavailable '),
        );
        const { id } = await submit();
        await service.decide({
          requestId: id,
          decision: 'approve',
          credentials: alice.credentials,
        });
        expect((await store.getRequest(id))?.status).toBe('approved');
        expect(observer.onFailed).not.toHaveBeenCalled();

        clock = new Date('2026-09-12T10:15:00.000Z');
        await service.launch(id);
        expect((await store.getRequest(id))?.status).toBe('running');
      });

      it('declines a second launch while one is in flight', async () => {
        // A decision's launch and a sweep tick can overlap. The claim is
        // compare-and-set, so only one of them mints a grant; a read of the
        // grants table followed by a write would let both through and run the
        // template twice.
        const { id } = await submit();
        await service.decide({
          requestId: id,
          decision: 'approve',
          credentials: alice.credentials,
        });

        // Put the request back into the state the sweep would find it in.
        await knex('approval_requests')
          .where({ id })
          .update({ status: 'approved', task_id: null });

        await service.launch(id);

        expect(scaffold).toHaveBeenCalledTimes(1);
        expect(
          await knex('approval_grants').where({ request_id: id }),
        ).toHaveLength(1);
      });

      it('lets only one of two concurrent launches through', async () => {
        const { id } = await submit();
        await service.decide({
          requestId: id,
          decision: 'approve',
          credentials: alice.credentials,
        });
        // Back to the moment just after the approval: nothing claimed, nothing
        // minted.
        await knex('approval_requests').where({ id }).update({
          status: 'approved',
          task_id: null,
          launch_attempted_at: null,
        });
        await knex('approval_grants').where({ request_id: id }).delete();
        scaffold.mockClear();

        await Promise.all([service.launch(id), service.launch(id)]);

        expect(scaffold).toHaveBeenCalledTimes(1);
        expect(
          await knex('approval_grants').where({ request_id: id }),
        ).toHaveLength(1);
      });

      it('revokes the unredeemed grant and relaunches after a failure', async () => {
        // The grant a failed launch left behind is what used to block
        // every retry. Revoking it is what lets a new one be minted, and the
        // old one must stop being redeemable at that moment.
        scaffold.mockRejectedValueOnce(new Error('scaffolder unreachable'));
        const { id } = await submit();
        await service.decide({
          requestId: id,
          decision: 'approve',
          credentials: alice.credentials,
        });
        expect((await store.getRequest(id))?.status).toBe('approved');

        const [first] = await knex('approval_grants').where({ request_id: id });
        expect(first.revoked_at).toBeNull();

        // Past the grace period on the claim, but well inside the grant TTL.
        clock = new Date('2026-09-12T10:15:00.000Z');
        await service.launch(id);

        expect(scaffold).toHaveBeenCalledTimes(2);
        expect((await store.getRequest(id))?.status).toBe('running');

        const grants = await knex('approval_grants')
          .where({ request_id: id })
          .orderBy('id');
        expect(grants).toHaveLength(2);
        expect(grants.filter(grant => grant.revoked_at !== null)).toHaveLength(
          1,
        );
      });

      it('gives every later grant the same deadline as the first', async () => {
        // Otherwise each retry would push the deadline out by a full TTL and a
        // scaffolder that stayed down would be retried forever, so the request
        // would never reach `failed`.
        scaffold.mockRejectedValueOnce(new Error('scaffolder unreachable'));
        const { id } = await submit();
        await service.decide({
          requestId: id,
          decision: 'approve',
          credentials: alice.credentials,
        });

        clock = new Date('2026-09-12T10:15:00.000Z');
        await service.launch(id);

        const expiries = (
          await knex('approval_grants').where({ request_id: id })
        ).map(grant => new Date(grant.expires_at).toISOString());
        expect(new Set(expiries).size).toBe(1);
      });

      it('stops launching once the approval is no longer redeemable', async () => {
        // `failed` only once the grant lapses. Past that point the approval
        // is spent, and a retry needs a fresh one.
        scaffold.mockRejectedValueOnce(new Error('scaffolder unreachable'));
        const { id } = await submit();
        await service.decide({
          requestId: id,
          decision: 'approve',
          credentials: alice.credentials,
        });
        expect(scaffold).toHaveBeenCalledTimes(1);

        // Past the one-hour grant TTL.
        clock = new Date('2026-09-12T11:30:00.000Z');
        await service.launch(id);

        expect(scaffold).toHaveBeenCalledTimes(1);
        expect((await store.getRequest(id))?.status).toBe('approved');
      });

      it('recovers the task id rather than launching twice', async () => {
        // The crash-after-scaffold case: a task is running and holds the
        // grant, but the transition that records its id was lost.
        const { id } = await submit();
        await service.decide({
          requestId: id,
          decision: 'approve',
          credentials: alice.credentials,
        });

        const [grant] = await knex('approval_grants').where({ request_id: id });
        await knex('approval_grants').where({ id: grant.id }).update({
          consumed_at: clock,
          consumed_by_task_id: 'task-from-the-lost-launch',
        });
        await knex('approval_requests')
          .where({ id })
          .update({ status: 'approved', task_id: null });
        scaffold.mockClear();

        clock = new Date('2026-09-12T10:15:00.000Z');
        await service.launch(id);

        expect(scaffold).not.toHaveBeenCalled();
        const request = await store.getRequest(id);
        expect(request?.status).toBe('running');
        expect(request?.taskId).toBe('task-from-the-lost-launch');
      });

      it('refuses a grant that was revoked', async () => {
        // Revoking has to stop the old grant being redeemable, or a task
        // holding it could still run the template alongside its replacement.
        const { id } = await submit();
        await service.decide({
          requestId: id,
          decision: 'approve',
          credentials: alice.credentials,
        });

        const [grant] = await knex('approval_grants').where({ request_id: id });
        expect(await store.revokeGrant(grant.id)).toBe(true);

        expect(
          await store.consumeGrant({
            requestId: id,
            tokenHash: grant.token_hash,
            valuesHash: grant.values_hash,
            taskId: 'task-9',
            templateRef: TEMPLATE_REF,
          }),
        ).toBe(false);
      });

      it('loses the revoke race to a task that redeems the grant', async () => {
        // The reason revoking is compare-and-set: zero rows changed means a
        // task holds the grant, and the caller must recover its id instead of
        // launching a second time.
        const { id } = await submit();
        await service.decide({
          requestId: id,
          decision: 'approve',
          credentials: alice.credentials,
        });

        const [grant] = await knex('approval_grants').where({ request_id: id });
        expect(
          await store.consumeGrant({
            requestId: id,
            tokenHash: grant.token_hash,
            valuesHash: grant.values_hash,
            taskId: 'task-9',
            templateRef: TEMPLATE_REF,
          }),
        ).toBe(true);

        expect(await store.revokeGrant(grant.id)).toBe(false);
      });

      it('does nothing for a request that is not approved', async () => {
        const { id } = await submit();
        await service.launch(id);
        expect(scaffold).not.toHaveBeenCalled();
      });

      it('refuses to launch a redacted request', async () => {
        const { id } = await submit();
        await knex('approval_requests').where({ id }).update({
          status: 'approved',
          values_json: null,
          redacted_at: clock,
        });

        await expect(service.launch(id)).rejects.toThrow(/been redacted/);
        expect(scaffold).not.toHaveBeenCalled();
      });
    });

    describe('cancel', () => {
      it('lets the requester withdraw a pending request', async () => {
        const { id } = await submit();

        const cancelled = await service.cancel({
          requestId: id,
          credentials: requester.credentials,
        });
        expect(cancelled.status).toBe('cancelled');
      });

      it('tells the observer, so an open page and a subscriber hear of it', async () => {
        // Withdrawing was the one change that published nothing, so a
        // page open on the request never updated.
        const { id } = await submit();

        await service.cancel({
          requestId: id,
          credentials: requester.credentials,
        });

        expect(observer.onWithdrawn).toHaveBeenCalledWith(
          expect.objectContaining({ id, status: 'cancelled' }),
        );
      });

      it('refuses anyone but the requester', async () => {
        const { id } = await submit();

        await expect(
          service.cancel({ requestId: id, credentials: alice.credentials }),
        ).rejects.toThrow(/Only the requester/);
        expect((await store.getRequest(id))?.status).toBe('pending');
      });

      it('refuses once the request has been decided', async () => {
        const { id } = await submit();
        await service.decide({
          requestId: id,
          decision: 'approve',
          credentials: alice.credentials,
        });

        await expect(
          service.cancel({ requestId: id, credentials: requester.credentials }),
        ).rejects.toThrow(/no longer pending/);
      });

      describe('once the timeout has passed', () => {
        // Past the deadline but before the sweep, approving was refused
        // and withdrawing was not, so a timeout ended as a withdrawal.
        beforeEach(() => {
          entity = gatedTemplate({
            approvers: ['group:default/devx-team'],
            timeout: { hours: 2 },
          });
        });

        it('refuses to withdraw, and leaves the request for the sweep', async () => {
          const { id } = await submit();
          clock = new Date('2026-09-12T12:00:01.000Z');

          await expect(
            service.cancel({
              requestId: id,
              credentials: requester.credentials,
            }),
          ).rejects.toThrow(/timed out before anyone decided/);

          expect((await store.getRequest(id))?.status).toBe('pending');
          expect(observer.onWithdrawn).not.toHaveBeenCalled();
        });

        it('lets the sweep and a withdrawal race to exactly one outcome', async () => {
          const { id } = await submit();
          clock = new Date('2026-09-12T12:00:01.000Z');

          expect(
            await store.transition(id, 'pending', 'cancelled', {
              notExpired: true,
            }),
          ).toBe(false);
          expect(await store.transition(id, 'pending', 'expired')).toBe(true);
        });

        it('still withdraws a request inside the timeout', async () => {
          const { id } = await submit();
          clock = new Date('2026-09-12T11:59:59.000Z');

          const cancelled = await service.cancel({
            requestId: id,
            credentials: requester.credentials,
          });
          expect(cancelled.status).toBe('cancelled');
        });
      });
    });
  });
});
