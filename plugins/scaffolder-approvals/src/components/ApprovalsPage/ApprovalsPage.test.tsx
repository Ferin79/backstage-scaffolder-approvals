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

import type { ApprovalRequest } from '@ferin79/backstage-plugin-scaffolder-approvals-common';
import { entityPresentationApiRef } from '@backstage/plugin-catalog-react';
import { signalApiRef } from '@backstage/plugin-signals-react';
import { renderInTestApp, TestApiProvider } from '@backstage/test-utils';
import { act, screen, waitFor } from '@testing-library/react';
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

/**
 * The catalog's presentation API, answering from a fixed list of titles, the
 * way the real one answers from each entity's title or display name.
 */
function fakePresentation(titles: Record<string, string>) {
  return {
    forEntity(entityRef: string) {
      const snapshot = {
        entityRef,
        primaryTitle: titles[entityRef] ?? entityRef,
      };
      return { snapshot, promise: Promise.resolve(snapshot) };
    },
  };
}

function render(api: Partial<ApprovalsApi>, view?: 'inbox' | 'mine') {
  return renderInTestApp(
    <TestApiProvider apis={[[approvalsApiRef, api as ApprovalsApi]]}>
      <ApprovalsPage view={view} />
    </TestApiProvider>,
    {
      // Only the root ref: `mountedRoutes` takes route refs, not sub route
      // refs, and a sub route resolves relative to its parent anyway.
      mountedRoutes: { '/scaffolder-approvals': rootRouteRef },
    },
  );
}

describe('ApprovalsPage', () => {
  it('shows both lists as tabs, each with an address of its own', async () => {
    await render({
      listRequests: jest.fn().mockResolvedValue({ items: [], totalItems: 0 }),
    });

    // Two tabs rather than one filtered table, because they answer different
    // questions for different people. Routes rather than in-page state, so
    // going back from a request returns to the list it came from.
    const inbox = await screen.findByRole('tab', { name: 'Waiting on you' });
    const mine = screen.getByRole('tab', { name: 'Your requests' });
    expect(inbox).toHaveAttribute('href', '/scaffolder-approvals');
    expect(mine).toHaveAttribute('href', '/scaffolder-approvals/mine');
    // In the plugin's own header, which names the plugin.
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(
      'Approvals',
    );
  });

  it('says so when the inbox is empty, rather than showing a bare table', async () => {
    await render({
      listRequests: jest.fn().mockResolvedValue({ items: [], totalItems: 0 }),
    });

    expect(
      await screen.findByText('Nothing is waiting on you'),
    ).toBeInTheDocument();
    // B15: inside the table, under its column headers, and without the
    // illustrated empty state, whose image was taller than the empty row and
    // left the table with a scrollbar and nothing to scroll.
    expect(
      screen.getAllByRole('columnheader').map(header => header.textContent),
    ).toEqual(['Template', 'Requested by', 'Status', 'Requested']);
    expect(screen.queryByRole('img')).not.toBeInTheDocument();
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

  it('names templates and people as the catalog does', async () => {
    // B16: the list showed the last segment of each ref, "request-github-admin"
    // and "requester", rather than what the catalog calls them.
    await renderInTestApp(
      <TestApiProvider
        apis={[
          [
            approvalsApiRef,
            {
              listRequests: async () => ({ items: [PENDING], totalItems: 1 }),
            } as Partial<ApprovalsApi> as ApprovalsApi,
          ],
          [
            entityPresentationApiRef,
            fakePresentation({
              'template:default/request-github-admin':
                'Request GitHub admin access',
              'user:default/requester': 'Riley Requester',
            }),
          ],
        ]}
      >
        <ApprovalsPage />
      </TestApiProvider>,
      { mountedRoutes: { '/scaffolder-approvals': rootRouteRef } },
    );

    expect(
      await screen.findByText('Request GitHub admin access'),
    ).toBeInTheDocument();
    expect(screen.getByText('Riley Requester')).toBeInTheDocument();
    // The summary still sits under the template's name.
    expect(screen.getByText('Admin on backstage')).toBeInTheDocument();
  });

  it('leaves out who asked on "Your requests", since it is always you', async () => {
    // B20: a "Requested by" column whose every row named the viewer.
    const listRequests = jest
      .fn()
      .mockResolvedValue({ items: [PENDING], totalItems: 1 });
    await render({ listRequests }, 'mine');

    await waitFor(() =>
      expect(listRequests).toHaveBeenCalledWith(
        expect.objectContaining({ role: 'requester' }),
      ),
    );
    expect(await screen.findByText('Admin on backstage')).toBeInTheDocument();
    expect(
      screen.getAllByRole('columnheader').map(header => header.textContent),
    ).toEqual(['Template', 'Status', 'Requested']);
    // Everything they asked for, not only what is still pending.
    expect(listRequests).not.toHaveBeenCalledWith(
      expect.objectContaining({ status: expect.anything() }),
    );
  });

  it('asks the backend only for pending requests in the inbox', async () => {
    const listRequests = jest
      .fn()
      .mockResolvedValue({ items: [], totalItems: 0 });
    await render({ listRequests });

    // Somebody looking for work does not want a history of everything they
    // ever approved, nor the requests they have already voted on (B2).
    await waitFor(() =>
      expect(listRequests).toHaveBeenCalledWith(
        expect.objectContaining({
          role: 'approver',
          actionable: true,
          status: ['pending'],
        }),
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

  it('shows a pending request past its deadline as expired', async () => {
    // B9: the sweep that moves it to `expired` runs every five minutes, and
    // until then it read as waiting for a decision nobody can make.
    await render({
      listRequests: jest.fn().mockResolvedValue({
        items: [{ ...PENDING, expiresAt: '2020-01-01T00:00:00.000Z' }],
        totalItems: 1,
      }),
    });

    expect(await screen.findByText('Expired')).toBeInTheDocument();
    expect(screen.queryByText('Awaiting approval')).not.toBeInTheDocument();
  });

  it('refetches the list when the backend signals a change', async () => {
    // B10: a vote takes a row out of an inbox and a submission adds one; the
    // list used to show neither until the page was reloaded.
    let deliver: (message: object) => void = () => {};
    const signalApi = {
      subscribe(_channel: string, onMessage: (message: any) => void) {
        deliver = onMessage;
        return { unsubscribe() {} };
      },
    };
    const listRequests = jest
      .fn()
      .mockResolvedValueOnce({ items: [PENDING], totalItems: 1 })
      .mockResolvedValue({ items: [], totalItems: 0 });

    await renderInTestApp(
      <TestApiProvider
        apis={[
          [approvalsApiRef, { listRequests } as unknown as ApprovalsApi],
          [signalApiRef, signalApi],
        ]}
      >
        <ApprovalsPage />
      </TestApiProvider>,
      { mountedRoutes: { '/scaffolder-approvals': rootRouteRef } },
    );
    expect(await screen.findByText('Admin on backstage')).toBeInTheDocument();

    await act(async () =>
      deliver({ action: 'decided', requestId: PENDING.id, status: 'approved' }),
    );

    expect(
      await screen.findByText('Nothing is waiting on you'),
    ).toBeInTheDocument();
  });
});
