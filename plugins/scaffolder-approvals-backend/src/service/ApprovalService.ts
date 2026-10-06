import {
  APPROVAL_GRANT_SECRET,
  type ApprovalDecision,
  type ApprovalRequest,
  type ApprovalRequestWithDecisions,
  checkDecisionEligibility,
  checkGatedTemplate,
  type ConsumeGrantResponse,
  computeQuorumProgress,
  DECISION_INELIGIBILITY_MESSAGES,
  type DecideApprovalRequestOptions,
  renderGateSummary,
  type SubmitApprovalRequestResponse,
  type TemplateDrift,
  tryNormaliseEntityRef,
} from '@ferin79/backstage-plugin-scaffolder-approvals-common';
import {
  compareTemplate,
  computeTemplateStepsHash,
  computeValuesHash,
  formatGrant,
  generateGrantToken,
  hashGrantToken,
} from '@ferin79/backstage-plugin-scaffolder-approvals-node';
import type {
  AuthService,
  BackstageCredentials,
  LoggerService,
  UserInfoService,
} from '@backstage/backend-plugin-api';
import {
  ConflictError,
  InputError,
  NotAllowedError,
  NotFoundError,
} from '@backstage/errors';
import type { CatalogService } from '@backstage/plugin-catalog-node';
import type { TemplateEntityV1beta3 } from '@backstage/plugin-scaffolder-common';
import type { ScaffolderService } from '@backstage/plugin-scaffolder-node';
import {
  durationToMilliseconds,
  type HumanDuration,
  type JsonObject,
  type JsonValue,
} from '@backstage/types';
import type { ApprovalStore } from '../database';
import { describeLaunchRefusal } from './launchRefusal';
import { assertValuesDepth, readEntityRef } from './requestInput';
import { validateValues } from './validateValues';

/**
 * Hook for the things that happen *around* a state change — notifications,
 * events, signals.
 *
 * Kept behind an interface because all three are soft dependencies: the plugin
 * has to work in a deployment that installs none of them. It also keeps payload
 * shapes out of the state machine, which is what makes the state machine
 * testable without any of that infrastructure.
 *
 * Implementations must not throw. The service guards against it anyway, since
 * a failed notification is not a reason to undo an approval.
 *
 * @public
 */
export interface ApprovalObserver {
  onSubmitted(request: ApprovalRequest): Promise<void>;
  onDecided(
    request: ApprovalRequest,
    decision: ApprovalDecision,
  ): Promise<void>;
  /** The template is running. Optional, as are the hooks below. */
  onLaunched?(request: ApprovalRequest): Promise<void>;
  /** The requester withdrew the request before it was decided. */
  onWithdrawn?(request: ApprovalRequest): Promise<void>;
  /**
   * The approved request will not run: the scaffolder refused to start the
   * template, so no task exists and none would on a retry. `reason` is the
   * sentence recorded on the request.
   */
  onFailed?(request: ApprovalRequest, reason: string): Promise<void>;
}

/** Options for {@link ApprovalService.submit}. */
export interface SubmitOptions {
  templateRef: string;
  values: JsonObject;
  credentials: BackstageCredentials;
}

/** Options for {@link ApprovalService.decide}. */
export interface DecideOptions extends DecideApprovalRequestOptions {
  requestId: string;
  credentials: BackstageCredentials;
}

/** Construction options for {@link ApprovalService}. */
export interface ApprovalServiceOptions {
  store: ApprovalStore;
  catalog: CatalogService;
  scaffolder: ScaffolderService;
  auth: AuthService;
  userInfo: UserInfoService;
  logger: LoggerService;
  /** How long a minted grant stays redeemable. */
  grantTtl: HumanDuration;
  observer?: ApprovalObserver;
  now?: () => Date;
}

/**
 * How long a claimed launch is left alone before another caller may take it
 * over.
 *
 * It bounds two things at once: how long a launcher that crashed mid-flight
 * blocks its request, and how long a task that was started but has not yet
 * reached its gate is safe from having its grant revoked underneath it. The
 * second is why it is minutes rather than seconds — a gate is the first step of
 * a gated template, so a task that has not reached it in ten minutes is queued
 * behind a saturated worker pool, and revoking its grant would fail a run that
 * was about to succeed.
 */
const LAUNCH_CLAIM_GRACE_MS = 10 * 60 * 1000;

