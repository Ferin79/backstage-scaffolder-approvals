import { type BackstageApi, expectError, type Person } from './support/api';
import { expect, test } from './support/fixtures';
import { RequestPage, RequestsList } from './support/pages';

/** A pending quorum-2 request from requester, with its summary. */
async function pendingGitHubAdmin(
  apiAs: (person: Person) => BackstageApi,
  unique: string,
) {
  const repository = `acme/eligibility-${unique}`;
  const id = await apiAs('requester').create('request-github-admin', {
    repository,
    justification: 'Checking who may decide',
  });
  return { id, summary: `Admin on ${repository}` };
}

test.describe('who may decide', () => {
  test('somebody outside the approver groups is told so, and refused', async ({
    signIn,
    apiAs,
    unique,
  }) => {
    const { id, summary } = await pendingGitHubAdmin(apiAs, unique);

    const page = await signIn('outsider');
    const request = await RequestPage.open(page, id);
    await expect(request.panel).toContainText(
      'You are not an approver for this request.',
    );
    await expect(request.button('Approve')).toHaveCount(0);
    await expect(request.button('Deny')).toHaveCount(0);
    await expect(request.button('Withdraw')).toHaveCount(0);

    const inbox = new RequestsList(page);
    await inbox.goto('inbox');
    await expect(inbox.row(summary)).toHaveCount(0);

    await expectError(
      await apiAs('outsider').decide(id, 'approve'),
      403,
      'You are not an approver for this request',
    );
    await expectError(
      await apiAs('outsider').decide(id, 'deny'),
      403,
      'You are not an approver for this request',
    );
  });

  test('a member of a group inside the approver group is not an approver', async ({
    signIn,
    apiAs,
    unique,
  }) => {
    // Dana is in devx-platform, whose parent is devx-team. Gates match the
    // groups in a person's sign-in, which are their direct groups only.
    const { id } = await pendingGitHubAdmin(apiAs, unique);

    const page = await signIn('dana');
    const request = await RequestPage.open(page, id);
    await expect(request.panel).toContainText(
      'You are not an approver for this request.',
    );
    await expectError(
      await apiAs('dana').decide(id, 'approve'),
      403,
      'You are not an approver for this request',
    );
  });

  test('the requester cannot approve their own request, even as an approver', async ({
    signIn,
    apiAs,
    unique,
  }) => {
    const { id, summary } = await pendingGitHubAdmin(apiAs, unique);

    const page = await signIn('requester');
    const request = await RequestPage.open(page, id);
    await expect(request.panel).toContainText(
      'Needs 2 approvals from DevX team. The requester cannot approve their own request.',
    );
    await expect(request.panel).toContainText(
      'You cannot approve your own request.',
    );
    await expect(request.button('Approve')).toHaveCount(0);
    await expect(request.button('Withdraw')).toBeVisible();

    // Not in their inbox either: there is nothing they can do there.
    const inbox = new RequestsList(page);
    await inbox.goto('inbox');
    await expect(inbox.row(summary)).toHaveCount(0);

    await expectError(
      await apiAs('requester').decide(id, 'approve'),
      403,
      'You cannot approve your own request',
    );
  });

  test('a requester who is not an approver is told whose decision it is', async ({
    signIn,
    apiAs,
    unique,
  }) => {
    // Outsider is in no group, so not one of e2e-single's approvers.
    const id = await apiAs('outsider').create('e2e-single', {
      target: unique,
    });
    const page = await signIn('outsider');
    const request = await RequestPage.open(page, id);
    await expect(request.panel).toContainText(
      'This is your request. The approvers named above decide on it.',
    );
    await expect(request.button('Withdraw')).toBeVisible();
  });

  test('an approver decides once, and cannot change their mind', async ({
    signIn,
    apiAs,
    unique,
  }) => {
    const { id } = await pendingGitHubAdmin(apiAs, unique);
    await apiAs('alice').approve(id);

    const page = await signIn('alice');
    const request = await RequestPage.open(page, id);
    await expect(request.panelHeading).toHaveText('1 of 2 approvals needed.');
    await expect(request.panel).toContainText(
      'You have already decided on this request.',
    );

    await expectError(
      await apiAs('alice').decide(id, 'approve'),
      409,
      'You have already decided on this request',
    );
    await expectError(
      await apiAs('alice').decide(id, 'deny', 'Changed my mind'),
      409,
      'You have already decided on this request',
    );
    const stored = await apiAs('alice').read(id);
    expect(stored.status).toBe('pending');
    expect(stored.decisions).toHaveLength(1);
  });

  test('a template that allows it lets the requester approve their own request', async ({
    signIn,
    apiAs,
    unique,
  }) => {
    const summary = `Self-approvable for ${unique}`;
    const id = await apiAs('requester').create('e2e-self-approve', {
      target: unique,
    });

    const page = await signIn('requester');
    const inbox = new RequestsList(page);
    await inbox.goto('inbox');
    await inbox.row(summary).click();

    const request = new RequestPage(page);
    await expect(request.panel).toContainText(
      'Needs one approval from DevX team. The requester may approve their own request.',
    );
    await expect(request.button('Withdraw')).toBeVisible();
    await request.approve('My own call to make');

    await expect(request.panelHeading).toHaveText(
      'Approved, and the template has run.',
    );
    const done = await apiAs('requester').read(id);
    expect(done.decisions?.[0].approverRef).toBe('user:default/requester');
  });

  test('a user named directly approves alongside a group, and counts towards the quorum', async ({
    signIn,
    apiAs,
    unique,
  }) => {
    const summary = `Mixed approvers for ${unique}`;
    const id = await apiAs('requester').create('e2e-mixed-approvers', {
      target: unique,
    });

    const page = await signIn('outsider');
    const inbox = new RequestsList(page);
    await inbox.goto('inbox');
    await inbox.row(summary).click();

    const request = new RequestPage(page);
    await expect(request.panel).toContainText(
      'Needs 2 approvals from DevX team or Oscar Outsider. The requester cannot approve their own request.',
    );
    await request.approve();
    await expect(request.panelHeading).toHaveText('1 of 2 approvals needed.');

    await apiAs('alice').approve(id);
    const done = await apiAs('requester').waitForStatus(id, 'completed');
    const log = await apiAs('requester').taskLog(done.taskId!);
    expect(log).toContain(
      'approvedBy=user:default/outsider,user:default/alice',
    );
  });

  test('only the requester is offered Withdraw, and only they may', async ({
    signIn,
    apiAs,
    unique,
  }) => {
    const id = await apiAs('requester').create('e2e-single', {
      target: unique,
    });
    const page = await signIn('alice');
    const request = await RequestPage.open(page, id);
    await expect(request.button('Approve')).toBeVisible();
    await expect(request.button('Withdraw')).toHaveCount(0);

    await expectError(
      await apiAs('alice').cancel(id),
      403,
      'Only the requester may cancel a request',
    );
  });
});
