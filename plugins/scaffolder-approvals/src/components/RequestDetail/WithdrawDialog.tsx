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
  Button,
  Dialog,
  DialogBody,
  DialogFooter,
  DialogHeader,
  Text,
} from '@backstage/ui';
import type { ReactNode } from 'react';

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
 * Approve and Deny already asked, and withdrawing is just as final: a withdrawn
 * request cannot be revived, any approvals it had gathered are lost, and asking
 * again means a new request and every approver deciding again (B11 in the
 * browser review).
 */
export function WithdrawDialog(props: WithdrawDialogProps) {
  const { summary, busy, onCancel, onConfirm } = props;

  return (
    // `Dialog` is the overlay itself and shows nothing without `isOpen`.
    // Dismissing it is the same as cancelling.
    <Dialog
      isOpen
      width={480}
      isDismissable={!busy}
      onOpenChange={open => {
        if (!open) {
          onCancel();
        }
      }}
    >
      <DialogHeader>Withdraw this request?</DialogHeader>

      <DialogBody>
        <Text>
          Withdrawing stops <strong>{summary}</strong>. Nobody will be asked to
          decide on it, any approvals it already has are discarded, and it
          cannot be undone: to ask again, you will have to submit a new request.
        </Text>
      </DialogBody>

      <DialogFooter>
        <Button variant="secondary" onClick={onCancel} isDisabled={busy}>
          Keep it
        </Button>
        <Button
          variant="primary"
          destructive
          onClick={onConfirm}
          isPending={busy}
          isDisabled={busy}
        >
          Withdraw
        </Button>
      </DialogFooter>
    </Dialog>
  );
}
