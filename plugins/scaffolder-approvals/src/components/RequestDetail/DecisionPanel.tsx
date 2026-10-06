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
  type ApprovalDecisionOutcome,
  type ApprovalRequestStatus,
  type ApprovalRequestWithDecisions,
  DECISION_INELIGIBILITY_MESSAGES,
  type DecisionEligibility,
  type DecisionIneligibility,
  type QuorumProgress,
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
import { scaffolderTaskPath } from '../scaffolderPaths';
import { STATUS_TONE } from '../StatusPill';
import { RequesterActions } from './RequesterActions';
import styles from './RequestDetail.module.css';

/**
 * Why the decide buttons are not available, in the same words the backend
 * refuses with. Only shown while a request is pending; once it has settled the
 * question is what happened, which `OUTCOME` answers.
 *
 * A requester outside every approver group is not told they are "not an
 * approver" — true, and beside the point. It is their request.
 */
function whyNot(reason: DecisionIneligibility, isRequester: boolean): string {
  if (isRequester && reason === 'not-an-approver') {
    return 'This is your request. The approvers named above decide on it.';
  }
  return `${DECISION_INELIGIBILITY_MESSAGES[reason]}.`;
}

/**
 * What happened to a request that is no longer waiting, by its status.
 *
 * Not "this request has already been decided": a withdrawn or expired request
 * was never decided at all. Written from the status rather than from the
 * decisions, so a denial that lost the race to an approval does not make a
 * running request read as denied.
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
 * A failure reason as a sentence of its own. The backend writes reasons to
 * follow "did not complete:" in a notification, so they start in lower case
 * and carry no full stop.
 */
function asSentence(reason: string): string {
  const text = reason.trim();
  const capitalised = text.charAt(0).toLocaleUpperCase('en-US') + text.slice(1);
  return /[.!?…]$/.test(capitalised) ? capitalised : `${capitalised}.`;
}

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
 * nobody is in. The footer holds whatever the viewer can do: decide, see
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
            {/* Why it failed, where the backend recorded it. "Did not
                complete" on its own sent people to the task log, and a launch
                the scaffolder refused has no task log to read. */}
            {status === 'failed' && request.failureReason && (
              <Text data-testid="failure-reason">
                {asSentence(request.failureReason)}
              </Text>
            )}
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
                    onPress={() => onDecide('approve')}
                    iconStart={<RiCheckLine aria-hidden />}
                  >
                    Approve
                  </Button>
                  <Button
                    variant="secondary"
                    destructive
                    isDisabled={busy}
                    onPress={() => onDecide('deny')}
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
                  <Text color="secondary">
                    {whyNot(eligibility.reason, isRequester)}
                  </Text>
                </Flex>
              ))}

            {requesterActions}

            {request.taskId && (
              <Flex>
                <ButtonLink
                  href={scaffolderTaskPath(request.taskId)}
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
