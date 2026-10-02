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

import {
  type ApprovalDecision,
  type ApprovalRequest,
  APPROVALS_SIGNAL_CHANNEL,
  SCAFFOLDER_APPROVALS_PLUGIN_ID,
} from '@backstage-community/plugin-scaffolder-approvals-common';
import type { LoggerService } from '@backstage/backend-plugin-api';
import type { EventsService } from '@backstage/plugin-events-node';
import type { NotificationService } from '@backstage/plugin-notifications-node';
import type { SignalsService } from '@backstage/plugin-signals-node';
import type { ApprovalObserver } from './ApprovalService';

/** The topic this plugin publishes its own lifecycle events on. */
export const APPROVALS_EVENT_TOPIC = SCAFFOLDER_APPROVALS_PLUGIN_ID;

/**
 * What happened, as the event payload names it.
 *
 * `launched` and `completed` deliberately carry no notification: Q20 settles on
 * four in v1, and "launched" is redundant with "decided" in somebody's inbox.
 * They exist because an external subscriber — a Slack integration, an audit
 * pipeline — needs the whole lifecycle, not the part that happens to be worth
 * interrupting a person for.
 */
export type ApprovalEventAction =
  | 'requested'
  | 'decided'
  | 'launched'
  | 'completed'
  | 'failed'
  | 'expired'
  | 'withdrawn';

export interface ApprovalNotifierOptions {
  logger: LoggerService;
  /** Absolute URL of the Backstage app, for deep links. */
  appBaseUrl: string;
  /** All three are soft dependencies; any of them may be absent. */
  notifications?: NotificationService;
  signals?: SignalsService;
  events?: EventsService;
}

/**
 * Fans a state change out to notifications, signals and events.
 *
 * All three are optional (§7.5): the plugin has to work in a deployment that
 * installs none of them, so every call site checks before using one and every
 * failure is swallowed with a log. A notification that cannot be sent is not a
 * reason to undo an approval that has already been committed.
 *
 * Implements {@link ApprovalObserver} for the two events the service raises,
 * and adds the two the sweeps raise.
 */
export class ApprovalNotifier implements ApprovalObserver {
  private readonly logger: LoggerService;
  private readonly appBaseUrl: string;
  private readonly notifications?: NotificationService;
  private readonly signals?: SignalsService;
  private readonly events?: EventsService;

  constructor(options: ApprovalNotifierOptions) {
    this.logger = options.logger;
    this.appBaseUrl = options.appBaseUrl.replace(/\/+$/, '');
    this.notifications = options.notifications;
    this.signals = options.signals;
    this.events = options.events;
  }

  private link(request: ApprovalRequest): string {
    return `${this.appBaseUrl}/${SCAFFOLDER_APPROVALS_PLUGIN_ID}/requests/${request.id}`;
  }

  private describe(request: ApprovalRequest): string {
    // The summary is nulled by the retention sweep, and the template ref is the
    // only thing that outlives it.
    return request.summary ?? request.templateRef;
  }

  /** Approvers, as entity refs. Group refs resolve on the receiving side. */
  private approvers(request: ApprovalRequest): string[] {
    return request.policySnapshot.approvers;
  }

  async onSubmitted(request: ApprovalRequest): Promise<void> {
    await this.fanOut('requested', request, {
      recipients: this.approvers(request),
      // The requester does not need telling about their own request, and the
      // notifications service filters them out even if they are an approver.
      exclude: [request.requesterRef],
      title: 'Approval requested',
      description: `${request.requesterRef} is asking to run ${this.describe(
        request,
      )}`,
      severity: 'normal',
    });
  }

  async onDecided(
    request: ApprovalRequest,
    decision: ApprovalDecision,
  ): Promise<void> {
    const approved = decision.decision === 'approve';
    await this.fanOut('decided', request, {
      // A vote that leaves the request pending is an event and a signal, never
      // a notification: "Request approved" while another approval is still
      // needed would tell the requester something untrue. Q20's four are
      // about outcomes, and a partial vote is not one.
      recipients: request.status === 'pending' ? [] : [request.requesterRef],
      title: approved ? 'Request approved' : 'Request denied',
      description: `${decision.approverRef} ${
        approved ? 'approved' : 'denied'
      } your request to run ${this.describe(request)}${
        decision.comment ? `: ${decision.comment}` : ''
      }`,
      severity: approved ? 'normal' : 'high',
      extra: { decision: decision.decision, approverRef: decision.approverRef },
    });
  }

