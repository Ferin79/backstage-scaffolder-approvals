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
