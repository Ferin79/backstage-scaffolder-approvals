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

import type {
  ApprovalDecisionOutcome,
  TemplateDrift,
} from '@ferin79/backstage-plugin-scaffolder-approvals-common';
import {
  Alert,
  Button,
  Dialog,
  DialogBody,
  DialogFooter,
  DialogHeader,
  Flex,
  Text,
  TextAreaField,
} from '@backstage/ui';
import { RiCheckLine, RiCloseLine } from '@remixicon/react';
import { type ReactNode, useState } from 'react';
import { driftBlocksLaunch, explainDrift } from './DriftNotice';

/** @public */
export interface DecisionDialogProps {
  decision: ApprovalDecisionOutcome;
  /** What the request is called: its summary, or its template's name. */
  summary: ReactNode;
  /**
   * How the template has changed since the request was submitted. Repeated
   * here because the dialog covers the page's own warning (L19 in the browser
   * review).
   */
  drift?: TemplateDrift;
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
 * Approving a template that has changed says so again, and when the launch is
 * bound to fail it says that rather than promising the template will start.
 *
 * @public
 */
export function DecisionDialog(props: DecisionDialogProps) {
  const { decision, summary, drift, busy, onCancel, onConfirm } = props;
  const [comment, setComment] = useState('');

  const denying = decision === 'deny';
  // Denying is the same whatever happened to the template.
  const driftWarnings = denying ? [] : explainDrift(drift);
  const launchWillFail = !denying && driftBlocksLaunch(drift);

  // "Anyway" once the dialog has said why not: a plain "Approve" under a
  // warning reads as if the warning did not apply.
  let confirmLabel = 'Approve';
  if (denying) {
    confirmLabel = 'Deny';
  } else if (driftWarnings.length > 0) {
    confirmLabel = 'Approve anyway';
  }

  return (
    // `Dialog` extends `ModalOverlayProps`, so it is the overlay itself and
    // shows nothing without `isOpen`. Dismissing it is the same as cancelling.
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
      <DialogHeader>
        {denying ? 'Deny this request?' : 'Approve this request?'}
      </DialogHeader>

      <DialogBody>
        <Flex direction="column" gap="4">
          <Text>
            {denying ? (
              <>
                Denying rejects <strong>{summary}</strong> outright. Nobody
                else's approval can undo it, and the requester will have to ask
                again.
              </>
            ) : (
              <>
                Approving counts towards the quorum for{' '}
                <strong>{summary}</strong>.{' '}
                {launchWillFail
                  ? 'Once the quorum is met the template is launched, but as things stand the launch will fail.'
                  : 'Once the quorum is met the template starts straight away.'}
              </>
            )}
          </Text>

          {driftWarnings.length > 0 && (
            <Alert
              status={launchWillFail ? 'danger' : 'warning'}
              icon
              title="The template has changed"
              description={
                <Flex direction="column" gap="1">
                  {driftWarnings.map(warning => (
                    <Text key={warning} variant="body-small">
                      {warning}
                    </Text>
                  ))}
                </Flex>
              }
            />
          )}

          <TextAreaField
            label="Comment"
            // Optional for an approval, and strongly worth it for a denial: the
            // requester sees this and it is the only explanation they get.
            description={
              denying
                ? 'Tell the requester why. This is all they will see.'
                : 'Optional. The requester and the other approvers will see it.'
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
          destructive={denying}
          isPending={busy}
          isDisabled={busy}
          onClick={() => onConfirm(comment.trim() || undefined)}
          iconStart={
            denying ? <RiCloseLine aria-hidden /> : <RiCheckLine aria-hidden />
          }
        >
          {confirmLabel}
        </Button>
      </DialogFooter>
    </Dialog>
  );
}
