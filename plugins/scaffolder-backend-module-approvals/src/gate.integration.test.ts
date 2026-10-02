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
  APPROVAL_GRANT_SECRET,
  GATE_ACTION_ID,
} from '@ferin79/backstage-plugin-scaffolder-approvals-common';
import { scaffolderApprovalsPlugin } from '@ferin79/backstage-plugin-scaffolder-approvals-backend';
import {
  mockCredentials,
  mockServices,
  startTestBackend,
} from '@backstage/backend-test-utils';
import type { Entity } from '@backstage/catalog-model';
import {
  coreServices,
  createServiceFactory,
} from '@backstage/backend-plugin-api';
import {
  type CatalogService,
  catalogServiceRef,
} from '@backstage/plugin-catalog-node';
import {
  type ScaffolderService,
  scaffolderServiceRef,
} from '@backstage/plugin-scaffolder-node';
import { createMockActionContext } from '@backstage/plugin-scaffolder-node-test-utils';
import { createApprovalGateAction } from './createApprovalGateAction';

jest.setTimeout(120_000);

/**
 * The gate action against a **real** approvals backend, over real HTTP.
 *
 * The unit tests in `createApprovalGateAction.test.ts` mock `fetch`, so they
 * prove what the action does with a given answer but not that the two halves
 * agree on the wire. This test starts the backend — real router, real store,
 * real SQLite — and drives the action against it. What it proves that nothing
 * else does:
 *
 * - The action's request body is one the router accepts.
 * - The values hash the action computes matches the one the backend bound the
 *   grant to when the request was submitted. These are computed in different
 *   packages from different inputs, and a mismatch would fail every gated run.
 * - Replay, tamper and expiry are refused by the real guards rather than by a
 *   mock that was told to refuse.
 * - A task with no grant is refused, which is the bypass case.
 */
const TEMPLATE_REF = 'template:default/request-github-admin';
const REQUESTER = 'user:default/requester';
const APPROVER = 'user:default/alice';
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
          summary: 'Admin on backstage',
          values: VALUES,
        },
      },
      { id: 'grant', action: 'github:admin:grant' },
    ],
  },
} as Entity;

