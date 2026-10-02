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
  APPROVAL_REQUEST_STATUSES,
  approvalRequestCancelPermission,
  approvalRequestCreatePermission,
  approvalRequestDecidePermission,
  approvalRequestReadPermission,
  type ApprovalRequestStatus,
  type ConsumeGrantRequest,
  type ConsumeGrantResponse,
} from '@ferin79/backstage-plugin-scaffolder-approvals-common';
import { parseGrant } from '@ferin79/backstage-plugin-scaffolder-approvals-node';
import type {
  AuditorService,
  BackstageCredentials,
  BackstageServicePrincipal,
  HttpAuthService,
  LoggerService,
  PermissionsService,
  UserInfoService,
} from '@backstage/backend-plugin-api';
import { InputError, NotAllowedError, NotFoundError } from '@backstage/errors';
import {
  AuthorizeResult,
  type BasicPermission,
  type ResourcePermission,
} from '@backstage/plugin-permission-common';
import type { JsonObject } from '@backstage/types';
import express from 'express';
import Router from 'express-promise-router';
import { z, ZodError, type ZodType } from 'zod';
import type { ApprovalStore } from '../database';
import type { ApprovalService } from './ApprovalService';

/** Construction options for {@link createRouter}. */
export interface RouterOptions {
  service: ApprovalService;
  store: ApprovalStore;
  httpAuth: HttpAuthService;
  userInfo: UserInfoService;
  permissions: PermissionsService;
  logger: LoggerService;
  /**
   * Where decisions are recorded for audit (P4).
   *
   * Optional, because the plugin has to work in a deployment that does not
   * wire one — but note that the approvals tables are themselves the audit
   * trail of who approved what. This is what puts the same events into
   * whatever the deployment already collects.
   */
  auditor?: AuditorService;
  /**
   * Service principal subjects allowed to redeem a grant (S3).
   *
   * Defaults to the scaffolder alone. See `assertGrantConsumer` for why this is
   * configurable rather than a hard-coded equality.
   */
  grantConsumers?: string[];
}

/** The only caller that has any business redeeming a grant. */
export const DEFAULT_GRANT_CONSUMERS = ['plugin:scaffolder'];

/**
 * Request ids are uuids, and every route that takes one has to say so.
 *
 * Postgres types the column as `uuid` and rejects anything malformed at the
 * driver, so `GET /requests/not-a-uuid` came back as a 500 there while SQLite
 * and MySQL answered 404 — the same request, three different answers, and the
 * one that looks like a server fault is the one an operator pages on. Checking
 * the shape first also keeps a malformed id out of the permission framework's
 * `getResources`, which would otherwise make the same trip to the database.
 */
const requestId = z.string().uuid('must be a request id');

const submitBody = z.object({
  templateRef: z.string().min(1),
  values: z.record(z.string(), z.unknown()).default({}),
});

const decisionBody = z.object({
  decision: z.enum(['approve', 'deny']),
  comment: z.string().max(4096).optional(),
});

// Typed against the shared wire contract, so the gate action and this schema
// cannot drift apart without a type error.
const consumeBody: ZodType<ConsumeGrantRequest> = z.object({
  grant: z.string().min(1),
  // Checked here so a malformed digest is a 400 rather than a TypeError from
  // the store's own guard.
  valuesHash: z
    .string()
    .regex(/^[0-9a-f]{64}$/, 'must be a hex SHA-256 digest'),
  taskId: z.string().min(1),
  templateRef: z.string().min(1),
});

const listQuery = z.object({
  status: z
    .union([z.string(), z.array(z.string())])
    .optional()
    .transform(value =>
      value === undefined
        ? undefined
        : (Array.isArray(value) ? value : [value]).flatMap(entry =>
            entry.split(','),
          ),
    ),
  role: z.enum(['requester', 'approver']).optional(),
  // A query string carries text, so `true` arrives as "true". Anything other
  // than the two spellings is refused rather than read as false, so a typo
  // cannot quietly turn an inbox back into a list of everything.
  actionable: z
    .enum(['true', 'false'])
    .optional()
    .transform(value => (value === undefined ? undefined : value === 'true')),
  templateRef: z.string().optional(),
  requesterRef: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(200).optional(),
  offset: z.coerce.number().int().min(0).optional(),
});

/**
 * Validate untrusted input, reporting a failure as a client error.
 *
 * A bare `schema.parse` throws a `ZodError`, which Backstage's error middleware
 * does not recognise as a client error and therefore turns into a 500 — a
 * malformed body would be reported as a server fault.
 */
