import { expectError, expectStatus } from './support/api';
import { expect, test } from './support/fixtures';

/**
 * The REST API's contract (docs/api-reference.md), against the real backend:
 * every route's answers, and the refusals that keep the gate honest.
 */

const UNKNOWN_ID = '00000000-0000-4000-8000-000000000000';

test.describe('the approvals API', () => {
  test('refuses anybody who is not signed in', async ({ apiAs }) => {
    const anonymous = apiAs('requester');
    const routes: [string, string][] = [
      ['GET', '/api/scaffolder-approvals/requests'],
      ['POST', '/api/scaffolder-approvals/requests'],
      ['GET', `/api/scaffolder-approvals/requests/${UNKNOWN_ID}`],
      ['POST', `/api/scaffolder-approvals/requests/${UNKNOWN_ID}/decision`],
      ['POST', `/api/scaffolder-approvals/requests/${UNKNOWN_ID}/cancel`],
      ['POST', '/api/scaffolder-approvals/grants/consume'],
    ];
    for (const [method, path] of routes) {
      const response = await anonymous.fetch(method, path, {
        signedIn: false,
        data: method === 'POST' ? {} : undefined,
      });
      expect(response.status(), `${method} ${path}`).toBe(401);
    }
  });

  test.describe('submitting', () => {
    test('creates a request, then collapses an identical one into it', async ({
      apiAs,
      unique,
    }) => {
      const requester = apiAs('requester');
      const values = { target: unique, reason: 'First of two' };

      const created = await requester.submit('e2e-single', values);
      await expectStatus(created, 201);
      const { id, collapsed } = await created.json();
      expect(collapsed).toBe(false);

      // Same template, however it is spelled, and the same values in any
      // order: the request already waiting is returned, with 200.
      for (const [templateRef, same] of [
        ['template:default/e2e-single', values],
        ['Template:Default/E2E-Single', values],
        ['  e2e-single  ', { reason: 'First of two', target: unique }],
      ] as const) {
        const again = await requester.submit(templateRef, same);
        await expectStatus(again, 200);
        expect(await again.json()).toEqual({ id, collapsed: true });
      }

      const stored = await requester.read(id);
      expect(stored.templateRef).toBe('template:default/e2e-single');
      expect(stored.valuesHash).toMatch(/^[0-9a-f]{64}$/);

      // Different values, or a different person, are a different request.
      expect(
        await requester.create('e2e-single', { ...values, reason: 'Second' }),
      ).not.toBe(id);
      expect(await apiAs('outsider').create('e2e-single', values)).not.toBe(id);

      // Once it is settled, the same values make a new request.
      await requester.withdraw(id);
      expect(await requester.create('e2e-single', values)).not.toBe(id);
    });

    test('checks the values against the template before storing anything', async ({
      apiAs,
      unique,
    }) => {
      const requester = apiAs('requester');
      await expectError(
        await requester.submit('e2e-single', { reason: 'No target at all' }),
        400,
        'target',
      );
      await expectError(
        await requester.submit('e2e-single', { target: unique, reason: 'abc' }),
        400,
        'reason',
      );
      await expectError(
        await requester.submit('e2e-single', { target: 42 }),
        400,
        'target',
      );
      expect(
        (
          await requester.listItems({
            role: 'requester',
            templateRef: 'e2e-single',
          })
        ).items.filter(item => JSON.stringify(item.values).includes(unique)),
      ).toEqual([]);
    });

    test('refuses values nested deeper than any form makes', async ({
      apiAs,
    }) => {
      let deep: Record<string, unknown> = { leaf: true };
      for (let i = 0; i < 64; i++) {
        deep = { deeper: deep };
      }
      await expectError(
        await apiAs('requester').submit('e2e-single', {
          target: 'deep',
          deep,
        }),
        400,
        'nested more than 64 levels deep',
      );
    });

    test('refuses a malformed body', async ({ apiAs }) => {
      const requester = apiAs('requester');
      await expectError(
        await requester.fetch('POST', '/api/scaffolder-approvals/requests', {
          data: { values: {} },
        }),
        400,
        /^Invalid request body: templateRef/,
      );
      await expectError(
        await requester.fetch('POST', '/api/scaffolder-approvals/requests', {
          data: { templateRef: 'e2e-single', values: ['not', 'an', 'object'] },
        }),
        400,
        /^Invalid request body: values/,
      );
      await expectError(
        await requester.submit('template:default/', {}),
        400,
        /^Invalid templateRef/,
      );
    });

    test('refuses what is not a usable gated template', async ({
      apiAs,
      unique,
    }) => {
      const requester = apiAs('requester');
      await expectError(
        await requester.submit(`e2e-nothing-here-${unique}`, {}),
        404,
        `No such template: template:default/e2e-nothing-here-${unique}`,
      );
      await expectError(
        await requester.submit('group:default/devx-team', {}),
        400,
        'group:default/devx-team is not a Template',
      );
      await expectError(
        await requester.submit('e2e-ungated', { target: unique }),
        400,
        'template:default/e2e-ungated is not gated; run it through the scaffolder directly',
      );

      const refused: [string, string][] = [
        ['e2e-refused-if', "must not carry an 'if:' condition"],
        ['e2e-refused-secret', 'are secret-typed'],
        ['e2e-refused-values', "has no 'values' input"],
        ['e2e-refused-dynamic-approvers', 'is a template expression'],
        ['e2e-refused-not-first', 'must be the first step'],
      ];
      for (const [template, problem] of refused) {
        await expectError(
          await requester.submit(template, { target: unique }),
          400,
          problem,
        );
      }
    });
  });

  test.describe('reading and listing', () => {
    test('one request: 400 for a malformed id, 404 for an unknown one', async ({
      apiAs,
    }) => {
      const api = apiAs('alice');
      await expectError(
        await api.get('not-a-uuid'),
        400,
        'Invalid request id: must be a request id',
      );
      await expectError(
        await api.get(UNKNOWN_ID),
        404,
        `No such approval request: ${UNKNOWN_ID}`,
      );
    });

    test('anybody signed in can read a request, with its decisions', async ({
      apiAs,
      unique,
    }) => {
      const id = await apiAs('requester').create('e2e-single', {
        target: unique,
      });
      await apiAs('alice').deny(id, 'Read by everyone');
      const seen = await apiAs('newcomer').read(id);
      expect(seen.status).toBe('rejected');
      expect(seen.decisions).toEqual([
        expect.objectContaining({
          requestId: id,
          approverRef: 'user:default/alice',
          decision: 'deny',
          comment: 'Read by everyone',
        }),
      ]);
    });

    test('filters by status, role, template and requester, and pages', async ({
      apiAs,
      unique,
    }) => {
      const requester = apiAs('requester');
      const pending = await requester.create('e2e-single', {
        target: `${unique}-pending`,
      });
      const withdrawn = await requester.create('e2e-single', {
        target: `${unique}-withdrawn`,
      });
      await requester.withdraw(withdrawn);
      const mixed = await requester.create('e2e-mixed-approvers', {
        target: unique,
      });

      const ids = async (
        api: ReturnType<typeof apiAs>,
        query: Record<string, string | number> | URLSearchParams,
      ) => (await api.listItems(query)).items.map(item => item.id);

      // Status: one, several by comma, several by repeating the parameter.
      expect(await ids(requester, { status: 'pending', limit: 200 })).toContain(
        pending,
      );
      expect(
        await ids(requester, { status: 'pending', limit: 200 }),
      ).not.toContain(withdrawn);
      expect(
        await ids(requester, { status: 'pending,cancelled', limit: 200 }),
      ).toEqual(expect.arrayContaining([pending, withdrawn]));
      expect(
        await ids(
          requester,
          new URLSearchParams([
            ['status', 'pending'],
            ['status', 'cancelled'],
            ['limit', '200'],
          ]),
        ),
      ).toEqual(expect.arrayContaining([pending, withdrawn]));

      // Requester refs and template refs match however they are spelled.
      for (const requesterRef of [
        'requester',
        'user:default/requester',
        'User:Default/Requester',
      ]) {
        expect(
          await ids(apiAs('newcomer'), {
            requesterRef,
            templateRef: 'e2e-single',
            limit: 200,
          }),
        ).toEqual(expect.arrayContaining([pending, withdrawn]));
      }
      expect(
        await ids(apiAs('newcomer'), {
          templateRef: 'e2e-mixed-approvers',
          limit: 200,
        }),
      ).toContain(mixed);
      expect(
        await ids(apiAs('newcomer'), {
          templateRef: 'e2e-mixed-approvers',
          limit: 200,
        }),
      ).not.toContain(pending);

      // role=requester is your own; role=approver names you or your groups.
      expect(
        await ids(apiAs('newcomer'), { role: 'requester', limit: 200 }),
      ).toEqual([]);
      const outsiderNamed = await ids(apiAs('outsider'), {
        role: 'approver',
        limit: 200,
      });
      expect(outsiderNamed).toContain(mixed);
      expect(outsiderNamed).not.toContain(pending);

      // actionable narrows that to what you can still decide.
      const aliceInbox = await ids(apiAs('alice'), {
        role: 'approver',
        actionable: 'true',
        status: 'pending',
        limit: 200,
      });
      expect(aliceInbox).toEqual(expect.arrayContaining([pending, mixed]));
      expect(aliceInbox).not.toContain(withdrawn);
      await apiAs('alice').approve(pending);
      expect(
        await ids(apiAs('alice'), {
          role: 'approver',
          actionable: 'true',
          limit: 200,
        }),
      ).not.toContain(pending);
      expect(
        await ids(requester, {
          role: 'approver',
          actionable: 'true',
          limit: 200,
        }),
      ).not.toContain(mixed);

      // Paging: a total independent of the page, and no overlap.
      const first = await requester.listItems({ role: 'requester', limit: 2 });
      const second = await requester.listItems({
        role: 'requester',
        limit: 2,
        offset: 2,
      });
      expect(first.items).toHaveLength(2);
      expect(second.totalItems).toBe(first.totalItems);
      expect(first.totalItems).toBeGreaterThanOrEqual(3);
      expect(second.items.map(i => i.id)).not.toContain(first.items[0].id);
      expect(Date.parse(first.items[0].createdAt)).toBeGreaterThanOrEqual(
        Date.parse(first.items[1].createdAt),
      );
    });

    test('refuses filters it cannot honour', async ({ apiAs }) => {
      const api = apiAs('alice');
      await expectError(
        await api.list({ status: 'pending,bogus' }),
        400,
        'Unknown status: bogus',
      );
      await expectError(
        await api.list({ actionable: 'true' }),
        400,
        "'actionable' needs role=approver",
      );
      await expectError(
        await api.list({ role: 'approver', actionable: 'yes' }),
        400,
        /^Invalid query: actionable/,
      );
      await expectError(
        await api.list({ role: 'boss' }),
        400,
        /^Invalid query: role/,
      );
      for (const limit of [0, 201, 1.5]) {
        await expectError(
          await api.list({ limit }),
          400,
          /^Invalid query: limit/,
        );
      }
      await expectError(
        await api.list({ offset: -1 }),
        400,
        /^Invalid query: offset/,
      );
      await expectStatus(await api.list({ limit: 200 }), 200);
    });
  });

  test.describe('deciding', () => {
    test('validates the decision and its comment', async ({
      apiAs,
      unique,
    }) => {
      const id = await apiAs('requester').create('request-github-admin', {
        repository: `acme/api-${unique}`,
        justification: 'Checking the decision body',
      });
      const alice = apiAs('alice');
      await expectError(
        await alice.fetch(
          'POST',
          `/api/scaffolder-approvals/requests/${id}/decision`,
          { data: { decision: 'maybe' } },
        ),
        400,
        /^Invalid request body: decision/,
      );
      await expectError(
        await alice.decide(id, 'approve', 'x'.repeat(4097)),
        400,
        /^Invalid request body: comment/,
      );

      // The longest comment allowed is kept whole.
      const recorded = await alice.approve(id, 'y'.repeat(4096));
      expect(recorded.decisions?.[0].comment).toHaveLength(4096);
      expect(recorded.status).toBe('pending');
    });

    test('400 for a malformed id, 404 for an unknown one', async ({
      apiAs,
    }) => {
      await expectError(
        await apiAs('alice').decide('nope', 'approve'),
        400,
        'Invalid request id',
      );
      await expectError(
        await apiAs('alice').decide(UNKNOWN_ID, 'approve'),
        404,
        `No such approval request: ${UNKNOWN_ID}`,
      );
    });

    test('a settled request takes no more decisions', async ({
      apiAs,
      unique,
    }) => {
      const id = await apiAs('requester').create('e2e-single', {
        target: unique,
      });
      await apiAs('alice').approve(id);
      await expectError(
        await apiAs('bob').decide(id, 'deny', 'Too late'),
        409,
        'This request has already been decided',
      );
      const done = await apiAs('bob').waitForStatus(id, 'completed');
      expect(done.decisions).toHaveLength(1);
    });
  });

  test.describe('withdrawing', () => {
    test('only by the requester, and only while pending', async ({
      apiAs,
      unique,
    }) => {
      const id = await apiAs('requester').create('e2e-single', {
        target: unique,
      });
      await expectError(
        await apiAs('bob').cancel(id),
        403,
        'Only the requester may cancel a request',
      );
      const withdrawn = await apiAs('requester').withdraw(id);
      expect(withdrawn.status).toBe('cancelled');
      expect(withdrawn.decidedAt).toBeTruthy();
      await expectError(
        await apiAs('requester').cancel(id),
        409,
        `Approval request ${id} is no longer pending`,
      );
      await expectError(
        await apiAs('requester').cancel(UNKNOWN_ID),
        404,
        `No such approval request: ${UNKNOWN_ID}`,
      );
    });
  });

  test.describe('grants', () => {
    test('cannot be redeemed by a user, only by the scaffolder', async ({
      apiAs,
    }) => {
      const response = await apiAs('alice').fetch(
        'POST',
        '/api/scaffolder-approvals/grants/consume',
        {
          data: {
            grant: 'anything',
            valuesHash: '0'.repeat(64),
            taskId: 'task',
            templateRef: 'template:default/e2e-single',
          },
        },
      );
      expect(response.status()).toBe(403);
    });
  });
});

