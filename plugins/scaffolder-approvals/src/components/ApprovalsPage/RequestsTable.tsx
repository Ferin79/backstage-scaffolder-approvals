import type { ApprovalRequest } from '@ferin79/backstage-plugin-scaffolder-approvals-common';
import { useRouteRef } from '@backstage/core-plugin-api';
import { useEntityPresentation } from '@backstage/plugin-catalog-react';
import {
  Cell,
  CellText,
  Flex,
  type OffsetParams,
  Table,
  Text,
  useBreakpoint,
  useTable,
} from '@backstage/ui';
import { useMemo } from 'react';
import type { ApprovalsApi } from '../../api';
import { requestRouteRef } from '../../routes';
import { ApprovalsIcon } from '../ApprovalsIcon';
import { PersonAvatar } from '../PersonAvatar';
import type { RequestsQuery } from '../queries';
import { StatusPill } from '../StatusPill';
import { effectiveStatus } from '../StatusPill/effectiveStatus';
import { Timestamp } from '../Timestamp';
import { useOnApprovalsChange } from '../useOnApprovalsChange';
import styles from './RequestsTable.module.css';

/** A row is a request; BUI's table only needs it to have an id. */
type Row = ApprovalRequest;

/**
 * The template's catalog title, with the request's summary under it.
 *
 * The catalog's name rather than the ref's last segment: "Request GitHub admin
 * access", not "request-github-admin". Not a link, because the whole row
 * already is one. Until the catalog answers, and for an entity it does not
 * know, this is the name from the ref.
 */
function TemplateCell(props: { item: Row }) {
  const { item } = props;
  const { primaryTitle } = useEntityPresentation(item.templateRef);
  return (
    <CellText
      title={primaryTitle}
      // The summary is what an approver actually needs to read, and it is
      // null once the retention sweep has been through.
      description={item.summary ?? undefined}
    />
  );
}

/**
 * Who asked, by the name the catalog has for them, beside their initials. The
 * avatar is decoration: the name next to it says the same.
 */
function RequesterCell(props: { item: Row }) {
  const { requesterRef } = props.item;
  const { primaryTitle } = useEntityPresentation(requesterRef, {
    defaultKind: 'user',
  });
  return (
    <Cell>
      <Flex align="center" gap="2">
        <PersonAvatar entityRef={requesterRef} />
        <Text variant="body-medium">{primaryTitle}</Text>
      </Flex>
    </Cell>
  );
}

/**
 * An empty list, said in the table's own row under its column headers.
 *
 * Not core-components' `EmptyState`: its illustration is taller than the
 * table's empty row, so the table overflowed BUI's scroll container and
 * showed a scrollbar with nothing to scroll.
 *
 * `grow`, because BUI puts the empty state in a row of its own: without it
 * this took only its content's width, and sat centred over the first column
 * rather than the table.
 */
function EmptyRow(props: { title: string; description: string }) {
  return (
    <Flex
      direction="column"
      align="center"
      gap="2"
      py="8"
      px="4"
      grow
      className={styles.empty}
    >
      <span className={styles.emptyIcon} aria-hidden="true">
        <ApprovalsIcon fontSize="inherit" />
      </span>
      <Text variant="body-large" weight="bold" as="h3">
        {props.title}
      </Text>
      <Text color="secondary">{props.description}</Text>
    </Flex>
  );
}

/** @internal */
export interface RequestsTableProps {
  api: ApprovalsApi;
  /** Which requests to list; the table pages through them. */
  query: RequestsQuery;
  emptyTitle: string;
  emptyDescription: string;
}

/**
 * A page of approval requests.
 *
 * Server-side paging (`mode: 'offset'`) rather than fetching everything and
 * paging in the browser: the backend reports a total independent of the page
 * size, and an approvals inbox is exactly the thing that grows.
 *
 * @internal
 */
export function RequestsTable(props: RequestsTableProps) {
  const { api, query, emptyTitle, emptyDescription } = props;

  const requestRoute = useRouteRef(requestRouteRef);

  // Below BUI's `sm` breakpoint (768px) there is room for what a request is
  // and where it stands, not for four columns without truncating every one.
  // Who asked and when are on the request page, one tap away.
  const { up } = useBreakpoint();
  const narrow = !up('sm');

  // On "Your requests" every row was asked for by the viewer, so a column
  // saying so is noise.
  const hideRequester = narrow || query.role === 'requester';

  const columnConfig = useMemo(
    () => [
      {
        id: 'templateRef',
        label: 'Template',
        // The column that names a row. react-aria requires one and throws in
        // the browser without it ("A table must have at least one Column with
        // the isRowHeader prop set to true"); jsdom never reached that check.
        isRowHeader: true,
        cell: (item: Row) => <TemplateCell item={item} />,
      },
      {
        id: 'requesterRef',
        label: 'Requested by',
        isHidden: hideRequester,
        cell: (item: Row) => <RequesterCell item={item} />,
      },
      {
        id: 'status',
        label: 'Status',
        // Wide enough for the longest label, "Awaiting approval", so a pill is
        // never cut off however the other columns share the width.
        minWidth: 160,
        // `CellText` takes a plain string title, so a pill needs the generic
        // `Cell` wrapper — which the table still requires at the top level.
        cell: (item: Row) => (
          <Cell>
            {/* Past its deadline is expired, whether or not the sweep has
                caught up with it yet. */}
            <StatusPill status={effectiveStatus(item)} />
          </Cell>
        ),
      },
      {
        id: 'createdAt',
        label: 'Requested',
        isHidden: narrow,
        // How long ago, which is what tells an approver what has been waiting
        // longest; the exact time is in the tooltip.
        cell: (item: Row) => (
          <Cell>
            <Timestamp iso={item.createdAt} color="secondary" />
          </Cell>
        ),
      },
    ],
    [narrow, hideRequester],
  );

  const { tableProps, reload } = useTable<Row>({
    mode: 'offset',
    getData: async ({ pageSize, offset }: OffsetParams<unknown>) => {
      const page = await api.listRequests({
        ...query,
        limit: pageSize,
        offset,
      });
      return { data: page.items, totalCount: page.totalItems };
    },
    paginationOptions: { pageSize: 10 },
  });

  // Any change to any request can move a row — a vote takes one out of an
  // inbox, a submission adds one — so any signal refetches the page on show.
  useOnApprovalsChange(reload);

  return (
    <Table<Row>
      {...tableProps}
      columnConfig={columnConfig}
      rowConfig={{ getHref: item => requestRoute({ requestId: item.id }) }}
      emptyState={
        <EmptyRow title={emptyTitle} description={emptyDescription} />
      }
    />
  );
}
