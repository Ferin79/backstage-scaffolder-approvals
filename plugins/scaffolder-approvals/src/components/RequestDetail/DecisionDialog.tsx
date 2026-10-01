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

import type { ApprovalDecisionOutcome } from '@backstage-community/plugin-scaffolder-approvals-common';
import {
  Button,
  Dialog,
  DialogBody,
  DialogFooter,
  DialogHeader,
  Flex,
  Text,
  TextAreaField,
} from '@backstage/ui';
import { useState } from 'react';

/** @public */
export interface DecisionDialogProps {
  decision: ApprovalDecisionOutcome;
  summary: string;
  busy: boolean;
  onCancel: () => void;
  onConfirm: (comment?: string) => void;
}

/**
 * Confirm an approval or a denial, with an optional comment.
 *
 * A confirmation step rather than a bare button, because both outcomes are
 * hard to take back: an approval starts the template immediately, and a denial
 * is terminal — the requester has to start over.
 *
 * @public
 */
export function DecisionDialog(props: DecisionDialogProps) {
  const { decision, summary, busy, onCancel, onConfirm } = props;
  const [comment, setComment] = useState('');

  const denying = decision === 'deny';

  return (
    // `Dialog` extends `ModalOverlayProps`, so it is the overlay itself and
    // shows nothing without `isOpen`. Dismissing it is the same as cancelling.
    <Dialog
      isOpen
      isDismissable={!busy}
      onOpenChange={open => {
        if (!open) {
          onCancel();
        }
      }}
    >
      <DialogHeader>
        <Text variant="title-small">
          {denying ? 'Deny this request?' : 'Approve this request?'}
        </Text>
      </DialogHeader>

      <DialogBody>
        <Flex direction="column" gap="4">
          <Text>
            {denying
              ? `Denying rejects ${summary} outright. Nobody else's approval can undo it, and the requester will have to ask again.`
              : `Approving counts towards the quorum for ${summary}. Once the quorum is met the template starts straight away.`}
          </Text>

          <TextAreaField
            label="Comment"
            // Optional for an approval, and strongly worth it for a denial: the
            // requester sees this and it is the only explanation they get.
            description={
              denying
                ? 'Tell the requester why. This is all they will see.'
                : 'Optional.'
            }
            value={comment}
            onChange={setComment}
            isDisabled={busy}
          />
        </Flex>
      </DialogBody>

      <DialogFooter>
        <Button variant="secondary" onClick={onCancel} isDisabled={busy}>
          Cancel
        </Button>
        <Button
          variant="primary"
          isDisabled={busy}
          onClick={() => onConfirm(comment.trim() || undefined)}
        >
          {denying ? 'Deny' : 'Approve'}
        </Button>
      </DialogFooter>
    </Dialog>
  );
}
