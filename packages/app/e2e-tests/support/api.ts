import {
  type APIRequestContext,
  type APIResponse,
  expect,
} from '@playwright/test';
import { BACKEND_URL } from './env';

/**
 * Everyone a test can sign in as. requester, alice, bob and outsider come
 * from examples/scaffolder-approvals/org.yaml; the rest from
 * e2e-tests/catalog/org.yaml, where each says what it is for.
 */
export type Person =
  | 'requester'
  | 'alice'
  | 'bob'
  | 'outsider'
  | 'carol'
  | 'newcomer'
  | 'pager'
  | 'dana';

/** How the catalog names each person, which is how the UI shows them. */
export const DISPLAY_NAME: Record<Person, string> = {
  requester: 'Riley Requester',
  alice: 'Alice Approver',
  bob: 'Bob Approver',
  outsider: 'Oscar Outsider',
  carol: 'Carol Counter',
  newcomer: 'Nina Newcomer',
  pager: 'Paige Pager',
  dana: 'Dana Nested',
};

export type RequestStatus =
  | 'pending'
  | 'approved'
  | 'running'
  | 'completed'
  | 'failed'
  | 'rejected'
  | 'cancelled'
  | 'expired';

export interface ApprovalDecision {
  id: string;
  requestId: string;
  approverRef: string;
  decision: 'approve' | 'deny';
  comment?: string;
  createdAt: string;
}

/** The backend's request object; see docs/api-reference.md. */
export interface ApprovalRequest {
  id: string;
  templateRef: string;
  requesterRef: string;
  status: RequestStatus;
  values: Record<string, unknown> | null;
  valuesHash: string;
  summary: string | null;
  policySnapshot: {
    approvers: string[];
    quorum: number;
    selfApprove: boolean;
    timeout?: Record<string, number>;
    summary?: string;
  };
  taskId?: string;
  failureReason?: string;
  createdAt: string;
  updatedAt: string;
  expiresAt?: string;
  decidedAt?: string;
  redactedAt?: string;
  templateStepsHash?: string;
  decisions?: ApprovalDecision[];
  templateDrift?: { changed: boolean; reasons: string[] };
}

export interface NotificationRecord {
  id: string;
  user: string;
  read: string | null;
  payload: {
    title: string;
    description?: string;
    link?: string;
    severity: string;
    scope?: string;
  };
}

export type Sweep = 'reconcile' | 'timeouts' | 'retention';

type Query = Record<string, string | number | boolean> | URLSearchParams;

/** One sign-in per person per worker: tokens last an hour, a run less. */
const tokens = new Map<Person, Promise<string>>();

/** A Backstage user token for `person`, from the e2e sign-in provider. */
export function tokenFor(
  request: APIRequestContext,
  person: Person,
): Promise<string> {
  let token = tokens.get(person);
  if (!token) {
    token = (async () => {
      const response = await request.get(
        `${BACKEND_URL}/api/auth/e2e/refresh`,
        { params: { user: person } },
      );
      expect(response.status(), await response.text()).toBe(200);
      const body = await response.json();
      return body.backstageIdentity.token as string;
    })();
    tokens.set(person, token);
    token.catch(() => tokens.delete(person));
  }
  return token;
}

/** Fail with the response body in the message, which is what explains it. */
export async function expectStatus(
  response: APIResponse,
  status: number,
): Promise<void> {
  expect(
    response.status(),
    `${response.url()} answered ${response.status()}: ${await response.text()}`,
  ).toBe(status);
}

/**
 * A Backstage error response: its status, and that its message says `message`.
 */
export async function expectError(
  response: APIResponse,
  status: number,
  message?: string | RegExp,
): Promise<string> {
  await expectStatus(response, status);
  const body = await response.json();
  const text: string = body.error?.message ?? '';
  if (typeof message === 'string') {
    expect(text).toContain(message);
  } else if (message) {
    expect(text).toMatch(message);
  }
  return text;
}

/**
 * The backend, signed in as one person.
 *
 * Tests set up most of their state through here, because driving the UI as
 * three people to reach the state the test is actually about is slow and
 * tests nothing new. What the test is *about* goes through the browser.
 */
export class BackstageApi {
  constructor(readonly request: APIRequestContext, readonly person: Person) {}

  get userRef(): string {
    return `user:default/${this.person}`;
  }

  async fetch(
    method: string,
    path: string,
    options: { data?: unknown; params?: Query; signedIn?: boolean } = {},
  ): Promise<APIResponse> {
    const headers: Record<string, string> = {};
    if (options.signedIn !== false) {
      headers.Authorization = `Bearer ${await tokenFor(
        this.request,
        this.person,
      )}`;
    }
    return this.request.fetch(`${BACKEND_URL}${path}`, {
      method,
      headers,
      data: options.data,
      params: options.params,
    });
  }

  // --- Approval requests ---------------------------------------------------

  submit(templateRef: string, values: Record<string, unknown>) {
    return this.fetch('POST', '/api/scaffolder-approvals/requests', {
      data: { templateRef, values },
    });
  }

