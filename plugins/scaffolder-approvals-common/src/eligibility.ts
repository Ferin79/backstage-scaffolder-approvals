import {
  isSameEntityRef,
  normaliseEntityRefs,
  tryNormaliseEntityRef,
} from './entityRefs';
import type { ApprovalDecision, ApprovalRequest, GatePolicy } from './types';

/**
 * Who is asking, in the terms the catalog describes them.
 *
 * `ownershipEntityRefs` is what `UserInfoService` returns: the user's own ref
 * plus the groups the sign-in resolver put in their token. Backstage's own
 * resolvers put in the groups the user is a *direct* member of, not those
 * groups' parents, so an approver group's child groups do not qualify unless
 * the deployment's resolver adds them.
 *
 * Group membership is resolved at *sign-in*, not at decision time: somebody
 * added to an approver group can decide from their next sign-in rather than
 * from the moment they are added.
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
 * - `expired` — its timeout has passed, even though the sweep that will mark
 *   it `expired` has not run yet.
 * - `already-voted` — they have cast a vote; decisions are append-only.
 *
 * @public
 */
export type DecisionIneligibility =
  | 'not-an-approver'
  | 'self-approval'
  | 'not-pending'
  | 'expired'
  | 'already-voted';

/**
 * Why a caller may not decide, in words, by reason.
 *
 * The backend refuses with these and the UI explains a disabled button with
 * them, so the two always tell the same story.
 *
 * @public
 */
export const DECISION_INELIGIBILITY_MESSAGES: Readonly<
  Record<DecisionIneligibility, string>
> = {
  'not-an-approver': 'You are not an approver for this request',
  'self-approval': 'You cannot approve your own request',
  'not-pending': 'This request has already been decided',
  expired: 'This request timed out before anyone decided',
  'already-voted': 'You have already decided on this request',
};

/**
 * Whether a caller may decide on a request.
 *
 * @public
 */
export type DecisionEligibility =
  | { allowed: true }
  | { allowed: false; reason: DecisionIneligibility };

/**
 * Whether any of a caller's refs appear in a gate's approver list.
 *
 * Both sides are normalised, so the casing and namespace a template author used
 * cannot lock an approver out. A ref that does not parse matches nothing.
 *
 * @public
 */
export function isApprover(
  policy: Pick<GatePolicy, 'approvers'>,
  caller: ApprovalCaller,
): boolean {
  const callerRefs = new Set(
    normaliseEntityRefs([
      caller.userEntityRef,
      ...(caller.ownershipEntityRefs ?? []),
    ]),
  );
  return policy.approvers.some(approver => {
    const normalised = tryNormaliseEntityRef(approver);
    return normalised !== undefined && callerRefs.has(normalised);
  });
}

/**
 * Decide whether a caller may vote on a request, and if not, why.
 *
 * Shared so that the backend's rejection and the UI's disabled button always
 * agree. This answers "may this person vote", not "may this person see the
 * request" — that is the permission framework's question.
 *
 * @public
 */
export function checkDecisionEligibility(
  request: Pick<
    ApprovalRequest,
    'status' | 'requesterRef' | 'policySnapshot' | 'expiresAt'
  >,
  caller: ApprovalCaller,
  decisions: readonly ApprovalDecision[] = [],
  now: Date = new Date(),
): DecisionEligibility {
  if (request.status !== 'pending') {
    return { allowed: false, reason: 'not-pending' };
  }

  // A request is dead the moment its timeout passes, not when the sweep
  // notices. Without this a request could be approved — and the template
  // launched — after the deadline the approvers were given.
  if (request.expiresAt && new Date(request.expiresAt) <= now) {
    return { allowed: false, reason: 'expired' };
  }

  if (!isApprover(request.policySnapshot, caller)) {
    return { allowed: false, reason: 'not-an-approver' };
  }

  // The remaining checks are about this one person, so they compare the
  // caller's own user ref rather than their whole ownership set. Checked after
  // approver membership, so a non-approver is told that first.
  if (
    !request.policySnapshot.selfApprove &&
    isSameEntityRef(caller.userEntityRef, request.requesterRef)
  ) {
    return { allowed: false, reason: 'self-approval' };
  }

  if (
    decisions.some(decision =>
      isSameEntityRef(decision.approverRef, caller.userEntityRef),
    )
  ) {
    return { allowed: false, reason: 'already-voted' };
  }

  return { allowed: true };
}
