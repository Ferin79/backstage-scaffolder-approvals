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

import { normaliseEntityRef } from './entityRefs';
import type { ApprovalDecision, ApprovalRequest, GatePolicy } from './types';

/**
 * Who is asking, in the terms the catalog describes them.
 *
 * `ownershipEntityRefs` is what `UserInfoService` returns: the user's own ref
 * plus every group they belong to, transitively. Group membership is therefore
 * resolved by the catalog rather than expanded here, which is what makes adding
 * someone to an approver group take effect immediately — the deliberate
 * exception to the policy being a frozen snapshot.
 *
 * @public
 */
export interface ApprovalCaller {
  userEntityRef: string;
  ownershipEntityRefs?: readonly string[];
}

/**
 * Why a caller may not decide on a request.
 *
 * - `not-an-approver` — none of their refs appear in the policy.
 * - `self-approval` — they submitted it and the gate forbids self-approval.
 * - `not-pending` — the request already reached a decision.
 * - `already-voted` — they have cast a vote; decisions are append-only.
 *
 * @public
 */
export type DecisionIneligibility =
  | 'not-an-approver'
  | 'self-approval'
  | 'not-pending'
  | 'already-voted';

/**
 * Whether a caller may decide on a request.
 *
 * @public
 */
export type DecisionEligibility =
  | { allowed: true }
  | { allowed: false; reason: DecisionIneligibility };

function callerRefs(caller: ApprovalCaller): Set<string> {
  const refs = [caller.userEntityRef, ...(caller.ownershipEntityRefs ?? [])];

  const normalised = new Set<string>();
  for (const ref of refs) {
    try {
      normalised.add(normaliseEntityRef(ref));
    } catch {
      // A ref the catalog model cannot parse cannot match a policy entry
      // either, so skipping it is equivalent to failing to match — and safer
      // than rejecting the whole check over one malformed group ref.
    }
  }
  return normalised;
}

/**
 * Whether any of a caller's refs appear in a gate's approver list.
 *
 * Both sides are normalised, so the casing and namespace a template author used
 * cannot lock an approver out.
 *
 * @public
 */
export function isApprover(
  policy: Pick<GatePolicy, 'approvers'>,
  caller: ApprovalCaller,
): boolean {
  const refs = callerRefs(caller);
  return policy.approvers.some(approver => {
    try {
      return refs.has(normaliseEntityRef(approver));
    } catch {
      return false;
    }
  });
}

/**
 * Decide whether a caller may vote on a request, and if not, why.
 *
 * Shared so that the backend's rejection and the UI's disabled button always
 * agree, and give the same explanation. The backend maps each reason onto an
 * HTTP error; the UI maps it onto a tooltip.
 *
 * This answers "may this person vote", not "is this person allowed to see the
 * request" — that is the permission framework's question.
 *
 * @public
 */
export function checkDecisionEligibility(
  request: Pick<ApprovalRequest, 'status' | 'requesterRef' | 'policySnapshot'>,
  caller: ApprovalCaller,
  decisions: readonly ApprovalDecision[] = [],
): DecisionEligibility {
  if (request.status !== 'pending') {
    return { allowed: false, reason: 'not-pending' };
  }

  if (!isApprover(request.policySnapshot, caller)) {
    return { allowed: false, reason: 'not-an-approver' };
  }

  // Both remaining checks are about this one person, so they compare the
  // caller's own user ref rather than their whole ownership set: a request is
  // submitted by a user and a vote is cast by a user, never by a group.
  const self = safeNormalise(caller.userEntityRef);

  // Checked after approver membership, so that someone who is not an approver
  // at all is told that rather than being told about self-approval.
  if (
    !request.policySnapshot.selfApprove &&
    self !== undefined &&
    self === safeNormalise(request.requesterRef)
  ) {
    return { allowed: false, reason: 'self-approval' };
  }

  if (
    decisions.some(decision => safeNormalise(decision.approverRef) === self)
  ) {
    return { allowed: false, reason: 'already-voted' };
  }

  return { allowed: true };
}

function safeNormalise(ref: string): string | undefined {
  try {
    return normaliseEntityRef(ref);
  } catch {
    return undefined;
  }
}