/**
 * The caller's own ref, normalised like every other ref this plugin stores,
 * for a request's requester or a decision's approver. MySQL's default
 * collation is case-insensitive while SQLite and Postgres compare bytes, so a
 * ref stored as the token spelled it would compare differently per database.
 */
function normaliseCallerRef(userEntityRef: string | undefined): string {
  if (!userEntityRef) {
    throw new NotAllowedError(
      'Approval requests can only be used by a signed-in user',
    );
  }
  const normalised = tryNormaliseEntityRef(userEntityRef);
  if (!normalised) {
    throw new NotAllowedError(`Not a usable user identity: ${userEntityRef}`);
  }
  return normalised;
}

/**
 * The approval state machine.
 *
 * Everything about quorum, transitions and launching lives here so that the
 * router holds no business logic and this is unit-testable without HTTP.
 *
 * The store owns atomicity; this owns the rules. Where the two meet, a
 * `transition` returning false is never treated as an error to retry — it means
 * another replica got there first, and the state it reached is authoritative.
 */
export class ApprovalService {
  private readonly store: ApprovalStore;
  private readonly catalog: CatalogService;
  private readonly scaffolder: ScaffolderService;
  private readonly auth: AuthService;
  private readonly userInfo: UserInfoService;
  private readonly logger: LoggerService;
  private readonly grantTtlMs: number;
  private readonly observer?: ApprovalObserver;
  private readonly now: () => Date;

  constructor(options: ApprovalServiceOptions) {
    this.store = options.store;
    this.catalog = options.catalog;
    this.scaffolder = options.scaffolder;
    this.auth = options.auth;
    this.userInfo = options.userInfo;
    this.logger = options.logger;
    this.grantTtlMs = durationToMilliseconds(options.grantTtl);
    this.observer = options.observer;
    this.now = options.now ?? (() => new Date());
  }

  /**
   * Submit a request to run a gated template.
   *
   * The gate policy is read off the template and **snapshotted**, so editing
   * the template afterwards cannot change the terms of a request already in
   * flight. Group membership is the deliberate exception: `approvers` holds
   * refs, and the caller's groups are matched against them at decision time.
   */
  async submit(options: SubmitOptions): Promise<SubmitApprovalRequestResponse> {
    const { values, credentials } = options;

    // Normalised before anything uses it, and stored that way:
    // `Template:Default/Gated` and `template:default/gated` are the same
    // template, and must collapse into one request and redeem one grant.
    const templateRef = readEntityRef(options.templateRef, {
      defaultKind: 'template',
      field: 'templateRef',
    });
    assertValuesDepth(values);

    const requesterRef = await this.callerRef(credentials);

    const template = await this.getTemplate(templateRef, credentials);
    if (!template) {
      throw new NotFoundError(`No such template: ${templateRef}`);
    }
    if (template.kind !== 'Template') {
      throw new InputError(`${templateRef} is not a Template`);
    }

    // The same check the wizard and the catalog processor run, so none of them
    // can disagree about which templates can be asked for.
    const check = checkGatedTemplate(template, templateRef);
    if (!check.gated) {
      throw new InputError(
        `${templateRef} is not gated; run it through the scaffolder directly`,
      );
    }
    if (!check.usable) {
      throw new InputError(check.problem);
    }
    const { policy } = check;

    // Validated before anything is stored, so an approval is never spent on a
    // request that cannot run.
    validateValues(template, values);

    const created = await this.store.createOrCollapse({
      templateRef,
      values,
      valuesHash: computeValuesHash(values),
      requesterRef,
      // The gate step comes from the catalog, where the scaffolder's templating
      // has not run, so the parameter references are filled in here.
      summary: policy.summary
        ? renderGateSummary(policy.summary, values)
        : undefined,
      policySnapshot: policy,
      expiresAt: policy.timeout
        ? new Date(
            this.now().getTime() + durationToMilliseconds(policy.timeout),
          )
        : undefined,
      // What the template looks like now, so an approver deciding later can
      // be told if it has changed underneath them.
      templateUid: template.metadata.uid,
      templateStepsHash: computeTemplateStepsHash(template),
    });

    if (!created.collapsed) {
      await this.notifyCurrent(created.id, request =>
        this.observer?.onSubmitted(request),
      );
    }

    return created;
  }

