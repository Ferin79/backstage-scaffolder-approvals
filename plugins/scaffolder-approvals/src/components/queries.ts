import type { ListApprovalRequestsOptions } from '@ferin79/backstage-plugin-scaffolder-approvals-common';

/** Which requests a list shows; paging is the list's own business. */
export type RequestsQuery = Omit<
  ListApprovalRequestsOptions,
  'limit' | 'offset'
>;

/**
 * What is waiting on the viewer: requests that name them as an approver, are
 * still pending, and that they can decide on now — not ones they have already
 * voted on, nor their own when the gate forbids self-approval.
 *
 * One definition for the inbox tab and the home-page card, so the number on
 * the card and the list behind it cannot disagree.
 */
export const INBOX_QUERY: RequestsQuery = {
  role: 'approver',
  actionable: true,
  status: ['pending'],
};
