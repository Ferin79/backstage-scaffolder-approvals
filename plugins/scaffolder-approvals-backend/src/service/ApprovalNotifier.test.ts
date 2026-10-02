/*
 * Copyright 2026 The Backstage Authors
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import type {
  ApprovalDecision,
  ApprovalRequest,
} from '@ferin79/backstage-plugin-scaffolder-approvals-common';
import { mockServices } from '@backstage/backend-test-utils';
import type { EventsService } from '@backstage/plugin-events-node';
import type { NotificationService } from '@backstage/plugin-notifications-node';
import type { SignalsService } from '@backstage/plugin-signals-node';
import { ApprovalNotifier } from './ApprovalNotifier';

const REQUEST: ApprovalRequest = {
  id: '3f1e4c8a-0000-4000-8000-000000000001',
  templateRef: 'template:default/request-github-admin',
  values: { repository: 'backstage' },
  valuesHash: 'a'.repeat(64),
  requesterRef: 'user:default/requester',
  status: 'pending',
  summary: 'Admin on backstage',
  policySnapshot: {
    approvers: ['group:default/devx-team', 'user:default/platform-lead'],
    quorum: 1,
    selfApprove: false,
  },
  createdAt: '2026-09-13T10:00:00.000Z',
  updatedAt: '2026-09-13T10:00:00.000Z',
};

const APPROVAL: ApprovalDecision = {
  id: 'd1',
  requestId: REQUEST.id,
  approverRef: 'user:default/alice',
  decision: 'approve',
  createdAt: '2026-09-13T10:05:00.000Z',
};

describe('ApprovalNotifier', () => {
  let send: jest.Mock;
  let publishSignal: jest.Mock;
  let publishEvent: jest.Mock;
  let logger: ReturnType<typeof mockServices.logger.mock>;

  function notifier(
    overrides: {
      notifications?: NotificationService;
      signals?: SignalsService;
      events?: EventsService;
    } = {},
  ) {
    return new ApprovalNotifier({
      logger,
      appBaseUrl: 'https://backstage.example.com',
      notifications:
        'notifications' in overrides
          ? overrides.notifications
          : ({ send } as unknown as NotificationService),
      signals:
        'signals' in overrides
          ? overrides.signals
          : ({ publish: publishSignal } as unknown as SignalsService),
      events:
        'events' in overrides
          ? overrides.events
          : ({ publish: publishEvent } as unknown as EventsService),
    });
  }

  beforeEach(() => {
    send = jest.fn();
    publishSignal = jest.fn();
    publishEvent = jest.fn();
    logger = mockServices.logger.mock();
  });

  describe('with nothing installed', () => {
    it('does nothing, quietly', async () => {
      // The plugin has to work in a deployment with neither notifications nor
      // signals (§7.5), so absence is the normal case rather than an error.
      const bare = notifier({
        notifications: undefined,
        signals: undefined,
        events: undefined,
      });

      await expect(bare.onSubmitted(REQUEST)).resolves.toBeUndefined();
      await expect(bare.onDecided(REQUEST, APPROVAL)).resolves.toBeUndefined();
      await expect(bare.onFailed(REQUEST, 'reason')).resolves.toBeUndefined();
      await expect(bare.onExpired(REQUEST)).resolves.toBeUndefined();

      expect(logger.warn).not.toHaveBeenCalled();
    });
  });

  describe('when a channel fails', () => {
    it('still delivers to the others, and never throws', async () => {
      // A notification that cannot be sent is not a reason to undo a state
      // change that has already been committed.
      send.mockRejectedValue(new Error('notifications down'));

      await expect(notifier().onSubmitted(REQUEST)).resolves.toBeUndefined();

      expect(publishSignal).toHaveBeenCalled();
      expect(publishEvent).toHaveBeenCalled();
      expect(logger.warn).toHaveBeenCalledWith(
        expect.stringMatching(/notification/),
        expect.any(Error),
      );
    });

    it('is unaffected by signals failing', async () => {
      publishSignal.mockRejectedValue(new Error('signals down'));

      await expect(notifier().onExpired(REQUEST)).resolves.toBeUndefined();

      expect(send).toHaveBeenCalled();
      expect(publishEvent).toHaveBeenCalled();
    });
  });

  describe('the words a person reads', () => {
    // B16: every inbox read "user:default/requester is asking to run …". The
    // event payload keeps full refs for whatever subscribes to it; the
    // sentences people read name people.
    it('names people, not their entity refs', async () => {
      const n = notifier();
      await n.onSubmitted(REQUEST);
      await n.onDecided({ ...REQUEST, status: 'approved' as const }, APPROVAL);
      await n.onWithdrawn({ ...REQUEST, status: 'cancelled' as const });

      expect(
        send.mock.calls.map(([{ payload }]) => payload.description),
      ).toEqual([
        'requester is asking to run Admin on backstage',
        'alice approved your request to run Admin on backstage',
        'requester withdrew their request to run Admin on backstage. Nothing is waiting on you.',
      ]);
    });

    it('keeps a namespace that is not the default one', async () => {
      // Two people in different namespaces can share a name.
      await notifier().onSubmitted({
        ...REQUEST,
        requesterRef: 'user:ops/sam',
      });

      expect(send.mock.calls[0][0].payload.description).toBe(
        'ops/sam is asking to run Admin on backstage',
      );
    });
  });

  describe('onSubmitted', () => {
    it('tells the approvers, not the requester', async () => {
      await notifier().onSubmitted(REQUEST);

      expect(send).toHaveBeenCalledWith({
        recipients: {
          type: 'entity',
          entityRef: ['group:default/devx-team', 'user:default/platform-lead'],
          // Nobody needs telling about their own request, even if they happen
          // to be an approver too.
          excludeEntityRef: ['user:default/requester'],
        },
        payload: expect.objectContaining({
          title: 'Approval requested',
          link: `https://backstage.example.com/scaffolder-approvals/requests/${REQUEST.id}`,
        }),
      });
    });

    it('scopes the notification per request and action', async () => {
      // So a re-notification replaces rather than piles up in an inbox.
      await notifier().onSubmitted(REQUEST);

      expect(send.mock.calls[0][0].payload.scope).toBe(
        `scaffolder-approvals:${REQUEST.id}:requested`,
      );
    });
  });

  describe('onDecided', () => {
    // The service hands over the request as it is after the decision (C3), so
    // a denial arrives `rejected` and a final approval `approved`.
    it('tells the requester, and carries the comment', async () => {
      await notifier().onDecided(
        { ...REQUEST, status: 'rejected' as const },
        {
          ...APPROVAL,
          decision: 'deny',
          comment: 'not while the incident is open',
        },
      );

      const [{ recipients, payload }] = send.mock.calls[0];
      expect(recipients.entityRef).toEqual(['user:default/requester']);
      expect(payload.title).toBe('Request denied');
      expect(payload.description).toMatch(/not while the incident is open/);
      // A denial is worth more attention than an approval.
      expect(payload.severity).toBe('high');
    });

    it('reads as an approval when it was one', async () => {
      await notifier().onDecided(
        { ...REQUEST, status: 'approved' as const },
        APPROVAL,
      );

      const [{ payload }] = send.mock.calls[0];
      expect(payload.title).toBe('Request approved');
      expect(payload.severity).toBe('normal');
    });

    it('announces a vote that leaves it pending, without notifying anyone', async () => {
      // B10/B12: a partial approval published nothing, so a page open on the
      // request stayed at "0 of 2". It is an event and a signal now — and not
      // a notification, because "Request approved" with an approval still
      // missing would be untrue.
      await notifier().onDecided(REQUEST, APPROVAL);

      expect(send).not.toHaveBeenCalled();
      expect(publishSignal).toHaveBeenCalledWith(
        expect.objectContaining({
          message: {
            action: 'decided',
            requestId: REQUEST.id,
            status: 'pending',
          },
        }),
      );
      expect(publishEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          eventPayload: expect.objectContaining({
            action: 'decided',
            status: 'pending',
            decision: 'approve',
          }),
        }),
      );
    });
  });

  describe('onFailed and onExpired', () => {
    it('tell both sides', async () => {
      // The requester is waiting on it, and the approvers spent their attention
      // on something that did not happen.
      await notifier().onFailed(REQUEST, 'the task failed');

      expect(send.mock.calls[0][0].recipients.entityRef).toEqual([
        'user:default/requester',
        'group:default/devx-team',
        'user:default/platform-lead',
      ]);
      expect(send.mock.calls[0][0].payload.description).toMatch(
        /the task failed/,
      );
    });

    it('describe an expired request without blaming anyone', async () => {
      await notifier().onExpired(REQUEST);

      expect(send.mock.calls[0][0].payload.title).toBe(
        'Approval request expired',
      );
    });
  });

  describe('signals', () => {
    it('broadcast, because an approver is usually a group', async () => {
      // G12: a signal can only be addressed to `user:` refs, so addressing the
      // approvers meant the people most likely to have the page open were the
      // ones whose page never updated.
      await notifier().onFailed(REQUEST, 'the task failed');

      expect(publishSignal).toHaveBeenCalledWith({
        recipients: { type: 'broadcast' },
        channel: 'scaffolder-approvals',
        message: {
          action: 'failed',
          requestId: REQUEST.id,
          status: REQUEST.status,
        },
      });
    });

    it('go out even when every recipient is a group', async () => {
      await notifier().onSubmitted({
        ...REQUEST,
        policySnapshot: {
          ...REQUEST.policySnapshot,
          approvers: ['group:default/devx-team'],
        },
      });

      expect(publishSignal).toHaveBeenCalledWith(
        expect.objectContaining({ recipients: { type: 'broadcast' } }),
      );
      expect(send).toHaveBeenCalled();
    });

    it('carry nothing but the request id and its status', async () => {
      // A broadcast reaches every signed-in user, so the payload has to be
      // something they were all entitled to see. Reads are open (Q12) and the
      // page fetches the request itself once it is told to.
      await notifier().onDecided(REQUEST, APPROVAL);

      const [{ message }] = publishSignal.mock.calls[0];
      expect(Object.keys(message).sort()).toEqual([
        'action',
        'requestId',
        'status',
      ]);
    });
  });

  describe('launched and completed', () => {
    it('publish an event and a signal but never a notification', async () => {
      // Q20 settles on four notifications in v1, and "launched" is redundant
      // with "decided" in somebody's inbox. An external subscriber still needs
      // the whole lifecycle.
      const running = { ...REQUEST, status: 'running' as const, taskId: 't-1' };

      await notifier().onLaunched(running);

      expect(send).not.toHaveBeenCalled();
      expect(publishEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          eventPayload: expect.objectContaining({
            action: 'launched',
            status: 'running',
            taskId: 't-1',
          }),
        }),
      );
      expect(publishSignal).toHaveBeenCalledWith(
        expect.objectContaining({
          message: expect.objectContaining({ action: 'launched' }),
        }),
      );
    });

    it('report a completed request', async () => {
      const done = { ...REQUEST, status: 'completed' as const, taskId: 't-1' };

      await notifier().onCompleted(done);

      expect(send).not.toHaveBeenCalled();
      expect(publishEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          eventPayload: expect.objectContaining({
            action: 'completed',
            status: 'completed',
          }),
        }),
      );
    });
  });

  describe('withdrawn', () => {
    it("replaces the approvers' request notification instead of adding one", async () => {
      // B11: "Approval requested" stayed unread after a withdrawal, leading to
      // a request nobody could act on. Q20's four kinds stay four: this one
      // takes the scope of the notification it makes obsolete.
      await notifier().onWithdrawn({
        ...REQUEST,
        status: 'cancelled' as const,
      });

      expect(send).toHaveBeenCalledTimes(1);
      const [{ recipients, payload }] = send.mock.calls[0];
      expect(recipients.entityRef).toEqual(REQUEST.policySnapshot.approvers);
      expect(recipients.excludeEntityRef).toEqual([REQUEST.requesterRef]);
      expect(payload.title).toBe('Approval request withdrawn');
      expect(payload.description).toMatch(/Nothing is waiting on you/);
      expect(payload.severity).toBe('low');
      // The scope of the notification `onSubmitted` sent, so it is replaced.
      expect(payload.scope).toBe(
        `scaffolder-approvals:${REQUEST.id}:requested`,
      );
    });

    it('publishes an event and a signal', async () => {
      // B10: a page open on a withdrawn request never updated, because nothing
      // was published.
      await notifier().onWithdrawn({
        ...REQUEST,
        status: 'cancelled' as const,
      });

      expect(publishSignal).toHaveBeenCalledWith(
        expect.objectContaining({
          message: {
            action: 'withdrawn',
            requestId: REQUEST.id,
            status: 'cancelled',
          },
        }),
      );
      expect(publishEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          eventPayload: expect.objectContaining({
            action: 'withdrawn',
            status: 'cancelled',
          }),
        }),
      );
    });
  });

  describe('events', () => {
    it('describe what happened for anything listening', async () => {
      await notifier().onDecided(REQUEST, APPROVAL);

      expect(publishEvent).toHaveBeenCalledWith({
        topic: 'scaffolder-approvals',
        eventPayload: {
          action: 'decided',
          requestId: REQUEST.id,
          templateRef: REQUEST.templateRef,
          requesterRef: REQUEST.requesterRef,
          status: REQUEST.status,
          decision: 'approve',
          approverRef: 'user:default/alice',
        },
      });
    });
  });

  describe('a redacted request', () => {
    it('falls back to the template once the summary has gone', async () => {
      // The retention sweep nulls the summary, and a notification about a
      // failure can outlive it. Named, like a person, rather than as a ref.
      await notifier().onFailed(
        { ...REQUEST, summary: null, values: null },
        'the task failed',
      );

      expect(send.mock.calls[0][0].payload.description).toBe(
        'request-github-admin did not complete: the task failed',
      );
    });
  });

  it('tolerates an app base URL with a trailing slash', async () => {
    const trailing = new ApprovalNotifier({
      logger,
      appBaseUrl: 'https://backstage.example.com/',
      notifications: { send } as unknown as NotificationService,
    });
    await trailing.onSubmitted(REQUEST);

    expect(send.mock.calls[0][0].payload.link).toBe(
      `https://backstage.example.com/scaffolder-approvals/requests/${REQUEST.id}`,
    );
  });
});
