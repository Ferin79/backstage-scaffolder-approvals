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
  GATE_ACTION_ID,
  GATED_ANNOTATION,
} from '@backstage-community/plugin-scaffolder-approvals-common';
import {
  findGateStep,
  GateStepError,
  isGated,
} from '@backstage-community/plugin-scaffolder-approvals-node';
import type { LoggerService } from '@backstage/backend-plugin-api';
import { type Entity, stringifyEntityRef } from '@backstage/catalog-model';
import type { CatalogProcessor } from '@backstage/plugin-catalog-node';
import type { TemplateEntityV1beta3 } from '@backstage/plugin-scaffolder-common';

/**
 * User-scoped OAuth tokens die long before a multi-day approval completes, so a
 * gated template that depends on one will fail after the wait rather than
 * before it.
 */
const USER_TOKEN_PATTERN =
  /secrets\s*\.\s*USER_OAUTH_TOKEN|secrets\[['"]USER_OAUTH_TOKEN/;

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
 * @public
 */
export class ApprovalsGateProcessor implements CatalogProcessor {
  constructor(private readonly logger: LoggerService) {}

  getProcessorName(): string {
    return 'ApprovalsGateProcessor';
  }

  async preProcessEntity(entity: Entity): Promise<Entity> {
    if (entity.kind !== 'Template') {
      return entity;
    }

    const gated = isGated(entity);
    const annotated = entity.metadata.annotations?.[GATED_ANNOTATION];

    if (gated) {
      this.warnAboutSuspectGates(entity);
    }

    // Already says the right thing, so hand back the very same object. The
    // catalog re-processes every entity on a refresh cycle, and rebuilding an
    // identical entity each time is pure churn.
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
      this.logger.info(
        `Removing a '${GATED_ANNOTATION}' annotation from ${stringifyEntityRef(
          entity,
        )}, which has no '${GATE_ACTION_ID}' step. This annotation is derived, not authored.`,
      );
      delete annotations[GATED_ANNOTATION];
    }

    return {
      ...entity,
      metadata: { ...entity.metadata, annotations },
    };
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
  private warnAboutSuspectGates(entity: Entity): void {
    const ref = stringifyEntityRef(entity);
    const steps = (entity as TemplateEntityV1beta3).spec?.steps ?? [];

    try {
      const { step } = findGateStep(entity);

      // Without the parameters, the gate cannot check that the run matches
      // what was approved, so the action refuses rather than running
      // unchecked. Catching it at ingestion beats catching it when somebody
      // finally tries to use the template.
      const values = step?.input?.values;
      if (values === undefined || values === null) {
        this.logger.warn(
          `${ref} has an '${GATE_ACTION_ID}' step with no 'values' input. Add ` +
            `'values: \${{ parameters }}' so the approval can be checked against ` +
            'what actually runs; without it the gate will refuse every run.',
        );
      }
    } catch (error) {
      if (error instanceof GateStepError) {
        this.logger.warn(`${ref} has an unusable gate: ${error.message}`);
      } else {
        throw error;
      }
    }

    // §10.2: the wait outlives the token.
    const usesUserToken = steps.some(
      step =>
        step?.action !== GATE_ACTION_ID &&
        USER_TOKEN_PATTERN.test(JSON.stringify(step?.input ?? {})),
    );
    if (usesUserToken) {
      this.logger.warn(
        `${ref} is gated but a later step uses secrets.USER_OAUTH_TOKEN. That ` +
          'token belongs to the person who submitted the request and will have ' +
          'expired by the time a multi-day approval completes.',
      );
    }
  }
}
