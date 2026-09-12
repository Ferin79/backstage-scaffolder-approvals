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

import { GATE_ACTION_ID } from '@backstage-community/plugin-scaffolder-approvals-common';
import type { Entity } from '@backstage/catalog-model';
import type {
  TemplateEntityStepV1beta3,
  TemplateEntityV1beta3,
} from '@backstage/plugin-scaffolder-common';

/**
 * Thrown when a template declares a gate that cannot be honoured.
 *
 * @public
 */
export class GateStepError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'GateStepError';
  }
}

/**
 * What was found when looking for a gate on a template.
 *
 * `step` is undefined for an ungated template, which is not an error — most
 * templates are ungated.
 *
 * @public
 */
export interface GateStepLookup {
  step?: TemplateEntityStepV1beta3;
  /** Position in `spec.steps`, for diagnostics. */
  index?: number;
}

function stepsOf(entity: Entity): TemplateEntityStepV1beta3[] {
  const steps = (entity as TemplateEntityV1beta3).spec?.steps;
  return Array.isArray(steps) ? steps : [];
}

/**
 * Find a template's `approval:gate` step.
 *
 * Shared between the approvals service, which reads the policy off it, and the
 * catalog processor, which derives the `gated` annotation from its presence.
 * One definition of "this template is gated" is what keeps the annotation from
 * drifting away from the gate itself — the annotated-but-ungated mismatch is
 * the dangerous one.
 *
 * Two shapes are rejected rather than interpreted:
 *
 * - **A gate that is not the first step.** Everything before it would run
 *   before anyone had approved, which defeats the gate entirely while still
 *   looking gated.
 * - **More than one gate.** Which policy applies would be ambiguous, and the
 *   second gate's grant could never be satisfied.
 *
 * @public
 */
export function findGateStep(entity: Entity): GateStepLookup {
  const steps = stepsOf(entity);

  const found = steps
    .map((step, index) => ({ step, index }))
    .filter(({ step }) => step?.action === GATE_ACTION_ID);

  if (found.length === 0) {
    return {};
  }

  if (found.length > 1) {
    throw new GateStepError(
      `Template declares ${found.length} '${GATE_ACTION_ID}' steps; exactly one is allowed`,
    );
  }

  const [{ step, index }] = found;

  if (index !== 0) {
    throw new GateStepError(
      `'${GATE_ACTION_ID}' must be the first step, but is step ${
        index + 1
      } of ${
        steps.length
      }; the ${index} step(s) before it would run before the request was approved`,
    );
  }

  return { step, index };
}

/**
 * Whether a template carries a usable gate.
 *
 * A malformed gate counts as gated: the template is trying to be gated and is
 * broken, and treating it as ungated would make it freely runnable.
 *
 * @public
 */
export function isGated(entity: Entity): boolean {
  if (entity.kind !== 'Template') {
    return false;
  }
  return stepsOf(entity).some(step => step?.action === GATE_ACTION_ID);
}
