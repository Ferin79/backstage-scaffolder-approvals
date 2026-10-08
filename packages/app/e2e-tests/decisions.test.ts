import { DISPLAY_NAME } from './support/api';
import { expect, test } from './support/fixtures';
import { RequestPage, RequestsList, toast } from './support/pages';

test.describe('approving and denying', () => {
  test('two approvals start the template, and the requester watches it happen live', async ({
    signIn,
    apiAs,
    unique,
  }) => {
    const repository = `acme/quorum-${unique}`;
    const summary = `Admin on ${repository}`;
    const id = await apiAs('requester').create('request-github-admin', {
      repository,
      justification: 'Needed for the quorum test',
    });

    // The requester keeps the page open throughout, and never reloads it.
    const requesterPage = await signIn('requester');
    const watching = await RequestPage.open(requesterPage, id);
    await expect(watching.panelHeading).toHaveText('0 of 2 approvals needed.');

    // Alice finds it in her inbox.
    const alicePage = await signIn('alice');
    const inbox = new RequestsList(alicePage);
    await inbox.goto('inbox');
    const row = inbox.row(summary);
    await expect(row).toContainText('Request GitHub admin access');
    await expect(row).toContainText(DISPLAY_NAME.requester);
    await expect(row).toContainText('Awaiting approval');
    await row.click();

    // Cancelling the dialog changes nothing.
    const alice = new RequestPage(alicePage);
    await alice.button('Approve').click();
    const dialog = alice.dialog('Approve this request?');
    await expect(dialog).toContainText(
      `Approving counts towards the quorum for ${summary}. Once the quorum is met the template starts straight away.`,
    );
    await expect(dialog).toContainText(
      'Optional. The requester and the other approvers will see it.',
    );
    await dialog.getByRole('button', { name: 'Cancel' }).click();
    await expect(dialog).toBeHidden();
    await expect(alice.panelHeading).toHaveText('0 of 2 approvals needed.');

    await alice.approve('Fine for the on-call rotation');
    await expect(toast(alicePage, 'Request approved')).toBeVisible();
    await expect(alice.panelHeading).toHaveText('1 of 2 approvals needed.');
    await expect(alice.panel).toContainText(
      'You have already decided on this request.',
    );
    await expect(alice.button('Approve')).toHaveCount(0);
    await expect(alice.button('Deny')).toHaveCount(0);
    await expect(
      alice.activity(`${DISPLAY_NAME.alice} approved`),
    ).toContainText('Fine for the on-call rotation');

    // The requester's page followed along by itself.
    await expect(watching.panelHeading).toHaveText('1 of 2 approvals needed.');
    await expect(
      watching.activity(`${DISPLAY_NAME.alice} approved`),
    ).toContainText('Fine for the on-call rotation');
    // One of two is not "approved": nobody tells the requester it is.
    expect(
      (await apiAs('requester').notifications(repository)).map(
        n => n.payload.title,
      ),
    ).not.toContain('Request approved');

    // Somebody who has voted has nothing left to do in their inbox.
    await inbox.goto('inbox');
    await expect(inbox.row(summary)).toHaveCount(0);

    // Bob's approval meets the quorum and the template starts straight away.
    const bobPage = await signIn('bob');
    const bob = await RequestPage.open(bobPage, id);
    await bob.approve();
    await expect(toast(bobPage, 'Request approved')).toBeVisible();

    await expect(watching.panelHeading).toHaveText(
      'Approved, and the template has run.',
      { timeout: 60_000 },
    );
    await expect(watching.status).toHaveText('Completed');
    await expect(watching.button('Withdraw')).toHaveCount(0);
    await expect(
      watching.activity(`${DISPLAY_NAME.bob} approved`),
    ).toBeVisible();

    const done = await apiAs('requester').read(id);
    expect(done.status).toBe('completed');
    expect(done.decidedAt).toBeTruthy();
    expect(done.decisions?.map(d => [d.approverRef, d.decision])).toEqual([
      ['user:default/alice', 'approve'],
      ['user:default/bob', 'approve'],
    ]);
    const taskId = done.taskId!;
    await expect(watching.detail('Task')).toHaveText(taskId);
    await expect(watching.taskLogLink).toHaveAttribute(
      'href',
      `/create/tasks/${taskId}`,
    );

    // The run knows who asked and who agreed, though it ran as the plugin.
    const log = await apiAs('requester').taskLog(taskId);
    expect(log).toContain(`Granting admin on ${repository}`);
    expect(log).toContain('Requested by: user:default/requester');
    expect(log).toMatch(/Approved by: +user:default\/alice,user:default\/bob/);
    expect(log).toContain(`Request:      ${id}`);

    // "View task log" opens the scaffolder's own page for the run, in a new tab.
    const [taskTab] = await Promise.all([
      requesterPage.context().waitForEvent('page'),
      watching.taskLogLink.click(),
    ]);
    await expect(
      taskTab.getByText(`Granting admin on ${repository}`).first(),
    ).toBeVisible();

    const approved = await apiAs('requester').waitForNotification(
      repository,
      'Request approved',
    );
    expect(approved.payload.description).toBe(
      `bob approved your request to run ${summary}`,
    );

    const mine = new RequestsList(requesterPage);
    await mine.goto('mine');
    await expect(await mine.findRow(summary)).toContainText('Completed');
  });

  test('one denial rejects a request outright, whatever it already had', async ({
    signIn,
    apiAs,
    unique,
  }) => {
    const repository = `acme/denied-${unique}`;
    const summary = `Admin on ${repository}`;
    const id = await apiAs('requester').create('request-github-admin', {
      repository,
      justification: 'Should be turned down',
    });
    await apiAs('alice').approve(id, 'Looks fine to me');

    const bobPage = await signIn('bob');
    const bob = await RequestPage.open(bobPage, id);
    await expect(bob.panelHeading).toHaveText('1 of 2 approvals needed.');

    await bob.button('Deny').click();
    const dialog = bob.dialog('Deny this request?');
    await expect(dialog).toContainText(
      `Denying rejects ${summary} outright. Nobody else's approval can undo it, and the requester will have to ask again.`,
    );
    await expect(dialog).toContainText(
      'Tell the requester why. This is all they will see.',
    );
    await dialog
      .getByRole('textbox', { name: 'Comment' })
      .fill('Use the break-glass group instead');
    await dialog.getByRole('button', { name: 'Deny', exact: true }).click();
    await expect(dialog).toBeHidden();

    await expect(toast(bobPage, 'Request denied')).toBeVisible();
    await expect(bob.panelHeading).toHaveText(
      'Denied. A single denial rejects a request outright.',
    );
    await expect(bob.status).toHaveText('Denied');

    const requesterPage = await signIn('requester');
    const requester = await RequestPage.open(requesterPage, id);
    await expect(requester.status).toHaveText('Denied');
    await expect(
      requester.activity(`${DISPLAY_NAME.bob} denied`),
    ).toContainText('Use the break-glass group instead');
    await expect(
      requester.activity(`${DISPLAY_NAME.alice} approved`),
    ).toContainText('Looks fine to me');
    // Nothing left for the requester to do: no withdrawing, no resubmitting.
    await expect(requester.button('Withdraw')).toHaveCount(0);
    await expect(requester.button('Resubmit')).toHaveCount(0);
    await expect(requester.detail('Expires')).toHaveCount(0);

    const denied = await apiAs('requester').waitForNotification(
      repository,
      'Request denied',
    );
    expect(denied.payload.description).toBe(
      `bob denied your request to run ${summary}: Use the break-glass group instead`,
    );
    expect(denied.payload.severity).toBe('high');

    const stored = await apiAs('requester').read(id);
    expect(stored.status).toBe('rejected');
    expect(stored.taskId).toBeUndefined();

    const mine = new RequestsList(requesterPage);
    await mine.goto('mine');
    await expect(await mine.findRow(summary)).toContainText('Denied');
  });
});

