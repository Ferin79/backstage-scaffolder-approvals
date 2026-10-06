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
  type ConsumeGrantRequest,
  type ConsumeGrantResponse,
  GATE_ACTION_ID,
  HUMAN_DURATION_UNITS,
  SCAFFOLDER_APPROVALS_PLUGIN_ID,
} from '@ferin79/backstage-plugin-scaffolder-approvals-common';
import { computeValuesHash } from '@ferin79/backstage-plugin-scaffolder-approvals-node';
import type {
  AuthService,
  DiscoveryService,
} from '@backstage/backend-plugin-api';
import type { JsonObject } from '@backstage/types';
import { createTemplateAction } from '@backstage/plugin-scaffolder-node';

/**
 * What the caller sees when a gated template is run without going through the
 * approvals flow. Written for a template author or an engineer reading a failed
 * task, not for a machine.
 *
 * It points at the template's own form, because that is where a request is
 * made: the approvals page lists requests and cannot create one. And it says
 * what it means when that form still ends in Create, since then the app has not
 * installed the review step and following the advice would land here again.
 */
const NO_GRANT_MESSAGE =
  'This template requires approval before it can run, so it cannot be ' +
  "started directly. Submit it from the template's form instead: the last " +
  'step asks for approval rather than running it, and the template starts ' +
  'on its own once the request has been approved. If that step offers ' +
  'Create rather than Request approval, this Backstage app has not installed ' +
  "the approvals plugin's review step.";

/**
 * The gate: an action that refuses to let a template proceed without a grant.
 *
 * **This is the security boundary of the whole plugin.** Everything else —
 * the inbox, the notifications, the request page — is user experience. A
 * template is gated because this step stands in front of it and throws.
 *
 * A throw stops the run only for a template whose shape lets it. The scaffolder
 * skips a step with a falsy `if:`, runs an `each:` over an empty list zero
 * times, still executes later `always()`/`failure()` steps after a failure,
 * and drops steps a caller's step-read policy rejects. `findGateStep` refuses
 * all four shapes, at submit and at catalog ingestion, which is what makes
 * "the gate throws" mean "nothing else runs".
 *
 * It is an action rather than a check in the approvals backend because
 * `taskSpec.steps` is read from the catalog while callers supply only `values`
 * and `secrets`. A step is therefore the one part of a run that the person
 * starting it cannot influence.
 *
 * @public
 */
export function createApprovalGateAction(options: {
  auth: AuthService;
  discovery: DiscoveryService;
}) {
  const { auth, discovery } = options;

  return createTemplateAction({
    id: GATE_ACTION_ID,
    description:
      'Blocks the template until an approval request for it has been granted. Must be the first step.',
    // Deliberately not dry-run capable: a dry run has no grant, and pretending
    // to hold one would make the gate look passable.
    examples: [
      {
        description: 'Require approval from a team before the template runs',
        example: `steps:
  - id: gate
    name: Await approval
    action: ${GATE_ACTION_ID}
    input:
      approvers:
        - group:default/devx-team
      quorum: 2
      summary: 'Admin on \${{ parameters.repository }}'
      values: \${{ parameters }}
`,
      },
    ],
    schema: {
      input: {
        approvers: z =>
          z
            .array(z.string())
            .min(1)
            .describe('Group or user entity refs that may decide'),
        quorum: z =>
          z
            .number()
            .int()
            .positive()
            .optional()
            .describe('How many distinct principals must approve. Default 1'),
        selfApprove: z =>
          z
            .boolean()
            .optional()
            .describe(
              'Whether the requester may approve their own request. Default false',
            ),
        // Every unit the backend's policy reader accepts, so a gate that
        // submits cleanly cannot then fail here.
        timeout: z =>
          z
            .object(
              Object.fromEntries(
                HUMAN_DURATION_UNITS.map(unit => [unit, z.number().optional()]),
              ),
            )
            .optional()
            .describe(
              'How long the request may stay pending. Default: forever',
            ),
        summary: z =>
          z
            .string()
            .optional()
            .describe('A short description of the ask, shown to approvers'),
        values: z =>
          z
            .record(z.string(), z.any())
            .describe(
              'Always `${{ parameters }}`. The parameters this task is actually ' +
                'running, which are checked against the ones that were approved.',
            ),
      },
      output: {
        requestId: z =>
          z.string().describe('The approval request that unlocked this run'),
        requestedBy: z =>
          z.string().describe('Entity ref of the person who asked for this'),
        approvedBy: z =>
          z
            .array(z.string())
            .describe('Entity refs of the people who approved it'),
      },
    },
    async handler(ctx) {
      const grant = ctx.secrets?.[APPROVAL_GRANT_SECRET];
      if (!grant) {
        throw new Error(NO_GRANT_MESSAGE);
      }

      // The check that makes an approval mean something. The hash is
      // recomputed from the parameters *this* task is running, not from
      // anything the approvals backend said, so a grant stolen and replayed
      // against a task with different parameters does not match.
      //
      // `values` comes from the gate step's own input, which lives in the
      // catalog alongside the rest of the template — the same reason the gate
      // itself cannot be removed by whoever starts the run.
      //
      // The runner checks input against the schema before calling this, so the
      // guard below matters only when the action is invoked some other way. It
      // stays because this is the security boundary: it must fail closed, and
      // say why.
      if (
        typeof ctx.input.values !== 'object' ||
        ctx.input.values === null ||
        Array.isArray(ctx.input.values)
      ) {
        throw new Error(
          `The '${GATE_ACTION_ID}' step must pass 'values: \${{ parameters }}' so the ` +
            'approval can be checked against what is actually running',
        );
      }

      const valuesHash = computeValuesHash(ctx.input.values as JsonObject);

      const baseUrl = await discovery.getBaseUrl(
        SCAFFOLDER_APPROVALS_PLUGIN_ID,
      );
      const { token } = await auth.getPluginRequestToken({
        onBehalfOf: await auth.getOwnServiceCredentials(),
        targetPluginId: SCAFFOLDER_APPROVALS_PLUGIN_ID,
      });

      let response: Response;
      try {
        response = await fetch(`${baseUrl}/grants/consume`, {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({
            grant,
            valuesHash,
            taskId: ctx.task.id,
            // What this task is really running, so the backend can refuse a
            // grant that was approved for a different template.
            templateRef: ctx.templateInfo?.entityRef ?? '',
          } satisfies ConsumeGrantRequest),
        });
      } catch (error) {
        // An unreachable approvals backend must stop the run. Treating it as a
        // pass would turn an outage into an ungated execution.
        throw new Error(
          `Could not reach the approvals backend to redeem the grant: ${
            error instanceof Error ? error.message : error
          }`,
        );
      }

      if (!response.ok) {
        // The backend answers every failure identically on purpose, so there is
        // nothing more specific to report and nothing to leak.
        throw new Error(
          `The approval for this run was rejected (${response.status}). It may ` +
            'have already been used, expired, or been granted for different ' +
            'parameters than the ones this task is running.',
        );
      }

      const consumed = (await response.json()) as ConsumeGrantResponse;

      ctx.logger.info(
        `Approval request ${consumed.requestId} granted by ${
          consumed.approvedBy.join(', ') || 'nobody'
        }`,
      );

      // The task was launched by the service principal, so `task.createdBy`
      // names this plugin rather than a person. Later steps need the real
      // actors, and this is the only place that knows them.
      ctx.output('requestId', consumed.requestId);
      ctx.output('requestedBy', consumed.requesterRef);
      ctx.output('approvedBy', consumed.approvedBy);
    },
  });
}
