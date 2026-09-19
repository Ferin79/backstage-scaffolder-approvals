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
} from '@backstage-community/plugin-scaffolder-approvals-common';
import { Box, Text } from '@backstage/ui';
import styles from './DriftNotice.module.css';

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
  unknown: '',
};

/** @public */
export interface DriftNoticeProps {
  drift?: TemplateDrift;
}

/**
 * Warn an approver that the template has changed under them (§10.3).
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
 * @public
 */
export function DriftNotice(props: DriftNoticeProps) {
  const { drift } = props;

  const reasons = (drift?.reasons ?? []).filter(reason => EXPLANATIONS[reason]);
  if (!drift?.changed || reasons.length === 0) {
    return null;
  }

  return (
    // `alert` rather than `status`: this changes what approving means, so it
    // is worth interrupting a screen-reader user for.
    <Box role="alert" className={styles.notice}>
      <Text variant="title-x-small">The template has changed</Text>
      {reasons.map(reason => (
        <Text key={reason}>{EXPLANATIONS[reason]}</Text>
      ))}
    </Box>
  );
}
