import { expect, test } from './support/fixtures';
import { RequestPage, toast } from './support/pages';

/**
 * examples/scaffolder-approvals/provision-service: four pages of every kind
 * of input, conditional fields, and fifteen steps after the gate.
 */
function provisionValues(name: string): Record<string, unknown> {
  return {
    name,
    displayName: 'Payments ledger',
    description: 'Keeps the ledger of every payment taken, for audit.',
    owner: 'group:default/devx-team',
    lifecycle: 'production',
    tags: ['payments', 'ledger'],
    language: 'typescript',
    nodeVersion: '22',
    tier: 'tier-1',
    replicas: 3,
    cpu: 0.5,
    memoryMb: 512,
    containerised: true,
    baseImage: 'gcr.io/distroless/nodejs22-debian12:nonroot',
    regions: ['eu-west-1', 'us-east-1'],
    alertChannels: ['slack'],
    environments: [
      {
        name: 'development',
        url: 'https://dev.example.com',
        autoDeploy: true,
        minReplicas: 1,
      },
    ],
    launchDate: '2026-12-01',
    featureFlags: ['new-ledger'],
    oncall: {
      primaryContact: 'oncall@example.com',
      escalationMinutes: 15,
      pagerEnabled: true,
    },
    includeDocs: true,
    dataClassification: 'internal',
    publish: false,
    acceptPolicy: true,
    requestedVia: 'backstage-scaffolder',
  };
}

test.describe('the production-shaped example template', () => {
  test('its four pages end in a request for approval, not a run', async ({
    signIn,
    apiAs,
    unique,
  }) => {
    const name = `svc-${unique}`.slice(0, 40);
    const values = provisionValues(name);
    const page = await signIn('requester');
    await page.goto(
      `/create/templates/default/provision-service?formData=${encodeURIComponent(
        JSON.stringify(values),
      )}`,
    );

    for (const step of ['Runtime', 'Delivery', 'Access and compliance']) {
      await page.getByRole('button', { name: 'Next' }).click();
      await expect(page.getByText(step, { exact: true }).first()).toBeVisible();
    }
    await page.getByRole('button', { name: 'Review' }).click();

    const notice = page
      .getByRole('article')
      .filter({ hasText: 'This template needs approval' })
      .last();
    await expect(notice).toContainText(
      'Needs 2 approvals from DevX team. The requester cannot approve their own request.',
    );
    await expect(page.getByRole('row', { name: `Name ${name}` })).toBeVisible();

    await page.getByRole('button', { name: 'Request approval' }).click();
    await expect(toast(page, 'Approval requested')).toBeVisible();
    const request = new RequestPage(page);
    await expect(request.title).toHaveText(
      `Provision ${name} (tier-1, production)`,
    );
    await expect(request.parameter('Name')).toHaveText(name);
    await expect(request.parameter('Node.js version')).toHaveText('22');
    await expect(request.detail('Expires')).toHaveText('in 7 days');

    const id = page.url().split('/').pop()!;
    const stored = await apiAs('requester').read(id);
    expect(stored.values).toMatchObject({
      name,
      language: 'typescript',
      nodeVersion: '22',
      environments: values.environments,
      oncall: values.oncall,
    });
    await apiAs('requester').withdraw(id);
  });

  test('runs all its steps once two approvers agree, as the people involved', async ({
    signIn,
    apiAs,
    unique,
  }) => {
    test.setTimeout(180_000);
    const name = `run-${unique}`.slice(0, 40);
    const id = await apiAs('requester').create('provision-service', {
      ...provisionValues(name),
      // Left from before the language changed: the form keeps it, so the
      // request shows it apart from the rest.
      goVersion: '1.24',
    });

    const page = await signIn('requester');
    const request = await RequestPage.open(page, id);
    const hidden = request
      .card('Parameters')
      .locator('section')
      .filter({ hasText: 'Hidden by the form for these answers' });
    await expect(hidden).toContainText('Go version');
    await expect(hidden).toContainText('1.24');

    await apiAs('alice').approve(id);
    await apiAs('bob').approve(id, 'Ship it');

    await expect(request.panelHeading).toHaveText(
      'Approved, and the template has run.',
      { timeout: 90_000 },
    );
    const done = await apiAs('requester').read(id);
    const log = await apiAs('requester').taskLog(done.taskId!);
    expect(log).toContain(`Generated ${name}; component entity valid: true`);

    // Its last step notifies the requester, named from the gate's outputs.
    const provisioned = await apiAs('requester').waitForNotification(
      name,
      `${name} has been provisioned`,
    );
    expect(provisioned.payload.description).toBe(
      'Approved by user:default/alice, user:default/bob.',
    );
    expect(provisioned.payload.link).toMatch(
      new RegExp(`/scaffolder-approvals/requests/${id}$`),
    );
  });
});