test.describe('the gate itself', () => {
  test('a gated template started through the scaffolder fails at the gate, and nothing after it runs', async ({
    apiAs,
    unique,
  }) => {
    const requester = apiAs('requester');
    const started = await requester.runTemplate('template:default/e2e-single', {
      target: unique,
    });
    await expectStatus(started, 201);
    const { id: taskId } = await started.json();

    await expect
      .poll(async () => (await requester.task(taskId)).status, {
        message: 'the task to finish',
        timeout: 60_000,
      })
      .toBe('failed');
    const log = await requester.taskLog(taskId);
    expect(log).toContain(
      'This template requires approval before it can run, so it cannot be started directly.',
    );
    expect(log).not.toContain(`E2E-SINGLE ran for ${unique}`);

    // And no approval request appeared out of it.
    const { items } = await requester.listItems({
      role: 'requester',
      templateRef: 'e2e-single',
      limit: 200,
    });
    expect(items.filter(item => item.values?.target === unique)).toEqual([]);
  });

  test('an approved run is told who asked and who agreed', async ({
    apiAs,
    unique,
  }) => {
    const id = await apiAs('requester').create('e2e-single', {
      target: unique,
    });
    await apiAs('bob').approve(id);
    const done = await apiAs('requester').waitForStatus(id, 'completed');
    const log = await apiAs('requester').taskLog(done.taskId!);
    expect(log).toContain(
      `E2E-SINGLE ran for ${unique}; requestedBy=user:default/requester; approvedBy=user:default/bob; requestId=${id}`,
    );
  });
});
