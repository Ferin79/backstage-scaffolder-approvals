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
  canonicalJson,
  type TemplateDrift,
  type TemplateDriftReason,
} from '@ferin79/backstage-plugin-scaffolder-approvals-common';
import type { Entity } from '@backstage/catalog-model';
import type {
  TemplateEntityStepV1beta3,
  TemplateEntityV1beta3,
} from '@backstage/plugin-scaffolder-common';
import type { JsonObject } from '@backstage/types';
import { sha256Hex } from './hashes';

/**
 * Hash the steps a template will execute.
 *
 * `values` and `policy_snapshot` are frozen when a request is submitted, but
 * the template itself is read live from the catalog at launch time (§10.3). An
 * approver looking at a request sees the values and the policy; without this
 * they have no way to notice that the steps changed underneath them, and an
 * added step runs like any other.
 *
 * Only `spec.steps` is covered. Those are what execute, and hashing the whole
 * spec would report an owner or a description edit as drift — a warning that
 * fires on everything is one nobody reads.
 *
 * Canonical serialisation makes this independent of key order, so a template
 * reserialised by the catalog does not read as edited.
 *
 * @public
 */
export function computeTemplateStepsHash(entity: Entity): string {
  const steps = (entity as TemplateEntityV1beta3).spec?.steps;
  const list: TemplateEntityStepV1beta3[] = Array.isArray(steps) ? steps : [];
  return sha256Hex(canonicalJson({ steps: list } as unknown as JsonObject));
}

/**
 * Compare a template as it is now against what it was when a request was
 * submitted.
 *
 * `template` is undefined when the catalog no longer serves it.
 *
 * Both recorded values are checked, because either on its own can be fooled: a
 * template deleted and recreated keeps its name but takes a new uid, while one
 * edited in place keeps its uid and changes its steps.
 *
 * @public
 */
export function compareTemplate(options: {
  template: Entity | undefined;
  submittedUid?: string;
  submittedStepsHash?: string;
}): TemplateDrift {
  const { template, submittedUid, submittedStepsHash } = options;
  const reasons: TemplateDriftReason[] = [];

  if (!template) {
    return { changed: true, reasons: ['missing'] };
  }

  // Nothing was recorded, so there is nothing to compare against. Reported as
  // its own reason rather than as "unchanged", which would be a claim this
  // cannot make.
  if (!submittedUid && !submittedStepsHash) {
    return { changed: false, reasons: ['unknown'] };
  }

  if (submittedUid && template.metadata.uid !== submittedUid) {
    reasons.push('replaced');
  }

  if (
    submittedStepsHash &&
    computeTemplateStepsHash(template) !== submittedStepsHash
  ) {
    reasons.push('steps');
  }

  return { changed: reasons.length > 0, reasons };
}
