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
  checkDecisionEligibility,
  computeQuorumProgress,
  type DecisionIneligibility,
} from '@backstage-community/plugin-scaffolder-approvals-common';
import {
  Content,
  Header,
  Page,
  Progress,
  ResponseErrorPanel,
} from '@backstage/core-components';
import {
  alertApiRef,
  identityApiRef,
  useApi,
} from '@backstage/core-plugin-api';
import { Box, Button, Card, Flex, Text } from '@backstage/ui';
import { useCallback, useState } from 'react';
import useAsync from 'react-use/esm/useAsync';
import { approvalsApiRef } from '../../api';
import { StatusPill } from '../StatusPill';
import { DecisionDialog } from './DecisionDialog';

/** Why the decide buttons are not available, in the approver's words. */
const WHY_NOT: Record<DecisionIneligibility, string> = {
  'not-an-approver': 'You are not an approver for this request.',
  'self-approval': 'You cannot approve your own request.',
  'not-pending': 'This request has already been decided.',
  'already-voted': 'You have already decided on this request.',
};

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

  const [reload, setReload] = useState(0);
  const [deciding, setDeciding] = useState<ApprovalDecisionOutcome>();
  const [busy, setBusy] = useState(false);

  const state = useAsync(async () => {
    const [request, identity] = await Promise.all([
      api.getRequest(requestId),
      identityApi.getBackstageIdentity(),
    ]);
    return { request, identity };
  }, [api, identityApi, requestId, reload]);

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

  if (state.loading) {
    return <Progress />;
  }
  if (state.error) {
    return <ResponseErrorPanel error={state.error} />;
  }

  const request = state.value!.request;
  const identity = state.value!.identity;

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
        <StatusPill status={request.status} />
      </Header>

      <Content>
        <Flex direction="column" gap="4">
          <Card>
            <Flex direction="column" gap="3">
              <Text variant="title-small">Request</Text>

              <Detail label="Template" value={request.templateRef} />
              <Detail label="Requested" value={when(request.createdAt)} />
              {request.expiresAt && (
                <Detail label="Expires" value={when(request.expiresAt)} />
              )}
              {request.taskId && <Detail label="Task" value={request.taskId} />}

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

              <Text>
                {progress.denied
                  ? 'Denied. A single denial rejects a request outright.'
                  : `${progress.approvals} of ${progress.quorum} approval${
                      progress.quorum === 1 ? '' : 's'
                    } needed.`}
              </Text>

              {request.decisions.length === 0 ? (
                <Text>Nobody has decided yet.</Text>
              ) : (
                request.decisions.map(decision => (
                  <Box key={decision.id}>
                    <Text>
                      <strong>{decision.approverRef}</strong>{' '}
                      {decision.decision === 'approve' ? 'approved' : 'denied'}{' '}
                      on {when(decision.createdAt)}
                    </Text>
                    {decision.comment && <Text>{decision.comment}</Text>}
                  </Box>
                ))
              )}

              {eligibility.allowed ? (
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
                // The same reasons the backend would refuse with, so a disabled
                // control and a server error can never tell different stories.
                <Text>{WHY_NOT[eligibility.reason]}</Text>
              )}
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
      </Content>
    </Page>
  );
}

function Detail(props: { label: string; value: string }) {
  return (
    <Flex gap="2">
      <Text weight="bold">{props.label}</Text>
      <Text>{props.value}</Text>
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
