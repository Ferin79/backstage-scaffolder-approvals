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

import { createDevApp } from '@backstage/dev-utils';
import type {
  ApprovalRequest,
  ApprovalRequestWithDecisions,
} from '@backstage-community/plugin-scaffolder-approvals-common';
import {
  ApprovalsIndexPage,
  approvalsApiRef,
  scaffolderApprovalsPlugin,
} from '../src';
import type { ApprovalsApi } from '../src';

/**
 * Enough requests to see every status pill, a quorum part-way met, and a
 * redacted request — the three things that are awkward to eyeball otherwise.
 */
const REQUESTS: ApprovalRequestWithDecisions[] = [
  {
    id: '1',
    templateRef: 'template:default/request-github-admin',
    values: { repository: 'backstage', justification: 'on-call rotation' },
    valuesHash: 'a'.repeat(64),
    requesterRef: 'user:default/requester',
    status: 'pending',
    summary: 'Admin on backstage',
    policySnapshot: {
      approvers: ['group:default/devx-team'],
      quorum: 2,
      selfApprove: false,
    },
    createdAt: new Date(Date.now() - 3_600_000).toISOString(),
    updatedAt: new Date(Date.now() - 3_600_000).toISOString(),
    decisions: [
      {
        id: 'd1',
        requestId: '1',
        approverRef: 'user:default/alice',
        decision: 'approve',
        comment: 'Checked the rotation, looks right.',
        createdAt: new Date(Date.now() - 1_800_000).toISOString(),
      },
    ],
  },
  {
    id: '2',
    templateRef: 'template:default/request-prod-access',
    values: { environment: 'production' },
    valuesHash: 'b'.repeat(64),
    requesterRef: 'user:default/someone-else',
    status: 'running',
    summary: 'Production access for a deploy',
    policySnapshot: {
      approvers: ['group:default/devx-team'],
      quorum: 1,
      selfApprove: false,
    },
    taskId: 'task-42',
    createdAt: new Date(Date.now() - 86_400_000).toISOString(),
    updatedAt: new Date().toISOString(),
    decisions: [],
  },
  {
    id: '3',
    templateRef: 'template:default/request-github-admin',
    // Redacted: the retention sweep has been through.
    values: null,
    valuesHash: 'c'.repeat(64),
    requesterRef: 'user:default/requester',
    status: 'completed',
    summary: null,
    policySnapshot: {
      approvers: ['group:default/devx-team'],
      quorum: 1,
      selfApprove: false,
    },
    createdAt: new Date(Date.now() - 200 * 86_400_000).toISOString(),
    updatedAt: new Date(Date.now() - 200 * 86_400_000).toISOString(),
    redactedAt: new Date(Date.now() - 20 * 86_400_000).toISOString(),
    decisions: [],
  },
];

const mockApi: ApprovalsApi = {
  async listRequests(options = {}) {
    const statuses = [options.status ?? []].flat();
    const items: ApprovalRequest[] = REQUESTS.filter(
      request => statuses.length === 0 || statuses.includes(request.status),
    );
    return { items, totalItems: items.length };
  },
  async getRequest(id) {
    const found = REQUESTS.find(request => request.id === id);
    if (!found) {
      throw new Error(`No such approval request: ${id}`);
    }
    return found;
  },
  async submitRequest() {
    return { id: '1', collapsed: false };
  },
  async decide(id) {
    return await this.getRequest(id);
  },
  async cancel(id) {
    return await this.getRequest(id);
  },
};

createDevApp()
  .registerPlugin(scaffolderApprovalsPlugin)
  .registerApi({
    api: approvalsApiRef,
    deps: {},
    factory: () => mockApi,
  })
  .addPage({
    element: <ApprovalsIndexPage />,
    title: 'Approvals',
    path: '/scaffolder-approvals',
  })
  .render();
