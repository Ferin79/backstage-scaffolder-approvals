import type { GatePolicy } from '@ferin79/backstage-plugin-scaffolder-approvals-common';
import { EntityRefLink } from '@backstage/plugin-catalog-react';
import { Text } from '@backstage/ui';
import { Fragment } from 'react';

/** @internal */
export interface PolicySummaryProps {
  policy: GatePolicy;
  /**
   * `_blank` in the wizard, where following a link in the same tab would
   * throw away everything filled in so far.
   */
  linkTarget?: '_blank';
  /** Secondary where the sentence explains a heading above it. */
  color?: 'primary' | 'secondary';
}

/**
 * Who can approve, how many approvals it takes, and whether the requester's
 * own counts, as one sentence: "Needs 2 approvals from DevX team. The
 * requester cannot approve their own request."
 *
 * One sentence for the wizard and the request page alike, so a requester reads
 * the same terms before submitting and after.
 *
 * Each approver is the catalog's name for them, linked to their page, rather
 * than a raw entity ref: a requester wants to know who is in the group they
 * are waiting on.
 *
 * @internal
 */
export function PolicySummary(props: PolicySummaryProps) {
  const { policy, linkTarget, color } = props;
  const { approvers, quorum, selfApprove } = policy;

  return (
    <Text color={color}>
      Needs {quorum === 1 ? 'one approval' : `${quorum} approvals`} from{' '}
      {approvers.map((approver, index) => (
        <Fragment key={approver}>
          {index > 0 && (index === approvers.length - 1 ? ' or ' : ', ')}
          <EntityRefLink entityRef={approver} hideIcon target={linkTarget} />
        </Fragment>
      ))}
      .{' '}
      {selfApprove
        ? 'The requester may approve their own request.'
        : 'The requester cannot approve their own request.'}
    </Text>
  );
}
