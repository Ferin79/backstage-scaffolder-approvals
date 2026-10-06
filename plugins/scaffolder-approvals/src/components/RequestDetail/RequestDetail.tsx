import {
  type ApprovalDecisionOutcome,
  type ApprovalRequest,
  type ApprovalRequestStatus,
  type ApprovalRequestWithDecisions,
  checkDecisionEligibility,
  computeQuorumProgress,
  type DecisionEligibility,
  type DecisionIneligibility,
  isSameEntityRef,
} from '@ferin79/backstage-plugin-scaffolder-approvals-common';
import {
  type BackstageUserIdentity,
  identityApiRef,
  useApi,
  useRouteRef,
} from '@backstage/core-plugin-api';
import { toastApiRef } from '@backstage/frontend-plugin-api';
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
import { type ReactNode, useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import useAsync from 'react-use/esm/useAsync';
import { approvalsApiRef } from '../../api';
import { rootRouteRef } from '../../routes';
import { ApprovalsLayout, DocumentTitle } from '../ApprovalsLayout';
import { httpStatusOf, messageOf } from '../errors';
import { useTemplateFormLink } from '../scaffolderLinks';
import { StatusPill } from '../StatusPill';
import { effectiveStatus } from '../StatusPill/effectiveStatus';
import { useOnApprovalsChange } from '../useOnApprovalsChange';
import { useSubmitApprovalRequest } from '../useSubmitApprovalRequest';
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
import { TRANSIENT_TOAST_MS } from '../toast';

/**
 * What a request is called: its gate's rendered summary, or the template's
 * catalog name when there is none — a gate need not define a summary, and
 * redaction removes it. Never the raw template ref.
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
 * The catalog's names as plain strings, because BUI's header takes a string
 * title and description; the requester's link to their catalog page is in the
 * Details card instead. The status is a labelled metadata item, which wraps
 * under the title on a narrow screen rather than sliding over it.
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

/** Whether the signed-in user may decide on the request, and if not, why. */
function eligibilityOf(
  request: ApprovalRequestWithDecisions,
  identity: BackstageUserIdentity,
): DecisionEligibility {
  return checkDecisionEligibility(request, identity, request.decisions);
}

/**
 * Why a decision dialog closed by itself, once the request moved on under it.
 */
const MOVED_ON: Record<DecisionIneligibility, string> = {
  'not-pending': 'this request was settled while the dialog was open.',
  expired: 'this request timed out while the dialog was open.',
  'already-voted': 'you have already decided on this request elsewhere.',
  'not-an-approver': 'you are no longer an approver for this request.',
  'self-approval': 'you cannot approve your own request.',
};

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
  const toastApi = useApi(toastApiRef);
  const identityApi = useApi(identityApiRef);
  const navigate = useNavigate();
  const submitRequest = useSubmitApprovalRequest();
  const templateForm = useTemplateFormLink();

  const [reload, setReload] = useState(0);
  const refresh = useCallback(() => setReload(value => value + 1), []);
  const [deciding, setDeciding] = useState<ApprovalDecisionOutcome>();
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
  // sweep expiring it: the page follows along without a reload.
  useOnApprovalsChange(refresh, requestId);

  const decide = useCallback(
    async (decision: ApprovalDecisionOutcome, comment?: string) => {
      setBusy(true);
      try {
        await api.decide(requestId, { decision, comment });
        toastApi.post({
          title: decision === 'approve' ? 'Request approved' : 'Request denied',
          status: 'success',
          timeout: TRANSIENT_TOAST_MS,
        });
        setDeciding(undefined);
        refresh();
      } catch (error) {
        toastApi.post({
          title: `Could not record your decision: ${messageOf(error)}`,
          status: 'danger',
        });
        // A conflict means the request moved on under the dialog: somebody
        // else settled it, it timed out, or this approver voted from another
        // tab. There is nothing left to confirm, so close the dialog and show
        // where the request stands now. Anything else keeps it open, to retry.
        if (httpStatusOf(error) === 409) {
          setDeciding(undefined);
          refresh();
        }
      } finally {
        setBusy(false);
      }
    },
    [api, toastApi, requestId, refresh],
  );

  const withdraw = useCallback(async () => {
    setBusy(true);
    try {
      await api.cancel(requestId);
      toastApi.post({
        title: 'Request withdrawn',
        status: 'success',
        timeout: TRANSIENT_TOAST_MS,
      });
      refresh();
    } catch (error) {
      toastApi.post({
        title: `Could not withdraw the request: ${messageOf(error)}`,
        status: 'danger',
      });
      // Settled or timed out under the dialog: show what it became.
      if (httpStatusOf(error) === 409) {
        refresh();
      }
    } finally {
      setBusy(false);
      setConfirmingWithdraw(false);
    }
  }, [api, toastApi, requestId, refresh]);

  const resubmit = useCallback(
    async (templateRef: string, values: JsonObject) => {
      setBusy(true);
      try {
        // A new request, never a retry of this one: a spent approval cannot be
        // spent twice, so resubmitting starts the whole thing over.
        await submitRequest({ templateRef, values }, 'Request submitted');
      } catch (error) {
        if (httpStatusOf(error) === 400 && templateForm) {
          // The template no longer takes these values as they are: a field
          // became required, an option went away. Posting them again can only
          // be refused again, so hand them to the template's form, pre-filled,
          // for the requester to put right.
          toastApi.post({
            title: `Could not resubmit as it was: ${messageOf(
              error,
            )}. The values are filled in on the template's form instead, to correct and submit again.`,
            status: 'info',
          });
          navigate(templateForm(templateRef, values));
          return;
        }
        toastApi.post({
          title: `Could not resubmit: ${messageOf(error)}`,
          status: 'danger',
        });
      } finally {
        setBusy(false);
      }
    },
    [toastApi, navigate, submitRequest, templateForm],
  );

  // The page updates itself, so a dialog left open over it could go on
  // offering a decision that can no longer be made. Close it once the request
  // moves on, and say why. Not while busy: then the change is this viewer's
  // own decision landing, which closes the dialog anyway.
  useEffect(() => {
    if (busy || !state.value) {
      return;
    }
    const { request, identity } = state.value;
    if (deciding) {
      const eligibility = eligibilityOf(request, identity);
      if (!eligibility.allowed) {
        setDeciding(undefined);
        toastApi.post({
          title: `Nothing was sent: ${MOVED_ON[eligibility.reason]}`,
          status: 'info',
          timeout: TRANSIENT_TOAST_MS,
        });
      }
    }
    if (confirmingWithdraw && effectiveStatus(request) !== 'pending') {
      setConfirmingWithdraw(false);
      toastApi.post({
        title:
          'Nothing was withdrawn: this request is no longer waiting for a decision.',
        status: 'info',
        timeout: TRANSIENT_TOAST_MS,
      });
    }
  }, [state.value, busy, deciding, confirmingWithdraw, toastApi]);

  // Only the first load shows a placeholder. A reload — after a decision, or
  // prompted by a signal — keeps the request on screen until the new copy
  // arrives, rather than flashing the page away while somebody reads it.
  if (state.loading && !state.value) {
    return <RequestSkeleton />;
  }
  if (state.error) {
    return <RequestLoadError error={state.error} />;
  }

  const { request, identity } = state.value!;
  // What to show, which for a pending request past its deadline is already
  // `expired` — the sweep only catches up with it later.
  const status = effectiveStatus(request);

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
                progress={computeQuorumProgress(
                  request.decisions,
                  request.policySnapshot,
                )}
                eligibility={eligibilityOf(request, identity)}
                isRequester={isSameEntityRef(
                  identity.userEntityRef,
                  request.requesterRef,
                )}
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
            drift={request.templateDrift}
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
 * Most people who land here followed an old or mangled notification link, so
 * "this does not exist" and a way back to the list are worth more to them than
 * an error panel.
 */
function RequestLoadError(props: { error: Error }) {
  const { error } = props;
  const rootPath = useRouteRef(rootRouteRef);

  // A `ResponseError` carries the HTTP status; anything else is a failure to
  // reach the backend at all.
  const statusCode = httpStatusOf(error);
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
