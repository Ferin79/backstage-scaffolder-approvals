import type {
  ApprovalRequest,
  ApprovalRequestStatus,
} from '@ferin79/backstage-plugin-scaffolder-approvals-common';
import type { AuthService, LoggerService } from '@backstage/backend-plugin-api';
import type { ScaffolderService } from '@backstage/plugin-scaffolder-node';
import type { ScaffolderTaskStatus } from '@backstage/plugin-scaffolder-common';
import { ResponseError } from '@backstage/errors';
import { durationToMilliseconds, type HumanDuration } from '@backstage/types';
import type { ApprovalStore } from '../database';
import type { ApprovalNotifier } from './ApprovalNotifier';
import type { ApprovalService } from './ApprovalService';

/**
 * How many requests one tick will touch.
 *
 * A cap rather than "everything that matches", so that a backlog built up
 * during an outage drains steadily instead of arriving at the scaffolder all at
 * once. Whatever is left is picked up on the next tick.
 */
export const DEFAULT_BATCH_SIZE = 50;

/**
 * How many batches one retention tick may redact.
 *
 * Redaction is cheap, and an organisation that settles more requests between
 * ticks than one batch holds would otherwise fall further behind every day.
 * Capped so that a first run over years of history still finishes inside the
 * task's timeout; the rest waits for the next tick.
 */
const MAX_REDACTION_BATCHES = 20;

export interface ApprovalSweepsOptions {
  store: ApprovalStore;
  service: ApprovalService;
  scaffolder: ScaffolderService;
  auth: AuthService;
  logger: LoggerService;
  notifier?: ApprovalNotifier;
  /** How long values and summaries are kept before redaction. */
  retention: HumanDuration;
  batchSize?: number;
  now?: () => Date;
}

/**
 * How a finished scaffolder task maps onto the request that asked for it.
 *
 * A *cancelled task* is not a `cancelled` request: that status means the
 * requester withdrew before anyone decided. A task cancelled mid-run was
 * approved and then stopped, which is a failure to deliver what was approved.
 */
const TASK_STATUS_MAP: Partial<
  Record<ScaffolderTaskStatus, ApprovalRequestStatus>
> = {
  completed: 'completed',
  failed: 'failed',
  cancelled: 'failed',
  skipped: 'completed',
};

/**
 * The three scheduled jobs that keep request state honest.
 *
 * Events are the fast path for task status; these are the backstop. Nothing
 * here assumes an event was delivered, which is the point — a dropped event
 * costs a request one sweep interval of staleness, not correctness.
 */
export class ApprovalSweeps {
  private readonly store: ApprovalStore;
  private readonly service: ApprovalService;
  private readonly scaffolder: ScaffolderService;
  private readonly auth: AuthService;
  private readonly logger: LoggerService;
  private readonly notifier?: ApprovalNotifier;
  private readonly retentionMs: number;
  private readonly batchSize: number;
  private readonly now: () => Date;

  constructor(options: ApprovalSweepsOptions) {
    this.store = options.store;
    this.service = options.service;
    this.scaffolder = options.scaffolder;
    this.auth = options.auth;
    this.logger = options.logger;
    this.notifier = options.notifier;
    this.retentionMs = durationToMilliseconds(options.retention);
    this.batchSize = options.batchSize ?? DEFAULT_BATCH_SIZE;
    this.now = options.now ?? (() => new Date());
  }

  /**
   * Reconcile requests that are mid-flight.
   *
   * For a request that was approved but has no task, three outcomes, and
   * telling them apart is the whole job:
   *
   * 1. **A grant was consumed.** The task started but the status transition was
   *    lost — a crash between `scaffold()` returning and the write. The grant
   *    records which task consumed it, so the id is recovered rather than the
   *    template being run a second time.
   * 2. **The approval is still redeemable.** Hand it to `launch`, which claims
   *    it, revokes whatever a failed attempt left behind and tries again.
   *    A launch that is genuinely in flight keeps its claim and `launch`
   *    declines, so this is safe to call on every tick.
   * 3. **The approval has lapsed.** Nothing redeemed it before the deadline, so
   *    it is spent and the request fails. A retry needs a fresh approval.
   *
   * Plus the simple case: a running request whose task has since finished.
   */
  async reconcile(): Promise<void> {
    await this.reconcileAwaitingLaunch();
    await this.reconcileRunning();
  }

  private async reconcileAwaitingLaunch(): Promise<void> {
    const requests = await this.store.findApprovedAwaitingLaunch(
      this.batchSize,
    );

    for (const request of requests) {
      try {
        const deadline = await this.store.launchDeadline(request.id);

        if (
          deadline &&
          deadline.getTime() <= this.now().getTime() &&
          !(await this.store.hasLiveGrant(request.id))
        ) {
          // Nothing redeemed the approval in time. Check once more for a task
          // before giving up on it, since a grant consumed moments ago is
          // still a template that ran.
          const consumed = await this.store.findConsumedGrant(request.id);
          if (consumed?.consumed_by_task_id) {
            await this.service.launch(request.id);
            continue;
          }

          await this.failRequest(
            request,
            'approved',
            'the approval grant expired before the template could start',
          );
          continue;
        }

        // Covers all of "never launched", "launched and failed" and "launched
        // and in flight": `launch` claims the request and decides which it is.
        await this.service.launch(request.id);
      } catch (error) {
        // One bad request must not stop the sweep for the rest.
        this.logger.warn(
          `Could not reconcile approval request ${request.id}`,
          error instanceof Error ? error : undefined,
        );
      }
    }
  }