  /**
   * Whether the template a request was raised against has changed since.
   *
   * Computed on read rather than stored, because the template is loaded live
   * at launch: the only honest answer is the one from the moment somebody
   * asked. A catalog that cannot be reached returns undefined rather than
   * "unchanged", since claiming a template is unchanged when nothing was
   * checked is the one answer that would mislead an approver.
   */
  async templateDrift(
    request: ApprovalRequest,
    credentials: BackstageCredentials,
  ): Promise<TemplateDrift | undefined> {
    let template: TemplateEntityV1beta3 | undefined;
    try {
      template = await this.getTemplate(request.templateRef, credentials);
    } catch (error) {
      this.logger.warn(
        `Could not check ${request.templateRef} for drift`,
        error instanceof Error ? error : undefined,
      );
      return undefined;
    }

    const drift = compareTemplate({
      template,
      submittedUid: request.templateUid,
      submittedStepsHash: request.templateStepsHash,
    });

    // The steps hash cannot see a change to the parameters, and that is the
    // change that stops a request from ever running: the scaffolder validates
    // the values again when it starts the task, and refuses values that no
    // longer fit. Checked only while the request can still launch, which is
    // when an approver can do something about it.
    if (
      template &&
      request.values !== null &&
      (request.status === 'pending' || request.status === 'approved') &&
      !this.valuesStillFit(template, request.values)
    ) {
      return { changed: true, reasons: [...drift.reasons, 'parameters'] };
    }

    return drift;
  }

  /**
   * Record a vote and, if the gate is now satisfied, approve and launch.
   *
   * A single denial rejects the request outright regardless of the approval
   * count — a quorum is a threshold for assent, not a tally.
   */
  async decide(options: DecideOptions): Promise<ApprovalRequestWithDecisions> {
    const { requestId, decision, comment, credentials } = options;

    const caller = await this.userInfo.getUserInfo(credentials);
    const request = await this.requireRequest(requestId);

    const eligibility = checkDecisionEligibility(
      request,
      caller,
      await this.store.listDecisions(requestId),
      this.now(),
    );
    if (!eligibility.allowed) {
      const message = DECISION_INELIGIBILITY_MESSAGES[eligibility.reason];
      // A request that moved on is a conflict; the other reasons are refusals.
      throw eligibility.reason === 'not-pending' ||
        eligibility.reason === 'already-voted' ||
        eligibility.reason === 'expired'
        ? new ConflictError(message)
        : new NotAllowedError(message);
    }

    const recorded = await this.store.recordDecision({
      requestId,
      approverRef: normaliseCallerRef(caller.userEntityRef),
      decision,
      comment,
    });

    if (!recorded.recorded) {
      // Lost a race with the same approver's other request. The stored vote
      // stands, since decisions are append-only.
      throw new ConflictError(DECISION_INELIGIBILITY_MESSAGES['already-voted']);
    }

    const announce = () =>
      this.notifyCurrent(requestId, current =>
        this.observer?.onDecided(current, recorded.decision),
      );
    // Guarded on the timeout as well as the status, so a decision and the
    // timeout sweep landing together produce exactly one winner.
    const settle = { decidedAt: this.now(), notExpired: true };

    if (decision === 'deny') {
      if (
        await this.store.transition(requestId, 'pending', 'rejected', settle)
      ) {
        await announce();
      } else {
        // A concurrent approval reached quorum first. The denial is on record
        // as part of the audit trail, but it arrived too late to stop the run.
        this.logger.warn(
          `Denial of approval request ${requestId} arrived after it had already left 'pending'`,
        );
      }
      return await this.requireRequestWithDecisions(requestId);
    }

    const progress = computeQuorumProgress(
      await this.store.listDecisions(requestId),
      request.policySnapshot,
    );

    if (!progress.satisfied) {
      // Still pending, but somebody voted: announced so an open page moves from
      // "0 of 2" to "1 of 2". The notifier sends no notification for it.
      await announce();
    } else if (
      await this.store.transition(requestId, 'pending', 'approved', settle)
    ) {
      await announce();
      await this.launch(requestId);
    }

    return await this.requireRequestWithDecisions(requestId);
  }

