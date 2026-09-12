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
  computeQuorumProgress,
  type DecideApprovalRequestOptions,
  type DecisionIneligibility,
  type GatePolicy,
  readGatePolicy,
  type SubmitApprovalRequestResponse,
} from '@backstage-community/plugin-scaffolder-approvals-common';
import {
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

    const created = await this.store.createOrCollapse({
      templateRef,
      values,
      valuesHash: computeValuesHash(values),
      requesterRef,
      summary: policy.summary,
      policySnapshot: policy,
      expiresAt: policy.timeout
        ? new Date(
            this.now().getTime() + durationToMilliseconds(policy.timeout),
          )
        : undefined,
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
        await this.notify(() =>
          this.observer?.onDecided(request, recorded.decision),
        );
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
      await this.notify(() =>
        this.observer?.onDecided(request, recorded.decision),
      );
      await this.launch(requestId);
    }

    return await this.requireRequestWithDecisions(requestId);
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
   * Safe to call more than once, which the reconciliation sweep relies on. Two
   * things make that true:
   *
   * - **It refuses to mint a second live grant.** Otherwise a crash between
   *   `scaffold()` returning and the status transition would leave a running
   *   task with no recorded `task_id`, and a retry would mint a fresh grant and
   *   run the template a second time. With this guard the retry declines, and
   *   the first grant's `consumed_by_task_id` is how the sweep recovers the
   *   task id it lost. If the task never started, the grant simply expires and
   *   the request fails — which is the documented outcome.
   * - **A launch failure leaves the request `approved`.** Nothing executed and
   *   the grant is unconsumed, so retrying is both safe and correct. This is
   *   deliberately different from a task that ran and failed (Q5), which is
   *   terminal and needs a fresh approval.
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

    if (await this.store.hasLiveGrant(requestId)) {
      this.logger.info(
        `Not launching approval request ${requestId}; a grant is already outstanding`,
      );
      return;
    }

    const token = generateGrantToken();
    await this.store.createGrant({
      requestId,
      tokenHash: hashGrantToken(token),
      valuesHash: request.valuesHash,
      expiresAt: new Date(this.now().getTime() + this.grantTtlMs),
    });

    // Service credentials, not the requester's: `AuthService` cannot mint
    // credentials for an arbitrary user from an entity ref, and by the time an
    // approval lands there is no request from the requester in flight. The
    // consequence is that `task.createdBy` is the service principal, which is
    // why the request page rather than the scaffolder task list is the
    // canonical view of who asked for what.
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
      // Q9: a launch failure is not a task failure. Leave the request
      // `approved` with no task id; the reconciliation sweep retries while the
      // grant is still valid, and fails the request once it is not.
      this.logger.warn(
        `Failed to launch approval request ${requestId}; will retry while the grant is valid`,
        error instanceof Error ? error : undefined,
      );
      return;
    }

    if (
      !(await this.store.transition(requestId, 'approved', 'running', {
        taskId,
      }))
    ) {
      // The task is running regardless, so losing this race must not be silent.
      this.logger.warn(
        `Launched task ${taskId} for approval request ${requestId}, but the request had already left 'approved'`,
      );
    }
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
  }): Promise<boolean> {
    return await this.store.consumeGrant({
      requestId: options.requestId,
      tokenHash: hashGrantToken(options.token),
      valuesHash: options.valuesHash,
      taskId: options.taskId,
    });
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
    return userEntityRef;
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
