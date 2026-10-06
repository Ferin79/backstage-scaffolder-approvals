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
} from '@backstage/ui';
import type { ReactElement, ReactNode } from 'react';

/** @internal */
export interface ConfirmDialogProps {
  title: string;
  /** Disables both buttons, and dismissing, while the action is in flight. */
  busy: boolean;
  cancelLabel?: string;
  confirmLabel: string;
  confirmIcon?: ReactElement;
  destructive?: boolean;
  onCancel: () => void;
  onConfirm: () => void;
  children: ReactNode;
}

/**
 * "Are you sure?" before an action that is hard to take back: approving,
 * denying and withdrawing all ask first.
 *
 * `Dialog` is the overlay itself and shows nothing without `isOpen`, so this
 * is rendered only while it is open. Dismissing it is the same as cancelling.
 *
 * @internal
 */
export function ConfirmDialog(props: ConfirmDialogProps) {
  const {
    title,
    busy,
    cancelLabel = 'Cancel',
    confirmLabel,
    confirmIcon,
    destructive,
    onCancel,
    onConfirm,
    children,
  } = props;

  return (
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
      <DialogHeader>{title}</DialogHeader>
      <DialogBody>{children}</DialogBody>
      <DialogFooter>
        <Button variant="secondary" onPress={onCancel} isDisabled={busy}>
          {cancelLabel}
        </Button>
        <Button
          variant="primary"
          destructive={destructive}
          isPending={busy}
          isDisabled={busy}
          onPress={onConfirm}
          iconStart={confirmIcon}
        >
          {confirmLabel}
        </Button>
      </DialogFooter>
    </Dialog>
  );
}
