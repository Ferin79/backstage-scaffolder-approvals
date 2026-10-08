import type { Page } from '@playwright/test';
import { DISPLAY_NAME } from './support/api';
import { expect, test } from './support/fixtures';
import { RequestPage, RequestsList } from './support/pages';

/** The home page's approvals card. */
const homeCard = (page: Page) =>
  page
    .locator('[class*="MuiCard-root"]')
    .filter({ has: page.getByRole('link', { name: 'Open approvals' }) });

test.describe('where approvers notice what is waiting', () => {
  test('the home page card counts what is waiting on you, and keeps count live', async ({
    signIn,
    apiAs,
    unique,
  }) => {
    // Carol approves e2e-home-card and nothing else, so the count is exactly
    // this test's requests; an earlier attempt's are withdrawn first.
    const requester = apiAs('requester');
    await requester.withdrawPending('template:default/e2e-home-card');

    const page = await signIn('carol');
    await page.goto('/');
    const card = homeCard(page);
    await expect(card).toContainText('0Nothing is waiting on you.');
    await expect(card.getByRole('link', { name: 'Review them' })).toHaveCount(
      0,
    );

    const first = await requester.create('e2e-home-card', {
      target: `${unique}-first`,
    });
    await expect(card).toContainText('1request is waiting on your decision.');

    const second = await requester.create('e2e-home-card', {
      target: `${unique}-second`,
    });
    await expect(card).toContainText('2requests are waiting on your decision.');

    await card.getByRole('link', { name: 'Review them' }).click();
    await expect(page).toHaveURL(/\/scaffolder-approvals$/);
    const inbox = new RequestsList(page);
    await expect(inbox.rows).toHaveCount(2);
    await expect(inbox.rows.nth(0)).toContainText(
      `Counted for ${unique}-second`,
    );
    await expect(inbox.rows.nth(1)).toContainText(
      `Counted for ${unique}-first`,
    );

    // Deciding takes a request out of the count.
    await inbox.row(`Counted for ${unique}-first`).click();
    await new RequestPage(page).approve();
    await page.goto('/');
    await expect(card).toContainText('1request is waiting on your decision.');

    // So does the requester withdrawing it, while the page is open.
    await requester.withdraw(second);
    await expect(card).toContainText('0Nothing is waiting on you.');

    await card.getByRole('link', { name: 'Open approvals' }).click();
    await expect(page).toHaveURL(/\/scaffolder-approvals$/);
    await expect(inbox.empty).toHaveText('Nothing is waiting on you');
    expect((await requester.read(first)).status).not.toBe('pending');
  });

  test('the inbox fills and empties live, without a reload', async ({
    signIn,
    apiAs,
    unique,
  }) => {
    const page = await signIn('bob');
    const inbox = new RequestsList(page);
    await inbox.goto('inbox');
    const summary = `Single approval for ${unique}`;
    await expect(inbox.row(summary)).toHaveCount(0);

    const id = await apiAs('requester').create('e2e-single', {
      target: unique,
    });
    const row = inbox.row(summary);
    await expect(row).toBeVisible();
    await expect(row).toContainText(DISPLAY_NAME.requester);
    await expect(row).toContainText('just now');

    await apiAs('alice').approve(id);
    await expect(row).toHaveCount(0);
  });

  test('“Your requests” lists everything asked for, newest first, a page at a time', async ({
    signIn,
    apiAs,
    unique,
  }) => {
    // Pager asks for things and approves nothing.
    const pager = apiAs('pager');
    const targets = Array.from({ length: 12 }, (_, i) => `${unique}-${i + 1}`);
    for (const target of targets) {
      await pager.create('e2e-single', { target });
    }
    const { totalItems } = await pager.listItems({ role: 'requester' });

    const page = await signIn('pager');
    const mine = new RequestsList(page);
    await mine.goto('mine');

    // Every row is the viewer's own, so there is no "Requested by" column.
    await expect(
      mine.table.getByRole('columnheader', { name: 'Requested by' }),
    ).toHaveCount(0);
    await expect(mine.rows).toHaveCount(10);
    await expect(mine.range).toHaveText(`1 - 10 of ${totalItems}`);
    await expect(mine.rows.nth(0)).toContainText(
      `Single approval for ${unique}-12`,
    );
    await expect(mine.previousPage).toBeDisabled();

    await mine.nextPage.click();
    await expect(mine.range).toHaveText(
      `11 - ${Math.min(20, totalItems)} of ${totalItems}`,
    );
    await expect(mine.rows.nth(0)).toContainText(
      `Single approval for ${unique}-2`,
    );
    await expect(mine.rows.nth(1)).toContainText(
      `Single approval for ${unique}-1`,
    );

    await mine.previousPage.click();
    await expect(mine.range).toHaveText(`1 - 10 of ${totalItems}`);

    // The inbox does have the column: there, who asked matters.
    const alicePage = await signIn('alice');
    const inbox = new RequestsList(alicePage);
    await inbox.goto('inbox');
    await expect(
      inbox.table.getByRole('columnheader', { name: 'Requested by' }),
    ).toBeVisible();

    for (const { id } of (
      await pager.listItems({
        role: 'requester',
        status: 'pending',
        limit: 200,
      })
    ).items) {
      await pager.cancel(id);
    }
  });

  test('a notification leads the approver to the request', async ({
    signIn,
    apiAs,
    unique,
  }) => {
    const summary = `Single approval for ${unique}`;
    const id = await apiAs('requester').create('e2e-single', {
      target: unique,
    });
    await apiAs('alice').waitForNotification(unique, 'Approval requested');

    const page = await signIn('alice');
    await page.goto('/notifications');
    const row = page
      .getByRole('row')
      .filter({ hasText: `requester is asking to run ${summary}` });
    const link = row.getByRole('link', { name: /Approval requested/ });
    await expect(link).toHaveAttribute(
      'href',
      new RegExp(`/scaffolder-approvals/requests/${id}$`),
    );

    await page.goto((await link.getAttribute('href'))!);
    await expect(new RequestPage(page).title).toHaveText(summary);
  });
});
