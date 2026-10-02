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

import { signalApiRef } from '@backstage/plugin-signals-react';
import { renderInTestApp, TestApiProvider } from '@backstage/test-utils';
import { act, screen } from '@testing-library/react';
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

    // The card extension is lazy-loaded, which is slow on a busy machine: this
    // and the test below failed twice under load in the browser review and
    // passed every time alone. Generous waits rather than flaky ones.
    expect(
      await screen.findByText('2', undefined, { timeout: 10_000 }),
    ).toBeInTheDocument();
    expect(screen.getAllByText('Approvals')).toHaveLength(1);
    // B19: the extension draws its own card, and used to take only the
    // content from this one, so the home page had no way to the page.
    expect(
      screen.getByRole('link', { name: 'Open approvals' }),
    ).toHaveAttribute('href', '/scaffolder-approvals');
  }, 20_000);

  it('has the same way to the page on its own as on the home page', async () => {
    await render({
      listRequests: async () => ({ items: [], totalItems: 0 }),
    });

    expect(
      await screen.findByRole('link', { name: 'Open approvals' }),
    ).toHaveAttribute('href', '/scaffolder-approvals');
  });

  it('writes its sentence at the size of the cards beside it', async () => {
    // B19: BUI's default body text is 14px; the Material UI cards a home page
    // puts next to this one use 16px, which is BUI's `body-large`.
    await render({
      listRequests: async () => ({ items: [], totalItems: 0 }),
    });

    expect(
      await screen.findByText('Nothing is waiting on you.'),
    ).toHaveAttribute('data-variant', 'body-large');
  });

  it('stays out of the way when the backend cannot be reached', async () => {
    // A home card that throws takes the whole home page with it.
    await render({
      listRequests: jest.fn().mockRejectedValue(new Error('backend is down')),
    });

    expect(
      await screen.findByText(/Could not load your approvals/, undefined, {
        timeout: 10_000,
      }),
    ).toBeInTheDocument();
  }, 20_000);

  it('recounts when the backend signals a change', async () => {
    // B10: a request arriving, or somebody else deciding the one that was
    // waiting, changed the number only on a page reload.
    let deliver: (message: object) => void = () => {};
    const signalApi = {
      subscribe(_channel: string, onMessage: (message: any) => void) {
        deliver = onMessage;
        return { unsubscribe() {} };
      },
    };
    const listRequests = jest
      .fn()
      .mockResolvedValueOnce({ items: [], totalItems: 2 })
      .mockResolvedValue({ items: [], totalItems: 1 });

    await renderInTestApp(
      <TestApiProvider
        apis={[
          [approvalsApiRef, { listRequests } as unknown as ApprovalsApi],
          [signalApiRef, signalApi],
        ]}
      >
        <PendingApprovalsCard />
      </TestApiProvider>,
      { mountedRoutes: { '/scaffolder-approvals': rootRouteRef } },
    );
    expect(await screen.findByText('2')).toBeInTheDocument();

    await act(async () =>
      deliver({ action: 'decided', requestId: 'r1', status: 'approved' }),
    );

    expect(await screen.findByText('1')).toBeInTheDocument();
    expect(listRequests).toHaveBeenCalledTimes(2);
  });
});
