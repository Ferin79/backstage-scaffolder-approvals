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
  ApprovalRequestStatus,
  ApprovalRequestWithDecisions,
} from '@ferin79/backstage-plugin-scaffolder-approvals-common';
import { EntityRefLink } from '@backstage/plugin-catalog-react';
import { Card, CardBody, CardHeader, Flex, Link, Text } from '@backstage/ui';
import { RiCheckLine, RiCloseLine } from '@remixicon/react';
import type { ReactNode } from 'react';
import { PersonAvatar } from '../PersonAvatar';
import { formatDateTime, Timestamp } from '../Timestamp';
import styles from './RequestDetail.module.css';

function SectionHeader(props: { title: string; description?: string }) {
  return (
    <CardHeader>
      <Flex direction="column" gap="1">
        <Text as="h3" variant="body-large" weight="bold">
          {props.title}
        </Text>
        {props.description && (
          <Text variant="body-small" color="secondary">
            {props.description}
          </Text>
        )}
      </Flex>
    </CardHeader>
  );
}

/** A value as submitted: text as text, anything structured as JSON. */
function ParameterValue(props: { value: unknown }) {
  const { value } = props;
  if (typeof value === 'string') {
    return <Text className={styles.valueText}>{value}</Text>;
  }
  if (value !== null && typeof value === 'object') {
    return (
      <pre className={styles.code}>
        <code>{JSON.stringify(value, null, 2)}</code>
      </pre>
    );
  }
  return <code className={styles.inlineCode}>{JSON.stringify(value)}</code>;
}

/**
 * What was submitted: what the approvers judge, and what an approval is bound
 * to.
 *
 * @internal
 */
export function RequestParameters(props: {
  request: Pick<ApprovalRequestWithDecisions, 'values' | 'redactedAt'>;
}) {
  const { values, redactedAt } = props.request;

  let body: ReactNode;
  if (values === null) {
    // Redaction is a normal end state, not a failure, so it is explained
    // rather than rendered as a blank or an error.
    body = (
      <Text color="secondary">
        The submitted parameters were removed on{' '}
        {redactedAt ? formatDateTime(redactedAt) : 'expiry'} by the retention
        policy. The decision history is kept indefinitely.
      </Text>
    );
  } else if (Object.keys(values).length === 0) {
    body = <Text color="secondary">This template takes no parameters.</Text>;
  } else {
    body = (
      <dl className={styles.values}>
        {Object.entries(values).map(([key, value]) => (
          <div key={key} className={styles.valueRow}>
            <dt>
              <Text variant="body-small" className={styles.key}>
                {key}
              </Text>
            </dt>
            <dd>
              <ParameterValue value={value} />
            </dd>
          </div>
        ))}
      </dl>
    );
  }

  return (
    <Card>
      <SectionHeader
        title="Parameters"
        description="What was submitted. An approval is bound to exactly these values."
      />
      <CardBody>{body}</CardBody>
    </Card>
  );
}

/**
 * The request's history: who asked, then who decided what, in order, with
 * whatever they said.
 *
 * @internal
 */
export function RequestActivity(props: {
  request: Pick<
    ApprovalRequestWithDecisions,
    'requesterRef' | 'createdAt' | 'decisions'
  >;
}) {
  const { requesterRef, createdAt, decisions } = props.request;

  return (
    <Card>
      <SectionHeader title="Activity" />
      <CardBody>
        <ol className={styles.timeline}>
          <li className={styles.event}>
            <span className={styles.marker}>
              <PersonAvatar entityRef={requesterRef} />
            </span>
            <div className={styles.eventBody}>
              <Text>
                <EntityRefLink entityRef={requesterRef} hideIcon /> requested
                approval
              </Text>
              <Timestamp
                iso={createdAt}
                variant="body-small"
                color="secondary"
              />
            </div>
          </li>

          {decisions.map(decision => {
            const approved = decision.decision === 'approve';
            return (
              <li key={decision.id} className={styles.event}>
                <span className={styles.marker}>
                  <PersonAvatar entityRef={decision.approverRef} />
                  <span
                    className={styles.markerBadge}
                    data-tone={approved ? 'success' : 'danger'}
                  >
                    {approved ? (
                      <RiCheckLine aria-hidden />
                    ) : (
                      <RiCloseLine aria-hidden />
                    )}
                  </span>
                </span>
                <div className={styles.eventBody}>
                  <Text>
                    <EntityRefLink entityRef={decision.approverRef} hideIcon />{' '}
                    {approved ? 'approved' : 'denied'}
                  </Text>
                  <Timestamp
                    iso={decision.createdAt}
                    variant="body-small"
                    color="secondary"
                  />
                  {decision.comment && (
                    <blockquote className={styles.comment}>
                      <Text>{decision.comment}</Text>
                    </blockquote>
                  )}
                </div>
              </li>
            );
          })}

          {decisions.length === 0 && (
            <li className={styles.event}>
              <span className={styles.marker}>
                <span className={styles.markerEmpty} />
              </span>
              <div className={styles.eventBody}>
                <Text color="secondary">Nobody has decided yet.</Text>
              </div>
            </li>
          )}
        </ol>
      </CardBody>
    </Card>
  );
}

function Detail(props: { label: string; children: ReactNode }) {
  return (
    <div className={styles.detail}>
      <dt>
        <Text variant="body-small" color="secondary">
          {props.label}
        </Text>
      </dt>
      <dd>{props.children}</dd>
    </div>
  );
}

/**
 * The facts of a request: who, what, when, and the task it became.
 *
 * @internal
 */
export function RequestDetails(props: {
  request: Pick<
    ApprovalRequestWithDecisions,
    'requesterRef' | 'templateRef' | 'createdAt' | 'expiresAt' | 'taskId'
  >;
  status: ApprovalRequestStatus;
}) {
  const { request, status } = props;

  return (
    <Card>
      <SectionHeader title="Details" />
      <CardBody>
        <dl className={styles.details}>
          <Detail label="Requested by">
            <Flex align="center" gap="2">
              <PersonAvatar entityRef={request.requesterRef} size="x-small" />
              <EntityRefLink entityRef={request.requesterRef} hideIcon />
            </Flex>
          </Detail>
          <Detail label="Template">
            <EntityRefLink entityRef={request.templateRef} hideIcon />
          </Detail>
          <Detail label="Requested">
            <Timestamp iso={request.createdAt} />
          </Detail>
          {/* A deadline only means something while the request is waiting.
              On a settled one, "Expires" read as if it still could. */}
          {request.expiresAt && status === 'pending' && (
            <Detail label="Expires">
              <Timestamp iso={request.expiresAt} />
            </Detail>
          )}
          {request.expiresAt && status === 'expired' && (
            <Detail label="Timed out">
              <Timestamp iso={request.expiresAt} />
            </Detail>
          )}
          {request.taskId && (
            <Detail label="Task">
              {/* §10.1: the requester cannot find this task under "my
                  tasks", because it was created by the service principal.
                  This link is how they reach its log at all. */}
              <Link
                href={`/create/tasks/${request.taskId}`}
                target="_blank"
                className={styles.taskLink}
              >
                {request.taskId}
              </Link>
            </Detail>
          )}
        </dl>
      </CardBody>
    </Card>
  );
}
