import { expect, test } from './support/fixtures';
import { RequestPage, RequestsList } from './support/pages';

test.describe('finding your way around the approvals pages', () => {
  test('the sidebar opens the inbox, and the tabs switch between the two lists', async ({
    signIn,
  }) => {
    // Newcomer has asked for nothing and approves nothing.
    const page = await signIn('newcomer');
    await page.goto('/');
    await page
      .getByRole('navigation', { name: 'sidebar nav' })
      .getByRole('link', { name: 'Approvals' })
      .click();

    const list = new RequestsList(page);
    await expect(page).toHaveURL(/\/scaffolder-approvals$/);
    await expect(page).toHaveTitle(/^Approvals \| Scaffolded Backstage App$/);
    await expect(list.tab('Waiting on you')).toHaveAttribute(
      'aria-selected',
      'true',
    );
    await expect(
      page.getByRole('heading', { name: 'Waiting on you', level: 2 }),
    ).toBeVisible();
    await expect(list.empty).toHaveText('Nothing is waiting on you');
    await expect(
      page.getByText('Requests you can decide on will appear here.'),
    ).toBeVisible();

    await list.tab('Your requests').click();
    await expect(page).toHaveURL(/\/scaffolder-approvals\/mine$/);
    await expect(page).toHaveTitle(
      /^Your requests \| Scaffolded Backstage App$/,
    );
    await expect(list.tab('Your requests')).toHaveAttribute(
      'aria-selected',
      'true',
    );
    await expect(list.empty).toHaveText('You have not asked for anything yet');
    await expect(
      page.getByText(
        'Gated templates you submit will appear here with their progress.',
      ),
    ).toBeVisible();

    // The tabs are addresses, so the browser's history follows them.
    await page.goBack();
    await expect(page).toHaveURL(/\/scaffolder-approvals$/);
    await expect(list.empty).toHaveText('Nothing is waiting on you');
  });

  test('a request opened from the inbox goes back to the inbox, and its plugin title leads there too', async ({
    signIn,
    apiAs,
    unique,
  }) => {
    const id = await apiAs('requester').create('e2e-single', {
      target: unique,
    });
    const page = await signIn('alice');
    const inbox = new RequestsList(page);
    await inbox.goto('inbox');

    await inbox.row(`Single approval for ${unique}`).click();
    await expect(page).toHaveURL(
      new RegExp(`/scaffolder-approvals/requests/${id}$`),
    );
    const request = new RequestPage(page);
    await expect(request.title).toHaveText(`Single approval for ${unique}`);
    // A request belongs to neither list, so the tabs are not offered.
    await expect(page.getByRole('tab')).toHaveCount(0);

    await page.goBack();
    await expect(inbox.row(`Single approval for ${unique}`)).toBeVisible();

    await inbox.row(`Single approval for ${unique}`).click();
    await expect(request.title).toHaveText(`Single approval for ${unique}`);
    await page
      .getByRole('heading', { level: 1 })
      .getByRole('link', { name: 'Approvals' })
      .click();
    await expect(page).toHaveURL(/\/scaffolder-approvals$/);
    await expect(inbox.tab('Waiting on you')).toHaveAttribute(
      'aria-selected',
      'true',
    );
  });

  test('a link to a request that does not exist says so, and leads back', async ({
    signIn,
  }) => {
    const page = await signIn('newcomer');
    await page.goto(
      '/scaffolder-approvals/requests/00000000-0000-4000-8000-000000000000',
    );

    await expect(
      page.getByRole('heading', { name: 'No such approval request' }),
    ).toBeVisible();
    await expect(
      page.getByText(
        'Nothing matches this link. It may have been mistyped, or it may belong to another Backstage instance.',
      ),
    ).toBeVisible();
    await expect(page).toHaveTitle(
      /Approval request \| Scaffolded Backstage App/,
    );

    await page.getByRole('link', { name: 'Back to approvals' }).click();
    await expect(page).toHaveURL(/\/scaffolder-approvals$/);
  });

  test('a link that is not a request id at all says so', async ({ signIn }) => {
    const page = await signIn('newcomer');
    await page.goto('/scaffolder-approvals/requests/not-a-request-id');

    await expect(
      page.getByRole('heading', {
        name: 'This is not a link to an approval request',
      }),
    ).toBeVisible();
    await expect(
      page.getByText(
        'The address does not contain a request id. Check that it was copied in full.',
      ),
    ).toBeVisible();
    await expect(
      page.getByRole('link', { name: 'Back to approvals' }),
    ).toHaveAttribute('href', '/scaffolder-approvals');
  });

  test('a request that cannot be loaded for another reason shows the error', async ({
    signIn,
    apiAs,
    unique,
  }) => {
    const id = await apiAs('requester').create('e2e-single', {
      target: unique,
    });
    const page = await signIn('requester');
    await page.route(`**/api/scaffolder-approvals/requests/${id}`, route =>
      route.fulfill({
        status: 503,
        contentType: 'application/json',
        body: JSON.stringify({
          error: {
            name: 'ServiceUnavailableError',
            message: 'Down for maintenance',
          },
          response: { statusCode: 503 },
        }),
      }),
    );
    await page.goto(`/scaffolder-approvals/requests/${id}`);

    await expect(
      page.getByText('Could not load this approval request'),
    ).toBeVisible();
    await expect(
      page.getByText('Down for maintenance (HTTP 503)'),
    ).toBeVisible();
    await expect(
      page.getByRole('link', { name: 'Back to approvals' }),
    ).toBeVisible();
  });
});
