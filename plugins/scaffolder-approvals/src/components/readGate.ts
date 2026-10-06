import {
  checkGatedTemplate,
  GATED_ANNOTATION,
  type GatedTemplateCheck,
} from '@ferin79/backstage-plugin-scaffolder-approvals-common';
import type { TemplateEntityV1beta3 } from '@backstage/plugin-scaffolder-common';

/** What `readGate` says about a template the wizard treats as gated. */
export type Gate = Exclude<GatedTemplateCheck, { gated: false }>;

/**
 * Whether the wizard treats a template as gated, and if so what its gate asks.
 *
 * One function for the template card and the review step, so the Create page
 * never promises an approval that the last step does not ask for, nor the
 * other way round.
 *
 * The catalog's derived annotation first. Without the catalog module that sets
 * it, the review step offers the scaffolder's own Create button, so nothing
 * else should talk about approval either. Then the same check the backend runs
 * at submit, because the annotation can lag a template that has just lost its
 * gate.
 *
 * @param templateRef - how to name the template in a `problem` sentence
 */
export function readGate(
  template: TemplateEntityV1beta3,
  templateRef: string,
): Gate | undefined {
  if (template.metadata.annotations?.[GATED_ANNOTATION] !== 'true') {
    return undefined;
  }
  const check = checkGatedTemplate(template, templateRef);
  return check.gated ? check : undefined;
}
