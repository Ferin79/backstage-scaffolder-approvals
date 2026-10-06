import { checkDecisionEligibility, isApprover } from './eligibility';
import { normaliseEntityRef } from './entityRefs';
import type { ApprovalDecision, ApprovalRequest, GatePolicy } from './types';

const POLICY: GatePolicy = {
  approvers: ['group:default/devx-team', 'user:default/platform-lead'],
  quorum: 1,
  selfApprove: false,
};

const REQUEST: Pick<
  ApprovalRequest,
  'status' | 'requesterRef' | 'policySnapshot'
> = {
  status: 'pending',
  requesterRef: 'user:default/requester',
  policySnapshot: POLICY,
};

function decision(approverRef: string): ApprovalDecision {
  return {
    id: 'd1',
    requestId: 'r1',
    approverRef,
    decision: 'approve',
    createdAt: '2026-09-12T10:00:00.000Z',
  };
}

describe('normaliseEntityRef', () => {
  it('collapses the spellings that denote one entity', () => {
    expect(normaliseEntityRef('Group:DevX')).toBe('group:default/devx');
    expect(normaliseEntityRef('  group:default/devx  ')).toBe(
      'group:default/devx',
    );
    expect(normaliseEntityRef('user:Alice')).toBe('user:default/alice');
    expect(normaliseEntityRef('group:Other/Team')).toBe('group:other/team');
  });

  it('throws on something that is not a ref', () => {
    expect(() => normaliseEntityRef('not a ref at all!')).toThrow();
  });
});

describe('isApprover', () => {
  it('matches through a group the caller belongs to', () => {
    expect(
      isApprover(POLICY, {
        userEntityRef: 'user:default/alice',
        ownershipEntityRefs: ['user:default/alice', 'group:default/devx-team'],
      }),
    ).toBe(true);
  });

  it('matches a directly listed user', () => {
    expect(
      isApprover(POLICY, {
        userEntityRef: 'user:default/platform-lead',
        ownershipEntityRefs: ['user:default/platform-lead'],
      }),
    ).toBe(true);
  });

  it('matches regardless of how either side was spelled', () => {
    // The whole point of normalising: a template author writing `Group:DevX-Team`
    // must not lock out a member whose catalog ref is `group:default/devx-team`.
    expect(
      isApprover(
        { approvers: ['Group:DevX-Team'] },
        {
          userEntityRef: 'User:Alice',
          ownershipEntityRefs: ['group:default/devx-team'],
        },
      ),
    ).toBe(true);
  });

  it('does not match someone outside the policy', () => {
    expect(
      isApprover(POLICY, {
        userEntityRef: 'user:default/bob',
        ownershipEntityRefs: ['user:default/bob', 'group:default/other-team'],
      }),
    ).toBe(false);
  });

  it('works when ownership refs are absent', () => {
    expect(
      isApprover(POLICY, { userEntityRef: 'user:default/platform-lead' }),
    ).toBe(true);
    expect(isApprover(POLICY, { userEntityRef: 'user:default/bob' })).toBe(
      false,
    );
  });

  it('ignores a ref it cannot parse instead of throwing', () => {
    // One malformed group ref in a caller's ownership list must not take down
    // the whole check.
    expect(
      isApprover(POLICY, {
        userEntityRef: 'user:default/alice',
        ownershipEntityRefs: ['!!broken!!', 'group:default/devx-team'],
      }),
    ).toBe(true);

    expect(
      isApprover(
        { approvers: ['!!broken!!'] },
        {
          userEntityRef: 'user:default/alice',
        },
      ),
    ).toBe(false);
  });
});

describe('checkDecisionEligibility', () => {
  const alice = {
    userEntityRef: 'user:default/alice',
    ownershipEntityRefs: ['user:default/alice', 'group:default/devx-team'],
  };

  it('allows an approver who has not yet voted', () => {
    expect(checkDecisionEligibility(REQUEST, alice)).toEqual({ allowed: true });
  });

  it('refuses someone who is not an approver', () => {
    expect(
      checkDecisionEligibility(REQUEST, {
        userEntityRef: 'user:default/bob',
        ownershipEntityRefs: ['user:default/bob'],
      }),
    ).toEqual({ allowed: false, reason: 'not-an-approver' });
  });

  it('refuses the requester when self-approval is off, even via a group', () => {
    // The case that matters: the requester is a member of the approver group,
    // so a naive membership check would let them wave their own request
    // through and a four-eyes control would be no control at all.
    expect(
      checkDecisionEligibility(REQUEST, {
        userEntityRef: 'user:default/requester',
        ownershipEntityRefs: [
          'user:default/requester',
          'group:default/devx-team',
        ],
      }),
    ).toEqual({ allowed: false, reason: 'self-approval' });
  });

  it('allows the requester when self-approval is explicitly on', () => {
    expect(
      checkDecisionEligibility(
        {
          ...REQUEST,
          policySnapshot: { ...POLICY, selfApprove: true },
        },
        {
          userEntityRef: 'user:default/requester',
          ownershipEntityRefs: [
            'user:default/requester',
            'group:default/devx-team',
          ],
        },
      ),
    ).toEqual({ allowed: true });
  });

  it('tells a non-approver requester they are not an approver', () => {
    // Ordering matters for the message: someone outside the policy entirely
    // should hear that, not a confusing note about self-approval.
    expect(
      checkDecisionEligibility(
        { ...REQUEST, requesterRef: 'user:default/outsider' },
        { userEntityRef: 'user:default/outsider' },
      ),
    ).toEqual({ allowed: false, reason: 'not-an-approver' });
  });

  it('refuses a second vote from the same approver', () => {
    expect(
      checkDecisionEligibility(REQUEST, alice, [
        decision('user:default/alice'),
      ]),
    ).toEqual({ allowed: false, reason: 'already-voted' });
  });

  it('is unaffected by somebody else having voted', () => {
    expect(
      checkDecisionEligibility(REQUEST, alice, [
        decision('user:default/platform-lead'),
      ]),
    ).toEqual({ allowed: true });
  });

  it('refuses once the request has left pending', () => {
    for (const status of [
      'approved',
      'running',
      'completed',
      'failed',
      'rejected',
      'cancelled',
      'expired',
    ] as const) {
      expect(checkDecisionEligibility({ ...REQUEST, status }, alice)).toEqual({
        allowed: false,
        reason: 'not-pending',
      });
    }
  });
});
