import { test as base, type BrowserContext, type Page } from '@playwright/test';
import { BackstageApi, type Person } from './api';
import { RuntimeTemplate } from './catalog';
import { APP_URL, BACKEND_URL } from './env';

/** Where the sign-in page remembers which provider to use. */
const SIGN_IN_PROVIDER_KEY = '@backstage/core:SignInPage:provider';

/**
 * Sign a browser context in as `person`, with no backend restart.
 *
 * The app signs in through the guest provider, which is one fixed user per
 * backend. Its refresh call is answered by the e2e provider instead, which
 * signs in as the catalog user named in the query, groups and all. The
 * remembered provider makes the sign-in page do it without a click.
 */
export async function signInContext(
  context: BrowserContext,
  person: Person,
): Promise<void> {
  await context.addInitScript(key => {
    try {
      window.localStorage.setItem(key, 'guest');
    } catch {
      // A frame with an opaque origin, which has no storage and no sign-in.
    }
  }, SIGN_IN_PROVIDER_KEY);
  await context.route(/\/api\/auth\/guest\/refresh/, route =>
    route.continue({
      url: `${BACKEND_URL}/api/auth/e2e/refresh?user=${person}`,
    }),
  );
}

type Fixtures = {
  /**
   * A page signed in as `person`, in a browser context of its own, so one
   * test can have several people looking at the same request at once.
   */
  signIn: (person: Person) => Promise<Page>;
  /** The backend's REST API, signed in as `person`. */
  apiAs: (person: Person) => BackstageApi;
  /**
   * Unique to this test and attempt, for values that make its requests its
   * own: tests run in parallel against one backend, and a retry must not
   * collapse into the request its first attempt made.
   */
  unique: string;
  /** A template this test may write, edit and delete; removed afterwards. */
  runtimeTemplate: (label: string) => RuntimeTemplate;
};

export const test = base.extend<Fixtures>({
  signIn: async ({ browser }, provide) => {
    const contexts: BrowserContext[] = [];
    await provide(async person => {
      const context = await browser.newContext({ baseURL: APP_URL });
      contexts.push(context);
      await signInContext(context, person);
      return context.newPage();
    });
    await Promise.all(contexts.map(context => context.close()));
  },

  apiAs: async ({ playwright }, provide) => {
    const request = await playwright.request.newContext();
    await provide(person => new BackstageApi(request, person));
    await request.dispose();
  },

  // eslint-disable-next-line no-empty-pattern
  unique: async ({}, provide, testInfo) => {
    const time = Date.now().toString(36);
    const random = Math.random().toString(36).slice(2, 6);
    await provide(
      `w${testInfo.workerIndex}r${testInfo.retry}-${time}${random}`,
    );
  },

  runtimeTemplate: async ({ apiAs, unique }, provide) => {
    const created: RuntimeTemplate[] = [];
    await provide(label => {
      const template = new RuntimeTemplate(
        apiAs('alice'),
        `rt-${label}-${unique}`.slice(0, 63),
      );
      created.push(template);
      return template;
    });
    for (const template of created) {
      await template.dispose();
    }
  },
});

export { expect } from '@playwright/test';
