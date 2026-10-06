import type {
  ApprovalRequest,
  ApprovalRequestWithDecisions,
  DecideApprovalRequestOptions,
  ListApprovalRequestsOptions,
  ListApprovalRequestsResponse,
  SubmitApprovalRequestOptions,
  SubmitApprovalRequestResponse,
} from '@ferin79/backstage-plugin-scaffolder-approvals-common';
import { createApiRef } from '@backstage/core-plugin-api';

/**
 * Talks to the approvals backend.
 *
 * @public
 */
export interface ApprovalsApi {
  listRequests(
    options?: ListApprovalRequestsOptions,
  ): Promise<ListApprovalRequestsResponse>;

  getRequest(id: string): Promise<ApprovalRequestWithDecisions>;

  submitRequest(
    options: SubmitApprovalRequestOptions,
  ): Promise<SubmitApprovalRequestResponse>;

  decide(
    id: string,
    options: DecideApprovalRequestOptions,
  ): Promise<ApprovalRequestWithDecisions>;

  cancel(id: string): Promise<ApprovalRequest>;
}

/**
 * @public
 */
export const approvalsApiRef = createApiRef<ApprovalsApi>({
  id: 'plugin.scaffolder-approvals.service',
});
