import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { Person } from './support/api';
import {
  GATED_ANNOTATION,
  getEntity,
  runtimeLocationRef,
} from './support/catalog';
import { BACKEND_URL, RUN_STATE_DIR } from './support/env';
import { expect, test as setup } from './support/fixtures';

setup.describe.configure({ mode: 'serial' });

/** Each person, and the groups their sign-in must carry. */
const PEOPLE: Record<Person, string[]> = {
  requester: ['group:default/devx-team'],
  alice: ['group:default/devx-team'],
  bob: ['group:default/devx-team'],
  outsider: [],
  carol: [],
  newcomer: [],
  pager: [],
  dana: ['group:default/devx-platform'],
};

/** Templates the catalog module must have marked gated. */
const GATED_TEMPLATES = [
  'request-github-admin',
  'provision-service',
  'e2e-single',
  'e2e-self-approve',
  'e2e-expiring',
  'e2e-fails',
  'e2e-mixed-approvers',
  'e2e-no-summary',
  'e2e-home-card',
  'e2e-rich-parameters',
  // Refused by the plugin, but gated all the same: the card and the wizard
  // read the annotation first, then say what is wrong.
  'e2e-refused-if',
  'e2e-refused-secret',
  'e2e-refused-values',
  'e2e-refused-dynamic-approvers',
  'e2e-refused-not-first',
];

setup(
  'the catalog holds the people and templates the tests use',
  async ({ apiAs, playwright }) => {
    setup.setTimeout(5 * 60_000);

    // Signing in before the catalog has read the org data gives a token
    // without groups, and an approver with no groups approves nothing. These
    // sign-ins are not cached: each attempt asks again.
    const request = await playwright.request.newContext();
    for (const [person, groups] of Object.entries(PEOPLE)) {
      await expect
        .poll(
          async () => {
            const response = await request.get(
              `${BACKEND_URL}/api/auth/e2e/refresh`,
              { params: { user: person } },
            );
            if (!response.ok()) {
              return [`sign-in answered ${response.status()}`];
            }
            const body = await response.json();
            return body.backstageIdentity.identity.ownershipEntityRefs;
          },
          { message: `${person} signs in with their groups`, timeout: 120_000 },
        )
        .toEqual([`user:default/${person}`, ...groups]);
    }
    await request.dispose();

    const api = apiAs('alice');
    for (const name of GATED_TEMPLATES) {
      await expect
        .poll(
          async () =>
            (
              await getEntity(api, 'template', name)
            )?.metadata.annotations?.[GATED_ANNOTATION],
          { message: `${name} marked gated`, timeout: 120_000 },
        )
        .toBe('true');
    }
    const ungated = await getEntity(api, 'template', 'e2e-ungated');
    expect(ungated?.metadata.annotations?.[GATED_ANNOTATION]).toBeUndefined();

    await runtimeLocationRef(api);
  },
);

/**
 * Requests settled at the start of the run, for the retention project to
 * find past the redaction window at the end of it, plus one still pending,
 * which retention must leave alone however old it is.
 */
setup(
  'requests for the retention project to age',
  async ({ apiAs, unique }) => {
    const requester = apiAs('requester');
    const alice = apiAs('alice');

    const withdrawn = await requester.create('e2e-single', {
      target: `retention-withdrawn-${unique}`,
      reason: 'Settled at the start of the run',
    });
    await requester.withdraw(withdrawn);

    const completed = await requester.create('e2e-single', {
      target: `retention-completed-${unique}`,
    });
    await alice.approve(completed, 'Approved before redaction');
    await requester.waitForStatus(completed, 'completed');

    const failed = await requester.create('e2e-fails', {
      target: `retention-failed-${unique}`,
    });
    await alice.approve(failed);
    await requester.waitForStatus(failed, 'failed');

    const pending = await requester.create('e2e-single', {
      target: `retention-pending-${unique}`,
    });

    await mkdir(RUN_STATE_DIR, { recursive: true });
    await writeFile(
      join(RUN_STATE_DIR, 'retention.json'),
      JSON.stringify({ withdrawn, completed, failed, pending }, null, 2),
    );
  },
);
