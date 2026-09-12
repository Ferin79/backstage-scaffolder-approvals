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

import { GATE_ACTION_ID } from '@backstage-community/plugin-scaffolder-approvals-common';
import { parseGrant } from '@backstage-community/plugin-scaffolder-approvals-node';
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
  '@backstage-community/plugin-scaffolder-approvals-backend',
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
        { id: 'gate', action: GATE_ACTION_ID, input: gateInput },
        { id: 'grant', action: 'github:admin:grant' },
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
    let scaffold: jest.Mock;
    let observer: { onSubmitted: jest.Mock; onDecided: jest.Mock };

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
      observer = { onSubmitted: jest.fn(), onDecided: jest.fn() };

      const catalog = {
        getEntityByRef: jest.fn(async (ref: unknown) =>
          ref === TEMPLATE_REF ? entity : undefined,
        ),
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

      it('refuses a gate whose policy is malformed, storing nothing', async () => {
        entity = gatedTemplate({ approvers: [] });

        await expect(submit()).rejects.toThrow(/unusable gate policy/);
        expect((await store.listRequests()).totalItems).toBe(0);
      });

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
        ).rejects.toThrow(/Self-approval is not permitted/);

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

      it('refuses an unknown request and an unknown decision', async () => {
        await expect(
          service.decide({
            requestId: '3f1e4c8a-0000-4000-8000-00000000dead',
            decision: 'approve',
            credentials: alice.credentials,
          }),
        ).rejects.toThrow(/No such approval request/);

        const { id } = await submit();
        await expect(
          service.decide({
            requestId: id,
            decision: 'abstain' as unknown as 'approve',
            credentials: alice.credentials,
          }),
        ).rejects.toThrow(/Unknown decision/);
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
        // Q9: a launch failure is not a task failure. Nothing executed and the
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

      it('refuses to mint a second grant while one is outstanding', async () => {
        // What makes a retry safe. A crash between scaffold() returning and the
        // status transition leaves a task whose id was never recorded; minting
        // a fresh grant on retry would run the template twice.
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

      it('mints a new grant once the old one has expired', async () => {
        scaffold.mockRejectedValueOnce(new Error('scaffolder unreachable'));
        const { id } = await submit();
        await service.decide({
          requestId: id,
          decision: 'approve',
          credentials: alice.credentials,
        });
        expect((await store.getRequest(id))?.status).toBe('approved');

        // Past the one-hour grant TTL.
        clock = new Date('2026-09-12T11:30:00.000Z');
        await service.launch(id);

        expect(scaffold).toHaveBeenCalledTimes(2);
        expect((await store.getRequest(id))?.status).toBe('running');
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
    });
  });
});
