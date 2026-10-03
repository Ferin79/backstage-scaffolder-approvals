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
  ApprovalRequestStatus,
  ApprovalRequestWithDecisions,
  DecisionEligibility,
  DecisionIneligibility,
  QuorumProgress,
} from '@ferin79/backstage-plugin-scaffolder-approvals-common';
import {
  Button,
  ButtonLink,
  Card,
  CardBody,
  CardFooter,
  Flex,
  Text,
} from '@backstage/ui';
import type { JsonObject } from '@backstage/types';
import {
  RiArrowGoBackLine,
  RiCheckboxCircleLine,
  RiCheckLine,
  RiCloseCircleLine,
  RiCloseLine,
  RiErrorWarningLine,
  RiExternalLinkLine,
  RiHourglassLine,
  RiInformationLine,
  RiPlayCircleLine,
  RiRocketLine,
  RiTimeLine,
} from '@remixicon/react';
import type { ReactElement } from 'react';
import { PolicySummary } from '../PolicySummary';
import { STATUS_TONE } from '../StatusPill';
import { RequesterActions } from './RequesterActions';
import styles from './RequestDetail.module.css';

/**
 * Why the decide buttons are not available, in the approver's words.
 *
 * Only shown while a request is pending. Once it has settled, nobody can decide
 * and the question is what happened, which `OUTCOME` answers.
 */
const WHY_NOT: Record<DecisionIneligibility, string> = {
  'not-an-approver': 'You are not an approver for this request.',
  'self-approval': 'You cannot approve your own request.',
  'not-pending': 'This request has already been decided.',
  expired: 'This request timed out before anyone decided.',
  'already-voted': 'You have already decided on this request.',
};

/**
 * What happened to a request that is no longer waiting, by its status.
 *
 * Not "this request has already been decided": a withdrawn or expired request
 * was never decided at all, and saying so sends people looking for a decision
 * that does not exist (B4 in the browser review). Written from the status
 * rather than from the decisions, too, so a denial that lost the race to an
 * approval does not make a running request read as denied.
 */
const OUTCOME: Record<Exclude<ApprovalRequestStatus, 'pending'>, string> = {
  approved: 'Approved. The template is starting.',
  running: 'Approved. The template is running.',
  completed: 'Approved, and the template has run.',
  failed: 'Approved, but the template did not complete.',
  rejected: 'Denied. A single denial rejects a request outright.',
  cancelled: 'Withdrawn by the requester before it was decided.',
  expired: 'Timed out before it was approved.',
};

const ICON: Record<ApprovalRequestStatus, ReactElement> = {
  pending: <RiTimeLine aria-hidden />,
  approved: <RiRocketLine aria-hidden />,
  running: <RiPlayCircleLine aria-hidden />,
  completed: <RiCheckboxCircleLine aria-hidden />,
  failed: <RiErrorWarningLine aria-hidden />,
  rejected: <RiCloseCircleLine aria-hidden />,
  cancelled: <RiArrowGoBackLine aria-hidden />,
  expired: <RiHourglassLine aria-hidden />,
};

/**
 * How far a pending request is towards its quorum, one segment per approval
 * it needs. Decoration: the heading above it says the same in words.
 */
function QuorumMeter(props: { approvals: number; quorum: number }) {
  const { approvals, quorum } = props;
  // Past a dozen, segments are slivers; a continuous bar says it better.
  if (quorum > 12) {
    return (
      <div className={styles.meter} aria-hidden="true">
        <span
          className={styles.meterFill}
          style={{ width: `${Math.min(1, approvals / quorum) * 100}%` }}
        />
      </div>
    );
  }
  return (
    <div className={styles.meter} aria-hidden="true">
      {Array.from({ length: quorum }, (_, index) => (
        <span
          key={index}
          className={styles.segment}
          data-filled={index < approvals || undefined}
        />
      ))}
    </div>
  );
}