function parseOrBadRequest<T>(
  schema: ZodType<T>,
  input: unknown,
  what: string,
): T {
  try {
    return schema.parse(input);
  } catch (error) {
    if (error instanceof ZodError) {
      const detail = error.issues
        .map(issue =>
          issue.path.length
            ? `${issue.path.join('.')}: ${issue.message}`
            : issue.message,
        )
        .join('; ');
      throw new InputError(`Invalid ${what}: ${detail}`);
    }
    throw error;
  }
}

function readStatuses(
  raw: string[] | undefined,
): ApprovalRequestStatus[] | undefined {
  if (!raw) {
    return undefined;
  }
  const invalid = raw.filter(
    status =>
      !(APPROVAL_REQUEST_STATUSES as readonly string[]).includes(status),
  );
  if (invalid.length) {
    throw new InputError(`Unknown status: ${invalid.join(', ')}`);
  }
  return raw as ApprovalRequestStatus[];
}

/**
 * HTTP surface for the approvals plugin.
 *
 * Deliberately thin: the state machine lives in {@link ApprovalService}, which
 * already throws the error types Backstage's middleware maps onto status codes,
 * so there is no error translation here. What does live here is authorization,
 * because that is a property of the request rather than of the state machine.
 */
export async function createRouter(
  options: RouterOptions,
): Promise<express.Router> {
  const {
    service,
    store,
    httpAuth,
    userInfo,
    permissions,
    logger,
    auditor,
    grantConsumers = DEFAULT_GRANT_CONSUMERS,
  } = options;

  /**
   * Record one auditable operation, whatever its outcome.
   *
   * Wrapping rather than logging after the fact, so a refusal is audited as
   * loudly as a success: "who tried to approve what and was told no" is the
   * half of an audit trail that gets left out when events are emitted only on
   * the happy path.
   */
  async function audited<T>(
    options2: {
      eventId: string;
      severityLevel: 'low' | 'medium' | 'high' | 'critical';
      request: express.Request;
      meta?: Record<string, JsonObject[string]>;
    },
    run: () => Promise<T>,
  ): Promise<T> {
    // An auditor that cannot record must not stop an approval. The approvals
    // tables are the system of record for who approved what; this is a second
    // copy for whatever the deployment already collects, and losing the copy
    // is not a reason to refuse the decision. Same reasoning as the notifier.
    const event = auditor
      ? await auditor
          .createEvent({
            eventId: options2.eventId,
            severityLevel: options2.severityLevel,
            request: options2.request,
            meta: options2.meta,
          })
          .catch(error => {
            logger.warn(
              `Could not open an audit event for ${options2.eventId}`,
              error instanceof Error ? error : undefined,
            );
            return undefined;
          })
      : undefined;

    const record = (finish: () => Promise<void>) =>
      finish().catch(error => {
        logger.warn(
          `Could not close the audit event for ${options2.eventId}`,
          error instanceof Error ? error : undefined,
        );
      });

    try {
      const result = await run();
      if (event) {
        await record(() => event.success());
      }
      return result;
    } catch (error) {
      if (event) {
        await record(() =>
          event.fail({
            error: error instanceof Error ? error : new Error(String(error)),
          }),
        );
      }
      throw error;
    }
  }

  const router = Router();
  router.use(express.json());

  /** Authorize a basic (non-resource) permission. */
  async function authorizeBasic(
    permission: BasicPermission,
    req: express.Request,
  ): Promise<void> {
    const credentials = await httpAuth.credentials(req, { allow: ['user'] });
    const [decision] = await permissions.authorize([{ permission }], {
      credentials,
    });
    if (decision.result !== AuthorizeResult.ALLOW) {
      throw new NotAllowedError(`Not allowed to perform '${permission.name}'`);
    }
  }

  /**
   * Authorize a resource permission against one request.
   *
   * The framework loads the request through `getResources` and runs the
   * registered rules' `apply` against it, so a conditional policy resolves to a
   * definite answer here.
   */
  async function authorizeOn(
    permission: ResourcePermission<string>,
    resourceRef: string,
    req: express.Request,
  ): Promise<void> {
    const credentials = await httpAuth.credentials(req, { allow: ['user'] });
    const [decision] = await permissions.authorize(
      [{ permission, resourceRef }],
      { credentials },
    );
    if (decision.result !== AuthorizeResult.ALLOW) {
      throw new NotAllowedError(
        `Not allowed to perform '${permission.name}' on ${resourceRef}`,
      );
    }
  }

  router.post('/requests', async (req, res) => {
    await authorizeBasic(approvalRequestCreatePermission, req);
    const credentials = await httpAuth.credentials(req, { allow: ['user'] });

    const body = parseOrBadRequest(submitBody, req.body, 'request body');
    const result = await audited(
      {
        eventId: 'request-submit',
        // Asking is not the privileged act; agreeing is.
        severityLevel: 'medium',
        request: req,
        meta: { templateRef: body.templateRef },
      },
      () =>
        service.submit({
          templateRef: body.templateRef,
          // The body arrived through `express.json()`, so it is JSON by
          // construction; `JsonObject` only differs in admitting `undefined`,
          // which `JSON.parse` cannot produce.
          values: body.values as JsonObject,
          credentials,
        }),
    );

    // 200 rather than 201 when collapsed, since nothing was created.
    res.status(result.collapsed ? 200 : 201).json(result);
  });

  router.get('/requests', async (req, res) => {
    const credentials = await httpAuth.credentials(req, { allow: ['user'] });

    // Reads are open to any signed-in user (Q12), so there is no filter to
    // push down. `authorizeConditional` is still used rather than skipping the
    // check, so that a policy denying reads outright is honoured — and so that
    // a policy returning a *condition* is refused loudly instead of being
    // silently ignored, which would be a quiet hole in whatever that policy
    // was trying to enforce. The extension point is the rules' `toQuery`
    // together with `ListApprovalRequestRows.approverRefs`.
    const [decision] = await permissions.authorizeConditional(
      [{ permission: approvalRequestReadPermission }],
      { credentials },
    );
    if (decision.result === AuthorizeResult.DENY) {
      throw new NotAllowedError('Not allowed to read approval requests');
    }
    if (decision.result === AuthorizeResult.CONDITIONAL) {
      throw new NotAllowedError(
        'This deployment has a conditional read policy for approval requests, which is not supported yet',
      );
    }

    const query = parseOrBadRequest(listQuery, req.query, 'query');
    const statuses = readStatuses(query.status);

    if (query.actionable && query.role !== 'approver') {
      throw new InputError(
        "'actionable' needs role=approver: it narrows the requests that name you as an approver to the ones you can still decide on",
      );
    }

    let requesterRef = query.requesterRef;
    let approverRefs: string[] | undefined;
    let actionableBy: string | undefined;

    if (query.role) {
      // `ownershipEntityRefs` is the user's own ref plus every group they
      // belong to, transitively, resolved by the catalog rather than expanded
      // here. It comes from the caller's token, so a group added to somebody's
      // membership shows up in their inbox from their next sign-in.
      const caller = await userInfo.getUserInfo(credentials);
      if (query.role === 'requester') {
        requesterRef = caller.userEntityRef;
      } else {
        approverRefs = caller.ownershipEntityRefs;
        // Named is not the same as able to act. Without this an approver's
        // inbox keeps every request they have already voted on, and their own
        // where self-approval is forbidden (B2 in the browser review).
        if (query.actionable) {
          actionableBy = caller.userEntityRef;
        }
      }
    }

    res.json(
      await store.listRequests({
        status: statuses,
        templateRef: query.templateRef,
        requesterRef,
        approverRefs,
        actionableBy,
        limit: query.limit,
        offset: query.offset,
      }),
    );
  });

  router.get('/requests/:id', async (req, res) => {
    // Before authorizing, so that a malformed id never reaches the
    // permission framework's resource load or the database.
    const id = parseOrBadRequest(requestId, req.params.id, 'request id');
    await authorizeOn(approvalRequestReadPermission, id, req);

    const request = await store.getRequestWithDecisions(id);
    if (!request) {
      throw new NotFoundError(`No such approval request: ${id}`);
    }

    // §10.3. Only on the detail route: it costs a catalog read, and the list
    // would pay it once per row for something nobody can act on from a table.
    const credentials = await httpAuth.credentials(req);
    const templateDrift = await service.templateDrift(request, credentials);

    res.json(templateDrift ? { ...request, templateDrift } : request);
  });

  router.post('/requests/:id/decision', async (req, res) => {
    // Before authorizing, so that a malformed id never reaches the
    // permission framework's resource load or the database.
    const id = parseOrBadRequest(requestId, req.params.id, 'request id');

    // The check the whole feature rests on (Q19). It runs in addition to the
    // service's own eligibility check: this one is what an RBAC policy can see
    // and extend, while the service enforces the gate's own terms.
    await authorizeOn(approvalRequestDecidePermission, id, req);
    const credentials = await httpAuth.credentials(req, { allow: ['user'] });

    const body = parseOrBadRequest(decisionBody, req.body, 'request body');
    res.json(
      await audited(
        {
          eventId: 'request-decide',
          // The act the whole plugin exists to record.
          severityLevel: 'high',
          request: req,
          meta: { requestId: id, decision: body.decision },
        },
        () =>
          service.decide({
            requestId: id,
            decision: body.decision,
            comment: body.comment,
            credentials,
          }),
      ),
    );
  });

  router.post('/requests/:id/cancel', async (req, res) => {
    // Before authorizing, so that a malformed id never reaches the
    // permission framework's resource load or the database.
    const id = parseOrBadRequest(requestId, req.params.id, 'request id');
    await authorizeOn(approvalRequestCancelPermission, id, req);
    const credentials = await httpAuth.credentials(req, { allow: ['user'] });

    res.json(
      await audited(
        {
          eventId: 'request-cancel',
          severityLevel: 'medium',
          request: req,
          meta: { requestId: id },
        },
        () => service.cancel({ requestId: id, credentials }),
      ),
    );
  });

  /**
   * Refuse a service principal that is not the scaffolder.
   *
   * `allow: ['service']` on its own lets in every service principal, including
   * a static `external:` token an adopter issued for something unrelated. Such
   * a caller cannot forge a grant, but it can *spend* one it has seen: a
   * redeemed grant is single-use, so the legitimate task then fails at its own
   * gate. That is a denial of service against approved runs.
   *
   * The framework documents `principal.subject` as informational, so this is
   * deliberately a configurable allow-list rather than a hard-coded equality:
   * a split deployment, a renamed plugin id or a gateway in front of the
   * backend can present something else, and widening it must not need a code
   * change. The grant's own guards remain the real control; this is the outer
   * fence.
   */
  function assertGrantConsumer(credentials: BackstageCredentials): void {
    const { subject } = credentials.principal as BackstageServicePrincipal;
    if (grantConsumers.includes(subject)) {
      return;
    }
    // Logged rather than returned: the caller learns only that it was refused,
    // but an operator who widened the deployment can see what to allow.
    logger.warn(
      `Refused an approval grant redemption from '${subject}'; only ${grantConsumers.join(
        ', ',
      )} may redeem grants. Set scaffolderApprovals.grantConsumers to widen this.`,
    );
    throw new NotAllowedError(
      'This endpoint may only be called by the scaffolder',
    );
  }

  router.post('/grants/consume', async (req, res) => {
    // Service principals only. The caller is the gate action running inside the
    // scaffolder backend, and a grant is a capability to run an approved
    // template — a user must never be able to redeem one directly, which is the
    // difference between a gate and a suggestion.
    //
    // Note this trusts the caller's `valuesHash` and `templateRef` to describe
    // the task it is actually running. Nothing else can: only the task knows
    // what it is running. That is exactly why this route refuses user
    // principals — and why it refuses service principals other than the
    // scaffolder too.
    const credentials = await httpAuth.credentials(req, {
      allow: ['service'],
    });
    assertGrantConsumer(credentials);

    const body = parseOrBadRequest(consumeBody, req.body, 'request body');

    let grantRequestId: string;
    let token: string;
    try {
      ({ requestId: grantRequestId, token } = parseGrant(body.grant));
      // A grant carries its request id, and that half is subject to exactly
      // the same driver-level typing as one in a URL.
      grantRequestId = requestId.parse(grantRequestId);
    } catch (error) {
      throw new InputError('The approval grant is malformed');
    }

    // Audited around the whole redemption, so a refused grant is recorded as
    // well as a spent one: a grant presented and rejected is the signal that
    // something is being replayed.
    const consumed = await audited(
      {
        eventId: 'grant-consume',
        severityLevel: 'high',
        request: req,
        meta: {
          requestId: grantRequestId,
          taskId: body.taskId,
          templateRef: body.templateRef,
        },
      },
      async () => {
        const result = await service.consumeGrant({
          requestId: grantRequestId,
          token,
          valuesHash: body.valuesHash,
          taskId: body.taskId,
          templateRef: body.templateRef,
        });
        if (!result) {
          throw new NotAllowedError('The approval grant is not valid');
        }
        return result;
      },
    ).catch((error: unknown) => {
      if (
        error instanceof NotAllowedError &&
        error.message === 'The approval grant is not valid'
      ) {
        return undefined;
      }
      throw error;
    });

    if (!consumed) {
      // One refusal for every reason: telling a bearer-token holder whether it
      // was the token, the values or the expiry that failed would be an oracle.
      logger.warn(
        `Refused an approval grant for request ${grantRequestId} and task ${body.taskId}`,
      );
      throw new NotAllowedError('The approval grant is not valid');
    }

    const consumeResponse: ConsumeGrantResponse = consumed;
    res.json(consumeResponse);
  });

  return router;
}
