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

import type {
  TemplateDrift,
  TemplateDriftReason,
} from '@ferin79/backstage-plugin-scaffolder-approvals-common';
import { Alert, Flex, Text } from '@backstage/ui';

/**
 * What each kind of drift means to somebody about to approve.
 *
 * Written as consequences rather than as facts about hashes: the reader has to
 * decide whether to approve, and "the steps have changed" is only useful if it
 * also says that the new steps are the ones that will run.
 */
const EXPLANATIONS: Record<TemplateDriftReason, string> = {
  missing:
    'The template is no longer in the catalog. Approving this request will fail, because there is nothing left to run.',
  replaced:
    'The template was deleted and recreated since this request was submitted. It shares a name with the one that was asked for, and nothing else.',
  steps:
    'The steps in this template have been edited since the request was submitted. The edited steps are the ones that will run, not the ones that were asked for.',
  parameters:
    "The template's parameters have changed since the request was submitted, and the submitted values no longer fit them. The scaffolder will refuse to start it, so approving will fail; the requester needs to submit it again.",
  unknown: '',
};

/**
 * What a drift means, one sentence per reason, in the order the backend gave
 * them. Empty when there is nothing worth saying, which includes a check the
 * backend could not make (`unknown`).
 */
export function explainDrift(drift?: TemplateDrift): string[] {
  if (!drift?.changed) {
    return [];
  }
  return drift.reasons
    .map(reason => EXPLANATIONS[reason])
    .filter(explanation => explanation);
}

/**
 * Whether approving is bound to fail: the template is gone, or the submitted
 * values no longer fit it, so the scaffolder will refuse to start it.
 */
export function driftBlocksLaunch(drift?: TemplateDrift): boolean {
  return Boolean(
    drift?.changed &&
      drift.reasons.some(
        reason => reason === 'missing' || reason === 'parameters',
      ),
  );
}

/** @internal */
export interface DriftNoticeProps {
  drift?: TemplateDrift;
  /**
   * How loudly to say it. `danger` on the page; the approve dialog softens it
   * to `warning` when approving will still launch.
   */
  status?: 'danger' | 'warning';
}

/**
 * Warn an approver that the template has changed under them.
 *
 * The values and the policy are frozen when a request is submitted, but the
 * template is read live from the catalog at launch. Somebody approving three
 * days later is shown the parameters and the approvers, neither of which says
 * anything about the steps that will actually execute.
 *
 * Renders nothing when there is nothing to say. That deliberately includes the
 * case where the backend could not check: an unreachable catalog is not
 * evidence of a change, and a warning that fires on infrastructure trouble is
 * one people learn to click past.
 *
 * @internal
 */
export function DriftNotice(props: DriftNoticeProps) {
  const { drift, status = 'danger' } = props;
  const explanations = explainDrift(drift);
  if (explanations.length === 0) {
    return null;
  }

  return (
    <Alert
      // `alert` rather than `status`: this changes what approving means, so
      // it is worth interrupting a screen-reader user for.
      role="alert"
      status={status}
      icon
      title="The template has changed"
      description={
        <Flex direction="column" gap="1">
          {explanations.map(explanation => (
            <Text key={explanation} variant="body-small">
              {explanation}
            </Text>
          ))}
        </Flex>
      }
    />
  );
}
