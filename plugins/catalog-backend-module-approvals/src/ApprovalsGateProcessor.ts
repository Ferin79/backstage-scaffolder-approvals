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
  GATE_ACTION_ID,
  GATED_ANNOTATION,
} from '@ferin79/backstage-plugin-scaffolder-approvals-common';
import type { LoggerService } from '@backstage/backend-plugin-api';
import { type Entity, stringifyEntityRef } from '@backstage/catalog-model';
import type {
  CatalogProcessor,
  CatalogProcessorCache,
  CatalogProcessorEmit,
  LocationSpec,
} from '@backstage/plugin-catalog-node';
import type { TemplateEntityV1beta3 } from '@backstage/plugin-scaffolder-common';

/**
 * User-scoped OAuth tokens die long before a multi-day approval completes, so a
 * gated template that depends on one will fail after the wait rather than
 * before it.
 */
const USER_TOKEN_PATTERN =
  /secrets\s*\.\s*USER_OAUTH_TOKEN|secrets\[['"]USER_OAUTH_TOKEN/;

/**
 * An approved run launches as the plugin's own service principal, so the task
 * carries no user and every `${{ user.* }}` renders empty.
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
 * The annotation is derived rather than authored so that it cannot drift from
 * the gate it describes. Template authors declare the step and nothing else.
 *
 * This processor **owns** the annotation completely: it stamps it on a gated
 * template and strips it from one that is not gated. Only adding it would leave
 * the mismatch that matters open — a hand-written `gated: 'true'` on a template
 * with no gate step, which would send people through an approval flow for
 * something they could simply run. A malformed gate still counts as gated: the
 * template is trying to be gated, and must not read as freely runnable.
 *
 * The annotation tells the UI which templates to route through an approval; it
 * enforces nothing. The gate step does, and a template that lost its
 * annotation but kept its step is still gated.
 *
 * It is also the only place a broken gate is reported before somebody tries to
 * use the template, so it runs the same check the approvals backend runs at
 * submit (`checkGatedTemplate`). Problems are logged as warnings rather than
 * raised as entity errors: an error that kept a template out of the catalog
 * would make *deleting the gate* the way to get the template back.
 *
 * @public
 */
export class ApprovalsGateProcessor implements CatalogProcessor {
  constructor(private readonly logger: LoggerService) {}

  getProcessorName(): string {
    return 'ApprovalsGateProcessor';
  }

  async preProcessEntity(
    entity: Entity,
    _location: LocationSpec,
    _emit: CatalogProcessorEmit,
    _originLocation: LocationSpec,
    cache: CatalogProcessorCache,
  ): Promise<Entity> {
    if (entity.kind !== 'Template') {
      return entity;
    }

    const ref = stringifyEntityRef(entity);
    const check = checkGatedTemplate(entity, ref);
    const annotated = entity.metadata.annotations?.[GATED_ANNOTATION];

    const notices: Notice[] = [];
    if (check.gated) {
      if (!check.usable) {
        notices.push({ level: 'warn', message: check.problem });
      }
      notices.push(...this.inspectLaterSteps(entity, ref));
    } else if (annotated !== undefined) {
      notices.push({
        level: 'info',
        message:
          `Removing a '${GATED_ANNOTATION}' annotation from ${ref}, which has ` +
          `no '${GATE_ACTION_ID}' step. This annotation is derived, not authored.`,
      });
    }

    await this.reportOnce(notices, cache);

    // Already says the right thing, so hand back the very same object.
    // Rebuilding an identical entity each cycle is pure churn.
    if (check.gated ? annotated === 'true' : annotated === undefined) {
      return entity;
    }

    const annotations = { ...entity.metadata.annotations };
    if (check.gated) {
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
   * cycle. The catalog re-processes every entity on every refresh, so an
   * un-deduplicated warning becomes a permanent stream that nobody reads.
   */
  private async reportOnce(
    notices: Notice[],
    cache: CatalogProcessorCache,
  ): Promise<void> {
    const signature = JSON.stringify(notices);
    if ((await cache.get<string>(NOTICES_CACHE_KEY)) === signature) {
      return;
    }
    await cache.set(NOTICES_CACHE_KEY, signature);

    for (const notice of notices) {
      this.logger[notice.level](notice.message);
    }
  }

  /**
   * Later steps that will not work after an approval, though the gate itself
   * is fine: they depend on the person who asked, and the run that follows an
   * approval is not theirs.
   */
  private inspectLaterSteps(entity: Entity, ref: string): Notice[] {
    const later = ((entity as TemplateEntityV1beta3).spec?.steps ?? [])
      .filter(step => step?.action !== GATE_ACTION_ID)
      .map(step => JSON.stringify(step?.input ?? {}));
    const notices: Notice[] = [];

    if (later.some(input => USER_TOKEN_PATTERN.test(input))) {
      notices.push({
        level: 'warn',
        message:
          `${ref} is gated but a later step uses secrets.USER_OAUTH_TOKEN. That ` +
          'token belongs to the person who submitted the request and will have ' +
          'expired by the time a multi-day approval completes.',
      });
    }

    if (later.some(input => USER_CONTEXT_PATTERN.test(input))) {
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