  /**
   * Withdraw a pending request.
   *
   * Only the requester may withdraw, and only before a decision — that is what
   * `cancelled` means, as distinct from `rejected`. Nor after the timeout: a
   * request is dead the moment its deadline passes, not when the sweep notices.
   */
  async cancel(options: {
    requestId: string;
    credentials: BackstageCredentials;
  }): Promise<ApprovalRequest> {
    const { requestId, credentials } = options;
    const callerRef = await this.callerRef(credentials);
    const request = await this.requireRequest(requestId);

    if (request.requesterRef !== callerRef) {
      throw new NotAllowedError('Only the requester may cancel a request');
    }

    const now = this.now();
    if (
      request.status === 'pending' &&
      request.expiresAt &&
      new Date(request.expiresAt) <= now
    ) {
      throw new ConflictError(
        'This request timed out before anyone decided, so there is nothing left to withdraw',
      );
    }

    if (
      !(await this.store.transition(requestId, 'pending', 'cancelled', {
        decidedAt: now,
        // The same guard as a decision's, so a withdrawal and the timeout
        // sweep landing together produce exactly one outcome.
        notExpired: true,
      }))
    ) {
      throw new ConflictError(
        `Approval request ${requestId} is no longer pending`,
      );
    }

    const withdrawn = await this.requireRequest(requestId);
    await this.notify(() => this.observer?.onWithdrawn?.(withdrawn));
    return withdrawn;
  }

  /**
   * Mint a grant and start the scaffolder task.
   *
   * Safe to call more than once, which the reconciliation sweep relies on, and
   * the four steps below are what make that true.
   *
   * **1. Claim the launch.** A compare-and-set on the request, so that a
   * decision and a sweep tick racing each other produce exactly one launch
   * rather than two grants and two tasks. A claim goes stale after
   * {@link LAUNCH_CLAIM_GRACE_MS}, so a launcher that crashed mid-flight does
   * not block the request forever.
   *
   * **2. Recover a task that already started.** If a grant has been consumed,
   * the template is running and only this plugin's record of it was lost — a
   * crash between `scaffold()` returning and the status transition. Its
   * `consumed_by_task_id` is the task id.
   *
   * **3. Revoke a grant a previous attempt left behind.** The launch cannot be
   * retried while the old grant is still redeemable: two live grants is two
   * possible runs. Revoking is itself compare-and-set, so a task redeeming the
   * grant at the same moment wins and this caller recovers its id instead.
   *
   * **4. Stop at the deadline.** The first grant's expiry is when the approval
   * stops being redeemable. Past it, `launch` does nothing and the sweep fails
   * the request. This is deliberately different from a task that ran and
   * failed, which is terminal and needs a fresh approval.
   */
  async launch(requestId: string): Promise<void> {
    const request = await this.requireRequest(requestId);

    if (request.status !== 'approved') {
      this.logger.info(
        `Not launching approval request ${requestId}; it is '${request.status}', not 'approved'`,
      );
      return;
    }

    if (request.values === null) {
      // Redaction only happens long after a terminal state, so this means the
      // retention window and the lifecycle disagree. Failing loudly beats
      // launching a template with no parameters.
      throw new ConflictError(
        `Approval request ${requestId} has been redacted and can no longer be launched`,
      );
    }

    const now = this.now();
    const staleBefore = new Date(now.getTime() - LAUNCH_CLAIM_GRACE_MS);

    if (!(await this.store.claimLaunch(requestId, staleBefore))) {
      this.logger.info(
        `Not launching approval request ${requestId}; another launch is already in flight`,
      );
      return;
    }

    if (await this.recoverStartedTask(requestId)) {
      return;
    }

    const live = await this.store.findLiveGrant(requestId);
    if (live) {
      // We hold the claim, so the attempt that minted this grant has had its
      // grace period and is not coming back. Withdraw the grant so a new one
      // can be minted — unless a task beats us to redeeming it.
      if (!(await this.store.revokeGrant(live.id))) {
        await this.recoverStartedTask(requestId);
        return;
      }
      this.logger.info(
        `Revoked the unredeemed grant of approval request ${requestId}; retrying the launch`,
      );
    }

    // Every grant after the first expires when the first one would have, so
    // that retrying cannot push the deadline out indefinitely.
    const deadline =
      (await this.store.launchDeadline(requestId)) ??
      new Date(now.getTime() + this.grantTtlMs);

    if (deadline.getTime() <= now.getTime()) {
      this.logger.info(
        `Not launching approval request ${requestId}; the approval is no longer redeemable`,
      );
      return;
    }

    // Service credentials, not the requester's: `AuthService` cannot mint
    // credentials for an arbitrary user, and by the time an approval lands
    // there is no request from the requester in flight. So `task.createdBy` is
    // this plugin, `${{ user.* }}` renders empty, and the run is not
    // permission-checked: the approver list is the access-control boundary.
    // See docs/security-model.md.
    const credentials = await this.auth.getOwnServiceCredentials();

    // Noted, not refused. A template repo takes unrelated commits while an
    // approval waits, and failing every in-flight request on any edit would
    // make the feature unusable. The approver saw the change on the request
    // page before deciding; this line ties the run to the template it ran.
    const drift = await this.templateDrift(request, credentials);
    if (drift?.changed) {
      this.logger.warn(
        `Launching approval request ${requestId} against a template that has changed since submit: ${drift.reasons.join(
          ', ',
        )}`,
      );
    }

    const token = generateGrantToken();
    const grantId = await this.store.createGrant({
      requestId,
      tokenHash: hashGrantToken(token),
      valuesHash: request.valuesHash,
      expiresAt: deadline,
    });

    let taskId: string;
    try {
      const response = await this.scaffolder.scaffold(
        {
          templateRef: request.templateRef,
          // `JsonObject` admits `undefined` property values while the
          // scaffolder's type does not. These came back out of a JSON column,
          // and JSON cannot represent `undefined`, so the cast is sound.
          values: request.values as Record<string, JsonValue>,
          // The request id travels with the token: the gate action needs it to
          // redeem the grant and has no other way to learn it.
          secrets: { [APPROVAL_GRANT_SECRET]: formatGrant(requestId, token) },
        },
        { credentials },
      );
      taskId = response.taskId;
    } catch (error) {
      // The scaffolder answered, and refused: the values no longer fit the
      // template's parameters, or the template is gone. No task was created and
      // asking again would get the same answer, so end the request now with the
      // scaffolder's own reason.
      const refusal = describeLaunchRefusal(error);
      if (refusal) {
        await this.failRefusedLaunch(requestId, grantId, refusal);
        return;
      }

      // Otherwise a launch failure is not a task failure: the request stays
      // `approved` and the next sweep retries it. The grant is deliberately
      // left live, because the error does not say whether a task was created —
      // `ScaffolderClient` throws a plain `Error` for a timeout or a 5xx too,
      // and a task that exists is on its way to the gate holding this grant.
      this.logger.warn(
        `Failed to launch approval request ${requestId}; the next sweep will retry it until ${deadline.toISOString()}`,
        error instanceof Error ? error : undefined,
      );
      return;
    }

    if (
      await this.store.transition(requestId, 'approved', 'running', { taskId })
    ) {
      await this.notifyLaunched(requestId);
    } else {
      // The task is running regardless, so losing this race must not be silent.
      this.logger.warn(
        `Launched task ${taskId} for approval request ${requestId}, but the request had already left 'approved'`,
      );
    }
  }

