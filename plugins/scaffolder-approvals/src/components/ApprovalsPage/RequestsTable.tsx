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
  type ApprovalRequest,
  type ApprovalRequestRole,
  type ApprovalRequestStatus,
} from '@backstage-community/plugin-scaffolder-approvals-common';
import { parseEntityRef } from '@backstage/catalog-model';
import { EmptyState } from '@backstage/core-components';
import { useRouteRef } from '@backstage/core-plugin-api';
import {
  Cell,
  CellText,
  type OffsetParams,
  Table,
  useTable,
} from '@backstage/ui';
import { useMemo } from 'react';
import type { ApprovalsApi } from '../../api';
import { requestRouteRef } from '../../routes';
import { StatusPill } from '../StatusPill';

/** A row is a request; BUI's table only needs it to have an id. */
type Row = ApprovalRequest;

function shortRef(ref: string): string {
  try {
    return parseEntityRef(ref).name;
  } catch {
    return ref;
  }
}

function when(iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? iso : date.toLocaleString();
}

/** @public */
export interface RequestsTableProps {
  api: ApprovalsApi;
  /**
   * Which side of a request to list.
   *
   * Not called `role`: that is a DOM attribute name, so a prop with that name
   * reads as ARIA to a linter and to anyone skimming the JSX.
   */
  viewAs: ApprovalRequestRole;
  status?: ApprovalRequestStatus[];
  emptyTitle: string;
  emptyDescription: string;
  /** Bumped by the caller to force a refetch — see ApprovalsPage. */
  reloadToken?: number;
}

/**
 * A page of approval requests.
 *
 * Server-side paging (`mode: 'offset'`) rather than fetching everything and
 * paging in the browser: the backend reports a total independent of the page
 * size, and an approvals inbox is exactly the thing that grows.
 *
 * @public
 */
export function RequestsTable(props: RequestsTableProps) {
  const { api, viewAs, status, emptyTitle, emptyDescription, reloadToken } =
    props;

  const requestRoute = useRouteRef(requestRouteRef);

  const columnConfig = useMemo(
    () => [
      {
        id: 'templateRef',
        label: 'Template',
        // The column that names a row. react-aria requires one and throws in
        // the browser without it ("A table must have at least one Column with
        // the isRowHeader prop set to true"); jsdom never reached that check.
        isRowHeader: true,
        cell: (item: Row) => (
          <CellText
            title={shortRef(item.templateRef)}
            // The summary is what an approver actually needs to read, and it
            // is null once the retention sweep has been through.
            description={item.summary ?? undefined}
          />
        ),
      },
      {
        id: 'requesterRef',
        label: 'Requested by',
        cell: (item: Row) => <CellText title={shortRef(item.requesterRef)} />,
      },
      {
        id: 'status',
        label: 'Status',
        // `CellText` takes a plain string title, so a pill needs the generic
        // `Cell` wrapper — which the table still requires at the top level.
        cell: (item: Row) => (
          <Cell>
            <StatusPill status={item.status} />
          </Cell>
        ),
      },
      {
        id: 'createdAt',
        label: 'Requested',
        cell: (item: Row) => <CellText title={when(item.createdAt)} />,
      },
    ],
    [],
  );

  const { tableProps } = useTable<Row>({
    mode: 'offset',
    // `reloadToken` participates so that deciding on a request refreshes the
    // list behind it without a full page reload.
    getData: async ({ pageSize, offset }: OffsetParams<unknown>) => {
      void reloadToken;
      const page = await api.listRequests({
        role: viewAs,
        status,
        limit: pageSize,
        offset,
      });
      return { data: page.items, totalCount: page.totalItems };
    },
    paginationOptions: { pageSize: 10 },
  });

  return (
    <Table<Row>
      {...tableProps}
      columnConfig={columnConfig}
      rowConfig={{ getHref: item => requestRoute({ requestId: item.id }) }}
      emptyState={
        <EmptyState
          missing="content"
          title={emptyTitle}
          description={emptyDescription}
        />
      }
    />
  );
}
