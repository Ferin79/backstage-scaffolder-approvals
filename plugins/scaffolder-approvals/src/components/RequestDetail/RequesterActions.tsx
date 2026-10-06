import type { ApprovalRequestWithDecisions } from '@ferin79/backstage-plugin-scaffolder-approvals-common';
import { Button, Flex, Text } from '@backstage/ui';
import type { JsonObject } from '@backstage/types';
import { RiArrowGoBackLine, RiRefreshLine } from '@remixicon/react';

/** @internal */
export interface RequesterActionsProps {
  request: ApprovalRequestWithDecisions;
  /** Whether the person looking at this is the one who asked for it. */
  isRequester: boolean;
  busy: boolean;
  onWithdraw: () => void;
  onResubmit: (templateRef: string, values: JsonObject) => void;
}

/**
 * What the person who asked for a request can do about it.
 *
 * Two actions, and which one applies is decided by the request's status rather
 * than by anything the viewer chooses:
 *
 * - **Withdraw**, while it is still pending. That is what `cancelled` means, as
 *   distinct from `rejected` — nobody decided, the requester changed their
 *   mind.
 * - **Resubmit**, once it has failed. A spent approval cannot be spent twice,
 *   so this starts a *new* request with the same values rather than
 *   retrying the old one. The distinction matters: retrying would run a
 *   template that nobody had agreed to run again.
 *
 * Renders nothing for anyone else. An approver looking at somebody else's
 * request has the decide buttons and no business with these.
 *
 * @internal
 */
export function RequesterActions(props: RequesterActionsProps) {
  const { request, isRequester, busy, onWithdraw, onResubmit } = props;

  if (!isRequester) {
    return null;
  }

  if (request.status === 'pending') {
    return (
      <Flex gap="3" align="center" style={{ flexWrap: 'wrap' }}>
        <Button
          variant="secondary"
          destructive
          isDisabled={busy}
          onPress={onWithdraw}
          iconStart={<RiArrowGoBackLine aria-hidden />}
        >
          Withdraw
        </Button>
        <Text variant="body-small" color="secondary">
          Withdrawing stops the request. Nobody is asked to decide on it.
        </Text>
      </Flex>
    );
  }

  if (request.status === 'failed') {
    // Redaction nulls the values long after a request settles, and there is
    // nothing to pre-fill from once it has.
    if (request.values === null) {
      return (
        <Text variant="body-small" color="secondary">
          This request can no longer be resubmitted: its parameters were removed
          by the retention policy.
        </Text>
      );
    }

    const { templateRef, values } = request;
    return (
      <Flex gap="3" align="center" style={{ flexWrap: 'wrap' }}>
        <Button
          variant="primary"
          isDisabled={busy}
          onPress={() => onResubmit(templateRef, values)}
          iconStart={<RiRefreshLine aria-hidden />}
        >
          Resubmit
        </Button>
        <Text variant="body-small" color="secondary">
          Starts a new request with the same parameters. The approval this run
          used is spent, so it has to be asked for again.
        </Text>
      </Flex>
    );
  }

  return null;
}