  /**
   * Redeem a grant on behalf of a running task.
   *
   * Returns undefined for every kind of failure, deliberately. The caller is
   * presenting a bearer token, and distinguishing "no such grant" from "wrong
   * values" or "already used" would tell an attacker which part to change.
   *
   * The request's status is not checked: the task can reach the gate before
   * `launch` has finished recording its id, so `approved` and `running` are
   * both legitimate here. The grant's own guards are what decide.
   */
  async consumeGrant(options: {
    requestId: string;
    token: string;
    valuesHash: string;
    taskId: string;
    templateRef: string;
  }): Promise<ConsumeGrantResponse | undefined> {
    // An unparseable ref cannot match anything.
    const templateRef = tryNormaliseEntityRef(options.templateRef);
    if (!templateRef) {
      return undefined;
    }

    const consumed = await this.store.consumeGrant({
      requestId: options.requestId,
      tokenHash: hashGrantToken(options.token),
      valuesHash: options.valuesHash,
      taskId: options.taskId,
      templateRef,
    });
    if (!consumed) {
      return undefined;
    }

    // Read back only after the grant is spent, so nothing about a request is
    // revealed to a caller whose token was refused. The grant's foreign key
    // makes a missing request impossible short of a concurrent delete.
    const request = await this.store.getRequestWithDecisions(options.requestId);
    if (!request) {
      throw new ConflictError(
        `Approval grant for ${options.requestId} was consumed but the request has gone`,
      );
    }

    return {
      requestId: request.id,
      requesterRef: request.requesterRef,
      approvedBy: [
        ...new Set(
          request.decisions
            .filter(decision => decision.decision === 'approve')
            .map(decision => decision.approverRef),
        ),
      ],
    };
  }