  private async reconcileRunning(): Promise<void> {
    const requests = await this.store.findRunning(this.batchSize);
    if (requests.length === 0) {
      return;
    }

    const credentials = await this.auth.getOwnServiceCredentials();

    for (const request of requests) {
      if (!request.taskId) {
        continue;
      }
      try {
        const task = await this.scaffolder.getTask(
          { taskId: request.taskId },
          { credentials },
        );
        await this.applyTaskStatus(request, task.status);
      } catch (error) {
        if (isNotFound(error)) {
          // The task record is gone, so nothing will ever resolve this
          // request: no event can arrive for a task that does not exist, and
          // every later sweep would read the same 404. The scaffolder does not
          // delete tasks in normal operation, so this is a real end state
          // rather than a blip — and leaving the request `running` forever is
          // the worse answer, because the requester is still waiting on it.
          await this.failRequest(
            request,
            'running',
            'the scaffolder no longer has a record of the task',
          );
        } else {
          this.logger.warn(
            `Could not read task ${request.taskId} for approval request ${request.id}`,
            error instanceof Error ? error : undefined,
          );
        }
      }
    }

    // Recorded after the pass, and for every request in it — including the
    // ones nothing could be done about. That is the whole point: a request
    // that cannot be resolved must still move to the back of the queue, or it
    // holds a place in every batch and starves everything behind it.
    await this.store.markChecked(requests.map(request => request.id));
  }

  /**
   * Move a running request to match its task, if the task has settled.
   *
   * Shared by the sweep and the task-event subscription, so a request reaches
   * the same state whichever signal arrives first — and the second one to
   * arrive does nothing, because the transition is compare-and-set.
   */
  async applyTaskStatus(
    request: ApprovalRequest,
    taskStatus: ScaffolderTaskStatus | undefined,
  ): Promise<void> {
    const next = taskStatus && TASK_STATUS_MAP[taskStatus];
    if (!next) {
      // open or processing: still going.
      return;
    }

    if (next === 'failed') {
      await this.failRequest(
        request,
        'running',
        taskStatus === 'cancelled'
          ? 'the task was cancelled'
          : 'the task failed',
      );
      return;
    }

    if (await this.store.transition(request.id, 'running', next)) {
      this.logger.info(
        `Approval request ${request.id} is ${next}; its task ${request.taskId} ${taskStatus}`,
      );
      // No notification, but an external subscriber needs the end of the
      // lifecycle as much as the start of it.
      await this.notifier?.onCompleted({ ...request, status: next });
    }
  }

  /**
   * Expire pending requests nobody decided in time.
   *
   * The transition is guarded on `pending`, so a decision landing at the same
   * moment either wins or loses cleanly — never both.
   */
  async expireTimedOut(): Promise<void> {
    const requests = await this.store.findPendingPastExpiry(
      this.now(),
      this.batchSize,
    );

    for (const request of requests) {
      const expired = await this.store.transition(
        request.id,
        'pending',
        'expired',
        { decidedAt: this.now() },
      );
      if (expired) {
        this.logger.info(`Approval request ${request.id} expired undecided`);
        await this.notifier?.onExpired({ ...request, status: 'expired' });
      }
    }
  }

  /**
   * Redact the personal data of long-settled requests.
   *
   * Never deletes. What goes is the submitted values and the rendered
   * summary, which can carry personal data such as an access justification.
   * The request row and every decision on it stay indefinitely — that audit
   * trail is what this whole feature exists to produce.
   *
   * Works through the backlog a batch at a time until a batch comes back
   * short, up to {@link MAX_REDACTION_BATCHES}.
   */
  async redactOld(): Promise<void> {
    const before = new Date(this.now().getTime() - this.retentionMs);

    let redacted = 0;
    for (let batch = 0; batch < MAX_REDACTION_BATCHES; batch++) {
      const requests = await this.store.findRedactable(before, this.batchSize);
      for (const request of requests) {
        if (await this.store.redact(request.id)) {
          redacted += 1;
        }
      }
      if (requests.length < this.batchSize) {
        break;
      }
    }

    if (redacted > 0) {
      this.logger.info(
        `Redacted the values of ${redacted} approval request(s) settled before ${before.toISOString()}`,
      );
    }
  }

  /**
   * Fail a request that is still `from`, recording why. Compare-and-set, so a
   * sweep and a task event racing each other fail it, and notify, once.
   */
  private async failRequest(
    request: ApprovalRequest,
    from: ApprovalRequestStatus,
    reason: string,
  ): Promise<void> {
    if (
      await this.store.transition(request.id, from, 'failed', {
        failureReason: reason,
      })
    ) {
      this.logger.warn(`Approval request ${request.id} failed: ${reason}`);
      await this.notifier?.onFailed(
        { ...request, status: 'failed', failureReason: reason },
        reason,
      );
    }
  }
}

/**
 * Whether an error is the scaffolder saying it has no such task.
 *
 * Narrow on purpose. A 5xx or a connection failure says nothing about whether
 * the task exists, and treating either as "gone" would fail a request over a
 * restart.
 */
function isNotFound(error: unknown): boolean {
  return error instanceof ResponseError && error.statusCode === 404;
}