/** @internal */
export interface DecisionPanelProps {
  request: ApprovalRequestWithDecisions;
  /** The shown status, which for a lapsed request is already `expired`. */
  status: ApprovalRequestStatus;
  progress: QuorumProgress;
  eligibility: DecisionEligibility;
  isRequester: boolean;
  busy: boolean;
  onDecide: (decision: ApprovalDecisionOutcome) => void;
  onWithdraw: () => void;
  onResubmit: (templateRef: string, values: JsonObject) => void;
}

/**
 * Where a request stands and what the viewer can do about it, in one place.
 *
 * The heading is the answer to "what is happening": how many approvals are
 * still needed, or what became of it. Under it, whose approval it needs, so a
 * requester knows whom to chase and anyone can notice a gate naming a group
 * nobody is in (B5). The footer holds whatever the viewer can do: decide, see
 * why they cannot, withdraw or resubmit their own, or open the task's log.
 *
 * @internal
 */
export function DecisionPanel(props: DecisionPanelProps) {
  const {
    request,
    status,
    progress,
    eligibility,
    isRequester,
    busy,
    onDecide,
    onWithdraw,
    onResubmit,
  } = props;

  const pending = status === 'pending';
  const tone = STATUS_TONE[status];

  const requesterActions = (
    <RequesterActions
      // The shown status, so a request past its deadline is not offered for
      // withdrawal: there is nothing left to withdraw.
      request={{ ...request, status }}
      isRequester={isRequester}
      busy={busy}
      onWithdraw={onWithdraw}
      onResubmit={onResubmit}
    />
  );
  const hasRequesterActions =
    isRequester && (status === 'pending' || status === 'failed');

  return (
    <Card className={styles.panel} data-tone={tone}>
      <CardBody>
        <Flex gap="3" align="start">
          <span className={styles.panelIcon}>{ICON[status]}</span>
          <Flex direction="column" gap="2" grow>
            <Text as="h3" variant="title-x-small">
              {pending
                ? `${progress.approvals} of ${progress.quorum} approval${
                    progress.quorum === 1 ? '' : 's'
                  } needed.`
                : OUTCOME[status]}
            </Text>
            <PolicySummary policy={request.policySnapshot} color="secondary" />
            {pending && (
              <QuorumMeter
                approvals={progress.approvals}
                quorum={progress.quorum}
              />
            )}
          </Flex>
        </Flex>
      </CardBody>

      {(pending || hasRequesterActions || request.taskId) && (
        <CardFooter className={styles.panelFooter}>
          <Flex direction="column" gap="3">
            {pending &&
              (eligibility.allowed ? (
                <Flex gap="2" style={{ flexWrap: 'wrap' }}>
                  <Button
                    variant="primary"
                    isDisabled={busy}
                    onClick={() => onDecide('approve')}
                    iconStart={<RiCheckLine aria-hidden />}
                  >
                    Approve
                  </Button>
                  <Button
                    variant="secondary"
                    destructive
                    isDisabled={busy}
                    onClick={() => onDecide('deny')}
                    iconStart={<RiCloseLine aria-hidden />}
                  >
                    Deny
                  </Button>
                </Flex>
              ) : (
                // The same reasons the backend would refuse with, so a
                // disabled control and a server error can never tell
                // different stories.
                <Flex gap="2" align="center">
                  <span className={styles.inlineIcon}>
                    <RiInformationLine aria-hidden />
                  </span>
                  <Text color="secondary">{WHY_NOT[eligibility.reason]}</Text>
                </Flex>
              ))}

            {requesterActions}

            {request.taskId && (
              <Flex>
                {/* §10.1: the requester cannot find this task under "my
                    tasks", because the service principal created it. */}
                <ButtonLink
                  href={`/create/tasks/${request.taskId}`}
                  target="_blank"
                  variant="secondary"
                  iconEnd={<RiExternalLinkLine aria-hidden />}
                >
                  View task log
                </ButtonLink>
              </Flex>
            )}
          </Flex>
        </CardFooter>
      )}
    </Card>
  );
}
