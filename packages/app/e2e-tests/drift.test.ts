import { expect, test } from './support/fixtures';
import { RequestPage, toast } from './support/pages';

const STEPS_EDITED =
  'The steps in this template have been edited since the request was submitted. The edited steps are the ones that will run, not the ones that were asked for.';
const PARAMETERS_CHANGED =
  "The template's parameters have changed since the request was submitted, and the submitted values no longer fit them. The scaffolder will refuse to start it, so approving will fail; the requester needs to submit it again.";
const MISSING =
  'The template is no longer in the catalog. Approving this request will fail, because there is nothing left to run.';
const REPLACED =
  'The template was deleted and recreated since this request was submitted. It shares a name with the one that was asked for, and nothing else.';

test.describe('when a template changes while a request waits', () => {
  test('edited steps are pointed out before anyone approves, and are what runs', async ({
    signIn,
    apiAs,
    runtimeTemplate,
    unique,
  }) => {
    const template = runtimeTemplate('steps');
    await template.publish({ message: `ORIGINAL steps for ${unique}` });
    const id = await apiAs('requester').create(template.ref, {
      target: unique,
    });

    const page = await signIn('alice');
    const request = await RequestPage.open(page, id);
    await expect(request.panelHeading).toHaveText('0 of 1 approval needed.');
    await expect(request.driftAlert).toHaveCount(0);

    await template.publish({ message: `EDITED steps for ${unique}` });
    expect((await apiAs('alice').read(id)).templateDrift).toEqual({
      changed: true,
      reasons: ['steps'],
    });

    await page.reload();
    await expect(request.driftAlert).toContainText(STEPS_EDITED);

    // The dialog says it again, since it covers the page's warning, and the
    // button admits the warning applies.
    await request.button('Approve').click();
    const dialog = request.dialog('Approve this request?');
    await expect(dialog).toContainText(STEPS_EDITED);
    await expect(dialog).toContainText(
      'Once the quorum is met the template starts straight away.',
    );
    await dialog.getByRole('button', { name: 'Approve anyway' }).click();
    await expect(toast(page, 'Request approved')).toBeVisible();

    await expect(request.panelHeading).toHaveText(
      'Approved, and the template has run.',
    );
    // Once it has run, "the edited steps will run" is no longer worth saying.
    await expect(request.driftAlert).toHaveCount(0);
    const done = await apiAs('alice').read(id);
    const log = await apiAs('alice').taskLog(done.taskId!);
    expect(log).toContain(`EDITED steps for ${unique}`);
    expect(log).not.toContain(`ORIGINAL steps for ${unique}`);
  });

  test('parameters the values no longer fit mean approving fails, and Resubmit hands the values back to the form', async ({
    signIn,
    apiAs,
    runtimeTemplate,
    unique,
  }) => {
    const template = runtimeTemplate('params');
    await template.publish();
    const id = await apiAs('requester').create(template.ref, {
      target: unique,
    });

    // A new required field the request does not have.
    await template.publish({
      properties: {
        target: { title: 'Target', type: 'string' },
        ticket: { title: 'Ticket', type: 'string' },
      },
      required: ['target', 'ticket'],
    });
    const drift = (await apiAs('alice').read(id)).templateDrift;
    expect(drift?.changed).toBe(true);
    expect(drift?.reasons).toContain('parameters');

    const alicePage = await signIn('alice');
    const alice = await RequestPage.open(alicePage, id);
    await expect(alice.driftAlert).toContainText(PARAMETERS_CHANGED);

    await alice.button('Approve').click();
    const dialog = alice.dialog('Approve this request?');
    await expect(dialog).toContainText(
      'Once the quorum is met the template is launched, but as things stand the launch will fail.',
    );
    await dialog.getByRole('button', { name: 'Approve anyway' }).click();

    const failed = await apiAs('requester').waitForStatus(id, 'failed');
    // The scaffolder's own answer, which names what no longer fits.
    expect(failed.failureReason).toMatch(
      /^the scaffolder refused to start the template \(400 Bad Request\): .*ticket/,
    );
    expect(failed.taskId).toBeUndefined();

    const page = await signIn('requester');
    const request = await RequestPage.open(page, id);
    await expect(page.getByTestId('failure-reason')).toHaveText(
      /^The scaffolder refused to start the template \(400 Bad Request\): .*ticket.*\.$/,
    );
    // Nothing ran, so there is no log to offer.
    await expect(request.taskLogLink).toHaveCount(0);

    // Posting the old values again could only be refused again, so they go
    // to the template's form instead, to be put right.
    await request.button('Resubmit').click();
    await expect(
      toast(
        page,
        /^Could not resubmit as it was: .+ The values are filled in on the template's form instead, to correct and submit again\.$/,
      ),
    ).toBeVisible();
    await expect(page).toHaveURL(
      new RegExp(`/create/templates/default/${template.name}\\?formData=`),
    );
    await expect(page.getByRole('textbox', { name: 'Target' })).toHaveValue(
      unique,
    );
    await expect(page.getByRole('textbox', { name: 'Ticket' })).toHaveValue('');
  });

  test('a deleted template is pointed out, and approving it fails', async ({
    signIn,
    apiAs,
    runtimeTemplate,
    unique,
  }) => {
    const template = runtimeTemplate('gone');
    await template.publish();
    const id = await apiAs('requester').create(template.ref, {
      target: unique,
    });
    await template.remove();
    expect((await apiAs('alice').read(id)).templateDrift).toEqual({
      changed: true,
      reasons: ['missing'],
    });

    const page = await signIn('alice');
    const request = await RequestPage.open(page, id);
    await expect(request.driftAlert).toContainText(MISSING);
    // The title falls back from the catalog's name to the ref's.
    await expect(request.detail('Template')).toContainText(template.name);

    await request.approve();
    const failed = await apiAs('alice').waitForStatus(id, 'failed');
    expect(failed.failureReason).toMatch(
      /^the scaffolder refused to start the template/,
    );
  });

  test('a template deleted and recreated under the same name is pointed out', async ({
    signIn,
    apiAs,
    runtimeTemplate,
    unique,
  }) => {
    const template = runtimeTemplate('replaced');
    await template.publish();
    const id = await apiAs('requester').create(template.ref, {
      target: unique,
    });
    await template.recreate();
    const drift = (await apiAs('alice').read(id)).templateDrift;
    expect(drift?.changed).toBe(true);
    expect(drift?.reasons).toContain('replaced');

    const page = await signIn('alice');
    const request = await RequestPage.open(page, id);
    await expect(request.driftAlert).toContainText(REPLACED);
  });

  test('a change nobody deciding needs to know about is not pointed out', async ({
    signIn,
    apiAs,
    runtimeTemplate,
    unique,
  }) => {
    const template = runtimeTemplate('reworded');
    await template.publish();
    const id = await apiAs('requester').create(template.ref, {
      target: unique,
    });
    await template.publish({ description: 'Reworded, nothing else' });

    expect(
      (await apiAs('alice').read(id)).templateDrift?.changed ?? false,
    ).toBe(false);
    const page = await signIn('alice');
    const request = await RequestPage.open(page, id);
    await expect(request.button('Approve')).toBeVisible();
    await expect(request.driftAlert).toHaveCount(0);
  });

  test('the gate’s terms are frozen at submit: approvers and quorum edited afterwards do not apply', async ({
    signIn,
    apiAs,
    runtimeTemplate,
    unique,
  }) => {
    const template = runtimeTemplate('policy');
    await template.publish();
    const id = await apiAs('requester').create(template.ref, {
      target: unique,
    });
    const before = await apiAs('alice').read(id);
    expect(before.policySnapshot).toMatchObject({
      approvers: ['group:default/devx-team'],
      quorum: 1,
    });

    // Stricter terms for anything submitted from now on.
    await template.publish({
      approvers: ['user:default/outsider'],
      quorum: 2,
    });
    const after = await apiAs('alice').read(id);
    expect(after.policySnapshot).toEqual(before.policySnapshot);

    // The page shows the terms the request was made under, and they hold:
    // one approval from devx-team is still enough.
    const page = await signIn('alice');
    const request = await RequestPage.open(page, id);
    await expect(request.panel).toContainText(
      'Needs one approval from DevX team.',
    );
    await request.approve();
    await expect(request.panelHeading).toHaveText(
      'Approved, and the template has run.',
    );

    // A new request gets the new terms.
    const later = await apiAs('requester').create(template.ref, {
      target: `${unique}-later`,
    });
    expect((await apiAs('requester').read(later)).policySnapshot).toMatchObject(
      { approvers: ['user:default/outsider'], quorum: 2 },
    );
  });
});
