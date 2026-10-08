import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { REDACT_AFTER_MS, RUN_STATE_DIR } from './support/env';
import { expect, test } from './support/fixtures';
import { RequestPage, RequestsList } from './support/pages';

/**
 * Runs last, in a project of its own: the sweep redacts every request settled
 * more than two minutes ago (app-config.e2e.yaml), including other tests'.
 */
test('the retention sweep removes old values and summaries, and keeps the audit trail', async ({
  signIn,
  apiAs,
  unique,
}) => {
  test.setTimeout(6 * 60_000);
  const aged: {
    withdrawn: string;
    completed: string;
    failed: string;
    pending: string;
  } = JSON.parse(await readFile(join(RUN_STATE_DIR, 'retention.json'), 'utf8'));
  const requester = apiAs('requester');

  // The setup project settled these at the start of the run. If the run was
  // quicker than the redaction window, wait out the rest of it.
  const settledAt = Math.max(
    ...(await Promise.all(
      [aged.withdrawn, aged.completed, aged.failed].map(async id =>
        Date.parse((await requester.read(id)).updatedAt),
      ),
    )),
  );
  const wait = settledAt + REDACT_AFTER_MS + 5_000 - Date.now();
  if (wait > 0) {
    await new Promise(resolve => setTimeout(resolve, wait));
  }

  // Settled just now, so inside the window.
  const recent = await requester.create('e2e-single', {
    target: `retention-recent-${unique}`,
  });
  await requester.withdraw(recent);

  const before = await requester.read(aged.completed);
  await apiAs('alice').triggerSweep('retention');

  for (const id of [aged.withdrawn, aged.completed, aged.failed]) {
    await expect
      .poll(async () => (await requester.read(id)).redactedAt, {
        message: `request ${id} to be redacted`,
      })
      .toBeTruthy();
  }

  // What goes: the values and the summary. What stays: everything else.
  const redacted = await requester.read(aged.completed);
  expect(redacted.values).toBeNull();
  expect(redacted.summary).toBeNull();
  expect(redacted).toMatchObject({
    id: before.id,
    status: 'completed',
    templateRef: before.templateRef,
    requesterRef: before.requesterRef,
    valuesHash: before.valuesHash,
    taskId: before.taskId,
    policySnapshot: before.policySnapshot,
    decisions: before.decisions,
  });

  // Never what is still in flight, nor what settled inside the window.
  const pending = await requester.read(aged.pending);
  expect(pending.status).toBe('pending');
  expect(pending.values).not.toBeNull();
  expect(pending.redactedAt).toBeUndefined();
  const stillRecent = await requester.read(recent);
  expect(stillRecent.values).toEqual({ target: `retention-recent-${unique}` });
  expect(stillRecent.redactedAt).toBeUndefined();

  // The page says what happened rather than showing a blank.
  const page = await signIn('requester');
  const request = await RequestPage.open(page, aged.completed);
  await expect(request.title).toHaveText('E2E single approval');
  await expect(request.card('Parameters')).toContainText(
    /The submitted parameters were removed on .+ by the retention policy\. The decision history is kept indefinitely\./,
  );
  await expect(request.activity('Alice Approver approved')).toContainText(
    'Approved before redaction',
  );
  await expect(request.taskLogLink).toBeVisible();

  // A failed request cannot be resubmitted once there is nothing to resubmit.
  await request.goto(aged.failed);
  await expect(request.button('Resubmit')).toHaveCount(0);
  await expect(request.panel).toContainText(
    'This request can no longer be resubmitted: its parameters were removed by the retention policy.',
  );

  // In the list, a redacted request is named by its template alone.
  const mine = new RequestsList(page);
  await mine.goto('mine');
  await expect(mine.row(`retention-recent-${unique}`)).toBeVisible();
  await expect(mine.row(`retention-completed-`)).toHaveCount(0);

  await requester.withdraw(aged.pending);
});
