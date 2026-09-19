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
  APPROVAL_GRANT_SECRET,
  type ApprovalDecision,
  type ApprovalRequest,
  type ApprovalRequestWithDecisions,
  checkDecisionEligibility,
  type ConsumeGrantResponse,
  computeQuorumProgress,
  type DecideApprovalRequestOptions,
  type DecisionIneligibility,
  type GatePolicy,
  readGatePolicy,
  normaliseEntityRef,
  renderGateSummary,
  type SubmitApprovalRequestResponse,
  type TemplateDrift,
} from '@backstage-community/plugin-scaffolder-approvals-common';
import {
  compareTemplate,
  computeTemplateStepsHash,
  computeValuesHash,
  findGateStep,
  formatGrant,
  generateGrantToken,
  GateStepError,
  hashGrantToken,
} from '@backstage-community/plugin-scaffolder-approvals-node';
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
import { durationToMilliseconds, type HumanDuration } from '@backstage/types';
import type { JsonObject, JsonValue } from '@backstage/types';
import type { ApprovalStore } from '../database';
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
  /**
   * The template is running.
   *
   * Optional, because it carries no notification (Q20) and an implementation
   * that only feeds somebody's inbox has nothing to do with it.
   */
  onLaunched?(request: ApprovalRequest): Promise<void>;
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
  /** How long a minted grant stays redeemable (Q7). */
  grantTtl: HumanDuration;
  observer?: ApprovalObserver;
  now?: () => Date;
}

/** Why a caller was refused a vote, in words. */
const INELIGIBILITY_MESSAGES: Record<DecisionIneligibility, string> = {
  'not-an-approver': 'You are not an approver for this request',
  'self-approval': 'Self-approval is not permitted for this request',
  'not-pending': 'This request has already been decided',
  'already-voted': 'You have already decided on this request',
};

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
 *
 * Not configurable, deliberately: Q17 keeps app-config to `grantTtl` and
 * `retention`.
 */
