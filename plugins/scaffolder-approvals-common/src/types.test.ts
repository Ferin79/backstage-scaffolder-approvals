import {
  type ApprovalDecision,
  computeQuorumProgress,
  isApprovalRequestStatus,
  TERMINAL_APPROVAL_REQUEST_STATUSES,
} from './types';

function decision(
  approverRef: string,
  outcome: 'approve' | 'deny',
): ApprovalDecision {
  return {
    id: `d-${approverRef}-${outcome}`,
    requestId: 'r1',
    approverRef,
    decision: outcome,
    createdAt: '2026-09-12T10:00:00.000Z',
  };
}

describe('computeQuorumProgress', () => {
  it('counts approvals towards the quorum', () => {
    expect(computeQuorumProgress([], { quorum: 2 })).toEqual({
      approvals: 0,
      quorum: 2,
      denied: false,
      satisfied: false,
    });

    expect(
      computeQuorumProgress([decision('user:default/a', 'approve')], {
        quorum: 2,
      }),
    ).toMatchObject({ approvals: 1, satisfied: false });

    expect(
      computeQuorumProgress(
        [
          decision('user:default/a', 'approve'),
          decision('user:default/b', 'approve'),
        ],
        { quorum: 2 },
      ),
    ).toMatchObject({ approvals: 2, satisfied: true });
  });

  it('counts distinct principals, not decisions', () => {
    // The store enforces one vote per approver, but this helper is also handed
    // data from the API and must not be fooled into reaching quorum twice over.
    expect(
      computeQuorumProgress(
        [
          decision('user:default/a', 'approve'),
          decision('user:default/a', 'approve'),
        ],
        { quorum: 2 },
      ),
    ).toMatchObject({ approvals: 1, satisfied: false });
  });

  it('treats a single denial as decisive, whatever the approval count', () => {
    // A quorum is a threshold for assent, not a tally: you do not keep
    // collecting approvals past an objection.
    const progress = computeQuorumProgress(
      [
        decision('user:default/a', 'approve'),
        decision('user:default/b', 'approve'),
        decision('user:default/c', 'deny'),
      ],
      { quorum: 2 },
    );

    expect(progress.denied).toBe(true);
    expect(progress.satisfied).toBe(false);
    expect(progress.approvals).toBe(2);
  });

  it('is satisfied once approvals exceed the quorum', () => {
    expect(
      computeQuorumProgress(
        [
          decision('user:default/a', 'approve'),
          decision('user:default/b', 'approve'),
        ],
        { quorum: 1 },
      ),
    ).toMatchObject({ satisfied: true });
  });
});

describe('status helpers', () => {
  it('lists the statuses a request can never leave', () => {
    expect([...TERMINAL_APPROVAL_REQUEST_STATUSES].sort()).toEqual([
      'cancelled',
      'completed',
      'expired',
      'failed',
      'rejected',
    ]);
  });

  it('guards statuses read back as bare strings', () => {
    expect(isApprovalRequestStatus('pending')).toBe(true);
    expect(isApprovalRequestStatus('Pending')).toBe(false);
    expect(isApprovalRequestStatus('waiting')).toBe(false);
    expect(isApprovalRequestStatus(undefined)).toBe(false);
    expect(isApprovalRequestStatus(1)).toBe(false);
  });
});