  /** Whether submitted values still satisfy a template's parameters now. */
  private valuesStillFit(
    template: TemplateEntityV1beta3,
    values: JsonObject,
  ): boolean {
    try {
      validateValues(template, values);
      return true;
    } catch (error) {
      if (error instanceof InputError) {
        return false;
      }
      throw error;
    }
  }

  /**
   * End a request whose launch the scaffolder refused outright.
   *
   * The grant is withdrawn first, so nothing can redeem it once the request
   * says it failed. Revoking loses to a task that has redeemed the grant; a
   * refusal means no such task exists, but if one ever did, its id is
   * recovered rather than the request being failed underneath a running
   * template.
   */
  private async failRefusedLaunch(
    requestId: string,
    grantId: string,
    reason: string,
  ): Promise<void> {
    if (!(await this.store.revokeGrant(grantId))) {
      await this.recoverStartedTask(requestId);
      return;
    }

    if (
      await this.store.transition(requestId, 'approved', 'failed', {
        failureReason: reason,
      })
    ) {
      this.logger.warn(`Approval request ${requestId} failed: ${reason}`);
      await this.notifyCurrent(requestId, failed =>
        this.observer?.onFailed?.(failed, reason),
      );
    }
  }

  /**
   * Move a request to `running` on the strength of a grant a task has already
   * redeemed.
   *
   * Returns true when there was such a task, whether or not this call was the
   * one that recorded it.
   */
  private async recoverStartedTask(requestId: string): Promise<boolean> {
    const taskId = (await this.store.findConsumedGrant(requestId))
      ?.consumed_by_task_id;
    if (!taskId) {
      return false;
    }

    if (
      await this.store.transition(requestId, 'approved', 'running', { taskId })
    ) {
      this.logger.info(
        `Recovered task ${taskId} for approval request ${requestId} from its consumed grant`,
      );
      await this.notifyLaunched(requestId);
    }
    return true;
  }

  private async notifyLaunched(requestId: string): Promise<void> {
    await this.notifyCurrent(requestId, request =>
      this.observer?.onLaunched?.(request),
    );
  }

  private async getTemplate(
    templateRef: string,
    credentials: BackstageCredentials,
  ): Promise<TemplateEntityV1beta3 | undefined> {
    return (await this.catalog.getEntityByRef(templateRef, {
      credentials,
    })) as TemplateEntityV1beta3 | undefined;
  }

  private async requireRequest(id: string): Promise<ApprovalRequest> {
    const request = await this.store.getRequest(id);
    if (!request) {
      throw new NotFoundError(`No such approval request: ${id}`);
    }
    return request;
  }

  private async requireRequestWithDecisions(
    id: string,
  ): Promise<ApprovalRequestWithDecisions> {
    const request = await this.store.getRequestWithDecisions(id);
    if (!request) {
      throw new NotFoundError(`No such approval request: ${id}`);
    }
    return request;
  }

  private async callerRef(credentials: BackstageCredentials): Promise<string> {
    const { userEntityRef } = await this.userInfo.getUserInfo(credentials);
    return normaliseCallerRef(userEntityRef);
  }

  /**
   * Tell the observer about a change, with the request as it is *now*.
   *
   * Always re-read after the write: a request loaded before a transition still
   * carries its old status, and every subscriber would be told, say, that a
   * rejected request is still awaiting a decision.
   */
  private async notifyCurrent(
    requestId: string,
    hook: (request: ApprovalRequest) => Promise<void> | undefined,
  ): Promise<void> {
    const current = await this.store.getRequest(requestId);
    if (current) {
      await this.notify(() => hook(current));
    }
  }

  /**
   * Run an observer hook without letting it affect the outcome.
   *
   * Notifications and signals are soft dependencies, and a state change that
   * has already been committed must not be reported as failed because a
   * notification could not be sent.
   */
  private async notify(hook: () => Promise<void> | undefined): Promise<void> {
    try {
      await hook();
    } catch (error) {
      this.logger.warn(
        'An approvals observer threw; the state change still stands',
        error instanceof Error ? error : undefined,
      );
    }
  }
}
