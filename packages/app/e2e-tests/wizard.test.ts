import type { Page } from '@playwright/test';
import { DISPLAY_NAME } from './support/api';
import { expect, test } from './support/fixtures';
import { RequestPage, toast } from './support/pages';

/** Fill request-github-admin's one page and go to the last step. */
async function fillGitHubAdminForm(
  page: Page,
  repository: string,
  justification: string,
) {
  await page.goto('/create/templates/default/request-github-admin');
  await page.getByRole('textbox', { name: 'Repository' }).fill(repository);
  await page.getByRole('textbox', { name: 'Why' }).fill(justification);
  await page.getByRole('button', { name: 'Review' }).click();
}

const approvalNotice = (page: Page) =>
  page
    .getByRole('article')
    .filter({ hasText: 'This template needs approval' })
    // The innermost: the page's content is an article too.
    .last();

test.describe('the wizard of a gated template', () => {
  test('the last step asks for approval instead of running, and lands on the new request', async ({
    signIn,
    apiAs,
    unique,
  }) => {
    const page = await signIn('requester');
    const repository = `acme/wizard-${unique}`;
    const justification = 'On call for payments this quarter';

    // The template's own validation still applies before the last step.
    await fillGitHubAdminForm(page, repository, 'too short');
    await expect(
      page.getByText("'Why' must NOT have fewer than 10 characters"),
    ).toBeVisible();
    await expect(approvalNotice(page)).toHaveCount(0);
    await page.getByRole('textbox', { name: 'Why' }).fill(justification);
    await page.getByRole('button', { name: 'Review' }).click();

    // What will be asked for, and of whom.
    await expect(
      page.getByRole('row', { name: `Repository ${repository}` }),
    ).toBeVisible();
    await expect(
      page.getByRole('row', { name: `Why ${justification}` }),
    ).toBeVisible();
    const notice = approvalNotice(page);
    await expect(notice).toContainText(
      'Submitting does not run it. It creates a request, and the template runs on its own once the approvers below agree.',
    );
    await expect(notice).toContainText(
      'Needs 2 approvals from DevX team. The requester cannot approve their own request.',
    );
    // In a new tab: following it in this one would lose the form.
    await expect(
      notice.getByRole('link', { name: 'DevX team' }),
    ).toHaveAttribute('target', '_blank');
    await expect(page.getByRole('button', { name: 'Create' })).toHaveCount(0);

    // Back keeps what was filled in.
    await page.getByRole('button', { name: 'Back' }).click();
    await expect(page.getByRole('textbox', { name: 'Repository' })).toHaveValue(
      repository,
    );
    await page.getByRole('button', { name: 'Review' }).click();

    await page.getByRole('button', { name: 'Request approval' }).click();
    await expect(toast(page, 'Approval requested')).toBeVisible();
    await expect(page).toHaveURL(
      /\/scaffolder-approvals\/requests\/[0-9a-f-]{36}$/,
    );
    const id = page.url().split('/').pop()!;

    const request = new RequestPage(page);
    await expect(request.title).toHaveText(`Admin on ${repository}`);
    await expect(request.byline).toHaveText(
      `Requested by ${DISPLAY_NAME.requester}`,
    );
    await expect(request.status).toHaveText('Awaiting approval');
    await expect(request.panelHeading).toHaveText('0 of 2 approvals needed.');
    await expect(request.parameter('Repository')).toHaveText(repository);
    await expect(request.parameter('Why')).toHaveText(justification);
    await expect(request.detail('Template')).toHaveText(
      'Request GitHub admin access',
    );
    await expect(request.detail('Expires')).toHaveText('in 3 days');
    await expect(
      request.activity(`${DISPLAY_NAME.requester} requested approval`),
    ).toBeVisible();
    await expect(request.card('Activity')).toContainText(
      'Nobody has decided yet.',
    );

    // Stored exactly as filled in, with the gate's terms frozen.
    const stored = await apiAs('requester').read(id);
    expect(stored).toMatchObject({
      status: 'pending',
      templateRef: 'template:default/request-github-admin',
      requesterRef: 'user:default/requester',
      values: { repository, justification },
      summary: `Admin on ${repository}`,
      policySnapshot: {
        approvers: ['group:default/devx-team'],
        quorum: 2,
        selfApprove: false,
        timeout: { hours: 72 },
      },
    });

    // The approvers hear about it; the requester, an approver too, does not.
    const notification = await apiAs('alice').waitForNotification(
      repository,
      'Approval requested',
    );
    expect(notification.payload.description).toBe(
      `requester is asking to run Admin on ${repository}`,
    );
    expect(notification.payload.link).toMatch(
      new RegExp(`/scaffolder-approvals/requests/${id}$`),
    );
    await apiAs('bob').waitForNotification(repository, 'Approval requested');
    expect(await apiAs('requester').notifications(repository)).toEqual([]);
  });

  test('submitting the same answers again opens the request already waiting', async ({
    signIn,
    apiAs,
    unique,
  }) => {
    const repository = `acme/duplicate-${unique}`;
    const justification = 'Asked twice by accident';
    const first = await apiAs('requester').create('request-github-admin', {
      repository,
      justification,
    });

    const page = await signIn('requester');
    await fillGitHubAdminForm(page, repository, justification);
    await page.getByRole('button', { name: 'Request approval' }).click();

    await expect(
      toast(page, 'You already have an identical request open'),
    ).toBeVisible();
    await expect(page).toHaveURL(
      new RegExp(`/scaffolder-approvals/requests/${first}$`),
    );
  });

  test('the form can be pre-filled from the address, as Resubmit does', async ({
    signIn,
    unique,
  }) => {
    const page = await signIn('requester');
    const formData = JSON.stringify({ target: `prefilled-${unique}` });
    await page.goto(
      `/create/templates/default/e2e-single?formData=${encodeURIComponent(
        formData,
      )}`,
    );
    await expect(page.getByRole('textbox', { name: 'Target' })).toHaveValue(
      `prefilled-${unique}`,
    );
  });

  const refused: [template: string, problem: RegExp][] = [
    [
      'e2e-refused-if',
      /e2e-refused-if has an unusable gate: 'approval:gate' must not carry an 'if:' condition/,
    ],
    [
      'e2e-refused-secret',
      /e2e-refused-secret cannot be gated: its parameter\(s\) token are secret-typed/,
    ],
    [
      'e2e-refused-values',
      /e2e-refused-values has an unusable gate: 'approval:gate' has no 'values' input/,
    ],
    [
      'e2e-refused-dynamic-approvers',
      /e2e-refused-dynamic-approvers has an unusable gate policy: approvers\[0\] is a template expression/,
    ],
    [
      'e2e-refused-not-first',
      /e2e-refused-not-first has an unusable gate: 'approval:gate' must be the first step/,
    ],
  ];

  for (const [template, problem] of refused) {
    test(`a template the plugin refuses explains why at the last step: ${template}`, async ({
      signIn,
    }) => {
      const page = await signIn('requester');
      await page.goto(`/create/templates/default/${template}`);
      await page.getByRole('button', { name: 'Review' }).click();

      const alert = page
        .getByRole('alert')
        .filter({ hasText: 'This template cannot be requested yet' });
      await expect(alert).toContainText(problem);
      await expect(alert).toContainText(
        'The problem is in the template, not in what you filled in.',
      );
      await expect(
        page.getByRole('button', { name: 'Request approval' }),
      ).toHaveCount(0);
      await expect(page.getByRole('button', { name: 'Create' })).toHaveCount(0);
      await expect(page.getByRole('button', { name: 'Back' })).toBeEnabled();
    });
  }
});

test.describe('the wizard of an ungated template', () => {
  test('keeps the scaffolder’s own Create, and runs straight away', async ({
    signIn,
    unique,
  }) => {
    const page = await signIn('requester');
    await page.goto('/create/templates/default/e2e-ungated');
    await page.getByRole('textbox', { name: 'Target' }).fill(unique);
    await page.getByRole('button', { name: 'Review' }).click();

    await expect(
      page.getByRole('row', { name: `Target ${unique}` }),
    ).toBeVisible();
    await expect(approvalNotice(page)).toHaveCount(0);
    await page.getByRole('button', { name: 'Create' }).click();

    await expect(page).toHaveURL(/\/create\/tasks\/[0-9a-f-]{36}$/);
    await expect(
      page.getByText(`E2E-UNGATED ran for ${unique}`).first(),
    ).toBeVisible({ timeout: 60_000 });
  });
});
