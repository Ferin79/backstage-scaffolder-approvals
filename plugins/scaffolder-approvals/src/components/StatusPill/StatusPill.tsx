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
import { Badge } from '@backstage/ui';
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

/** The colour family a status is drawn in. */
export type StatusTone = 'warning' | 'info' | 'success' | 'danger' | 'neutral';

/**
 * Waiting is amber, in progress is blue, done is green, refused or broken is
 * red, and a request nobody decided is grey.
 *
 * @internal
 */
export const STATUS_TONE: Record<ApprovalRequestStatus, StatusTone> = {
  pending: 'warning',
  approved: 'info',
  running: 'info',
  completed: 'success',
  failed: 'danger',
  rejected: 'danger',
  cancelled: 'neutral',
  expired: 'neutral',
};

/** @public */
export interface StatusPillProps {
  status: ApprovalRequestStatus;
}

/**
 * A request's status, as a coloured badge.
 *
 * BUI's `Badge` gives the shape, size and type; it has no colour variants, so
 * the tint comes from BUI's own status variables, which is what keeps it
 * right in both themes.
 *
 * @public
 */
export function StatusPill(props: StatusPillProps) {
  const { status } = props;

  return (
    <Badge
      size="small"
      className={`${styles.pill} ${styles[STATUS_TONE[status] ?? 'neutral']}`}
      // Colour alone would not be enough for a colour-blind reader; the text
      // carries the meaning and the dot is reinforcement.
      icon={<span className={styles.dot} aria-hidden="true" />}
    >
      {LABELS[status] ?? status}
    </Badge>
  );
}
