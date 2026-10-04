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
  type ApprovalRequest,
  type ApprovalRequestStatus,
  checkDecisionEligibility,
  computeQuorumProgress,
} from '@ferin79/backstage-plugin-scaffolder-approvals-common';
import {
  alertApiRef,
  identityApiRef,
  useApi,
  useRouteRef,
} from '@backstage/core-plugin-api';
import {
  EntityDisplayName,
  useEntityPresentation,
} from '@backstage/plugin-catalog-react';
import {
  Alert,
  ButtonLink,
  Container,
  Flex,
  Header,
  Skeleton,
  Text,
} from '@backstage/ui';
import type { JsonObject } from '@backstage/types';
import { RiArrowLeftLine, RiQuestionLine } from '@remixicon/react';
import { type ReactNode, useCallback, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import useAsync from 'react-use/esm/useAsync';
import { approvalsApiRef } from '../../api';
import { rootRouteRef } from '../../routes';
import { ApprovalsLayout, DocumentTitle } from '../ApprovalsLayout';
import { StatusPill } from '../StatusPill';
import { effectiveStatus } from '../StatusPill/effectiveStatus';
import { useOnApprovalsChange } from '../useOnApprovalsChange';
import { DecisionDialog } from './DecisionDialog';
import { DecisionPanel } from './DecisionPanel';
import { DriftNotice } from './DriftNotice';
import {
  RequestActivity,
  RequestDetails,
  RequestParameters,
} from './RequestSections';
import { WithdrawDialog } from './WithdrawDialog';
import styles from './RequestDetail.module.css';

/**
 * What a request is called: its gate's rendered summary, or the template's
 * catalog name when there is none — a gate need not define a summary, and
 * redaction removes it. Never the raw template ref (B16).
 */
function RequestTitle(props: {
  request: Pick<ApprovalRequest, 'summary' | 'templateRef'>;
}) {
  const { summary, templateRef } = props.request;
  return summary ? (
    <>{summary}</>
  ) : (
    <EntityDisplayName entityRef={templateRef} hideIcon disableTooltip />
  );
}

/**
 * The page header: what the request is, who asked, and where it stands.
 *
 * The catalog's names, not raw refs (B16), as plain strings: BUI's header
 * takes a string title and description. The requester's link to their
 * catalog page is in the Details card instead. The status is a labelled
 * metadata item, which wraps under the title on a narrow screen rather than
 * sliding over it (B14).
 */
function RequestHeader(props: {
  request: Pick<ApprovalRequest, 'summary' | 'templateRef' | 'requesterRef'>;
  status: ApprovalRequestStatus;
}) {
  const { request, status } = props;
  const template = useEntityPresentation(request.templateRef);
  const requester = useEntityPresentation(request.requesterRef, {
    defaultKind: 'user',
  });

  const title = request.summary ?? template.primaryTitle;

  return (
    <>
      <DocumentTitle title={title} />
      <Header
        className={styles.header}
        title={title}
        description={`Requested by ${requester.primaryTitle}`}
        metadata={[{ label: 'Status', value: <StatusPill status={status} /> }]}
      />
    </>
  );
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

  // Only the first load shows a placeholder. A reload — after a decision, or
  // prompted by a signal — keeps the request on screen until the new copy
  // arrives, rather than flashing the page away while somebody reads it.
  if (state.loading && !state.value) {
    return <RequestSkeleton />;
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
  const isRequester =
    identity.userEntityRef.toLocaleLowerCase('en-US') ===
    request.requesterRef.toLocaleLowerCase('en-US');

  return (
    <ApprovalsLayout tabs={false}>
      <RequestHeader request={request} status={status} />

      <Container>
        <Flex direction="column" gap="4">
          {/* Above everything else: it changes what approving means, so it
              has to be read before the buttons. Only while there is still
              something to approve: once a request has run, or never will,
              "the edited steps are the ones that will run" is untrue. */}
          {status === 'pending' && (
            <DriftNotice drift={request.templateDrift} />
          )}

          <div className={styles.layout}>
            <div className={styles.decision}>
              <DecisionPanel
                request={request}
                status={status}
                progress={progress}
                eligibility={eligibility}
                isRequester={isRequester}
                busy={busy}
                onDecide={setDeciding}
                onWithdraw={() => setConfirmingWithdraw(true)}
                onResubmit={resubmit}
              />
            </div>

            {/* Beside the decision on a wide screen, and straight under it on
                a narrow one: what is being decided belongs next to the
                buttons, ahead of the history. */}
            <Flex direction="column" gap="4" className={styles.aside}>
              <RequestDetails request={request} status={status} />
              <RequestParameters request={request} />
            </Flex>

            <div className={styles.activity}>
              <RequestActivity request={request} />
            </div>
          </div>
        </Flex>

        {deciding && (
          <DecisionDialog
            decision={deciding}
            summary={<RequestTitle request={request} />}
            busy={busy}
            onCancel={() => setDeciding(undefined)}
            onConfirm={comment => decide(deciding, comment)}
          />
        )}

        {confirmingWithdraw && (
          <WithdrawDialog
            summary={<RequestTitle request={request} />}
            busy={busy}
            onCancel={() => setConfirmingWithdraw(false)}
            onConfirm={withdraw}
          />
        )}
      </Container>
    </ApprovalsLayout>
  );
}

/** The page's shape while the request loads, so nothing jumps when it lands. */
function RequestSkeleton() {
  return (
    <ApprovalsLayout tabs={false}>
      <Container>
        <Flex direction="column" gap="4" py="3" aria-busy="true">
          <Skeleton width="40%" height={32} />
          <Skeleton width="20%" height={18} />
          <div className={styles.layout}>
            <div className={styles.decision}>
              <Skeleton height={140} />
            </div>
            <Flex direction="column" gap="4" className={styles.aside}>
              <Skeleton height={200} />
              <Skeleton height={120} />
            </Flex>
            <div className={styles.activity}>
              <Skeleton height={160} />
            </div>
          </div>
        </Flex>
      </Container>
    </ApprovalsLayout>
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
    <ButtonLink
      href={rootPath()}
      variant="secondary"
      iconStart={<RiArrowLeftLine aria-hidden />}
    >
      Back to approvals
    </ButtonLink>
  );

  let body: ReactNode;
  if (statusCode === 404 || statusCode === 400) {
    body = (
      <Flex
        direction="column"
        align="center"
        gap="3"
        py="10"
        className={styles.notFound}
      >
        <span className={styles.notFoundIcon} aria-hidden="true">
          <RiQuestionLine />
        </span>
        <Text as="h3" variant="title-small">
          {statusCode === 404
            ? 'No such approval request'
            : 'This is not a link to an approval request'}
        </Text>
        <Text color="secondary" className={styles.notFoundText}>
          {statusCode === 404
            ? 'Nothing matches this link. It may have been mistyped, or it may belong to another Backstage instance.'
            : 'The address does not contain a request id. Check that it was copied in full.'}
        </Text>
        {back}
      </Flex>
    );
  } else {
    body = (
      <Flex direction="column" gap="4" align="start">
        <Alert
          status="danger"
          icon
          title="Could not load this approval request"
          description={
            statusCode ? `${error.message} (HTTP ${statusCode})` : error.message
          }
          style={{ alignSelf: 'stretch' }}
        />
        {back}
      </Flex>
    );
  }

  return (
    <ApprovalsLayout title="Approval request" tabs={false}>
      <Header title="Approval request" />
      <Container>{body}</Container>
    </ApprovalsLayout>
  );
}
