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
import {
  computeValuesHash,
  parseGrant,
} from '@backstage-community/plugin-scaffolder-approvals-node';
import { resolvePackagePath } from '@backstage/backend-plugin-api';
import {
  mockCredentials,
  mockErrorHandler,
  mockServices,
  TestDatabases,
} from '@backstage/backend-test-utils';
import type { Entity } from '@backstage/catalog-model';
import type { CatalogService } from '@backstage/plugin-catalog-node';
import { AuthorizeResult } from '@backstage/plugin-permission-common';
import type { ScaffolderService } from '@backstage/plugin-scaffolder-node';
import express from 'express';
import type { Knex } from 'knex';
import request from 'supertest';
import { ApprovalStore } from '../database';
import { ApprovalService } from './ApprovalService';
import { createRouter } from './router';

jest.setTimeout(60_000);

const migrationsDir = resolvePackagePath(
  '@backstage-community/plugin-scaffolder-approvals-backend',
  'migrations',
);

const TEMPLATE_REF = 'template:default/request-github-admin';
const REQUESTER = 'user:default/requester';
const VALUES = { repository: 'backstage', justification: 'on-call rotation' };

/**
 * Built fresh per test, because the drift cases edit it. A shared constant
 * would leak an added step into every test that ran afterwards.
 */
function newTemplate(): Entity {
  return {
    apiVersion: 'scaffolder.backstage.io/v1beta3',
    kind: 'Template',
    metadata: { name: 'request-github-admin', uid: 'uid-1' },
    spec: {
      type: 'service',
      steps: [
        {
          id: 'gate',
          action: GATE_ACTION_ID,
          input: { approvers: ['group:default/devx-team'] },
        },
        { id: 'grant', action: 'github:admin:grant' },
      ],
    },
  } as Entity;
}

/** Ownership refs per user, as the auth token would carry them. */
const OWNERSHIP: Record<string, string[]> = {
  [REQUESTER]: [REQUESTER, 'group:default/devx-team'],
  'user:default/alice': ['user:default/alice', 'group:default/devx-team'],
  'user:default/bob': ['user:default/bob', 'group:default/devx-team'],
  'user:default/outsider': ['user:default/outsider'],
};

