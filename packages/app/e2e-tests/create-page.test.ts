import type { Locator, Page } from '@playwright/test';
import { expect, test as base } from './support/fixtures';

/** A template's card on the Create page, by its title. */
function card(page: Page, title: string): Locator {
  return page
    .locator('[class*="MuiCard-root"]')
    .filter({ has: page.getByRole('heading', { name: title, exact: true }) });
}

const REFUSED = [
  'E2E refused - if on the gate',
  'E2E refused - secret parameter',
  'E2E refused - no values',
  'E2E refused - approvers from a parameter',
  'E2E refused - gate not first',
];

/** The Create page, as the requester, once its templates have loaded. */
const test = base.extend<{ createPage: Page }>({
  createPage: async ({ signIn }, provide) => {
    // The scaffolder's Create page sometimes stays on a page-wide loading bar
    // while the catalog is busy, with no request left in flight; a fresh
    // page recovers. It is the scaffolder's own page: it happens without the
    // gated card installed too, so it is waited out here rather than tested.
    let page = await signIn('requester');
    for (let attempt = 1; ; attempt++) {
      await page.goto('/create');
      try {
        await card(page, 'E2E single approval').waitFor({ timeout: 20_000 });
        break;
      } catch (error) {
        if (attempt === 4) {
          throw error;
        }
        await page.close();
        page = await signIn('requester');
      }
    }
    await provide(page);
  },
});

test.describe('gated templates on the Create page', () => {
  test('a gated template names its approvers, linked to their catalog page', async ({
    createPage: page,
  }) => {
    const gated = card(page, 'Request GitHub admin access');
    const approver = gated.getByRole('link', { name: 'Approver: DevX team' });
    await expect(approver).toHaveAttribute(
      'href',
      '/catalog/default/group/devx-team',
    );

    await approver.click();
    await expect(page).toHaveURL(/\/catalog\/default\/group\/devx-team/);
    await expect(
      page
        .getByText('Owns developer experience, and approves access requests')
        .first(),
    ).toBeVisible();
  });

  test('every approver is named, users as well as groups, in the order the gate lists them', async ({
    createPage: page,
  }) => {
    const links = card(page, 'E2E mixed approvers').getByRole('link', {
      name: /^Approver: /,
    });
    await expect(links).toHaveText([
      'Approver: DevX team',
      'Approver: Oscar Outsider',
    ]);
    await expect(links.nth(1)).toHaveAttribute(
      'href',
      '/catalog/default/user/outsider',
    );
  });

  test('the production-shaped example is gated too', async ({
    createPage: page,
  }) => {
    await expect(
      card(page, 'Provision a production service').getByRole('link', {
        name: 'Approver: DevX team',
      }),
    ).toBeVisible();
  });

  for (const title of REFUSED) {
    test(`a gate the plugin refuses is not dressed up with approvers: ${title}`, async ({
      createPage: page,
    }) => {
      const refused = card(page, title);
      await expect(
        refused.getByRole('link', { name: 'Needs approval' }),
      ).toHaveAttribute('href', '/scaffolder-approvals');
      await expect(
        refused.getByRole('link', { name: /^Approver: / }),
      ).toHaveCount(0);
    });
  }

  test('an ungated template says nothing about approval', async ({
    createPage: page,
  }) => {
    const ungated = card(page, 'E2E ungated');
    await expect(ungated.getByRole('button', { name: 'Choose' })).toBeVisible();
    await expect(
      ungated.getByRole('link', { name: /^Approver: |^Needs approval$/ }),
    ).toHaveCount(0);
  });

  test('choosing a gated template opens its form', async ({
    createPage: page,
  }) => {
    await card(page, 'E2E single approval')
      .getByRole('button', { name: 'Choose' })
      .click();
    await expect(page).toHaveURL(/\/create\/templates\/default\/e2e-single$/);
    await expect(page.getByRole('textbox', { name: 'Target' })).toBeVisible();
  });
});
