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

import type { ApprovalRequest } from '@backstage-community/plugin-scaffolder-approvals-common';
import { renderInTestApp, TestApiProvider } from '@backstage/test-utils';
import { screen, waitFor } from '@testing-library/react';
import { type ApprovalsApi, approvalsApiRef } from '../../api';
import { rootRouteRef } from '../../routes';
import { ApprovalsPage } from './ApprovalsPage';

const PENDING: ApprovalRequest = {
  id: '3f1e4c8a-0000-4000-8000-000000000001',
  templateRef: 'template:default/request-github-admin',
  values: { repository: 'backstage' },
  valuesHash: 'a'.repeat(64),
  requesterRef: 'user:default/requester',
  status: 'pending',
  summary: 'Admin on backstage',
  policySnapshot: {
    approvers: ['group:default/devx-team'],
    quorum: 1,
    selfApprove: false,
  },
  createdAt: '2026-09-13T10:00:00.000Z',
  updatedAt: '2026-09-13T10:00:00.000Z',
};

function render(api: Partial<ApprovalsApi>) {
  return renderInTestApp(
    <TestApiProvider apis={[[approvalsApiRef, api as ApprovalsApi]]}>
      <ApprovalsPage />
    </TestApiProvider>,
    {
      // Only the root ref: `mountedRoutes` takes route refs, not sub route
      // refs, and a sub route resolves relative to its parent anyway.
      mountedRoutes: { '/scaffolder-approvals': rootRouteRef },
    },
  );
}

describe('ApprovalsPage', () => {
  it('shows both tabs', async () => {
    await render({
      listRequests: jest.fn().mockResolvedValue({ items: [], totalItems: 0 }),
    });

    // Two tabs rather than one filtered table, because they answer different
    // questions for different people.
    expect(await screen.findByText('Waiting on you')).toBeInTheDocument();
    expect(screen.getByText('Your requests')).toBeInTheDocument();
  });

  it('says so when the inbox is empty, rather than showing a bare table', async () => {
    await render({
      listRequests: jest.fn().mockResolvedValue({ items: [], totalItems: 0 }),
    });

    expect(
      await screen.findByText('Nothing is waiting on you'),
    ).toBeInTheDocument();
  });

  it('lists a pending request with its summary and status', async () => {
    await render({
      listRequests: jest
        .fn()
        .mockResolvedValue({ items: [PENDING], totalItems: 1 }),
    });

    // The summary is what an approver actually reads.
    expect(await screen.findByText('Admin on backstage')).toBeInTheDocument();
    // The template ref is shortened to its name; the full ref is noise in a list.
    expect(screen.getByText('request-github-admin')).toBeInTheDocument();
    expect(screen.getByText('requester')).toBeInTheDocument();
    expect(screen.getByText('Awaiting approval')).toBeInTheDocument();
    // The template column names each row. Without a row header the table
    // throws in a browser, though not under jsdom, so assert the role instead.
    expect(
      screen.getByRole('rowheader', { name: /request-github-admin/ }),
    ).toBeInTheDocument();
  });

  it('asks the backend only for pending requests in the inbox', async () => {
    const listRequests = jest
      .fn()
      .mockResolvedValue({ items: [], totalItems: 0 });
    await render({ listRequests });

    // Somebody looking for work does not want a history of everything they
    // ever approved.
    await waitFor(() =>
      expect(listRequests).toHaveBeenCalledWith(
        expect.objectContaining({ role: 'approver', status: ['pending'] }),
      ),
    );
  });

  it('renders a redacted request without falling over', async () => {
    // The retention sweep nulls the values and summary; a list must still show
    // the row, because the row is the audit trail.
    await render({
      listRequests: jest.fn().mockResolvedValue({
        items: [
          {
            ...PENDING,
            status: 'completed' as const,
            values: null,
            summary: null,
          },
        ],
        totalItems: 1,
      }),
    });

    expect(await screen.findByText('request-github-admin')).toBeInTheDocument();
    expect(screen.getByText('Completed')).toBeInTheDocument();
  });
});