  /** Submit, expecting a new request, and return its id. */
  async create(
    templateRef: string,
    values: Record<string, unknown>,
  ): Promise<string> {
    const response = await this.submit(templateRef, values);
    await expectStatus(response, 201);
    const body = await response.json();
    expect(body.collapsed).toBe(false);
    return body.id;
  }

  get(id: string) {
    return this.fetch('GET', `/api/scaffolder-approvals/requests/${id}`);
  }

  async read(id: string): Promise<ApprovalRequest> {
    const response = await this.get(id);
    await expectStatus(response, 200);
    return response.json();
  }

  list(query: Query = {}) {
    return this.fetch('GET', '/api/scaffolder-approvals/requests', {
      params: query,
    });
  }

  async listItems(
    query: Query = {},
  ): Promise<{ items: ApprovalRequest[]; totalItems: number }> {
    const response = await this.list(query);
    await expectStatus(response, 200);
    return response.json();
  }

  decide(id: string, decision: 'approve' | 'deny', comment?: string) {
    return this.fetch(
      'POST',
      `/api/scaffolder-approvals/requests/${id}/decision`,
      { data: comment === undefined ? { decision } : { decision, comment } },
    );
  }

  async approve(id: string, comment?: string): Promise<ApprovalRequest> {
    const response = await this.decide(id, 'approve', comment);
    await expectStatus(response, 200);
    return response.json();
  }

  async deny(id: string, comment?: string): Promise<ApprovalRequest> {
    const response = await this.decide(id, 'deny', comment);
    await expectStatus(response, 200);
    return response.json();
  }

  cancel(id: string) {
    return this.fetch(
      'POST',
      `/api/scaffolder-approvals/requests/${id}/cancel`,
    );
  }

  async withdraw(id: string): Promise<ApprovalRequest> {
    const response = await this.cancel(id);
    await expectStatus(response, 200);
    return response.json();
  }

  /** Wait for a request to reach `status`, and return it as it is then. */
  async waitForStatus(
    id: string,
    status: RequestStatus,
    timeout = 45_000,
  ): Promise<ApprovalRequest> {
    await expect
      .poll(async () => (await this.read(id)).status, {
        message: `request ${id} to become '${status}'`,
        timeout,
      })
      .toBe(status);
    return this.read(id);
  }

  /**
   * Withdraw this person's pending requests for a template: what an earlier
   * attempt of a retried test left behind.
   */
  async withdrawPending(templateRef: string): Promise<void> {
    const { items } = await this.listItems({
      role: 'requester',
      status: 'pending',
      templateRef,
      limit: 200,
    });
    for (const item of items) {
      await this.cancel(item.id);
    }
  }

  /**
   * Run one of the approvals backend's scheduled jobs now, rather than at its
   * next slot. Retried while it is already running.
   */
  async triggerSweep(sweep: Sweep): Promise<void> {
    await expect(async () => {
      const response = await this.fetch(
        'POST',
        `/api/scaffolder-approvals/.backstage/scheduler/v1/tasks/scaffolder-approvals-${sweep}/trigger`,
      );
      await expectStatus(response, 200);
    }).toPass({ timeout: 30_000 });
  }

  // --- Notifications -------------------------------------------------------

  /** This person's notifications whose text mentions `search`. */
  async notifications(search: string): Promise<NotificationRecord[]> {
    const response = await this.fetch(
      'GET',
      '/api/notifications/notifications',
      { params: { search, limit: 50 } },
    );
    await expectStatus(response, 200);
    return (await response.json()).notifications;
  }

  /** Wait until a notification titled `title` mentions `search`. */
  async waitForNotification(
    search: string,
    title: string,
  ): Promise<NotificationRecord> {
    let found: NotificationRecord | undefined;
    await expect
      .poll(
        async () => {
          found = (await this.notifications(search)).find(
            n => n.payload.title === title,
          );
          return found?.payload.title;
        },
        { message: `a '${title}' notification about ${search}` },
      )
      .toBe(title);
    return found!;
  }

  // --- Scaffolder ----------------------------------------------------------

  async task(taskId: string): Promise<{ id: string; status: string }> {
    const response = await this.fetch(
      'GET',
      `/api/scaffolder/v2/tasks/${taskId}`,
    );
    await expectStatus(response, 200);
    return response.json();
  }

  /** Everything the task logged, one event per line. */
  async taskLog(taskId: string): Promise<string> {
    const response = await this.fetch(
      'GET',
      `/api/scaffolder/v2/tasks/${taskId}/events`,
    );
    await expectStatus(response, 200);
    const events: { body: { message?: string } }[] = await response.json();
    return events.map(event => event.body.message ?? '').join('\n');
  }

  /** Start a template through the scaffolder itself, skipping approvals. */
  runTemplate(templateRef: string, values: Record<string, unknown>) {
    return this.fetch('POST', '/api/scaffolder/v2/tasks', {
      data: { templateRef, values },
    });
  }
}
