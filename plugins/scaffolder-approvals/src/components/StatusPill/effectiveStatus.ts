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
  ApprovalRequest,
  ApprovalRequestStatus,
} from '@backstage-community/plugin-scaffolder-approvals-common';

/**
 * The status to show for a request, which is not always the one stored.
 *
 * A pending request whose deadline has passed can no longer be decided —
 * `checkDecisionEligibility` refuses it, and so does the backend — but it stays
 * `pending` in the database until the timeout sweep runs, up to five minutes
 * later. Showing "Awaiting approval" in that window tells people there is
 * something to do when there is not (B9 in the browser review), so it is shown
 * as what it already is.
 */
export function effectiveStatus(
  request: Pick<ApprovalRequest, 'status' | 'expiresAt'>,
  now: Date = new Date(),
): ApprovalRequestStatus {
  if (
    request.status === 'pending' &&
    request.expiresAt &&
    new Date(request.expiresAt).getTime() <= now.getTime()
  ) {
    return 'expired';
  }
  return request.status;
}
