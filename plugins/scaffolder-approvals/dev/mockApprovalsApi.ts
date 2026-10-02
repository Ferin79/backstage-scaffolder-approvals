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

import {
  type ApprovalCaller,
  type ApprovalRequestWithDecisions,
  checkDecisionEligibility,
  computeQuorumProgress,
  type DecisionIneligibility,
  type GatePolicy,
} from '@backstage-community/plugin-scaffolder-approvals-common';
import type { IdentityApi } from '@backstage/core-plugin-api';
import type { ApprovalsApi } from '../src';

const HOUR = 3_600_000;
const DAY = 24 * HOUR;

/** The backend's words for why somebody cannot decide, more or less. */
const REFUSAL: Record<DecisionIneligibility, string> = {
  'not-an-approver': 'You are not an approver for this request',
  'self-approval': 'You cannot approve your own request',
  'not-pending': 'This request has already been decided',
  expired: 'This request timed out before anyone decided',
  'already-voted': 'You have already decided on this request',
};

/**
 * The requests the harness starts with, as seen by `you`.
 *
 * `you` is an approver on every request, next to devx-team. The harness signs
 * in as a guest who is in no group, so when the requests named devx-team
 * alone, its inbox listed requests that its own user could not decide, and the
 * approve and deny flow could not be tried here at all (B21 in the browser
 * review).
 *
 * Between them they cover what is worth looking at: a quorum part-way met, a
 * request to deny, one of your own to withdraw, one running, and one redacted
 * by the retention sweep.
 */
export function initialRequests(
  you: string,
  now: number = Date.now(),
): ApprovalRequestWithDecisions[] {
  const at = (offset: number) => new Date(now + offset).toISOString();
  const policy = (quorum: number): GatePolicy => ({
    approvers: ['group:default/devx-team', you],
    quorum,
    selfApprove: false,
  });

  return [
    {
      id: '1',
      templateRef: 'template:default/request-github-admin',
      values: { repository: 'backstage', justification: 'on-call rotation' },
      valuesHash: 'a'.repeat(64),
      requesterRef: 'user:default/requester',
      status: 'pending',
      summary: 'Admin on backstage',
      policySnapshot: policy(2),
      createdAt: at(-HOUR),
      updatedAt: at(-HOUR / 2),
      expiresAt: at(2 * DAY),
      decisions: [
        {
          id: 'd1',
          requestId: '1',
          approverRef: 'user:default/alice',
          decision: 'approve',
          comment: 'Checked the rotation, looks right.',
          createdAt: at(-HOUR / 2),
        },
      ],
    },
    {
      id: '2',
      templateRef: 'template:default/request-prod-access',
      values: { environment: 'production' },
      valuesHash: 'b'.repeat(64),
      requesterRef: 'user:default/someone-else',
      status: 'pending',
      summary: 'Production access for a deploy',
      policySnapshot: policy(1),
      createdAt: at(-2 * HOUR),
      updatedAt: at(-2 * HOUR),
      expiresAt: at(DAY),
      decisions: [],
    },
    {
      id: '3',
      templateRef: 'template:default/request-github-admin',
      values: { repository: 'harness', justification: 'trying Withdraw' },
      valuesHash: 'c'.repeat(64),
      requesterRef: you,
      status: 'pending',
      summary: 'Admin on harness',
      policySnapshot: policy(1),
      createdAt: at(-10 * 60_000),
      updatedAt: at(-10 * 60_000),
      expiresAt: at(3 * DAY),
      decisions: [],
    },
    {
      id: '4',
      templateRef: 'template:default/request-prod-access',
      values: { environment: 'staging' },
      valuesHash: 'd'.repeat(64),
      requesterRef: 'user:default/someone-else',
      status: 'running',
      summary: 'Staging access for a load test',
      policySnapshot: policy(1),
      taskId: 'task-42',
      createdAt: at(-DAY),
      updatedAt: at(-HOUR),
      decisions: [
        {
          id: 'd2',
          requestId: '4',
          approverRef: 'user:default/bob',
          decision: 'approve',
          createdAt: at(-HOUR),
        },
      ],
    },
    {
      id: '5',
      templateRef: 'template:default/request-github-admin',
      // Redacted: the retention sweep has been through.
      values: null,
      valuesHash: 'e'.repeat(64),
      requesterRef: 'user:default/requester',
      status: 'completed',
      summary: null,
      policySnapshot: policy(1),
      createdAt: at(-200 * DAY),
      updatedAt: at(-200 * DAY),
      redactedAt: at(-20 * DAY),
      decisions: [],
    },
  ];
}

