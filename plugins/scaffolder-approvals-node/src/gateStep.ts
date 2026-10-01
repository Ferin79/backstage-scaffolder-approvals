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
 * `step` is undefined for an ungated template, which is not an error â€” most
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
 * Steps whose `if:` calls one of these run even after an earlier step threw.
 *
 * `always()` and `failure()` are ordinary choices for a cleanup or a
 * notification step, which is what makes them dangerous here: the gate throws
 * on an unapproved run, and the runner then goes on to execute every
 * failure-aware step after it.
 */
const FAILURE_AWARE_CONDITIONS = ['always(', 'failure('];

function tagsOf(step: TemplateEntityStepV1beta3): string[] {
  const tags = step?.['backstage:permissions']?.tags;
  return Array.isArray(tags) ? tags.filter(tag => typeof tag === 'string') : [];
}

function describeStep(step: TemplateEntityStepV1beta3, index: number): string {
  return step?.id ? `'${step.id}'` : `step ${index + 1}`;
}

/**
 * Find a template's `approval:gate` step.
 *
 * Shared between the approvals service, which reads the policy off it, and the
 * catalog processor, which derives the `gated` annotation from its presence.
 * One definition of "this template is gated" is what keeps the annotation from
 * drifting away from the gate itself â€” the annotated-but-ungated mismatch is
 * the dangerous one.
 *
 * The shapes below are rejected rather than interpreted. Each of them leaves a
 * template that still looks gated â€” it keeps the step, it keeps the derived
 * annotation â€” while a direct `POST /v2/tasks` runs real steps with no
 * approval. They were each reproduced against scaffolder-backend 4.1.0.
 *
 * - **A gate that is not the first step.** Everything before it would run
 *   before anyone had approved, which defeats the gate entirely while still
 *   looking gated.
 * - **More than one gate.** Which policy applies would be ambiguous, and the
 *   second gate's grant could never be satisfied.
 * - **`if:` on the gate.** The runner skips a step whose condition is falsy, so
 *   whoever starts the run chooses whether the gate applies to them.
 * - **`each:` on the gate.** An `each:` step runs once per entry, so a gate
 *   handed an empty list runs zero times and reports `completed`.
 * - **A later failure-aware step.** After the gate throws, the runner still
 *   executes any later step whose `if:` calls `always()` or `failure()`.
 * - **A later step tagged where the gate is not.** `authorizeTemplate` drops
 *   the steps a caller's `scaffolder.template.step.read` decision rejects, so
 *   under a `HAS_TAG` allow-list an untagged gate disappears from that
 *   caller's run while the tagged step survives. The gate therefore has to
 *   carry every tag any other step carries: then no policy can admit a real
 *   step without also admitting the gate.
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

  if (step.if !== undefined) {
    throw new GateStepError(
      `'${GATE_ACTION_ID}' must not carry an 'if:' condition; the runner skips a ` +
        'step whose condition is falsy, which would let the caller turn the gate off',
    );
  }

  if (step.each !== undefined) {
    throw new GateStepError(
      `'${GATE_ACTION_ID}' must not carry an 'each:' loop; a loop over an empty ` +
        'list runs the gate zero times and still reports the step as completed',
    );
  }

  const others = steps.filter((_, position) => position !== index);

  const failureAware = others
    .map((other, position) => ({ other, position }))
    .filter(({ other }) => {
      const condition = other?.if;
      return (
        typeof condition === 'string' &&
        FAILURE_AWARE_CONDITIONS.some(fn => condition.includes(fn))
      );
    });

  if (failureAware.length) {
    const named = failureAware
      .map(({ other, position }) => describeStep(other, position + 1))
      .join(', ');
    throw new GateStepError(
      `${named} run even after an earlier step fails ('always()' or 'failure()'). ` +
        'The gate throws on an unapproved run, so those steps would execute ' +
        'without an approval',
    );
  }

  const gateTags = new Set(tagsOf(step));
  const missing = new Set<string>();
  for (const other of others) {
    for (const tag of tagsOf(other)) {
      if (!gateTags.has(tag)) {
        missing.add(tag);
      }
    }
  }

  if (missing.size) {
    throw new GateStepError(
      `'${GATE_ACTION_ID}' is missing the 'backstage:permissions.tags' value(s) ` +
        `${[...missing]
          .map(tag => `'${tag}'`)
          .join(', ')} that later steps carry. A step-read ` +
        'policy that admits those steps would drop the gate from the run',
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