describe('createRouter', () => {
  const databases = TestDatabases.create();

  describe.each(databases.eachSupportedId())('%s', databaseId => {
    let knex: Knex;
    let store: ApprovalStore;
    let app: express.Express;
    let template: Entity;
    let scaffold: jest.Mock;
    let authorizeResult: AuthorizeResult;

    beforeEach(async () => {
      template = newTemplate();
      knex = await databases.init(databaseId);
      await knex.migrate.latest({ directory: migrationsDir });

      store = new ApprovalStore({ db: knex });
      scaffold = jest.fn().mockResolvedValue({ taskId: 'task-1' });
      authorizeResult = AuthorizeResult.ALLOW;

      const userInfo = {
        getUserInfo: jest.fn(async (credentials: any) => {
          const userEntityRef = credentials?.principal?.userEntityRef;
          if (!userEntityRef) {
            // Matches DefaultUserInfoService, which only supports users.
            throw new Error('Only user credentials are supported');
          }
          return {
            userEntityRef,
            ownershipEntityRefs: OWNERSHIP[userEntityRef] ?? [userEntityRef],
          };
        }),
      };

      const service = new ApprovalService({
        store,
        catalog: {
          getEntityByRef: jest.fn(async (ref: unknown) =>
            ref === TEMPLATE_REF ? template : undefined,
          ),
        } as unknown as CatalogService,
        scaffolder: { scaffold } as unknown as ScaffolderService,
        auth: mockServices.auth(),
        userInfo,
        logger: mockServices.logger.mock(),
        grantTtl: { hours: 1 },
      });

      const permissions = {
        authorize: jest.fn(async (requests: unknown[]) =>
          requests.map(() => ({ result: authorizeResult })),
        ),
        authorizeConditional: jest.fn(async (requests: unknown[]) =>
          requests.map(() => ({ result: authorizeResult })),
        ),
      };

      app = express()
        .use(
          await createRouter({
            service,
            store,
            // Without this the mock treats a request with no credentials as
            // the default mock *user*, which would make the unauthenticated
            // cases below silently test nothing.
            httpAuth: mockServices.httpAuth({
              defaultCredentials: mockCredentials.none(),
            }),
            userInfo,
            permissions: permissions as any,
            logger: mockServices.logger.mock(),
          }),
        )
        .use(mockErrorHandler());
    });

    afterEach(async () => {
      await knex.destroy();
      jest.resetAllMocks();
    });

    const as = (userEntityRef: string) =>
      mockCredentials.user.header(userEntityRef);

    async function submit(): Promise<string> {
      const response = await request(app)
        .post('/requests')
        .set('authorization', as(REQUESTER))
        .send({ templateRef: TEMPLATE_REF, values: VALUES });
      expect(response.status).toBe(201);
      return response.body.id;
    }

    describe('POST /requests', () => {
      it('creates a request and reports 201', async () => {
        const response = await request(app)
          .post('/requests')
          .set('authorization', as(REQUESTER))
          .send({ templateRef: TEMPLATE_REF, values: VALUES });

        expect(response.status).toBe(201);
        expect(response.body).toEqual({
          id: expect.any(String),
          collapsed: false,
        });
      });

      it('reports 200 rather than 201 when a duplicate collapses', async () => {
        await submit();

        const response = await request(app)
          .post('/requests')
          .set('authorization', as(REQUESTER))
          .send({ templateRef: TEMPLATE_REF, values: VALUES });

        // Nothing was created, so 201 would be a lie.
        expect(response.status).toBe(200);
        expect(response.body.collapsed).toBe(true);
      });

      it('rejects a body without a templateRef', async () => {
        const response = await request(app)
          .post('/requests')
          .set('authorization', as(REQUESTER))
          .send({ values: VALUES });

        expect(response.status).toBe(400);
      });

      it('refuses an unauthenticated caller', async () => {
        const response = await request(app)
          .post('/requests')
          .send({ templateRef: TEMPLATE_REF, values: VALUES });

        expect(response.status).toBe(401);
      });

      it('refuses when the policy denies the create permission', async () => {
        authorizeResult = AuthorizeResult.DENY;

        const response = await request(app)
          .post('/requests')
          .set('authorization', as(REQUESTER))
          .send({ templateRef: TEMPLATE_REF, values: VALUES });

        expect(response.status).toBe(403);
      });
    });

    describe('GET /requests', () => {
      it('lets any signed-in user see everything (Q12)', async () => {
        await submit();

        const response = await request(app)
          .get('/requests')
          .set('authorization', as('user:default/outsider'));

        expect(response.status).toBe(200);
        expect(response.body.totalItems).toBe(1);
        expect(response.body.items[0].requesterRef).toBe(REQUESTER);
      });

      it('reports a total independent of the page size', async () => {
        for (const justification of ['one', 'two', 'three']) {
          await request(app)
            .post('/requests')
            .set('authorization', as(REQUESTER))
            .send({
              templateRef: TEMPLATE_REF,
              values: { ...VALUES, justification },
            });
        }

        const response = await request(app)
          .get('/requests?limit=2')
          .set('authorization', as('user:default/alice'));

        expect(response.body.items).toHaveLength(2);
        expect(response.body.totalItems).toBe(3);

        const second = await request(app)
          .get('/requests?limit=2&offset=2')
          .set('authorization', as('user:default/alice'));

        expect(second.body.items).toHaveLength(1);
        expect(second.body.totalItems).toBe(3);
      });

      it('filters by role, resolving groups from the caller', async () => {
        const id = await submit();

        // Alice is in devx-team, which the gate lists as an approver.
        const inbox = await request(app)
          .get('/requests?role=approver')
          .set('authorization', as('user:default/alice'));
        expect(inbox.body.items.map((i: { id: string }) => i.id)).toEqual([id]);

        // The outsider is in no approver group.
        const empty = await request(app)
          .get('/requests?role=approver')
          .set('authorization', as('user:default/outsider'));
        expect(empty.body).toEqual({ items: [], totalItems: 0 });

        const mine = await request(app)
          .get('/requests?role=requester')
          .set('authorization', as(REQUESTER));
        expect(mine.body.totalItems).toBe(1);

        const notMine = await request(app)
          .get('/requests?role=requester')
          .set('authorization', as('user:default/alice'));
        expect(notMine.body.totalItems).toBe(0);
      });

      it('filters by status, accepting a repeated or comma-joined param', async () => {
        const id = await submit();
        await store.transition(id, 'pending', 'rejected');

        const pending = await request(app)
          .get('/requests?status=pending')
          .set('authorization', as('user:default/alice'));
        expect(pending.body.totalItems).toBe(0);

        for (const query of [
          '?status=rejected',
          '?status=rejected,cancelled',
          '?status=rejected&status=cancelled',
        ]) {
          const response = await request(app)
            .get(`/requests${query}`)
            .set('authorization', as('user:default/alice'));
          expect(response.body.totalItems).toBe(1);
        }
      });

      it('rejects an unknown status rather than ignoring it', async () => {
        const response = await request(app)
          .get('/requests?status=notastatus')
          .set('authorization', as('user:default/alice'));

        expect(response.status).toBe(400);
        expect(response.body.error.message).toMatch(/Unknown status/);
      });

      it('refuses a conditional read policy loudly', async () => {
        // Silently ignoring the condition would be a quiet hole in whatever
        // the policy was trying to enforce.
        authorizeResult = AuthorizeResult.CONDITIONAL;

        const response = await request(app)
          .get('/requests')
          .set('authorization', as('user:default/alice'));

        expect(response.status).toBe(403);
        expect(response.body.error.message).toMatch(/not supported yet/);
      });
    });

    describe('GET /requests/:id', () => {
      it('returns the request with its decision history', async () => {
        const id = await submit();
        await store.recordDecision({
          requestId: id,
          approverRef: 'user:default/alice',
          decision: 'approve',
        });

        const response = await request(app)
          .get(`/requests/${id}`)
          .set('authorization', as('user:default/outsider'));

        expect(response.status).toBe(200);
        expect(response.body.decisions).toHaveLength(1);
      });

      it('tells an approver when the template has changed', async () => {
        // §10.3: the detail page is where somebody decides, so it is where the
        // warning has to appear.
        const id = await submit();
        (template as any).spec.steps.push({
          id: 'extra',
          action: 'debug:log',
        });

        const response = await request(app)
          .get(`/requests/${id}`)
          .set('authorization', as('user:default/alice'));

        expect(response.body.templateDrift).toEqual({
          changed: true,
          reasons: ['steps'],
        });
      });

      it('says nothing about drift while the template is untouched', async () => {
        const id = await submit();

        const response = await request(app)
          .get(`/requests/${id}`)
          .set('authorization', as('user:default/alice'));

        expect(response.body.templateDrift).toEqual({
          changed: false,
          reasons: [],
        });
      });

      it('reports 404 for an unknown id', async () => {
        const response = await request(app)
          .get('/requests/3f1e4c8a-0000-4000-8000-00000000dead')
          .set('authorization', as('user:default/alice'));

        expect(response.status).toBe(404);
      });
    });

    describe('POST /requests/:id/decision', () => {
      it('records an approval from a designated approver', async () => {
        const id = await submit();

        const response = await request(app)
          .post(`/requests/${id}/decision`)
          .set('authorization', as('user:default/alice'))
          .send({ decision: 'approve', comment: 'fine by me' });

        expect(response.status).toBe(200);
        expect(response.body.status).toBe('running');
        expect(scaffold).toHaveBeenCalledTimes(1);
      });

      it('succeeds for a member of a listed approver group', async () => {
        // The gate lists group:default/devx-team, never bob directly.
        const id = await submit();

        const response = await request(app)
          .post(`/requests/${id}/decision`)
          .set('authorization', as('user:default/bob'))
          .send({ decision: 'approve' });

        expect(response.status).toBe(200);
      });

      it('refuses a non-approver with 403', async () => {
        const id = await submit();

        const response = await request(app)
          .post(`/requests/${id}/decision`)
          .set('authorization', as('user:default/outsider'))
          .send({ decision: 'approve' });

        expect(response.status).toBe(403);
        expect(await store.listDecisions(id)).toHaveLength(0);
      });

      it('refuses the requester with 403 when self-approval is off', async () => {
        const id = await submit();

        const response = await request(app)
          .post(`/requests/${id}/decision`)
          .set('authorization', as(REQUESTER))
          .send({ decision: 'approve' });

        expect(response.status).toBe(403);
      });

      it('refuses when the policy denies the decide permission', async () => {
        // Independent of the gate's own terms: this is the layer RBAC sees.
        const id = await submit();
        authorizeResult = AuthorizeResult.DENY;

        const response = await request(app)
          .post(`/requests/${id}/decision`)
          .set('authorization', as('user:default/alice'))
          .send({ decision: 'approve' });

        expect(response.status).toBe(403);
        expect(await store.listDecisions(id)).toHaveLength(0);
      });

      it('reports 409 for a second vote from the same approver', async () => {
        const id = await submit();
        await request(app)
          .post(`/requests/${id}/decision`)
          .set('authorization', as('user:default/alice'))
          .send({ decision: 'approve' });

        const response = await request(app)
          .post(`/requests/${id}/decision`)
          .set('authorization', as('user:default/alice'))
          .send({ decision: 'deny' });

        expect(response.status).toBe(409);
      });

      it('rejects an unknown decision value', async () => {
        const id = await submit();

        const response = await request(app)
          .post(`/requests/${id}/decision`)
          .set('authorization', as('user:default/alice'))
          .send({ decision: 'abstain' });

        expect(response.status).toBe(400);
      });
    });

    describe('POST /requests/:id/cancel', () => {
      it('lets the requester withdraw', async () => {
        const id = await submit();

        const response = await request(app)
          .post(`/requests/${id}/cancel`)
          .set('authorization', as(REQUESTER));

        expect(response.status).toBe(200);
        expect(response.body.status).toBe('cancelled');
      });

      it('refuses anyone else with 403', async () => {
        const id = await submit();

        const response = await request(app)
          .post(`/requests/${id}/cancel`)
          .set('authorization', as('user:default/alice'));

        expect(response.status).toBe(403);
      });
    });

    /**
     * A service token whose principal is the scaffolder, which is the only
     * caller allowed to redeem a grant (S3). `mockCredentials.service()`
     * defaults to `external:test-service`, which is exactly the principal that
     * must be refused.
     */
    function asScaffolder(): string {
      return mockCredentials.service.header({
        onBehalfOf: mockCredentials.service('plugin:scaffolder'),
        // The mock auth service refuses a token aimed at another plugin, and
        // its own id defaults to `test`.
        targetPluginId: 'test',
      });
    }

    describe('POST /grants/consume', () => {
      async function approvedGrant(): Promise<{ id: string; grant: string }> {
        const id = await submit();
        await request(app)
          .post(`/requests/${id}/decision`)
          .set('authorization', as('user:default/alice'))
          .send({ decision: 'approve' });
        return { id, grant: scaffold.mock.calls[0][0].secrets.APPROVAL_GRANT };
      }

      it('redeems a valid grant for a service principal', async () => {
        const { id, grant } = await approvedGrant();

        const response = await request(app)
          .post('/grants/consume')
          .set('authorization', asScaffolder())
          .send({
            grant,
            valuesHash: computeValuesHash(VALUES),
            taskId: 'task-1',
            templateRef: TEMPLATE_REF,
          });

        expect(response.status).toBe(200);
        // The actors travel back with the grant: the task was launched by the
        // service principal, so this is the only place the run can learn who
        // actually asked and who agreed.
        expect(response.body).toEqual({
          requestId: id,
          requesterRef: REQUESTER,
          approvedBy: ['user:default/alice'],
        });
      });

      it('reports each approver once, and only those who approved', async () => {
        const id = await submit();
        // Quorum is 1 here, so bob's vote lands before alice's decides it.
        await store.recordDecision({
          requestId: id,
          approverRef: 'user:default/bob',
          decision: 'approve',
        });
        await request(app)
          .post(`/requests/${id}/decision`)
          .set('authorization', as('user:default/alice'))
          .send({ decision: 'approve' });

        const grant = scaffold.mock.calls[0][0].secrets.APPROVAL_GRANT;
        const response = await request(app)
          .post('/grants/consume')
          .set('authorization', asScaffolder())
          .send({
            grant,
            valuesHash: computeValuesHash(VALUES),
            taskId: 'task-1',
            templateRef: TEMPLATE_REF,
          });

        expect(response.body.approvedBy).toEqual([
          'user:default/bob',
          'user:default/alice',
        ]);
      });

      it('rejects a user principal with 403', async () => {
        // A grant is the capability to run an approved template. If a user
        // could redeem one directly, the gate would be a suggestion.
        const { grant } = await approvedGrant();

        const response = await request(app)
          .post('/grants/consume')
          .set('authorization', as('user:default/alice'))
          .send({
            grant,
            valuesHash: computeValuesHash(VALUES),
            taskId: 'task-1',
            templateRef: TEMPLATE_REF,
          });

        expect(response.status).toBe(403);
      });

      it('rejects an unauthenticated caller', async () => {
        const { grant } = await approvedGrant();

        const response = await request(app)
          .post('/grants/consume')
          .send({
            grant,
            valuesHash: computeValuesHash(VALUES),
            taskId: 'task-1',
            templateRef: TEMPLATE_REF,
          });

        expect(response.status).toBe(401);
      });

      it('refuses a mismatched values hash with the same message as any other failure', async () => {
        const { grant } = await approvedGrant();

        const mismatched = await request(app)
          .post('/grants/consume')
          .set('authorization', asScaffolder())
          .send({
            grant,
            valuesHash: computeValuesHash({ repository: 'something-else' }),
            taskId: 'task-1',
            templateRef: TEMPLATE_REF,
          });

        const unknownToken = await request(app)
          .post('/grants/consume')
          .set('authorization', asScaffolder())
          .send({
            grant: `${parseGrant(grant).requestId}.${'x'.repeat(43)}`,
            valuesHash: computeValuesHash(VALUES),
            taskId: 'task-1',
            templateRef: TEMPLATE_REF,
          });

        // Telling a token holder which part failed would be an oracle.
        expect(mismatched.status).toBe(403);
        expect(unknownToken.status).toBe(403);
        expect(mismatched.body.error.message).toBe(
          unknownToken.body.error.message,
        );
      });

      it('refuses a service principal that is not the scaffolder', async () => {
        // S3: `allow: ['service']` lets in every service principal, including a
        // static `external:` token issued for something unrelated. It cannot
        // forge a grant, but spending one makes the legitimate task fail at its
        // own gate — a denial of service against approved runs.
        const { grant } = await approvedGrant();

        const response = await request(app)
          .post('/grants/consume')
          .set(
            'authorization',
            mockCredentials.service.header({
              onBehalfOf: mockCredentials.service('external:ci-bot'),
              targetPluginId: 'test',
            }),
          )
          .send({
            grant,
            valuesHash: computeValuesHash(VALUES),
            taskId: 'task-1',
            templateRef: TEMPLATE_REF,
          });

        expect(response.status).toBe(403);

        // And crucially the grant is still redeemable by the real task.
        const real = await request(app)
          .post('/grants/consume')
          .set('authorization', asScaffolder())
          .send({
            grant,
            valuesHash: computeValuesHash(VALUES),
            taskId: 'task-1',
            templateRef: TEMPLATE_REF,
          });
        expect(real.status).toBe(200);
      });

      it('refuses a grant redeemed under a different template', async () => {
        // S4: §3 binds a grant to (request, template, values). Without the
        // template a leaked grant would redeem inside any gated template that
        // happened to take the same values.
        const { grant } = await approvedGrant();

        const response = await request(app)
          .post('/grants/consume')
          .set('authorization', asScaffolder())
          .send({
            grant,
            valuesHash: computeValuesHash(VALUES),
            taskId: 'task-1',
            templateRef: 'template:default/some-other-gated-template',
          });

        expect(response.status).toBe(403);
      });

      it('accepts a template ref spelled differently', async () => {
        // Refs are case-insensitive and the namespace is optional, so the
        // binding has to compare meaning rather than spelling.
        const { grant } = await approvedGrant();

        const response = await request(app)
          .post('/grants/consume')
          .set('authorization', asScaffolder())
          .send({
            grant,
            valuesHash: computeValuesHash(VALUES),
            taskId: 'task-1',
            templateRef: 'Template:Default/Request-GitHub-Admin',
          });

        expect(response.status).toBe(200);
      });

      it('refuses a template ref that is not a ref at all', async () => {
        const { grant } = await approvedGrant();

        const response = await request(app)
          .post('/grants/consume')
          .set('authorization', asScaffolder())
          .send({
            grant,
            valuesHash: computeValuesHash(VALUES),
            taskId: 'task-1',
            templateRef: 'not a ref',
          });

        expect(response.status).toBe(403);
      });

      it('refuses a second redemption of the same grant', async () => {
        const { grant } = await approvedGrant();
        const body = {
          grant,
          valuesHash: computeValuesHash(VALUES),
          taskId: 'task-1',
          templateRef: TEMPLATE_REF,
        };

        const first = await request(app)
          .post('/grants/consume')
          .set('authorization', asScaffolder())
          .send(body);
        const second = await request(app)
          .post('/grants/consume')
          .set('authorization', asScaffolder())
          .send(body);

        expect(first.status).toBe(200);
        expect(second.status).toBe(403);
      });

      it('rejects a malformed grant or hash with 400', async () => {
        for (const body of [
          { grant: 'no-separator', valuesHash: 'a'.repeat(64), taskId: 't' },
          { grant: 'id.token', valuesHash: 'not-a-hash', taskId: 't' },
          { grant: 'id.token', valuesHash: 'a'.repeat(64) },
        ]) {
          const response = await request(app)
            .post('/grants/consume')
            .set('authorization', asScaffolder())
            .send(body);
          expect(response.status).toBe(400);
        }
      });
    });
  });
});
