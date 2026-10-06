import { GatePolicyError, readGatePolicy } from './gatePolicy';

describe('readGatePolicy', () => {
  it('normalises approver refs so they match the caller ownership refs', () => {
    // Ownership refs arrive lowercase and fully qualified. A template author
    // writing `Group:DevX-Team` means the same group, and must not be locked
    // out of their own gate by casing.
    const policy = readGatePolicy({
      approvers: [
        'Group:DevX-Team',
        'group:default/devx-team',
        ' user:default/Alice ',
        'user:Bob',
      ],
    });

    expect(policy.approvers).toEqual([
      'group:default/devx-team',
      'user:default/alice',
      'user:default/bob',
    ]);
  });

  it('applies the documented defaults', () => {
    const policy = readGatePolicy({
      approvers: ['group:default/devx-team'],
    });

    expect(policy).toEqual({
      approvers: ['group:default/devx-team'],
      quorum: 1,
      // Self-approval is off unless asked for; a gate the requester can
      // satisfy alone is not a four-eyes control.
      selfApprove: false,
    });
    expect(policy.timeout).toBeUndefined();
    expect(policy.summary).toBeUndefined();
  });

  it('reads a fully specified policy', () => {
    expect(
      readGatePolicy({
        approvers: ['group:default/devx-team', 'user:default/platform-lead'],
        quorum: 2,
        selfApprove: true,
        timeout: { hours: 72 },
        summary: '  Admin on backstage  ',
      }),
    ).toEqual({
      approvers: ['group:default/devx-team', 'user:default/platform-lead'],
      quorum: 2,
      selfApprove: true,
      timeout: { hours: 72 },
      summary: 'Admin on backstage',
    });
  });

  it('allows a quorum larger than the number of listed approvers', () => {
    // One group ref can expand to many members, so this is legitimate rather
    // than a mistake to reject.
    expect(
      readGatePolicy({ approvers: ['group:default/devx-team'], quorum: 3 })
        .quorum,
    ).toBe(3);
  });

  it('rejects a missing, empty or malformed approver list', () => {
    expect(() => readGatePolicy({})).toThrow(GatePolicyError);
    expect(() => readGatePolicy({ approvers: [] })).toThrow(/non-empty/);
    expect(() => readGatePolicy({ approvers: 'group:default/x' })).toThrow(
      /non-empty/,
    );
    expect(() => readGatePolicy({ approvers: [''] })).toThrow(
      /approvers\[0\] must be an entity ref/,
    );
    expect(() => readGatePolicy({ approvers: [42] })).toThrow(
      /approvers\[0\] must be an entity ref/,
    );
    expect(() => readGatePolicy({ approvers: ['not a ref at all!'] })).toThrow(
      /not a valid entity ref/,
    );
  });

  it('explains why approvers cannot come from the form', () => {
    // What a template author tries first, and what the probe template in the
    // browser test did: the error used to call it "not a valid entity ref".
    expect(() =>
      readGatePolicy({
        approvers: ['group:default/devx-team', '${{ parameters.owner }}'],
      }),
    ).toThrow(
      /approvers\[1\] is a template expression \(\$\{\{ parameters\.owner \}\}\)\. Approvers are read from the catalog before anyone fills in the form/,
    );
  });

  it('rejects approver kinds that cannot hold members', () => {
    // A Component cannot approve anything; catching it here beats a request
    // that can never reach quorum.
    expect(() =>
      readGatePolicy({ approvers: ['component:default/service'] }),
    ).toThrow(/must be a group or user ref/);
  });

  it('rejects a nonsensical quorum', () => {
    const approvers = ['group:default/devx-team'];
    expect(() => readGatePolicy({ approvers, quorum: 0 })).toThrow(
      /at least 1/,
    );
    expect(() => readGatePolicy({ approvers, quorum: -1 })).toThrow(
      /at least 1/,
    );
    expect(() => readGatePolicy({ approvers, quorum: 1.5 })).toThrow(/integer/);
    expect(() => readGatePolicy({ approvers, quorum: '2' })).toThrow(/integer/);
  });

  it('rejects a non-boolean selfApprove', () => {
    expect(() =>
      readGatePolicy({
        approvers: ['group:default/devx-team'],
        selfApprove: 'false',
      }),
    ).toThrow(/must be a boolean/);
  });

  it('validates the timeout, including the zero case', () => {
    const approvers = ['group:default/devx-team'];

    expect(
      readGatePolicy({ approvers, timeout: { days: 3, hours: 12 } }).timeout,
    ).toEqual({ days: 3, hours: 12 });

    // Zero would expire every request on the first sweep. Silently treating it
    // as "no timeout" would disable what the author asked for, so it throws.
    expect(() => readGatePolicy({ approvers, timeout: { hours: 0 } })).toThrow(
      /greater than zero/,
    );
    expect(() => readGatePolicy({ approvers, timeout: {} })).toThrow(
      /greater than zero/,
    );

    expect(() => readGatePolicy({ approvers, timeout: { hours: -1 } })).toThrow(
      /non-negative/,
    );
    expect(() =>
      readGatePolicy({ approvers, timeout: { fortnights: 1 } }),
    ).toThrow(/unsupported field\(s\): fortnights/);
    expect(() => readGatePolicy({ approvers, timeout: 72 })).toThrow(
      /must be an object/,
    );
  });

  it('rejects a non-object input', () => {
    expect(() => readGatePolicy(undefined)).toThrow(/must be an object/);
    expect(() => readGatePolicy(null)).toThrow(/must be an object/);
    expect(() => readGatePolicy([])).toThrow(/must be an object/);
    expect(() => readGatePolicy('approvers')).toThrow(/must be an object/);
  });
});
