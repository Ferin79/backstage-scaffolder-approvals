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
  findGateValuesProblem,
  findSecretParameters,
  GATE_ACTION_ID,
  GATED_ANNOTATION,
  GatePolicyError,
  readGatePolicy,
} from '@ferin79/backstage-plugin-scaffolder-approvals-common';
import {
  findGateStep,
  GateStepError,
  isGated,
} from '@ferin79/backstage-plugin-scaffolder-approvals-node';
import type { LoggerService } from '@backstage/backend-plugin-api';
import { type Entity, stringifyEntityRef } from '@backstage/catalog-model';
import type {
  CatalogProcessor,
  CatalogProcessorCache,
} from '@backstage/plugin-catalog-node';
import type {
  TemplateEntityStepV1beta3,
  TemplateEntityV1beta3,
} from '@backstage/plugin-scaffolder-common';

/**
 * User-scoped OAuth tokens die long before a multi-day approval completes, so a
 * gated template that depends on one will fail after the wait rather than
 * before it.
 */
const USER_TOKEN_PATTERN =
  /secrets\s*\.\s*USER_OAUTH_TOKEN|secrets\[['"]USER_OAUTH_TOKEN/;

/**
 * An approved run launches as the plugin's own service principal (§10.1), so
 * the task carries no user and every `${{ user.* }}` renders empty.
 */
const USER_CONTEXT_PATTERN = /\{\{[^}]*\buser\s*\./;

/** Cache key holding the notices last reported for an entity. */
const NOTICES_CACHE_KEY = 'scaffolder-approvals/notices';

/** Something worth saying about a template, once. */
interface Notice {
  level: 'warn' | 'info';
  message: string;
}

/**
 * Derives the `gated` annotation from the presence of an `approval:gate` step.
 *
 * The annotation is derived rather than authored (Q18) so that it cannot drift
 * from the gate it describes. Template authors declare the step and nothing
 * else.
 *
 * This processor **owns** the annotation completely: it stamps it on a gated
 * template and strips it from one that is not gated. Only adding it would leave
 * the mismatch that matters open — a hand-written `gated: 'true'` on a template
 * with no gate step, which would send people through an approval flow for
 * something they could simply run.
 *
 * Note what the annotation is and is not. It tells the UI which templates to
 * route through the approvals page; it is not what enforces anything. The
 * enforcement is the gate step itself, and a template that lost its annotation
 * but kept its step is still gated.
 *
 * It is also the only place a broken gate is reported before somebody tries to
 * use the template, so it runs the same checks the approvals backend runs at
 * submit: the gate shapes a direct run could slip past (`findGateStep`) and
 * the policy itself (`readGatePolicy`).
 *
 * @public
 */
export class ApprovalsGateProcessor implements CatalogProcessor {
  /**
   * Fallback for notice de-duplication when no processor cache is supplied.
   * Keyed by entity ref, so it is bounded by the number of templates rather
   * than by the number of refresh cycles.
   */
  private readonly lastNotices = new Map<string, string>();

  constructor(private readonly logger: LoggerService) {}

  getProcessorName(): string {
    return 'ApprovalsGateProcessor';
  }

  async preProcessEntity(
    entity: Entity,
    _location?: unknown,
    _emit?: unknown,
    _originLocation?: unknown,
    cache?: CatalogProcessorCache,
  ): Promise<Entity> {
    if (entity.kind !== 'Template') {
      return entity;
    }

    const gated = isGated(entity);
    const annotated = entity.metadata.annotations?.[GATED_ANNOTATION];
    const notices: Notice[] = [];

    if (gated) {
      notices.push(...this.inspectGate(entity));
    }

    if (!gated && annotated !== undefined) {
      notices.push({
        level: 'info',
        message:
          `Removing a '${GATED_ANNOTATION}' annotation from ${stringifyEntityRef(
            entity,
          )}, which has no '${GATE_ACTION_ID}' step. ` +
          'This annotation is derived, not authored.',
      });
    }

    // The catalog re-processes every entity on every refresh cycle, so an
    // un-deduplicated warning becomes a permanent stream in the log and stops
    // being read.
    await this.reportOnce(entity, notices, cache);

    // Already says the right thing, so hand back the very same object.
    // Rebuilding an identical entity each cycle is pure churn.
    if (gated && annotated === 'true') {
      return entity;
    }
    if (!gated && annotated === undefined) {
      return entity;
    }

    const annotations = { ...entity.metadata.annotations };
    if (gated) {
      annotations[GATED_ANNOTATION] = 'true';
    } else {
      delete annotations[GATED_ANNOTATION];
    }

    return {
      ...entity,
      metadata: { ...entity.metadata, annotations },
    };
  }

  /**
   * Log each notice, but only when the set of them has changed since the last
   * cycle.
   *
   * The processor cache is per entity and survives restarts, which is what
   * makes it the right home for this; the in-memory map is the fallback for
   * callers that supply no cache.
   */
  private async reportOnce(
    entity: Entity,
    notices: Notice[],
    cache?: CatalogProcessorCache,
  ): Promise<void> {
    const ref = stringifyEntityRef(entity);
    const signature = JSON.stringify(notices);

    const cached = typeof cache?.get === 'function';
    const previous = cached
      ? await cache!.get<string>(NOTICES_CACHE_KEY)
      : this.lastNotices.get(ref);

    if (previous === signature) {
      return;
    }

    if (cached && typeof cache?.set === 'function') {
      await cache.set(NOTICES_CACHE_KEY, signature);
    } else {
      this.lastNotices.set(ref, signature);
    }

    for (const notice of notices) {
      this.logger[notice.level](notice.message);
    }
  }

  /**
   * Report the shapes that will bite later, without blocking ingestion.
   *
   * Deliberately warnings and not entity errors. An error that kept a template
   * out of the catalog would make *deleting the gate* the way to make your
   * template appear again — precisely the wrong incentive for the one step that
   * enforces anything. The accepted risk (Q17) is that a template owner can
   * remove a gate; nothing here should make that attractive.
   */
  private inspectGate(entity: Entity): Notice[] {
    const ref = stringifyEntityRef(entity);
    const steps = (entity as TemplateEntityV1beta3).spec?.steps ?? [];
    const notices: Notice[] = [];

    let gateStep: TemplateEntityStepV1beta3 | undefined;
    try {
      gateStep = findGateStep(entity).step;
    } catch (error) {
      if (error instanceof GateStepError) {
        notices.push({
          level: 'warn',
          message: `${ref} has an unusable gate: ${error.message}`,
        });
      } else {
        throw error;
      }
    }

    if (gateStep) {
      // Without the whole parameters, the gate cannot check that the run
      // matches what was approved, so it refuses every run — and the approvals
      // backend refuses to accept a request for the template. Saying so at
      // ingestion beats an author hearing it from a requester. The same check
      // the backend runs, so the two cannot disagree.
      const valuesProblem = findGateValuesProblem(gateStep);
      if (valuesProblem) {
        notices.push({
          level: 'warn',
          message: `${ref} has an unusable gate: ${valuesProblem}`,
        });
      }

      // gatePolicy.ts promises that a template which ingests cleanly cannot
      // then fail at submit, which only holds if the policy is read here too.
      try {
        readGatePolicy(gateStep.input);
      } catch (error) {
        if (error instanceof GatePolicyError) {
          notices.push({
            level: 'warn',
            message: `${ref} has an unusable gate policy: ${error.message}`,
          });
        } else {
          throw error;
        }
      }
    }

    // S7: the backend refuses these at submit, so saying so at ingestion is
    // the difference between an author finding out now and a requester
    // finding out when they try to use the template.
    const secretParameters = findSecretParameters(
      (entity as TemplateEntityV1beta3).spec?.parameters,
    );
    if (secretParameters.length) {
      notices.push({
        level: 'warn',
        message:
          `${ref} is gated but declares secret-typed parameter(s) ` +
          `${secretParameters.join(', ')}. The scaffolder puts those in the ` +
          'task secrets rather than its values, so they cannot survive the ' +
          'wait for an approval; the approvals backend refuses to accept a ' +
          'request for this template.',
      });
    }

    const otherSteps = steps.filter(step => step?.action !== GATE_ACTION_ID);

    // §10.2: the wait outlives the token.
    if (
      otherSteps.some(step =>
        USER_TOKEN_PATTERN.test(JSON.stringify(step?.input ?? {})),
      )
    ) {
      notices.push({
        level: 'warn',
        message:
          `${ref} is gated but a later step uses secrets.USER_OAUTH_TOKEN. That ` +
          'token belongs to the person who submitted the request and will have ' +
          'expired by the time a multi-day approval completes.',
      });
    }

    // §10.1: an approved run launches as a service principal, so there is no
    // user on the task at all.
    if (
      otherSteps.some(step =>
        USER_CONTEXT_PATTERN.test(JSON.stringify(step?.input ?? {})),
      )
    ) {
      notices.push({
        level: 'warn',
        message:
          `${ref} is gated but a later step reads '\${{ user.* }}'. An approved ` +
          "run launches as the approvals plugin's own service principal, so " +
          "those references render empty. Use the gate's 'requestedBy' output " +
          'instead.',
      });
    }

    return notices;
  }
}
