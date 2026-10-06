import type {
  ApprovalRequest,
  ApprovalRequestStatus,
} from '@ferin79/backstage-plugin-scaffolder-approvals-common';

/**
 * The status to show for a request, which is not always the one stored.
 *
 * A pending request whose deadline has passed can no longer be decided —
 * `checkDecisionEligibility` refuses it, and so does the backend — but it stays
 * `pending` in the database until the timeout sweep runs, up to five minutes
 * later. Showing "Awaiting approval" in that window tells people there is
 * something to do when there is not, so it is shown as what it already is.
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