const LAUNCH_CLAIM_GRACE_MS = 10 * 60 * 1000;

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
   * refs, and the catalog resolves them at decision time.
   */
  async submit(options: SubmitOptions): Promise<SubmitApprovalRequestResponse> {
    const { templateRef, values, credentials } = options;

    const requesterRef = await this.callerRef(credentials);

    const template = (await this.catalog.getEntityByRef(templateRef, {
      credentials,
    })) as TemplateEntityV1beta3 | undefined;

    if (!template) {
      throw new NotFoundError(`No such template: ${templateRef}`);
    }
    if (template.kind !== 'Template') {
      throw new InputError(`${templateRef} is not a Template`);
    }

    let gate;
    try {
      gate = findGateStep(template);
    } catch (error) {
      // A malformed gate is a template bug, not a caller mistake, but the
      // caller is who is standing here — so say what is wrong with it.
      if (error instanceof GateStepError) {
        throw new InputError(
          `${templateRef} has an unusable gate: ${error.message}`,
        );
      }
      throw error;
    }

    if (!gate.step) {
      throw new InputError(
        `${templateRef} is not gated; run it through the scaffolder directly`,
      );
    }

    // Validated before anything is stored (Q3), so an approval is never spent
    // on a request that cannot run.
    validateValues(template, values);

    let policy: GatePolicy;
    try {
      policy = readGatePolicy(gate.step.input);
    } catch (error) {
      throw new InputError(
        `${templateRef} has an unusable gate policy: ${
          error instanceof Error ? error.message : error
        }`,
      );
    }

    // The gate step comes from the catalog, where the scaffolder's templating
    // has not run — and for a gated template it would not run until after the
    // approval this summary exists to inform. Fill the parameter references in
    // here, or approvers read a literal `${{ parameters.repository }}`.
    const summary = policy.summary
      ? renderGateSummary(policy.summary, values)
      : undefined;

    const created = await this.store.createOrCollapse({
      // Stored in one spelling, not as sent. `Template:Default/Gated` and
      // `template:default/gated` are the same template, and storing them as
      // written created two requests where Q13 wants one — and let a grant
      // approved for one spelling be refused for the other now that consuming
      // checks the template too.
      templateRef: normaliseEntityRef(templateRef),
      values,
      valuesHash: computeValuesHash(values),
      requesterRef,
      summary,
      policySnapshot: policy,
      expiresAt: policy.timeout
        ? new Date(
            this.now().getTime() + durationToMilliseconds(policy.timeout),
          )
        : undefined,
      // §10.3: what the template looked like now, so an approver deciding in
      // three days can be told if it has changed underneath them.
      templateUid: template.metadata.uid,
      templateStepsHash: computeTemplateStepsHash(template),
    });

    if (!created.collapsed) {
      const request = await this.store.getRequest(created.id);
      if (request) {
        await this.notify(() => this.observer?.onSubmitted(request));
      }
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
    try {
      const template = await this.catalog.getEntityByRef(request.templateRef, {
        credentials,
      });
      return compareTemplate({
        template,
        submittedUid: request.templateUid,
        submittedStepsHash: request.templateStepsHash,
      });
    } catch (error) {
      this.logger.warn(
        `Could not check ${request.templateRef} for drift`,
        error instanceof Error ? error : undefined,
      );
      return undefined;
    }
  }

  /**
   * Record a vote and, if the gate is now satisfied, approve and launch.
   *
   * A single denial rejects the request outright regardless of the approval
   * count — a quorum is a threshold for assent, not a tally.
   */
  async decide(options: DecideOptions): Promise<ApprovalRequestWithDecisions> {
    const { requestId, decision, comment, credentials } = options;

    if (decision !== 'approve' && decision !== 'deny') {
      throw new InputError(`Unknown decision: ${decision}`);
    }

    const caller = await this.userInfo.getUserInfo(credentials);

    const request = await this.store.getRequest(requestId);
    if (!request) {
      throw new NotFoundError(`No such approval request: ${requestId}`);
    }

    const existing = await this.store.listDecisions(requestId);
    const eligibility = checkDecisionEligibility(request, caller, existing);
    if (!eligibility.allowed) {
      const message = INELIGIBILITY_MESSAGES[eligibility.reason];
      // A stale request is a conflict; the other reasons are refusals.
      throw eligibility.reason === 'not-pending' ||
        eligibility.reason === 'already-voted'
        ? new ConflictError(message)
        : new NotAllowedError(message);
    }

    const recorded = await this.store.recordDecision({
      requestId,
      approverRef: caller.userEntityRef,
      decision,
      comment,
    });

    if (!recorded.recorded) {
      // Lost a race with the same approver's other request. The stored vote
      // stands, since decisions are append-only.
      throw new ConflictError(INELIGIBILITY_MESSAGES['already-voted']);
    }

    const decidedAt = this.now();

    if (decision === 'deny') {
      const rejected = await this.store.transition(
        requestId,
        'pending',
        'rejected',
        { decidedAt },
      );
      if (rejected) {
        // Re-read, never reuse `request`: it was loaded before the transition
        // and still says `pending`, so every subscriber would be told a
        // rejected request is awaiting a decision.
        await this.notifyDecided(requestId, recorded.decision);
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
      return await this.requireRequestWithDecisions(requestId);
    }

    const approved = await this.store.transition(
      requestId,
      'pending',
      'approved',
      { decidedAt },
    );

    if (approved) {
      await this.notifyDecided(requestId, recorded.decision);
      await this.launch(requestId);
    }

    return await this.requireRequestWithDecisions(requestId);
  }

  /**
   * Tell the observer about a decision, with the request as it is *now*.
   *
   * The request this method is handed by `decide` was loaded before the
   * transition, so its status is still `pending` whatever the decision did.
   * Publishing that is worse than publishing nothing: an external subscriber
   * acting on `status` would see every approval and every rejection as an
   * undecided request.
   */
  private async notifyDecided(
    requestId: string,
    decision: ApprovalDecision,
  ): Promise<void> {
    const current = await this.store.getRequest(requestId);
    if (!current) {
      return;
    }
    await this.notify(() => this.observer?.onDecided(current, decision));
  }

  /**
   * Withdraw a pending request.
   *
   * Only the requester may withdraw, and only before a decision — that is what
   * `cancelled` means, as distinct from `rejected`.
   */
  async cancel(options: {
    requestId: string;
    credentials: BackstageCredentials;
  }): Promise<ApprovalRequest> {
    const callerRef = await this.callerRef(options.credentials);

    const request = await this.store.getRequest(options.requestId);
    if (!request) {
      throw new NotFoundError(`No such approval request: ${options.requestId}`);
    }

    if (request.requesterRef !== callerRef) {
      throw new NotAllowedError('Only the requester may cancel a request');
    }

    if (
      !(await this.store.transition(options.requestId, 'pending', 'cancelled', {
        decidedAt: this.now(),
      }))
    ) {
      throw new ConflictError(
        `Approval request ${options.requestId} is no longer pending`,
      );
    }

    return await this.requireRequest(options.requestId);
  }

  /**
   * Mint a grant and start the scaffolder task.
   *
   * Safe to call more than once, which the reconciliation sweep relies on, and
   * the four steps below are what make that true.
   *
   * **1. Claim the launch.** A compare-and-set on the request, so that a
   * decision and a sweep tick racing each other produce exactly one launch
   * rather than two grants and two tasks (§6 forbids read-then-write here). A
   * claim goes stale after {@link LAUNCH_CLAIM_GRACE_MS}, so a launcher that
   * crashed mid-flight does not block the request forever.
   *
   * **2. Recover a task that already started.** If a grant has been consumed,
   * the template is running and only this plugin's record of it was lost — a
   * crash between `scaffold()` returning and the status transition. Its
   * `consumed_by_task_id` is the task id, which is the whole reason that column
   * exists.
   *
   * **3. Revoke a grant a previous attempt left behind.** Q9 asks for the
   * launch to be retried, and it cannot be while the old grant is still
   * redeemable: two live grants is two possible runs. Revoking is itself
   * compare-and-set, so a task redeeming the grant at the same moment wins and
   * this caller recovers its id instead.
   *
   * **4. Stop at the deadline.** The first grant's expiry is when the approval
   * stops being redeemable. Past it, `launch` does nothing and the sweep fails
   * the request — Q9's "`failed` only once the grant lapses". This is
   * deliberately different from a task that ran and failed (Q5), which is
   * terminal and needs a fresh approval.
   */
  async launch(requestId: string): Promise<void> {
    const request = await this.store.getRequest(requestId);
    if (!request) {
      throw new NotFoundError(`No such approval request: ${requestId}`);
    }

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

    // Noted, not refused. A template repo takes unrelated commits while an
    // approval waits, and failing every in-flight request on any edit would
    // make the feature unusable. What matters is that the change is visible:
    // the approver saw it on the request page before deciding, and this line
    // ties the run in the log to the template it actually ran.
    const drift = await this.templateDrift(
      request,
      await this.auth.getOwnServiceCredentials(),
    );
    if (drift?.changed) {
      this.logger.warn(
        `Launching approval request ${requestId} against a template that has changed since submit: ${drift.reasons.join(
          ', ',
        )}`,
      );
    }

    const token = generateGrantToken();
    await this.store.createGrant({
      requestId,
      tokenHash: hashGrantToken(token),
      valuesHash: request.valuesHash,
      expiresAt: deadline,
    });

    // Service credentials, not the requester's: `AuthService` cannot mint
    // credentials for an arbitrary user from an entity ref, and by the time an
    // approval lands there is no request from the requester in flight.
    //
    // Three consequences, all deliberate and all documented in the README:
    //
    // - `task.createdBy` is the service principal, which is why the request
    //   page rather than the scaffolder task list is the canonical view of who
    //   asked for what, and why `${{ user.* }}` renders empty in the template.
    // - `ServerPermissionClient` answers ALLOW for a service principal without
    //   consulting any policy, so the run is not permission-checked. An
    //   approval can grant more than the requester could have run themselves;
    //   the approver list is the access-control boundary.
    // - Steps that call other plugins act as this plugin, not as the
    //   requester.
    //
    // A deployment that needs the tighter property adds a
    // `scaffolder.action.execute` policy denying the action to user
    // principals, which reaches every direct run and no approved one.
    const credentials = await this.auth.getOwnServiceCredentials();

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
      // Q9: a launch failure is not a task failure, so the request stays
      // `approved` and the next sweep retries it.
      //
      // The grant is deliberately left live rather than revoked here. The
      // error does not say whether a task was created: `ScaffolderClient`
      // throws a plain `Error` for a non-2xx answer as well as for a timeout,
      // and a task that exists is on its way to the gate holding this grant.
      // Waiting out the grace period costs at most one sweep interval, while
      // guessing wrong would fail a run that was about to succeed.
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

  /** Announce a running template, again reading the request after the write. */
  private async notifyLaunched(requestId: string): Promise<void> {
    const current = await this.store.getRequest(requestId);
    if (!current) {
      return;
    }
    await this.notify(() => this.observer?.onLaunched?.(current));
  }

  /**
   * Move a request to `running` on the strength of a grant a task has already
   * redeemed.
   *
   * Returns true when there was such a task, whether or not this call was the
   * one that recorded it.
   */
  private async recoverStartedTask(requestId: string): Promise<boolean> {
    const consumed = await this.store.findConsumedGrant(requestId);
    if (!consumed?.consumed_by_task_id) {
      return false;
    }

    const taskId = consumed.consumed_by_task_id;
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

  /**
   * Redeem a grant on behalf of a running task.
   *
   * Returns false for every kind of failure, deliberately. The caller is
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
    // An unparseable ref cannot match anything, and saying so here would tell
    // a bearer-token holder which part of their guess was wrong.
    let templateRef: string;
    try {
      templateRef = normaliseEntityRef(options.templateRef);
    } catch {
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
    // revealed to a caller whose token was refused.
    const request = await this.store.getRequest(options.requestId);
    if (!request) {
      // The grant's foreign key makes this impossible short of a concurrent
      // delete, and the task is already running, so say so rather than hide it.
      throw new ConflictError(
        `Approval grant for ${options.requestId} was consumed but the request has gone`,
      );
    }

    const decisions = await this.store.listDecisions(options.requestId);

    return {
      requestId: request.id,
      requesterRef: request.requesterRef,
      approvedBy: [
        ...new Set(
          decisions
            .filter(decision => decision.decision === 'approve')
            .map(decision => decision.approverRef),
        ),
      ],
    };
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
    if (!userEntityRef) {
      throw new NotAllowedError(
        'Approval requests can only be submitted by a signed-in user',
      );
    }

    // Normalised, like every other ref this plugin stores. Two engines compare
    // strings differently — MySQL's default collation is case-insensitive
    // while SQLite and Postgres compare bytes — so a ref stored as written
    // makes "is this the requester?" and "collapse a duplicate" answer
    // differently depending on the database underneath.
    try {
      return normaliseEntityRef(userEntityRef);
    } catch {
      throw new NotAllowedError(`Not a usable user identity: ${userEntityRef}`);
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
