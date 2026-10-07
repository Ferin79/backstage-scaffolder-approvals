import { expectError } from './support/api';
import { expect, test } from './support/fixtures';
import { RequestPage, RequestsList, toast } from './support/pages';

test.describe('a request nobody decides on in time', () => {
  test('expires at its deadline, for everyone, before the sweep catches up', async ({
    signIn,
    apiAs,
    unique,
  }) => {
    test.setTimeout(180_000);
    const summary = `Expiring for ${unique}`;
    const id = await apiAs('requester').create('e2e-expiring', {
      target: unique,
    });
    const created = await apiAs('requester').read(id);
    const deadline = new Date(created.expiresAt!).getTime();
    // Thirty seconds, give or take the millisecond between the two clock
    // readings the backend takes for them.
    expect(
      Math.abs(deadline - new Date(created.createdAt).getTime() - 30_000),
    ).toBeLessThan(50);

    // Both open it while it can still be decided.
    const [requesterPage, alicePage] = await Promise.all([
      signIn('requester'),
      signIn('alice'),
    ]);
    const requester = await RequestPage.open(requesterPage, id);
    const alice = await RequestPage.open(alicePage, id);
    await expect(requester.detail('Expires')).toBeVisible();
    await expect(requester.button('Withdraw')).toBeVisible();
    await expect(alice.button('Approve')).toBeVisible();

    await requesterPage.waitForTimeout(
      Math.max(0, deadline - Date.now() + 1_000),
    );

    // Past the deadline nobody can act, whether or not the sweep has run. It
    // runs every five minutes, so either answer is possible here.
    await expectError(
      await apiAs('alice').decide(id, 'approve'),
      409,
      /This request timed out before anyone decided|This request has already been decided/,
    );
    await expectError(
      await apiAs('requester').cancel(id),
      409,
      /This request timed out before anyone decided, so there is nothing left to withdraw|is no longer pending/,
    );

    await requesterPage.reload();
    await expect(requester.status).toHaveText('Expired');
    await expect(requester.panelHeading).toHaveText(
      'Timed out before it was approved.',
    );
    await expect(requester.detail('Timed out')).toBeVisible();
    await expect(requester.detail('Expires')).toHaveCount(0);
    await expect(requester.button('Withdraw')).toHaveCount(0);

    // The sweep records it, and Alice's open page hears about it.
    await apiAs('alice').triggerSweep('timeouts');
    const expired = await apiAs('alice').waitForStatus(id, 'expired');
    expect(expired.decisions).toEqual([]);
    await expect(alice.panelHeading).toHaveText(
      'Timed out before it was approved.',
    );
    await expect(alice.button('Approve')).toHaveCount(0);

    for (const person of ['requester', 'alice'] as const) {
      const notification = await apiAs(person).waitForNotification(
        unique,
        'Approval request expired',
      );
      expect(notification.payload.description).toBe(
        `Nobody decided on ${summary} before it timed out`,
      );
    }

    const mine = new RequestsList(requesterPage);
    await mine.goto('mine');
    await expect(mine.row(summary)).toContainText('Expired');
  });
});

test.describe('an approved run that fails', () => {
  test('says why, links the log, and can be resubmitted as a new request', async ({
    signIn,
    apiAs,
    unique,
  }) => {
    const summary = `Failing run for ${unique}`;
    const id = await apiAs('requester').create('e2e-fails', {
      target: unique,
    });
    const page = await signIn('requester');
    const request = await RequestPage.open(page, id);

    await apiAs('alice').approve(id);

    // The open page follows the run to its end.
    await expect(request.panelHeading).toHaveText(
      'Approved, but the template did not complete.',
      { timeout: 60_000 },
    );
    await expect(request.status).toHaveText('Failed');
    await expect(page.getByTestId('failure-reason')).toHaveText(
      'The task failed.',
    );
    await expect(request.taskLogLink).toBeVisible();
    await expect(request.panel).toContainText(
      'Starts a new request with the same parameters. The approval this run used is spent, so it has to be asked for again.',
    );

    const failed = await apiAs('requester').read(id);
    expect(failed.failureReason).toBe('the task failed');
    const log = await apiAs('requester').taskLog(failed.taskId!);
    expect(log).toContain('e2e-does-not-exist-anywhere');

    // Both sides hear about it: the approvers spent their attention on it.
    for (const person of ['requester', 'alice', 'bob'] as const) {
      const notification = await apiAs(person).waitForNotification(
        unique,
        'Approved request failed',
      );
      expect(notification.payload.description).toBe(
        `${summary} did not complete: the task failed`,
      );
    }

    // Approvers can read the log, but resubmitting is the requester's call.
    const alicePage = await signIn('alice');
    const alice = await RequestPage.open(alicePage, id);
    await expect(alice.taskLogLink).toBeVisible();
    await expect(alice.button('Resubmit')).toHaveCount(0);

    await request.button('Resubmit').click();
    await expect(toast(page, 'Request submitted')).toBeVisible();
    await expect(page).toHaveURL(
      /\/scaffolder-approvals\/requests\/[0-9a-f-]{36}$/,
    );
    await expect(page).not.toHaveURL(new RegExp(id));
    const resubmittedId = page.url().split('/').pop()!;

    await expect(request.status).toHaveText('Awaiting approval');
    await expect(request.parameter('Target')).toHaveText(unique);
    expect((await apiAs('requester').read(resubmittedId)).values).toEqual({
      target: unique,
    });
    // The failed one stays failed: a spent approval is never retried.
    expect((await apiAs('requester').read(id)).status).toBe('failed');

    // Resubmitting again while that one waits opens it, not a duplicate.
    await request.goto(id);
    await request.button('Resubmit').click();
    await expect(
      toast(page, 'You already have an identical request open'),
    ).toBeVisible();
    await expect(page).toHaveURL(new RegExp(`/requests/${resubmittedId}$`));
  });
});