test.describe('withdrawing', () => {
  test('the requester can withdraw a pending request, after confirming', async ({
    signIn,
    apiAs,
    unique,
  }) => {
    const summary = `Single approval for ${unique}`;
    const id = await apiAs('requester').create('e2e-single', {
      target: unique,
    });

    const page = await signIn('requester');
    const request = await RequestPage.open(page, id);
    await expect(request.panel).toContainText(
      'Withdrawing stops the request. Nobody is asked to decide on it.',
    );

    // "Keep it" keeps it.
    await request.button('Withdraw').click();
    const dialog = request.dialog('Withdraw this request?');
    await expect(dialog).toContainText(
      `Withdrawing stops ${summary}. Nobody will be asked to decide on it, any approvals it already has are discarded, and it cannot be undone`,
    );
    await dialog.getByRole('button', { name: 'Keep it' }).click();
    await expect(dialog).toBeHidden();
    await expect(request.status).toHaveText('Awaiting approval');

    await request.withdraw();
    await expect(toast(page, 'Request withdrawn')).toBeVisible();
    await expect(request.panelHeading).toHaveText(
      'Withdrawn by the requester before it was decided.',
    );
    await expect(request.status).toHaveText('Withdrawn');
    await expect(request.button('Withdraw')).toHaveCount(0);

    // Approvers can no longer act on it, and are told so.
    const alicePage = await signIn('alice');
    const alice = await RequestPage.open(alicePage, id);
    await expect(alice.panelHeading).toHaveText(
      'Withdrawn by the requester before it was decided.',
    );
    await expect(alice.button('Approve')).toHaveCount(0);
    const inbox = new RequestsList(alicePage);
    await inbox.goto('inbox');
    await expect(inbox.row(summary)).toHaveCount(0);

    // Their "Approval requested" is replaced, not left beside the news.
    await expect
      .poll(async () =>
        (await apiAs('alice').notifications(unique)).map(n => n.payload.title),
      )
      .toEqual(['Approval request withdrawn']);
    const [withdrawn] = await apiAs('alice').notifications(unique);
    expect(withdrawn.payload.description).toBe(
      `requester withdrew their request to run ${summary}. Nothing is waiting on you.`,
    );
    expect(withdrawn.payload.severity).toBe('low');
  });

  test('an approver whose dialog is open when the request is withdrawn is told nothing was sent', async ({
    signIn,
    apiAs,
    unique,
  }) => {
    const id = await apiAs('requester').create('e2e-single', {
      target: unique,
    });
    const page = await signIn('alice');
    const alice = await RequestPage.open(page, id);

    await alice.button('Approve').click();
    const dialog = alice.dialog('Approve this request?');
    await dialog.getByRole('textbox', { name: 'Comment' }).fill('Too late');

    await apiAs('requester').withdraw(id);

    await expect(dialog).toBeHidden();
    await expect(
      toast(
        page,
        'Nothing was sent: this request was settled while the dialog was open.',
      ),
    ).toBeVisible();
    await expect(alice.panelHeading).toHaveText(
      'Withdrawn by the requester before it was decided.',
    );
    expect((await apiAs('alice').read(id)).decisions).toEqual([]);
  });

  test('a requester about to withdraw is told when an approval got there first', async ({
    signIn,
    apiAs,
    unique,
  }) => {
    const id = await apiAs('requester').create('e2e-single', {
      target: unique,
    });
    const page = await signIn('requester');
    const request = await RequestPage.open(page, id);

    await request.button('Withdraw').click();
    const dialog = request.dialog('Withdraw this request?');
    await expect(dialog).toBeVisible();

    await apiAs('alice').approve(id);

    await expect(dialog).toBeHidden();
    await expect(
      toast(
        page,
        'Nothing was withdrawn: this request is no longer waiting for a decision.',
      ),
    ).toBeVisible();
    await expect(request.panelHeading).toHaveText(
      /^Approved(\. The template is (starting|running)\.|, and the template has run\.)$/,
    );
  });

  test('an approver who voted in another tab is told when this one’s dialog closes', async ({
    signIn,
    apiAs,
    unique,
  }) => {
    // Quorum 2, so Alice's vote elsewhere leaves the request pending.
    const id = await apiAs('requester').create('request-github-admin', {
      repository: `acme/two-tabs-${unique}`,
      justification: 'Decided in another tab',
    });
    const page = await signIn('alice');
    const alice = await RequestPage.open(page, id);
    await alice.button('Deny').click();
    const dialog = alice.dialog('Deny this request?');
    await expect(dialog).toBeVisible();

    await apiAs('alice').approve(id);

    await expect(dialog).toBeHidden();
    await expect(
      toast(
        page,
        'Nothing was sent: you have already decided on this request elsewhere.',
      ),
    ).toBeVisible();
    await expect(alice.panelHeading).toHaveText('1 of 2 approvals needed.');
    await expect(alice.panel).toContainText(
      'You have already decided on this request.',
    );
  });

  test('without live updates, a decision on a request that moved on is refused and the page catches up', async ({
    signIn,
    apiAs,
    unique,
  }) => {
    const id = await apiAs('requester').create('e2e-single', {
      target: unique,
    });
    const page = await signIn('alice');
    // A signals socket that never says anything: the page cannot hear the
    // withdrawal, so only the backend can stop the vote.
    await page.routeWebSocket(/\/api\/signals/, () => {});
    const alice = await RequestPage.open(page, id);

    await alice.button('Approve').click();
    const dialog = alice.dialog('Approve this request?');
    await apiAs('requester').withdraw(id);
    await expect(dialog).toBeVisible();
    await dialog.getByRole('button', { name: 'Approve', exact: true }).click();

    await expect(
      toast(
        page,
        'Could not record your decision: This request has already been decided',
      ),
    ).toBeVisible();
    await expect(dialog).toBeHidden();
    await expect(alice.panelHeading).toHaveText(
      'Withdrawn by the requester before it was decided.',
    );
  });
});
