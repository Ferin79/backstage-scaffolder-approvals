import { expect, type Locator, type Page } from '@playwright/test';

/** A toast the app posted, such as "Request approved". */
export function toast(page: Page, text: string | RegExp): Locator {
  return page.getByRole('alert').filter({ hasText: text });
}

/** The value beside a `<dt>` label, in a definition list inside `scope`. */
function definition(scope: Locator, label: string): Locator {
  return scope
    .locator('dt')
    .filter({ hasText: new RegExp(`^${label}$`) })
    .locator('xpath=following-sibling::dd[1]');
}

/**
 * One approval request's page.
 *
 * The page is four cards: the decision panel (where the request stands and
 * what the viewer can do), Details, Parameters and Activity.
 */
export class RequestPage {
  constructor(readonly page: Page) {}

  static async open(page: Page, id: string): Promise<RequestPage> {
    const requestPage = new RequestPage(page);
    await requestPage.goto(id);
    return requestPage;
  }

  async goto(id: string): Promise<void> {
    await this.page.goto(`/scaffolder-approvals/requests/${id}`);
    await expect(this.panelHeading).toBeVisible();
  }

  /** The request's name: its summary, or the template's title. */
  get title(): Locator {
    return this.page.getByRole('heading', { level: 2 }).first();
  }

  /** "Requested by Riley Requester", under the title. */
  get byline(): Locator {
    return this.page.getByText(/^Requested by /).first();
  }

  /** The status pill in the header, such as "Awaiting approval". */
  get status(): Locator {
    return definition(this.page.locator('body'), 'Status').first();
  }

  get panel(): Locator {
    return this.page.getByRole('article').first();
  }

  /** "1 of 2 approvals needed.", or what became of the request. */
  get panelHeading(): Locator {
    return this.panel.getByRole('heading', { level: 3 });
  }

  card(title: 'Details' | 'Parameters' | 'Activity'): Locator {
    return this.page.getByRole('article').filter({
      has: this.page.getByRole('heading', { name: title, exact: true }),
    });
  }

  detail(label: string): Locator {
    return definition(this.card('Details'), label);
  }

  parameter(title: string): Locator {
    return definition(this.card('Parameters'), title);
  }

  /** One entry of the Activity timeline, by who did it and what. */
  activity(text: string | RegExp): Locator {
    return this.card('Activity')
      .getByRole('listitem')
      .filter({ hasText: text });
  }

  button(name: 'Approve' | 'Deny' | 'Withdraw' | 'Resubmit'): Locator {
    return this.panel.getByRole('button', { name, exact: true });
  }

  get taskLogLink(): Locator {
    return this.panel.getByRole('link', { name: 'View task log' });
  }

  get driftAlert(): Locator {
    return this.page
      .getByRole('alert')
      .filter({ hasText: 'The template has changed' });
  }

  dialog(
    title:
      | 'Approve this request?'
      | 'Deny this request?'
      | 'Withdraw this request?',
  ): Locator {
    return this.page.getByRole('dialog', { name: title });
  }

  /** Approve through the dialog, with an optional comment. */
  async approve(comment?: string): Promise<void> {
    await this.button('Approve').click();
    const dialog = this.dialog('Approve this request?');
    if (comment) {
      await dialog.getByRole('textbox', { name: 'Comment' }).fill(comment);
    }
    await dialog.getByRole('button', { name: /^Approve( anyway)?$/ }).click();
    await expect(dialog).toBeHidden();
  }

  /** Deny through the dialog, with an optional comment. */
  async deny(comment?: string): Promise<void> {
    await this.button('Deny').click();
    const dialog = this.dialog('Deny this request?');
    if (comment) {
      await dialog.getByRole('textbox', { name: 'Comment' }).fill(comment);
    }
    await dialog.getByRole('button', { name: 'Deny', exact: true }).click();
    await expect(dialog).toBeHidden();
  }

  /** Withdraw through the confirmation dialog. */
  async withdraw(): Promise<void> {
    await this.button('Withdraw').click();
    const dialog = this.dialog('Withdraw this request?');
    await dialog.getByRole('button', { name: 'Withdraw', exact: true }).click();
    await expect(dialog).toBeHidden();
  }
}

/** "Waiting on you" and "Your requests". */
export class RequestsList {
  constructor(readonly page: Page) {}

  async goto(view: 'inbox' | 'mine'): Promise<void> {
    await this.page.goto(
      view === 'inbox' ? '/scaffolder-approvals' : '/scaffolder-approvals/mine',
    );
    await expect(this.table.or(this.empty)).toBeVisible();
  }

  get table(): Locator {
    return this.page.getByRole('grid', { name: 'Data table' });
  }

  /** The list's empty state, such as "Nothing is waiting on you". */
  get empty(): Locator {
    return this.page.getByRole('heading', { level: 3 }).filter({
      hasText:
        /^(Nothing is waiting on you|You have not asked for anything yet)$/,
    });
  }

  /** The row for a request, found by its summary or anything else in it. */
  row(text: string | RegExp): Locator {
    return this.table.getByRole('row').filter({ hasText: text });
  }

  /** Every row of the current page, without the header. */
  get rows(): Locator {
    return this.table.getByRole('rowgroup').nth(1).getByRole('row');
  }

  /** "1 - 10 of 12". */
  get range(): Locator {
    return this.page.getByText(/^\d+ - \d+ of \d+$/);
  }

  get nextPage(): Locator {
    return this.page.getByRole('button', { name: 'Next table page' });
  }

  get previousPage(): Locator {
    return this.page.getByRole('button', { name: 'Previous table page' });
  }

  tab(name: 'Waiting on you' | 'Your requests'): Locator {
    return this.page.getByRole('tab', { name });
  }

  /**
   * The row for a request on whichever page it is on. Tests in parallel keep
   * adding requests as the same people, so one made a while ago may have
   * been pushed off the first page, newest first.
   */
  async findRow(text: string): Promise<Locator> {
    const row = this.row(text);
    for (;;) {
      await expect(this.range).toBeVisible();
      if ((await row.count()) > 0 || !(await this.nextPage.isEnabled())) {
        break;
      }
      const range = await this.range.textContent();
      await this.nextPage.click();
      await expect(this.range).not.toHaveText(range!);
    }
    await expect(row, `a row for ${text} on some page`).toHaveCount(1);
    return row;
  }
}
