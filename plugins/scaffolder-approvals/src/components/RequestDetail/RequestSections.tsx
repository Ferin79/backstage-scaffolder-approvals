import type {
  ApprovalRequestStatus,
  ApprovalRequestWithDecisions,
} from '@ferin79/backstage-plugin-scaffolder-approvals-common';
import { EntityRefLink } from '@backstage/plugin-catalog-react';
import { Card, CardBody, CardHeader, Flex, Link, Text } from '@backstage/ui';
import { RiCheckLine, RiCloseLine } from '@remixicon/react';
import type { ReactNode } from 'react';
import { PersonAvatar } from '../PersonAvatar';
import { scaffolderTaskPath } from '../scaffolderPaths';
import { formatDateTime, Timestamp } from '../Timestamp';
import {
  type ParameterStanding,
  type ParameterTitles,
  useTemplateParameters,
} from './templateParameters';
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

type Scalar = string | number | boolean | null;

const isScalar = (value: unknown): value is Scalar =>
  value === null || ['string', 'number', 'boolean'].includes(typeof value);

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/** How far a value is unpacked into rows before it is shown as JSON. */
const MAX_DEPTH = 2;

function scalarText(value: Scalar): string {
  if (typeof value === 'boolean') {
    return value ? 'Yes' : 'No';
  }
  return value === null ? 'None' : String(value);
}

function ScalarValue(props: { value: Scalar }) {
  const { value } = props;
  if (typeof value === 'string') {
    return <Text className={styles.valueText}>{value}</Text>;
  }
  if (typeof value === 'number') {
    return <Text className={styles.number}>{value}</Text>;
  }
  return (
    <Text color={value === null ? 'secondary' : undefined}>
      {scalarText(value)}
    </Text>
  );
}

function Json(props: { value: unknown }) {
  return (
    <pre className={styles.code}>
      <code>{JSON.stringify(props.value, null, 2)}</code>
    </pre>
  );
}

/**
 * A value as submitted, laid out for reading: a list of names as chips, an
 * object as rows, a list of objects as one small block each. A template with
 * thirty parameters was over three thousand pixels of pretty-printed JSON.
 */
function ParameterValue(props: {
  value: unknown;
  path: string;
  titles: ParameterTitles;
  depth: number;
}) {
  const { value, path, titles, depth } = props;

  if (isScalar(value)) {
    return <ScalarValue value={value} />;
  }
  if (Array.isArray(value)) {
    if (value.length === 0) {
      return <Text color="secondary">None</Text>;
    }
    if (value.every(isScalar)) {
      return (
        <ul className={styles.chips}>
          {value.map((item, index) => (
            <li key={index} className={styles.chip}>
              {scalarText(item)}
            </li>
          ))}
        </ul>
      );
    }
    if (depth < MAX_DEPTH && value.every(isRecord)) {
      return (
        <ol className={styles.items}>
          {value.map((item, index) => (
            <li key={index} className={styles.item}>
              <ParameterFields
                values={item}
                path={`${path}[]`}
                titles={titles}
                depth={depth + 1}
                nested
              />
            </li>
          ))}
        </ol>
      );
    }
    return <Json value={value} />;
  }
  if (isRecord(value) && depth < MAX_DEPTH) {
    return (
      <ParameterFields
        values={value}
        path={path}
        titles={titles}
        depth={depth + 1}
        nested
      />
    );
  }
  return <Json value={value} />;
}

/** Short enough to sit beside its label in the narrow column. */
function isShort(value: unknown): boolean {
  if (typeof value === 'string') {
    return value.length <= 28 && !value.includes('\n');
  }
  return isScalar(value);
}

/** Parameters set apart from the rest, with why. */
function ParameterGroup(props: {
  title: string;
  description: string;
  children: ReactNode;
}) {
  return (
    <section className={styles.parameterGroup}>
      <Flex direction="column" gap="1" mb="2">
        <Text as="h4" variant="body-small" weight="bold">
          {props.title}
        </Text>
        <Text variant="body-small" color="secondary">
          {props.description}
        </Text>
      </Flex>
      {props.children}
    </section>
  );
}

/**
 * Parameters by the names the template's form gave them, where it gave any,
 * with the key itself one hover away; by their keys otherwise.
 */
function ParameterFields(props: {
  values: Record<string, unknown>;
  path: string;
  titles: ParameterTitles;
  depth: number;
  nested?: boolean;
}) {
  const { values, path, titles, depth, nested } = props;
  return (
    <dl className={nested ? styles.nested : styles.values}>
      {Object.entries(values).map(([key, value]) => {
        const childPath = path ? `${path}.${key}` : key;
        const title = titles.get(childPath);
        let rowClass = styles.valueRow;
        if (nested) {
          rowClass = styles.nestedRow;
        } else if (isShort(value)) {
          // A short value beside its label: thirty parameters stacked one
          // over the other made a column three thousand pixels tall.
          rowClass = `${styles.valueRow} ${styles.valueRowInline}`;
        }
        return (
          <div key={key} className={rowClass}>
            <dt>
              {title ? (
                <Text variant="body-small" color="secondary" title={key}>
                  {title}
                </Text>
              ) : (
                <Text variant="body-small" className={styles.key}>
                  {key}
                </Text>
              )}
            </dt>
            <dd>
              <ParameterValue
                value={value}
                path={childPath}
                titles={titles}
                depth={depth}
              />
            </dd>
          </div>
        );
      })}
    </dl>
  );
}

/**
 * What was submitted: what the approvers judge, and what an approval is bound
 * to.
 *
 * @internal
 */
export function RequestParameters(props: {
  request: Pick<
    ApprovalRequestWithDecisions,
    'values' | 'redactedAt' | 'templateRef'
  >;
}) {
  const { values, redactedAt, templateRef } = props.request;
  const { titles, standing } = useTemplateParameters(templateRef);

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
    const groups: Record<ParameterStanding, Record<string, unknown>> = {
      shown: {},
      hidden: {},
      undeclared: {},
    };
    const standingOf = standing?.(values);
    for (const [key, value] of Object.entries(values)) {
      groups[standingOf ? standingOf(key) : 'shown'][key] = value;
    }
    body = (
      <Flex direction="column" gap="4">
        <ParameterFields
          values={groups.shown}
          path=""
          titles={titles}
          depth={0}
        />
        {Object.keys(groups.hidden).length > 0 && (
          <ParameterGroup
            title="Hidden by the form for these answers"
            description="The form keeps what was entered when an answer that showed a field changes, and fills in the defaults of the fields it shows first. These were submitted with the rest, so they are part of what an approval runs."
          >
            <ParameterFields
              values={groups.hidden}
              path=""
              titles={titles}
              depth={0}
            />
          </ParameterGroup>
        )}
        {Object.keys(groups.undeclared).length > 0 && (
          <ParameterGroup
            title="Not in the template's form"
            description="No page of the template asks for these; they were sent with the request directly. They are passed to the run like everything else."
          >
            <ParameterFields
              values={groups.undeclared}
              path=""
              titles={titles}
              depth={0}
            />
          </ParameterGroup>
        )}
      </Flex>
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
              <Link
                href={scaffolderTaskPath(request.taskId)}
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