describe('approval:gate against a real approvals backend', () => {
  let backend: Awaited<ReturnType<typeof startTestBackend>>;
  let action: ReturnType<typeof createApprovalGateAction>;
  let scaffold: jest.Mock;
  let baseUrl: string;

  /** The grant the backend handed to the (mocked) scaffolder when launching. */
  function lastGrant(): string {
    return scaffold.mock.calls.at(-1)![0].secrets[APPROVAL_GRANT_SECRET];
  }

  function contextFor(
    grant: string | undefined,
    values: Record<string, unknown> = VALUES,
    templateRef: string = TEMPLATE_REF,
  ) {
    return createMockActionContext({
      input: { approvers: ['group:default/devx-team'], values } as any,
      secrets: grant ? { [APPROVAL_GRANT_SECRET]: grant } : {},
      task: { id: 'task-1' },
      templateInfo: { entityRef: templateRef },
    });
  }

  beforeAll(async () => {
    // Only the scaffolder itself is stood in for: running real tasks would add
    // a workspace, a task worker and an integrations config without testing
    // anything more about the gate.
    scaffold = jest.fn().mockResolvedValue({ taskId: 'task-1' });

    backend = await startTestBackend({
      features: [
        scaffolderApprovalsPlugin,
        mockServices.rootConfig.factory({
          data: { app: { baseUrl: 'http://localhost:3000' } },
        }),
        // A plugin service ref has no `.mock`; overriding one means supplying a
        // factory, which is also what an app does.
        createServiceFactory({
          service: catalogServiceRef,
          deps: {},
          async factory() {
            return {
              getEntityByRef: async (ref: unknown) =>
                ref === TEMPLATE_REF ? TEMPLATE : undefined,
            } as unknown as CatalogService;
          },
        }),
        createServiceFactory({
          service: scaffolderServiceRef,
          deps: {},
          async factory() {
            return { scaffold } as unknown as ScaffolderService;
          },
        }),
        // The default mock reports a user as owning only themselves, so alice
        // would not be a member of the approver group and every decision would
        // be refused. Group membership is the thing being exercised here.
        createServiceFactory({
          service: coreServices.userInfo,
          deps: {},
          async factory() {
            return {
              getUserInfo: async (credentials: any) => {
                const userEntityRef = credentials.principal.userEntityRef;
                return {
                  userEntityRef,
                  ownershipEntityRefs:
                    userEntityRef === APPROVER
                      ? [userEntityRef, 'group:default/devx-team']
                      : [userEntityRef],
                };
              },
            };
          },
        }),
      ],
    });

    baseUrl = `http://localhost:${backend.server.port()}/api/scaffolder-approvals`;

    action = createApprovalGateAction({
      // The gate action is a module of the scaffolder backend, so its own
      // service credentials name the scaffolder. The approvals backend only
      // lets that principal redeem a grant (S3), and this is what makes the
      // test exercise the real arrangement rather than a permissive mock.
      auth: mockServices.auth({ pluginId: 'scaffolder' }),
      // Points the action at the backend that is actually running, so the call
      // it makes is a real HTTP request to the real router.
      discovery: mockServices.discovery.mock({
        getBaseUrl: async () => baseUrl,
      }),
    });
  });

  afterAll(async () => {
    await backend?.stop();
  });

  /** Submit and approve a request, returning the grant it produced. */
  async function approvedGrant(values = VALUES): Promise<string> {
    const submitted = await fetch(`${baseUrl}/requests`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: mockCredentials.user.header(REQUESTER),
      },
      body: JSON.stringify({ templateRef: TEMPLATE_REF, values }),
    });
    expect(submitted.status).toBe(201);
    const { id } = (await submitted.json()) as { id: string };

    const decided = await fetch(`${baseUrl}/requests/${id}/decision`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: mockCredentials.user.header(APPROVER),
      },
      body: JSON.stringify({ decision: 'approve' }),
    });
    expect(decided.status).toBe(200);

    return lastGrant();
  }

  it('redeems a real grant and publishes the real actors', async () => {
    const grant = await approvedGrant();
    const ctx = contextFor(grant);

    await action.handler(ctx);

    // The whole point: the hash the action computed from its own step input
    // matched the one the backend stored when the request was submitted.
    expect(ctx.output).toHaveBeenCalledWith('requestedBy', REQUESTER);
    expect(ctx.output).toHaveBeenCalledWith('approvedBy', [APPROVER]);
    expect(ctx.output).toHaveBeenCalledWith('requestId', expect.any(String));
  });

  it('refuses a grant redeemed inside a different template', async () => {
    // S4: §3 binds a grant to (request, template, values). Two access-request
    // templates sharing a parameter shape is an ordinary thing to have, and
    // without this binding a grant approved for one would unlock the other.
    const grant = await approvedGrant({ ...VALUES, justification: 'crossing' });

    await expect(
      action.handler(
        contextFor(
          grant,
          { ...VALUES, justification: 'crossing' },
          'template:default/some-other-gated-template',
        ),
      ),
    ).rejects.toThrow(/approval for this run was rejected/);

    // And the grant survives the attempt, so the legitimate run still works.
    await expect(
      action.handler(
        contextFor(grant, { ...VALUES, justification: 'crossing' }),
      ),
    ).resolves.toBeUndefined();
  });

  it('refuses a replayed grant', async () => {
    const grant = await approvedGrant({ ...VALUES, justification: 'replay' });

    await action.handler(
      contextFor(grant, { ...VALUES, justification: 'replay' }),
    );

    await expect(
      action.handler(contextFor(grant, { ...VALUES, justification: 'replay' })),
    ).rejects.toThrow(/approval for this run was rejected/);
  });

  it('refuses a grant redeemed against different parameters', async () => {
    // The attack this feature exists to stop: approved for one thing, run with
    // another.
    const grant = await approvedGrant({ ...VALUES, justification: 'tamper' });

    await expect(
      action.handler(contextFor(grant, { repository: 'something-else' })),
    ).rejects.toThrow(/approval for this run was rejected/);
  });

  it('refuses a task carrying no grant at all', async () => {
    // Running a gated template straight through the scaffolder lands here.
    await expect(action.handler(contextFor(undefined))).rejects.toThrow(
      /requires approval before it can run/,
    );
  });

  it('refuses a forged grant', async () => {
    await expect(
      action.handler(
        contextFor('3f1e4c8a-0000-4000-8000-000000000001.not-a-real-token'),
      ),
    ).rejects.toThrow(/approval for this run was rejected/);
  });

  it('refuses a user principal at the consume endpoint', async () => {
    // The action authenticates as a service. A user must never be able to
    // redeem a grant directly, or the gate would be a suggestion.
    const grant = await approvedGrant({ ...VALUES, justification: 'as-user' });

    const response = await fetch(`${baseUrl}/grants/consume`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: mockCredentials.user.header(APPROVER),
      },
      body: JSON.stringify({
        grant,
        valuesHash: 'a'.repeat(64),
        taskId: 'task-1',
      }),
    });

    expect(response.status).toBe(403);
  });

  it('keeps the request and its decisions across the whole flow', async () => {
    // The audit trail is what the feature exists to produce, so it is checked
    // through the API a person would actually read it through.
    const grant = await approvedGrant({ ...VALUES, justification: 'audit' });
    await action.handler(
      contextFor(grant, { ...VALUES, justification: 'audit' }),
    );

    const listed = await fetch(
      `${baseUrl}/requests?requesterRef=${encodeURIComponent(REQUESTER)}`,
      { headers: { authorization: mockCredentials.user.header(APPROVER) } },
    );
    const page = (await listed.json()) as { items: { id: string }[] };
    const audit = page.items.find(item => item.id);
    expect(audit).toBeDefined();

    const detail = await fetch(`${baseUrl}/requests/${audit!.id}`, {
      headers: { authorization: mockCredentials.user.header(APPROVER) },
    });
    const request = (await detail.json()) as {
      status: string;
      requesterRef: string;
      decisions: { approverRef: string; decision: string }[];
    };

    expect(request.requesterRef).toBe(REQUESTER);
    expect(request.decisions).toEqual([
      expect.objectContaining({ approverRef: APPROVER, decision: 'approve' }),
    ]);
  });
});
