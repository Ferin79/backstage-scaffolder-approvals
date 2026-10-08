import { expect, test } from './support/fixtures';
import { RequestPage, RequestsList } from './support/pages';

test.describe('what a request shows of its parameters', () => {
  test('every kind of value, by the titles the template’s form gave it', async ({
    signIn,
    apiAs,
    unique,
  }) => {
    const serviceName = `rich-${unique}`;
    const id = await apiAs('requester').create('e2e-rich-parameters', {
      serviceName,
      replicas: 3,
      public: true,
      regions: ['eu-west-1', 'us-east-1'],
      notes: 'First line\nSecond line',
      environments: [
        { name: 'staging', autoDeploy: false },
        { name: 'production', autoDeploy: true },
      ],
      owner: { team: 'devx-team', pager: 'devx-primary' },
      // The form hides `tuning` unless the mode is advanced, but keeps what
      // was typed into it before the mode changed.
      mode: 'simple',
      tuning: 'aggressive',
      // Sent through the API; no page of the form asks for it.
      sentDirectly: 'from a script',
    });

    const page = await signIn('alice');
    const request = await RequestPage.open(page, id);
    // The summary fills in the parameter it names.
    await expect(request.title).toHaveText(
      `Rich parameters for ${serviceName}`,
    );

    await expect(request.parameter('Service name')).toHaveText(serviceName);
    await expect(request.parameter('Replica count')).toHaveText('3');
    await expect(request.parameter('Publicly reachable')).toHaveText('Yes');
    await expect(request.parameter('Regions').getByRole('listitem')).toHaveText(
      ['eu-west-1', 'us-east-1'],
    );
    await expect(request.parameter('Notes')).toContainText('First line');
    await expect(request.parameter('Notes')).toContainText('Second line');
    await expect(request.parameter('Mode')).toHaveText('simple');

    // The key behind each title, for whoever needs it.
    await expect(
      request.card('Parameters').getByText('Service name', { exact: true }),
    ).toHaveAttribute('title', 'serviceName');

    // A list of objects, one block each, by the item schema's titles.
    const environments = request
      .parameter('Environments')
      .getByRole('listitem');
    await expect(environments).toHaveCount(2);
    await expect(environments.nth(0)).toContainText('Environment name');
    await expect(environments.nth(0)).toContainText('staging');
    await expect(environments.nth(0)).toContainText('Deploy automaticallyNo');
    await expect(environments.nth(1)).toContainText('production');
    await expect(environments.nth(1)).toContainText('Deploy automaticallyYes');

    // A nested object, as rows of its own.
    const ownership = request.parameter('Ownership');
    await expect(ownership).toContainText('Owning team');
    await expect(ownership).toContainText('devx-team');
    await expect(ownership).toContainText('Pager rotation');
    await expect(ownership).toContainText('devx-primary');

    // Set apart, and said why: both are part of what an approval runs.
    const hidden = request
      .card('Parameters')
      .locator('section')
      .filter({ hasText: 'Hidden by the form for these answers' });
    await expect(hidden).toContainText('Tuning profile');
    await expect(hidden).toContainText('aggressive');
    const undeclared = request
      .card('Parameters')
      .locator('section')
      .filter({ hasText: "Not in the template's form" });
    await expect(undeclared).toContainText('sentDirectly');
    await expect(undeclared).toContainText('from a script');
    await expect(undeclared).toContainText(
      'No page of the template asks for these; they were sent with the request directly.',
    );
  });

  test('a template with no summary and no parameters is named by its title, and says it takes none', async ({
    signIn,
    apiAs,
  }) => {
    // No values means every attempt would collapse into one request, so the
    // last attempt's is withdrawn first.
    await apiAs('requester').withdrawPending('template:default/e2e-no-summary');
    const id = await apiAs('requester').create('e2e-no-summary', {});
    expect((await apiAs('requester').read(id)).summary).toBeNull();

    const page = await signIn('requester');
    const request = await RequestPage.open(page, id);
    await expect(request.title).toHaveText('E2E without a summary');
    await expect(request.card('Parameters')).toContainText(
      'This template takes no parameters.',
    );

    const mine = new RequestsList(page);
    await mine.goto('mine');
    const row = mine.rows.filter({ hasText: 'E2E without a summary' }).first();
    await expect(row).toContainText('Awaiting approval');

    await apiAs('requester').withdraw(id);
  });
});
