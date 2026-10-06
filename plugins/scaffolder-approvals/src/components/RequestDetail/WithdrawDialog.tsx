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
