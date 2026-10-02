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
  checkDecisionEligibility,
  computeQuorumProgress,
  type DecisionIneligibility,
  type GatePolicy,
} from '@backstage-community/plugin-scaffolder-approvals-common';
import {
  Content,
  EmptyState,
  Header,
  HeaderLabel,
  Page,
  Progress,
  ResponseErrorPanel,
} from '@backstage/core-components';
import {
  alertApiRef,
  identityApiRef,
  useApi,
  useRouteRef,
} from '@backstage/core-plugin-api';
import { Button, ButtonLink, Card, Flex, Link, Text } from '@backstage/ui';
import type { JsonObject } from '@backstage/types';
import { type ReactNode, useCallback, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import useAsync from 'react-use/esm/useAsync';
import { approvalsApiRef } from '../../api';
import { rootRouteRef } from '../../routes';
import { StatusPill } from '../StatusPill';
import { effectiveStatus } from '../StatusPill/effectiveStatus';
import { useOnApprovalsChange } from '../useOnApprovalsChange';
import { DecisionDialog } from './DecisionDialog';
import { DriftNotice } from './DriftNotice';
import { RequesterActions } from './RequesterActions';
import { WithdrawDialog } from './WithdrawDialog';

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

/** "a, b or c" */
function oneOf(refs: string[]): string {
  return refs.length <= 1
    ? refs.join('')
    : `${refs.slice(0, -1).join(', ')} or ${refs[refs.length - 1]}`;
}

/**
 * Who can approve, and how many of them it takes, from the frozen policy.
 *
 * The requester needs to know whom to chase, and anyone can notice from this a
 * gate that names a group nobody is in (B5).
 */
function describePolicy(policy: GatePolicy): string {
  const count =
    policy.quorum === 1 ? 'one approval' : `${policy.quorum} approvals`;
  const self = policy.selfApprove
    ? 'The requester may approve their own request.'
    : 'The requester cannot approve their own request.';
  return `Needs ${count} from ${oneOf(policy.approvers)}. ${self}`;
}

function when(iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? iso : date.toLocaleString();
}

/** @public */
export interface RequestDetailProps {
  requestId: string;
}

/**
 * One approval request, and whatever you can do about it.
 *
 * This is the canonical view of a gated run. The scaffolder's own task page
 * cannot be: the task is created by the service principal, so it records this
 * plugin as its author rather than the person who asked.
 *
 * @public
 */
export function RequestDetail(props: RequestDetailProps) {
  const { requestId } = props;

  const api = useApi(approvalsApiRef);
  const alertApi = useApi(alertApiRef);
  const identityApi = useApi(identityApiRef);

  const navigate = useNavigate();
  const rootPath = useRouteRef(rootRouteRef);

  const [reload, setReload] = useState(0);
  const [deciding, setDeciding] = useState<ApprovalDecisionOutcome>();
  // Withdrawing asks first, as approving and denying do (B11).
  const [confirmingWithdraw, setConfirmingWithdraw] = useState(false);
  const [busy, setBusy] = useState(false);

  const state = useAsync(async () => {
    const [request, identity] = await Promise.all([
      api.getRequest(requestId),
      identityApi.getBackstageIdentity(),
    ]);
    return { request, identity };
  }, [api, identityApi, requestId, reload]);

  // Somebody else's decision, the template launching, its task finishing, the
  // sweep expiring it: all of these used to appear only on a manual reload.
  useOnApprovalsChange(() => setReload(value => value + 1), requestId);

  const decide = useCallback(
    async (decision: ApprovalDecisionOutcome, comment?: string) => {
      setBusy(true);
      try {
        await api.decide(requestId, { decision, comment });
        alertApi.post({
          message:
            decision === 'approve' ? 'Request approved' : 'Request denied',
          severity: 'success',
          display: 'transient',
        });
        setDeciding(undefined);
        setReload(value => value + 1);
      } catch (error) {
        // The backend's refusals are written to be read, so show what it said
        // rather than a generic failure.
        alertApi.post({
          message: `Could not record your decision: ${
            error instanceof Error ? error.message : error
          }`,
          severity: 'error',
        });
      } finally {
        setBusy(false);
      }
    },
    [api, alertApi, requestId],
  );

  const withdraw = useCallback(async () => {
    setBusy(true);
    try {
      await api.cancel(requestId);
      alertApi.post({
        message: 'Request withdrawn',
        severity: 'success',
        display: 'transient',
      });
      setReload(value => value + 1);
    } catch (error) {
      alertApi.post({
        message: `Could not withdraw the request: ${
          error instanceof Error ? error.message : error
        }`,
        severity: 'error',
      });
    } finally {
      setBusy(false);
      setConfirmingWithdraw(false);
    }
  }, [api, alertApi, requestId]);

  const resubmit = useCallback(
    async (templateRef: string, values: JsonObject) => {
      setBusy(true);
      try {
        // A new request, never a retry of this one: a spent approval cannot be
        // spent twice (Q5), so resubmitting has to start the whole thing over
        // with the values pre-filled.
        const created = await api.submitRequest({ templateRef, values });
        alertApi.post({
          message: created.collapsed
            ? 'You already have an identical request open'
            : 'Request submitted',
          severity: 'success',
          display: 'transient',
        });
        navigate(`${rootPath()}/requests/${created.id}`);
      } catch (error) {
        alertApi.post({
          message: `Could not resubmit: ${
            error instanceof Error ? error.message : error
          }`,
          severity: 'error',
        });
      } finally {
        setBusy(false);
      }
    },
    [api, alertApi, navigate, rootPath],
  );

  // Only the first load shows a spinner. A reload — after a decision, or
  // prompted by a signal — keeps the request on screen until the new copy
  // arrives, rather than flashing the page away while somebody reads it.
  if (state.loading && !state.value) {
    return <Progress />;
  }
  if (state.error) {
    return <RequestLoadError error={state.error} />;
  }

  const request = state.value!.request;
  const identity = state.value!.identity;
  // What to show, which for a pending request past its deadline is already
  // `expired` (B9) — the sweep only catches up with it later.
  const status = effectiveStatus(request);

  const eligibility = checkDecisionEligibility(
    request,
    {
      userEntityRef: identity.userEntityRef,
      ownershipEntityRefs: identity.ownershipEntityRefs,
    },
    request.decisions,
  );
  const progress = computeQuorumProgress(
    request.decisions,
    request.policySnapshot,
  );

  return (
    <Page themeId="tool">
      <Header
        title={request.summary ?? request.templateRef}
        subtitle={`Requested by ${request.requesterRef}`}
      >
        {/* In a `HeaderLabel`, as Backstage pages put their header items. The
            header lays its children out in a spaced grid whose negative
            margins expect grid items; a bare pill was not one, so on a narrow
            screen it slid up over the subtitle (B14). */}
        <HeaderLabel label="Status" value={<StatusPill status={status} />} />
      </Header>

      <Content>
        <Flex direction="column" gap="4">
          {/* Above the request rather than beside it: it changes what
              approving means, so it has to be read before the buttons. */}
          <DriftNotice drift={request.templateDrift} />

          <Card>
            <Flex direction="column" gap="3">
              <Text variant="title-small">Request</Text>

              <Detail label="Template" value={request.templateRef} />
              <Detail label="Requested" value={when(request.createdAt)} />
              {/* A deadline only means something while the request is waiting.
                  On a settled one, "Expires" read as if it still could. */}
              {request.expiresAt && status === 'pending' && (
                <Detail label="Expires" value={when(request.expiresAt)} />
              )}
              {request.expiresAt && status === 'expired' && (
                <Detail label="Timed out" value={when(request.expiresAt)} />
              )}
              {request.taskId && (
                <Detail
                  label="Task"
                  value={
                    // §10.1: the requester cannot find this task under "my
                    // tasks", because it was created by the service principal.
                    // This link is how they reach its log at all.
                    <Link
                      href={`/create/tasks/${request.taskId}`}
                      target="_blank"
                    >
                      {request.taskId}
                    </Link>
                  }
                />
              )}

              <Text variant="title-x-small">Parameters</Text>
              {request.values === null ? (
                // Redaction is a normal end state, not a failure, so it is
                // explained rather than rendered as a blank or an error.
                <Text>
                  The submitted parameters were removed on{' '}
                  {request.redactedAt ? when(request.redactedAt) : 'expiry'} by
                  the retention policy. The decision history below is kept
                  indefinitely.
                </Text>
              ) : (
                <ValueList values={request.values} />
              )}
            </Flex>
          </Card>

          <Card>
            <Flex direction="column" gap="3">
              <Text variant="title-small">Decisions</Text>

              <Text>{describePolicy(request.policySnapshot)}</Text>

              <Text>
                {status === 'pending'
                  ? `${progress.approvals} of ${progress.quorum} approval${
                      progress.quorum === 1 ? '' : 's'
                    } needed.`
                  : OUTCOME[status]}
              </Text>

              {request.decisions.length === 0 ? (
                <Text>Nobody has decided yet.</Text>
              ) : (
                request.decisions.map(decision => (
                  // A column: `Text` is inline, so in a plain box the comment
                  // ran straight on from the timestamp.
                  <Flex key={decision.id} direction="column" gap="1">
                    <Text>
                      <strong>{decision.approverRef}</strong>{' '}
                      {decision.decision === 'approve' ? 'approved' : 'denied'}{' '}
                      on {when(decision.createdAt)}
                    </Text>
                    {decision.comment && (
                      <Text color="secondary">{decision.comment}</Text>
                    )}
                  </Flex>
                ))
              )}

              <RequesterActions
                // The shown status, so a request past its deadline is not
                // offered for withdrawal: there is nothing left to withdraw.
                request={{ ...request, status }}
                isRequester={
                  identity.userEntityRef.toLocaleLowerCase('en-US') ===
                  request.requesterRef.toLocaleLowerCase('en-US')
                }
                busy={busy}
                onWithdraw={() => setConfirmingWithdraw(true)}
                onResubmit={resubmit}
              />

              {status === 'pending' &&
                (eligibility.allowed ? (
                  <Flex gap="2">
                    <Button
                      variant="primary"
                      onClick={() => setDeciding('approve')}
                    >
                      Approve
                    </Button>
                    <Button
                      variant="secondary"
                      onClick={() => setDeciding('deny')}
                    >
                      Deny
                    </Button>
                  </Flex>
                ) : (
                  // The same reasons the backend would refuse with, so a
                  // disabled control and a server error can never tell
                  // different stories.
                  <Text>{WHY_NOT[eligibility.reason]}</Text>
                ))}
            </Flex>
          </Card>
        </Flex>

        {deciding && (
          <DecisionDialog
            decision={deciding}
            summary={request.summary ?? request.templateRef}
            busy={busy}
            onCancel={() => setDeciding(undefined)}
            onConfirm={comment => decide(deciding, comment)}
          />
        )}

        {confirmingWithdraw && (
          <WithdrawDialog
            summary={request.summary ?? request.templateRef}
            busy={busy}
            onCancel={() => setConfirmingWithdraw(false)}
            onConfirm={withdraw}
          />
        )}
      </Content>
    </Page>
  );
}

/**
 * A request that could not be loaded, inside the page like everything else.
 *
 * It used to be a bare error bar at the top of an empty screen, with no
 * heading and no way back (B6). Most people who land here followed an old or
 * mangled notification link, so "this does not exist" and a way back to the
 * list are worth more to them than an error panel.
 */
function RequestLoadError(props: { error: Error }) {
  const { error } = props;
  const rootPath = useRouteRef(rootRouteRef);

  // A `ResponseError` carries the HTTP status; anything else is a failure to
  // reach the backend at all.
  const statusCode = (error as { statusCode?: number }).statusCode;
  const back = (
    // A link, because it navigates: announced as one, and it opens in a new
    // tab like any other link.
    <ButtonLink href={rootPath()} variant="secondary">
      Back to approvals
    </ButtonLink>
  );

  let body: ReactNode;
  if (statusCode === 404) {
    body = (
      <EmptyState
        missing="data"
        title="No such approval request"
        description="Nothing matches this link. It may have been mistyped, or it may belong to another Backstage instance."
        action={back}
      />
    );
  } else if (statusCode === 400) {
    body = (
      <EmptyState
        missing="data"
        title="This is not a link to an approval request"
        description="The address does not contain a request id. Check that it was copied in full."
        action={back}
      />
    );
  } else {
    body = (
      <Flex direction="column" gap="3" align="start">
        <ResponseErrorPanel error={error} />
        {back}
      </Flex>
    );
  }

  return (
    <Page themeId="tool">
      <Header title="Approval request" />
      <Content>{body}</Content>
    </Page>
  );
}

function Detail(props: { label: string; value: ReactNode }) {
  return (
    <Flex gap="2">
      <Text weight="bold">{props.label}</Text>
      {/* A string is the common case, but the task id is a link. Wrapping a
          link in `Text` would nest an anchor inside a span for no reason. */}
      {typeof props.value === 'string' ? (
        <Text>{props.value}</Text>
      ) : (
        props.value
      )}
    </Flex>
  );
}

function ValueList(props: { values: Record<string, unknown> }) {
  const entries = Object.entries(props.values);
  if (entries.length === 0) {
    return <Text>This template takes no parameters.</Text>;
  }

  return (
    <Flex direction="column" gap="1">
      {entries.map(([key, value]) => (
        <Flex key={key} gap="2">
          <Text weight="bold">{key}</Text>
          <Text>
            {typeof value === 'string' ? value : JSON.stringify(value)}
          </Text>
        </Flex>
      ))}
    </Flex>
  );
}
