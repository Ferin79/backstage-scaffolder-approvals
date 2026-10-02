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
import { computeValuesHash } from '@ferin79/backstage-plugin-scaffolder-approvals-node';
import { mockServices } from '@backstage/backend-test-utils';
import { createMockActionContext } from '@backstage/plugin-scaffolder-node-test-utils';
import { createApprovalGateAction } from './createApprovalGateAction';

const VALUES = { repository: 'backstage', justification: 'on-call rotation' };
const GRANT = '3f1e4c8a-0000-4000-8000-000000000001.a-token-value';
const TEMPLATE_REF = 'template:default/request-github-admin';

/**
 * The gate is the security boundary: a template is gated because this step
 * stands in front of it and throws. Every test here is therefore about what it
 * refuses, and the one happy path exists to prove the refusals are not vacuous.
 */
describe('approval:gate', () => {
  let fetchMock: jest.Mock;

  const action = createApprovalGateAction({
    auth: mockServices.auth(),
    discovery: mockServices.discovery(),
  });

  function context(
    overrides: {
      secrets?: Record<string, string>;
      values?: unknown;
      templateInfo?: { entityRef: string } | undefined;
    } = {},
  ) {
    return createMockActionContext({
      input: {
        approvers: ['group:default/devx-team'],
        values: 'values' in overrides ? overrides.values : VALUES,
      } as any,
      secrets:
        overrides.secrets === undefined
          ? { [APPROVAL_GRANT_SECRET]: GRANT }
          : overrides.secrets,
      task: { id: 'task-1' },
      templateInfo:
        'templateInfo' in overrides
          ? overrides.templateInfo
          : { entityRef: TEMPLATE_REF },
    });
  }

  function respond(status: number, body: unknown = {}) {
    fetchMock.mockResolvedValue({
      ok: status >= 200 && status < 300,
      status,
      json: async () => body,
      text: async () => JSON.stringify(body),
    });
  }

  beforeEach(() => {
    fetchMock = jest.fn();
    global.fetch = fetchMock as unknown as typeof fetch;
  });

  afterEach(() => {
    jest.resetAllMocks();
  });

  it('is registered under the id a gated template names', () => {
    // Changing this breaks every gated template and the catalog processor that
    // derives the annotation from it.
    expect(action.id).toBe(GATE_ACTION_ID);
    expect(GATE_ACTION_ID).toBe('approval:gate');
  });

  it('does not offer a dry run', () => {
    // A dry run has no grant. Supporting it would mean either passing without
    // one, which makes the gate look optional, or failing every dry run.
    expect(action.supportsDryRun).toBeFalsy();
  });

  describe('the bypass attempt', () => {
    it('throws when the task carries no grant', async () => {
      // Running `POST /api/scaffolder/v2/tasks` directly against a gated
      // template lands here: no grant, so the step throws and, being first,
      // nothing after it runs.
      await expect(action.handler(context({ secrets: {} }))).rejects.toThrow(
        /requires approval before it can run/,
      );
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('throws when the secrets are absent entirely', async () => {
      const ctx = context();
      (ctx as { secrets?: unknown }).secrets = undefined;

      await expect(action.handler(ctx)).rejects.toThrow(
        /requires approval before it can run/,
      );
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('tells the caller what to do instead of leaking why', async () => {
      await expect(action.handler(context({ secrets: {} }))).rejects.toThrow(
        /Submit it from the template's form instead/,
      );
    });

    it('does not send the caller to the approvals page, which cannot submit', async () => {
      // The page lists requests; it has no form. Pointing people at it was a
      // dead end (B3 in the browser review).
      await expect(
        action.handler(context({ secrets: {} })),
      ).rejects.not.toThrow(/approvals page/);
    });
  });

  describe('the values binding', () => {
    it('sends a hash of the parameters this task is actually running', async () => {
      respond(200, {
        requestId: 'r1',
        requesterRef: 'user:default/requester',
        approvedBy: ['user:default/alice'],
      });

      await action.handler(context());

      const [url, init] = fetchMock.mock.calls[0];
      expect(url).toMatch(/\/grants\/consume$/);
      expect(JSON.parse(init.body)).toEqual({
        grant: GRANT,
        // Recomputed here rather than taken from the backend, which is the
        // whole point: a grant replayed against different parameters will not
        // match what it was minted for.
        valuesHash: computeValuesHash(VALUES),
        taskId: 'task-1',
        // §3 binds a grant to the template as well as the values, so a leaked
        // grant cannot redeem inside a different gated template.
        templateRef: TEMPLATE_REF,
      });
    });

    it('sends the template this task is running, not one it was told about', async () => {
      respond(200, { requestId: 'r1', requesterRef: 'u', approvedBy: [] });

      await action.handler(
        context({ templateInfo: { entityRef: 'template:default/other' } }),
      );

      expect(JSON.parse(fetchMock.mock.calls[0][1].body).templateRef).toBe(
        'template:default/other',
      );
    });

    it('sends an empty template ref when the runner supplies none', async () => {
      // Which the backend refuses, because an empty ref matches no request.
      respond(200, { requestId: 'r1', requesterRef: 'u', approvedBy: [] });

      await action.handler(context({ templateInfo: undefined }));

      expect(JSON.parse(fetchMock.mock.calls[0][1].body).templateRef).toBe('');
    });

    it('hashes independently of the key order the parameters arrived in', async () => {
      respond(200, { requestId: 'r1', requesterRef: 'u', approvedBy: [] });

      await action.handler(
        context({
          values: {
            justification: 'on-call rotation',
            repository: 'backstage',
          },
        }),
      );

      expect(JSON.parse(fetchMock.mock.calls[0][1].body).valuesHash).toBe(
        computeValuesHash(VALUES),
      );
    });

    it('refuses to run when the step did not pass the parameters', async () => {
      // A gate step missing `values: ${{ parameters }}` cannot be checked
      // against anything, so it fails rather than passing unchecked.
      for (const values of [undefined, null, 'parameters', [1, 2]]) {
        await expect(action.handler(context({ values }))).rejects.toThrow(
          /must pass 'values: \$\{\{ parameters \}\}'/,
        );
      }
      expect(fetchMock).not.toHaveBeenCalled();
    });
  });

  describe('what the backend refuses', () => {
    it.each([
      ['a replayed grant', 403],
      ['a tampered values hash', 403],
      ['an expired grant', 403],
      ['an unknown request', 404],
      ['a rejected principal', 403],
      ['a backend error', 500],
    ])('fails the step on %s', async (_case, status) => {
      // The backend answers every refusal identically on purpose, so the
      // action cannot and must not distinguish them.
      respond(status, {
        error: { message: 'The approval grant is not valid' },
      });

      await expect(action.handler(context())).rejects.toThrow(
        /approval for this run was rejected/,
      );
    });

    it('says what might be wrong without claiming to know which', async () => {
      respond(403, {});

      await expect(action.handler(context())).rejects.toThrow(
        /already been used, expired, or been granted for different parameters/,
      );
    });

    it('fails the step when the approvals backend cannot be reached', async () => {
      // An outage must stop the run. Treating an unreachable backend as a pass
      // would turn it into an ungated execution.
      fetchMock.mockRejectedValue(new Error('ECONNREFUSED'));

      await expect(action.handler(context())).rejects.toThrow(
        /Could not reach the approvals backend/,
      );
    });
  });

  describe('the happy path', () => {
    it('redeems the grant and publishes the real actors', async () => {
      respond(200, {
        requestId: '3f1e4c8a-0000-4000-8000-000000000001',
        requesterRef: 'user:default/requester',
        approvedBy: ['user:default/alice', 'user:default/bob'],
      });

      const ctx = context();
      await action.handler(ctx);

      // The task was launched by the service principal, so `task.createdBy`
      // names the plugin. These outputs are the only record of who actually
      // asked and who agreed.
      expect(ctx.output).toHaveBeenCalledWith(
        'requestId',
        '3f1e4c8a-0000-4000-8000-000000000001',
      );
      expect(ctx.output).toHaveBeenCalledWith(
        'requestedBy',
        'user:default/requester',
      );
      expect(ctx.output).toHaveBeenCalledWith('approvedBy', [
        'user:default/alice',
        'user:default/bob',
      ]);
    });

    it('authenticates as a service, not as the person who filled the form', async () => {
      // `/grants/consume` rejects user principals, so a user-scoped token here
      // would fail every run — and would also mean a user could redeem a grant.
      respond(200, { requestId: 'r1', requesterRef: 'u', approvedBy: [] });

      await action.handler(context());

      const { headers } = fetchMock.mock.calls[0][1];
      expect(headers.authorization).toMatch(/^Bearer .+/);
      expect(headers['content-type']).toBe('application/json');
    });
  });
});