  /** The template is running. An event and a signal only, never a notification. */
  async onLaunched(request: ApprovalRequest): Promise<void> {
    await this.fanOut('launched', request, {
      recipients: [],
      extra: request.taskId ? { taskId: request.taskId } : undefined,
    });
  }

  /**
   * The requester withdrew it. Event and signal only, as for `launched`: Q20
   * settles on four notifications, and this was the one change that published
   * nothing, so a page open on it never noticed (B10).
   */
  async onWithdrawn(request: ApprovalRequest): Promise<void> {
    await this.fanOut('withdrawn', request, { recipients: [] });
  }

  /** The task finished successfully. Event and signal only, as for `launched`. */
  async onCompleted(request: ApprovalRequest): Promise<void> {
    await this.fanOut('completed', request, {
      recipients: [],
      extra: request.taskId ? { taskId: request.taskId } : undefined,
    });
  }

  /** The task ran and failed, or the approval expired before it could run. */
  async onFailed(request: ApprovalRequest, reason: string): Promise<void> {
    await this.fanOut('failed', request, {
      // Both sides: the requester is waiting on it, and the approvers spent
      // their attention on something that did not happen.
      recipients: [request.requesterRef, ...this.approvers(request)],
      title: 'Approved request failed',
      description: `${this.describe(request)} did not complete: ${reason}`,
      severity: 'high',
      extra: { reason },
    });
  }

  /** Nobody decided in time. */
  async onExpired(request: ApprovalRequest): Promise<void> {
    await this.fanOut('expired', request, {
      recipients: [request.requesterRef, ...this.approvers(request)],
      title: 'Approval request expired',
      description: `Nobody decided on ${this.describe(
        request,
      )} before it timed out`,
      severity: 'normal',
    });
  }

  /**
   * Send one state change to everything that is installed.
   *
   * Each channel is attempted independently: signals failing must not stop the
   * notification, and neither must stop the event.
   */
  private async fanOut(
    action: ApprovalEventAction,
    request: ApprovalRequest,
    message: {
      /** Empty means "no notification for this one", not "nobody to tell". */
      recipients: string[];
      exclude?: string[];
      title?: string;
      description?: string;
      severity?: 'normal' | 'high';
      extra?: Record<string, string>;
    },
  ): Promise<void> {
    const recipients = [...new Set(message.recipients)].filter(Boolean);

    await this.attempt('notification', async () => {
      if (!this.notifications || recipients.length === 0 || !message.title) {
        return;
      }
      await this.notifications.send({
        recipients: {
          type: 'entity',
          entityRef: recipients,
          ...(message.exclude ? { excludeEntityRef: message.exclude } : {}),
        },
        payload: {
          title: message.title,
          description: message.description ?? '',
          link: this.link(request),
          severity: message.severity ?? 'normal',
          topic: SCAFFOLDER_APPROVALS_PLUGIN_ID,
          // Scoped per request so a re-notification replaces rather than piles
          // up in somebody's inbox.
          scope: `${SCAFFOLDER_APPROVALS_PLUGIN_ID}:${request.id}:${action}`,
        },
      });
    });

    await this.attempt('signal', async () => {
      if (!this.signals) {
        return;
      }
      // Broadcast, not addressed. A signal can only be sent to `user:` refs,
      // and approvers are normally groups, so addressing them meant the people
      // most likely to have the page open were the ones who never saw it
      // update. The payload is the request id and its status and nothing else,
      // which reveals nothing: reads are open to any signed-in user (Q12), and
      // the page fetches the request itself once it is told to.
      await this.signals.publish({
        recipients: { type: 'broadcast' },
        channel: APPROVALS_SIGNAL_CHANNEL,
        message: { action, requestId: request.id, status: request.status },
      });
    });

    await this.attempt('event', async () => {
      if (!this.events) {
        return;
      }
      await this.events.publish({
        topic: APPROVALS_EVENT_TOPIC,
        eventPayload: {
          action,
          requestId: request.id,
          templateRef: request.templateRef,
          requesterRef: request.requesterRef,
          status: request.status,
          ...message.extra,
        },
      });
    });
  }

  private async attempt(what: string, run: () => Promise<void>): Promise<void> {
    try {
      await run();
    } catch (error) {
      this.logger.warn(
        `Could not deliver an approvals ${what}; the state change still stands`,
        error instanceof Error ? error : undefined,
      );
    }
  }
}