/**
 * An `ApprovalsApi` that keeps its requests in memory and applies the same
 * rules the backend does, so the harness can be used rather than only looked
 * at: the inbox lists what you can decide, approving and denying change the
 * request, and withdrawing your own works.
 *
 * Who "you" is comes from the identity API, so it is whoever the harness
 * signed in as. A request that meets its quorum goes straight to completed:
 * there is no scaffolder here to run it. Changes last until the page reloads,
 * which starts again from `initialRequests`.
 */
export function createMockApprovalsApi(
  identityApi: Pick<IdentityApi, 'getBackstageIdentity'>,
): ApprovalsApi {
  let requests: ApprovalRequestWithDecisions[] | undefined;

  async function caller(): Promise<Required<ApprovalCaller>> {
    const { userEntityRef, ownershipEntityRefs } =
      await identityApi.getBackstageIdentity();
    return { userEntityRef, ownershipEntityRefs };
  }

  async function all(): Promise<ApprovalRequestWithDecisions[]> {
    if (!requests) {
      requests = initialRequests((await caller()).userEntityRef);
    }
    return requests;
  }

  async function find(id: string): Promise<ApprovalRequestWithDecisions> {
    const found = (await all()).find(request => request.id === id);
    if (!found) {
      throw new Error(`No such approval request: ${id}`);
    }
    return found;
  }

  /** A new object for every change, so a page holding the old one re-renders. */
  function replace(updated: ApprovalRequestWithDecisions) {
    requests = requests!.map(request =>
      request.id === updated.id ? updated : request,
    );
    return updated;
  }

  return {
    async listRequests(options = {}) {
      const you = await caller();
      const yours = new Set([you.userEntityRef, ...you.ownershipEntityRefs]);
      const statuses = [options.status ?? []].flat();

      const matching = (await all()).filter(
        request =>
          (statuses.length === 0 || statuses.includes(request.status)) &&
          (options.role !== 'requester' ||
            request.requesterRef === you.userEntityRef) &&
          (options.role !== 'approver' ||
            request.policySnapshot.approvers.some(ref => yours.has(ref))) &&
          (!options.actionable ||
            checkDecisionEligibility(request, you, request.decisions).allowed),
      );

      const offset = options.offset ?? 0;
      const limit = options.limit ?? matching.length;
      return {
        items: matching.slice(offset, offset + limit),
        totalItems: matching.length,
      };
    },

    getRequest: find,

    async submitRequest() {
      throw new Error(
        'The dev harness has no scaffolder wizard to submit from; try it in the app.',
      );
    },

    async decide(id, { decision, comment }) {
      const you = await caller();
      const request = await find(id);
      const eligibility = checkDecisionEligibility(
        request,
        you,
        request.decisions,
      );
      if (!eligibility.allowed) {
        throw new Error(REFUSAL[eligibility.reason]);
      }

      const now = new Date().toISOString();
      const decisions = [
        ...request.decisions,
        {
          id: `d-${id}-${request.decisions.length + 1}`,
          requestId: id,
          approverRef: you.userEntityRef,
          decision,
          comment,
          createdAt: now,
        },
      ];
      const progress = computeQuorumProgress(decisions, request.policySnapshot);

      return replace({
        ...request,
        decisions,
        updatedAt: now,
        ...(progress.denied ? { status: 'rejected' as const } : {}),
        ...(progress.satisfied
          ? { status: 'completed' as const, taskId: `task-${id}` }
          : {}),
      });
    },

    async cancel(id) {
      const you = await caller();
      const request = await find(id);
      if (request.requesterRef !== you.userEntityRef) {
        throw new Error('Only the requester can withdraw a request');
      }
      if (request.status !== 'pending') {
        throw new Error(`Approval request ${id} is no longer pending`);
      }
      return replace({
        ...request,
        status: 'cancelled',
        updatedAt: new Date().toISOString(),
      });
    },
  };
}
