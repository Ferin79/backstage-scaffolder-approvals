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
import { Flex, Text, TextAreaField } from '@backstage/ui';
import { RiCheckLine, RiCloseLine } from '@remixicon/react';
import { type ReactNode, useState } from 'react';
import { ConfirmDialog } from './ConfirmDialog';
import { DriftNotice, driftBlocksLaunch, explainDrift } from './DriftNotice';

/** @internal */
export interface DecisionDialogProps {
  decision: ApprovalDecisionOutcome;
  /** What the request is called: its summary, or its template's name. */
  summary: ReactNode;
  /**
   * How the template has changed since the request was submitted. Repeated
   * here because the dialog covers the page's own warning.
   */
  drift?: TemplateDrift;
  busy: boolean;
  onCancel: () => void;
  onConfirm: (comment?: string) => void;
}

/**
 * Confirm an approval or a denial, with an optional comment.
 *
 * Both outcomes are hard to take back: an approval starts the template once
 * the quorum is met, and a denial is terminal — the requester has to start
 * over.
 *
 * Approving a template that has changed says so again, and when the launch is
 * bound to fail it says that rather than promising the template will start.
 *
 * @internal
 */
export function DecisionDialog(props: DecisionDialogProps) {
  const { decision, summary, drift, busy, onCancel, onConfirm } = props;
  const [comment, setComment] = useState('');

  const denying = decision === 'deny';
  // Denying is the same whatever happened to the template.
  const driftChanged = !denying && explainDrift(drift).length > 0;
  const launchWillFail = !denying && driftBlocksLaunch(drift);

  // "Anyway" once the dialog has said why not: a plain "Approve" under a
  // warning reads as if the warning did not apply.
  let confirmLabel = 'Approve';
  if (denying) {
    confirmLabel = 'Deny';
  } else if (driftChanged) {
    confirmLabel = 'Approve anyway';
  }

  return (
    <ConfirmDialog
      title={denying ? 'Deny this request?' : 'Approve this request?'}
      busy={busy}
      confirmLabel={confirmLabel}
      confirmIcon={
        denying ? <RiCloseLine aria-hidden /> : <RiCheckLine aria-hidden />
      }
      destructive={denying}
      onCancel={onCancel}
      onConfirm={() => onConfirm(comment.trim() || undefined)}
    >
      <Flex direction="column" gap="4">
        <Text>
          {denying ? (
            <>
              Denying rejects <strong>{summary}</strong> outright. Nobody else's
              approval can undo it, and the requester will have to ask again.
            </>
          ) : (
            <>
              Approving counts towards the quorum for <strong>{summary}</strong>
              .{' '}
              {launchWillFail
                ? 'Once the quorum is met the template is launched, but as things stand the launch will fail.'
                : 'Once the quorum is met the template starts straight away.'}
            </>
          )}
        </Text>

        {driftChanged && (
          <DriftNotice
            drift={drift}
            status={launchWillFail ? 'danger' : 'warning'}
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
    </ConfirmDialog>
  );
}
