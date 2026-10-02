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

import type { ApprovalRequestStatus } from '@ferin79/backstage-plugin-scaffolder-approvals-common';
import { Text } from '@backstage/ui';
import styles from './StatusPill.module.css';

/**
 * What each status means to somebody reading a list, in their words.
 *
 * The stored values are a state machine's vocabulary; these are not. `approved`
 * in particular is a transient state — the template is starting — and saying
 * "Approved" alone would leave a requester wondering why nothing happened.
 */
const LABELS: Record<ApprovalRequestStatus, string> = {
  pending: 'Awaiting approval',
  approved: 'Starting',
  running: 'Running',
  completed: 'Completed',
  failed: 'Failed',
  rejected: 'Denied',
  cancelled: 'Withdrawn',
  expired: 'Expired',
};

/** @public */
export interface StatusPillProps {
  status: ApprovalRequestStatus;
}

/**
 * A coloured status pill.
 *
 * Hand-rolled: BUI's `Badge` and `Tag` accept only an icon, a size and
 * children, so there is no coloured badge to reach for. Colour comes from BUI's
 * own CSS variables, which is what keeps it correct in both themes.
 *
 * @public
 */
export function StatusPill(props: StatusPillProps) {
  const { status } = props;

  return (
    // BUI's `Text` renders a span and carries the type scale, so the pill sits
    // in the same typography as everything around it.
    <Text variant="body-small" className={`${styles.pill} ${styles[status]}`}>
      {/* Colour alone would not be enough for a colour-blind reader; the text
          carries the meaning and the dot is reinforcement. */}
      <Text className={styles.dot} aria-hidden="true" />
      {LABELS[status] ?? status}
    </Text>
  );
}
