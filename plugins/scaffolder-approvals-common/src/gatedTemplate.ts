import type { Entity } from '@backstage/catalog-model';
import type {
  TemplateEntityStepV1beta3,
  TemplateEntityV1beta3,
} from '@backstage/plugin-scaffolder-common';
import { findGateStep, findGateValuesProblem, GateStepError } from './gateStep';
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
 * request for it: the gate's shape, then its `values` input, then secret-typed
 * parameters, then the gate policy. That is everything submit refuses about a
 * *template*; validating the submitted values needs the values, and stays with
 * the backend.
 *
 * One function, used by the backend at submit, by the catalog processor at
 * ingestion and by the wizard before it offers "Request approval", so none of
 * them can disagree about which templates can be asked for, or give different
 * reasons. Only the first problem is reported: each one alone makes the
 * template unusable.
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
    step = findGateStep(template);
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

  // A gate that cannot check the run against the approval refuses every run,
  // so accepting a request for it would spend an approval on nothing.
  const valuesProblem = findGateValuesProblem(step);
  if (valuesProblem) {
    return {
      gated: true,
      usable: false,
      problem: `${templateRef} has an unusable gate: ${valuesProblem}`,
    };
  }

  // A secret-typed parameter never reaches the request at all — the scaffolder
  // puts it in the task's `secrets` — so a template declaring one would be
  // approved and then run without it.
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
