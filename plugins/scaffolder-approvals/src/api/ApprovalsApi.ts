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
  ApprovalRequestWithDecisions,
  DecideApprovalRequestOptions,
  ListApprovalRequestsOptions,
  ListApprovalRequestsResponse,
  SubmitApprovalRequestOptions,
  SubmitApprovalRequestResponse,
} from '@backstage-community/plugin-scaffolder-approvals-common';
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
