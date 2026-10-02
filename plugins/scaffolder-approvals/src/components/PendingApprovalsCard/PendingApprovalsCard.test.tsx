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

import { renderInTestApp, TestApiProvider } from '@backstage/test-utils';
import { screen } from '@testing-library/react';
import { type ApprovalsApi, approvalsApiRef } from '../../api';
import { rootRouteRef } from '../../routes';
import { PendingApprovalsHomePageCard } from '../../plugin';
import { PendingApprovalsCard } from './PendingApprovalsCard';

function render(api: Partial<ApprovalsApi>) {
  return renderInTestApp(
    <TestApiProvider apis={[[approvalsApiRef, api as ApprovalsApi]]}>
      <PendingApprovalsCard />
    </TestApiProvider>,
    { mountedRoutes: { '/scaffolder-approvals': rootRouteRef } },
  );
}

describe('PendingApprovalsCard', () => {
  it('counts what is waiting on you, not everything pending', async () => {
    // The same query the inbox tab runs, so the number here and the list there
    // cannot disagree.
    const listRequests = jest.fn().mockResolvedValue({
      items: [],
      totalItems: 3,
    });

    await render({ listRequests });

    expect(await screen.findByText('3')).toBeInTheDocument();
    // `actionable`, so a request the viewer has already voted on, or their own
    // under a gate that forbids self-approval, does not keep the count up (B2).
    expect(listRequests).toHaveBeenCalledWith({
      role: 'approver',
      actionable: true,
      status: ['pending'],
      limit: 1,
    });
  });

  it('says so plainly when there is nothing to do', async () => {
    await render({
      listRequests: async () => ({ items: [], totalItems: 0 }),
    });

    expect(
      await screen.findByText('Nothing is waiting on you.'),
    ).toBeInTheDocument();
    // No call to action when there is nothing to act on.
    expect(
      screen.queryByRole('link', { name: 'Review them' }),
    ).not.toBeInTheDocument();
  });

  it('reads as singular for one request', async () => {
    await render({
      listRequests: async () => ({ items: [], totalItems: 1 }),
    });

    expect(
      await screen.findByText('request is waiting on your decision.'),
    ).toBeInTheDocument();
  });

  it('is one card on the home page, not a card inside a card', async () => {
    // The home-page extension wraps its content in a titled card of its own.
    // It used to be handed this whole card, so two "Approvals" cards nested.
    await renderInTestApp(
      <TestApiProvider
        apis={[
          [
            approvalsApiRef,
            {
              listRequests: async () => ({ items: [], totalItems: 2 }),
            } as Partial<ApprovalsApi> as ApprovalsApi,
          ],
        ]}
      >
        <PendingApprovalsHomePageCard />
      </TestApiProvider>,
      { mountedRoutes: { '/scaffolder-approvals': rootRouteRef } },
    );

    expect(await screen.findByText('2')).toBeInTheDocument();
    expect(screen.getAllByText('Approvals')).toHaveLength(1);
  });

  it('stays out of the way when the backend cannot be reached', async () => {
    // A home card that throws takes the whole home page with it.
    await render({
      listRequests: jest.fn().mockRejectedValue(new Error('backend is down')),
    });

    expect(
      await screen.findByText(/Could not load your approvals/),
    ).toBeInTheDocument();
  });
});
