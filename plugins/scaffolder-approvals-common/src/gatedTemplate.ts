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

import type { Entity } from '@backstage/catalog-model';
import type {
  TemplateEntityStepV1beta3,
  TemplateEntityV1beta3,
} from '@backstage/plugin-scaffolder-common';
import { findGateStep, GateStepError } from './gateStep';
import { readGatePolicy } from './gatePolicy';
import { findSecretParameters } from './secretFields';
import type { GatePolicy } from './types';

/**
 * Whether a template can be asked for through an approval, and if not, why.
 *
 * @public
 */
export type GatedTemplateCheck =
  /** No gate step at all: an ordinary template, run as usual. */
  | { gated: false }
  /** Gated, but in a way the approvals backend refuses to accept. */
  | { gated: true; usable: false; problem: string }
  /** Gated, and fit to be requested. */
  | {
      gated: true;
      usable: true;
      step: TemplateEntityStepV1beta3;
      policy: GatePolicy;
    };

/**
 * Check a template the way the approvals backend does before it accepts a
 * request for it: the gate's shape, then secret-typed parameters, then the gate
 * policy. Everything submit refuses about a *template*, that is — validating
 * the submitted values needs the values, and stays with the backend.
 *
 * One function, used by the backend at submit and by the wizard's review step
 * before it offers "Request approval", so the button and the server cannot
 * disagree about which templates can be asked for, or give different reasons.
 * The `problem` sentences are the ones the backend refuses with, worded for the
 * person who is standing there with a filled-in form.
 *
 * @param templateRef - how to name the template in a `problem`; pass the ref
 *   the caller used, so the sentence talks about what they asked for.
 * @public
 */
export function checkGatedTemplate(
  template: Entity,
  templateRef: string,
): GatedTemplateCheck {
  let step: TemplateEntityStepV1beta3 | undefined;
  try {
    step = findGateStep(template).step;
  } catch (error) {
    // A malformed gate is a template bug, not a caller mistake, but the caller
    // is who is standing here — so say what is wrong with it.
    if (error instanceof GateStepError) {
      return {
        gated: true,
        usable: false,
        problem: `${templateRef} has an unusable gate: ${error.message}`,
      };
    }
    throw error;
  }

  if (!step) {
    return { gated: false };
  }

  // S7. A secret-typed parameter never reaches the request at all — the
  // scaffolder puts it in the task's `secrets` — so a template declaring one
  // would be approved and then run without it.
  const secretParameters = findSecretParameters(
    (template as TemplateEntityV1beta3).spec?.parameters,
  );
  if (secretParameters.length) {
    return {
      gated: true,
      usable: false,
      problem:
        `${templateRef} cannot be gated: its parameter(s) ${secretParameters.join(
          ', ',
        )} are secret-typed, and a secret cannot survive the wait for an ` +
        'approval. Pass the secret to the step that needs it from the ' +
        "deployment's own integration credentials instead.",
    };
  }

  try {
    return {
      gated: true,
      usable: true,
      step,
      policy: readGatePolicy(step.input),
    };
  } catch (error) {
    return {
      gated: true,
      usable: false,
      problem: `${templateRef} has an unusable gate policy: ${
        error instanceof Error ? error.message : error
      }`,
    };
  }
}
