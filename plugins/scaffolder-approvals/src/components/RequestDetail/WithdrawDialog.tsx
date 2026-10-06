import { Text } from '@backstage/ui';
import type { ReactNode } from 'react';
import { ConfirmDialog } from './ConfirmDialog';

/** @internal */
export interface WithdrawDialogProps {
  /** What the request is called: its summary, or its template's name. */
  summary: ReactNode;
  busy: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}

/**
 * "Are you sure?" before withdrawing a request.
 *
 * Withdrawing is as final as a decision: a withdrawn request cannot be
 * revived, any approvals it had gathered are lost, and asking again means a
 * new request and every approver deciding again.
 *
 * @internal
 */
export function WithdrawDialog(props: WithdrawDialogProps) {
  const { summary, busy, onCancel, onConfirm } = props;

  return (
    <ConfirmDialog
      title="Withdraw this request?"
      busy={busy}
      cancelLabel="Keep it"
      confirmLabel="Withdraw"
      destructive
      onCancel={onCancel}
      onConfirm={onConfirm}
    >
      <Text>
        Withdrawing stops <strong>{summary}</strong>. Nobody will be asked to
        decide on it, any approvals it already has are discarded, and it cannot
        be undone: to ask again, you will have to submit a new request.
      </Text>
    </ConfirmDialog>
  );
}
