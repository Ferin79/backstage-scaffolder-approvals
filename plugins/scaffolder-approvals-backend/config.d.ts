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

import type { HumanDuration } from '@backstage/types';

export interface Config {
  /**
   * Configuration for the scaffolder-approvals plugin.
   *
   * This is the entire config surface. Gate policy — who approves, how many,
   * self-approval, timeout — is declared per-template in the `approval:gate`
   * step, never here, so that the people who own a template own its gate.
   */
  scaffolderApprovals?: {
    /**
     * How long an approval grant stays redeemable after a request is approved.
     *
     * Short by design: it is a single-use capability to run the template, and
     * it only has to survive the launch. Defaults to one hour.
     */
    grantTtl?: HumanDuration;

    /**
     * Service principal subjects allowed to redeem an approval grant.
     *
     * Only the scaffolder's gate action has any business calling
     * `POST /grants/consume`, and the default is `['plugin:scaffolder']`. A
     * grant cannot be forged, but any service principal that has seen one
     * could *spend* it, and a spent grant makes the legitimate task fail at
     * its own gate.
     *
     * It is configurable because the framework treats a principal's subject as
     * informational rather than as stable API: a split deployment, a renamed
     * plugin id or a gateway in front of the backend can present a different
     * one, and widening this must not need a code change. The refused subject
     * is logged, so an operator can see what to add.
     */
    grantConsumers?: string[];

    retention?: {
      /**
       * How long submitted values and the rendered summary are kept before
       * being redacted.
       *
       * Redaction nulls those two fields; the request and every decision on it
       * are kept indefinitely, because that is the audit trail this plugin
       * exists to produce. Defaults to 180 days.
       */
      redactAfter?: HumanDuration;
    };
  };
}
