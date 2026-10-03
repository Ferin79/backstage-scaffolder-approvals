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

import type { ApprovalRequestWithDecisions } from '@ferin79/backstage-plugin-scaffolder-approvals-common';
import { alertApiRef, identityApiRef } from '@backstage/core-plugin-api';
import { entityRouteRef } from '@backstage/plugin-catalog-react';
import { renderInTestApp, TestApiProvider } from '@backstage/test-utils';
import { signalApiRef } from '@backstage/plugin-signals-react';
import { act, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { type ApprovalsApi, approvalsApiRef } from '../../api';
import { rootRouteRef } from '../../routes';
import { RequestDetail } from './RequestDetail';

const REQUEST: ApprovalRequestWithDecisions = {
  id: '3f1e4c8a-0000-4000-8000-000000000001',
  templateRef: 'template:default/request-github-admin',
  values: { repository: 'backstage', justification: 'on-call rotation' },
  valuesHash: 'a'.repeat(64),
  requesterRef: 'user:default/requester',
  status: 'pending',
  summary: 'Admin on backstage',
  policySnapshot: {
    approvers: ['group:default/devx-team'],
    quorum: 2,
    selfApprove: false,
  },
  createdAt: '2026-09-13T10:00:00.000Z',
  updatedAt: '2026-09-13T10:00:00.000Z',
  decisions: [],
};

/** An identity, as `identityApiRef` reports it. */
function identityOf(userEntityRef: string, groups: string[] = []) {
  return {
    getBackstageIdentity: async () => ({
      type: 'user' as const,
      userEntityRef,
      ownershipEntityRefs: [userEntityRef, ...groups],
    }),
    getProfileInfo: async () => ({}),
    getCredentials: async () => ({}),
    signOut: async () => {},
  };
}

const APPROVER = identityOf('user:default/alice', ['group:default/devx-team']);

/**
 * A stand-in for the signals plugin: records subscribers, and lets a test
 * deliver a message to them as the backend's broadcast would.
 */
function fakeSignals() {
  const subscribers: Array<{
    channel: string;
    onMessage: (message: any) => void;
  }> = [];
  return {
    api: {
      subscribe(channel: string, onMessage: (message: any) => void) {
        subscribers.push({ channel, onMessage });
        return { unsubscribe() {} };
      },
    },
    async publish(channel: string, message: object) {
      await act(async () => {
        for (const subscriber of subscribers) {
          if (subscriber.channel === channel) {
            subscriber.onMessage(message);
          }
        }
      });
    },
  };
}

function render(
  api: Partial<ApprovalsApi>,
  identity: ReturnType<typeof identityOf> = APPROVER,
  alertApi = { post: jest.fn(), alert$: jest.fn() },
  signals?: ReturnType<typeof fakeSignals>,
) {
  return renderInTestApp(
    <TestApiProvider
      apis={[
        [approvalsApiRef, api as ApprovalsApi],
        [identityApiRef, identity as any],
        [alertApiRef, alertApi as any],
        ...(signals ? [[signalApiRef, signals.api] as const] : []),
      ]}
    >
      <RequestDetail requestId={REQUEST.id} />
    </TestApiProvider>,
    {
      // Only the root ref: `mountedRoutes` takes route refs, not sub route
      // refs, and a sub route resolves relative to its parent anyway.
      // And the catalog's entity page, which people and the template link to.
      mountedRoutes: {
        '/scaffolder-approvals': rootRouteRef,
        '/catalog/:namespace/:kind/:name': entityRouteRef,
      },
    },
  );
}

describe('RequestDetail', () => {
  it('shows the request, its parameters and the quorum so far', async () => {
    await render({ getRequest: jest.fn().mockResolvedValue(REQUEST) });

    expect(await screen.findByText('Admin on backstage')).toBeInTheDocument();
    expect(screen.getByText('repository')).toBeInTheDocument();
    expect(screen.getByText('backstage')).toBeInTheDocument();
    // "1 of 2" has to mean the same thing here as it does in the backend, which
    // is why both use computeQuorumProgress.
    expect(screen.getByText('0 of 2 approvals needed.')).toBeInTheDocument();
    expect(screen.getByText('Nobody has decided yet.')).toBeInTheDocument();
  });

  it('puts the status in a labelled header item', async () => {
    // B14: as a bare child of the header's spaced grid, the pill slid over
    // the subtitle on a narrow screen. A labelled metadata item wraps under
    // the title instead, and names what the pill is.
    await render({ getRequest: jest.fn().mockResolvedValue(REQUEST) });

    await screen.findByText('Admin on backstage');
    const label = screen
      .getAllByRole('term')
      .find(term => term.textContent === 'Status');
    expect(label?.nextElementSibling).toHaveTextContent('Awaiting approval');
  });

  it('keeps the way back to both lists', async () => {
    // The plugin header's tabs, with neither selected on a request.
    await render({ getRequest: jest.fn().mockResolvedValue(REQUEST) });

    await screen.findByText('Admin on backstage');
    expect(screen.getByRole('tab', { name: 'Waiting on you' })).toHaveAttribute(
      'href',
      '/scaffolder-approvals',
    );
    expect(screen.getByRole('tab', { name: 'Your requests' })).toHaveAttribute(
      'href',
      '/scaffolder-approvals/mine',
    );
  });

  it('approves through a confirmation step', async () => {
    // A confirmation rather than a bare button: approving starts the template
    // immediately.
    const decide = jest.fn().mockResolvedValue(REQUEST);
    const alertApi = { post: jest.fn(), alert$: jest.fn() };
    await render(
      { getRequest: jest.fn().mockResolvedValue(REQUEST), decide },
      APPROVER,
      alertApi,
    );

    await userEvent.click(
      await screen.findByRole('button', { name: 'Approve' }),
    );
    expect(
      await screen.findByText('Approve this request?'),
    ).toBeInTheDocument();

    await userEvent.click(
      screen.getAllByRole('button', { name: 'Approve' }).at(-1)!,
    );

    await waitFor(() =>
      expect(decide).toHaveBeenCalledWith(REQUEST.id, {
        decision: 'approve',
        comment: undefined,
      }),
    );
    expect(alertApi.post).toHaveBeenCalledWith(
      expect.objectContaining({ message: 'Request approved' }),
    );
  });

  it('carries a comment through when denying', async () => {
    const decide = jest.fn().mockResolvedValue(REQUEST);
    await render({ getRequest: jest.fn().mockResolvedValue(REQUEST), decide });

    await userEvent.click(await screen.findByRole('button', { name: 'Deny' }));
    // The requester sees this and it is the only explanation they get.
    await userEvent.type(
      screen.getByRole('textbox'),
      'not while the incident is open',
    );
    await userEvent.click(
      screen.getAllByRole('button', { name: 'Deny' }).at(-1)!,
    );

    await waitFor(() =>
      expect(decide).toHaveBeenCalledWith(REQUEST.id, {
        decision: 'deny',
        comment: 'not while the incident is open',
      }),
    );
  });

  it('shows what the backend said when a decision is refused', async () => {
    // The backend's refusals are written to be read by a person, so they are
    // surfaced rather than replaced with a generic failure.
    const alertApi = { post: jest.fn(), alert$: jest.fn() };
    await render(
      {
        getRequest: jest.fn().mockResolvedValue(REQUEST),
        decide: jest
          .fn()
          .mockRejectedValue(
            new Error('You have already decided on this request'),
          ),
      },
      APPROVER,
      alertApi,
    );

    await userEvent.click(
      await screen.findByRole('button', { name: 'Approve' }),
    );
    await userEvent.click(
      screen.getAllByRole('button', { name: 'Approve' }).at(-1)!,
    );

    await waitFor(() =>
      expect(alertApi.post).toHaveBeenCalledWith(
        expect.objectContaining({
          message: expect.stringContaining('already decided'),
          severity: 'error',
        }),
      ),
    );
  });

  describe('when you cannot decide', () => {
    it('explains that you are not an approver', async () => {
      await render(
        { getRequest: jest.fn().mockResolvedValue(REQUEST) },
        identityOf('user:default/outsider'),
      );

      expect(
        await screen.findByText('You are not an approver for this request.'),
      ).toBeInTheDocument();
      expect(
        screen.queryByRole('button', { name: 'Approve' }),
      ).not.toBeInTheDocument();
    });

    it('explains that you cannot approve your own request', async () => {
      // The requester is in the approver group, so a naive membership check
      // would offer them the button.
      await render(
        { getRequest: jest.fn().mockResolvedValue(REQUEST) },
        identityOf('user:default/requester', ['group:default/devx-team']),
      );

      expect(
        await screen.findByText('You cannot approve your own request.'),
      ).toBeInTheDocument();
    });

    it('explains that you have already decided', async () => {
      await render({
        getRequest: jest.fn().mockResolvedValue({
          ...REQUEST,
          decisions: [
            {
              id: 'd1',
              requestId: REQUEST.id,
              approverRef: 'user:default/alice',
              decision: 'approve' as const,
              createdAt: '2026-09-13T10:05:00.000Z',
            },
          ],
        }),
      });

      expect(
        await screen.findByText('You have already decided on this request.'),
      ).toBeInTheDocument();
      expect(screen.getByText('1 of 2 approvals needed.')).toBeInTheDocument();
    });

    it('says what happened, rather than why you cannot decide, once it is settled', async () => {
      await render({
        getRequest: jest
          .fn()
          .mockResolvedValue({ ...REQUEST, status: 'rejected' as const }),
      });

      expect(
        await screen.findByText(
          'Denied. A single denial rejects a request outright.',
        ),
      ).toBeInTheDocument();
      expect(
        screen.queryByText('This request has already been decided.'),
      ).not.toBeInTheDocument();
    });
  });

  describe('what the requester can do', () => {
    const REQUESTER = identityOf('user:default/requester');

    it('offers Withdraw while the request is pending', async () => {
      // §5: withdrawing is what `cancelled` means, as distinct from
      // `rejected` — nobody decided, the requester changed their mind.
      const cancel = jest.fn().mockResolvedValue(REQUEST);
      await render({ getRequest: async () => REQUEST, cancel }, REQUESTER);

      await userEvent.click(
        await screen.findByRole('button', {
          name: 'Withdraw',
        }),
      );
      // B11: it asks first, as Approve and Deny do — withdrawing is as final.
      expect(
        await screen.findByText('Withdraw this request?'),
      ).toBeInTheDocument();
      expect(cancel).not.toHaveBeenCalled();

      await userEvent.click(
        screen.getAllByRole('button', { name: 'Withdraw' }).at(-1)!,
      );

      await waitFor(() => expect(cancel).toHaveBeenCalledWith(REQUEST.id));
    });

    it('withdraws nothing when the confirmation is declined', async () => {
      const cancel = jest.fn().mockResolvedValue(REQUEST);
      await render({ getRequest: async () => REQUEST, cancel }, REQUESTER);

      await userEvent.click(
        await screen.findByRole('button', { name: 'Withdraw' }),
      );
      await userEvent.click(
        await screen.findByRole('button', { name: 'Keep it' }),
      );

      await waitFor(() =>
        expect(
          screen.queryByText('Withdraw this request?'),
        ).not.toBeInTheDocument(),
      );
      expect(cancel).not.toHaveBeenCalled();
    });

    it('offers Resubmit once the request has failed', async () => {
      // Q5: a spent approval cannot be spent twice, so this starts a new
      // request rather than retrying the old one.
      const submitRequest = jest
        .fn()
        .mockResolvedValue({ id: 'req-2', collapsed: false });
      await render(
        {
          getRequest: async () => ({ ...REQUEST, status: 'failed' as const }),
          submitRequest,
        },
        REQUESTER,
      );

      await userEvent.click(
        await screen.findByRole('button', {
          name: 'Resubmit',
        }),
      );

      expect(submitRequest).toHaveBeenCalledWith({
        templateRef: REQUEST.templateRef,
        values: REQUEST.values,
      });
    });

    it('cannot resubmit a request whose parameters were redacted', async () => {
      await render(
        {
          getRequest: async () => ({
            ...REQUEST,
            status: 'failed' as const,
            values: null,
          }),
        },
        REQUESTER,
      );

      expect(
        await screen.findByText(/can no longer be resubmitted/),
      ).toBeInTheDocument();
      expect(
        screen.queryByRole('button', { name: 'Resubmit' }),
      ).not.toBeInTheDocument();
    });

    it('offers neither to somebody else', async () => {
      // An approver looking at another person's request has the decide
      // buttons and no business with these.
      await render({ getRequest: async () => REQUEST });

      expect(
        screen.queryByRole('button', { name: 'Withdraw' }),
      ).not.toBeInTheDocument();
      expect(
        screen.queryByRole('button', { name: 'Resubmit' }),
      ).not.toBeInTheDocument();
    });

    it('links to the task log once there is a task', async () => {
      // §10.1: the requester cannot find this task under "my tasks", because
      // it was created by the service principal. This link is the only way
      // they reach its log.
      await render({
        getRequest: async () => ({
          ...REQUEST,
          status: 'running' as const,
          taskId: 'task-42',
        }),
      });

      expect(
        await screen.findByRole('link', { name: 'task-42' }),
      ).toHaveAttribute('href', '/create/tasks/task-42');
    });
  });

  describe('template drift', () => {
    it('warns an approver that the steps have changed', async () => {
      // §10.3: the values and the policy are frozen at submit, but the
      // template is read live at launch, so the steps on screen are not
      // necessarily the ones that will run.
      await render({
        getRequest: async () => ({
          ...REQUEST,
          templateDrift: { changed: true, reasons: ['steps'] },
        }),
      });

      const notice = await screen.findByRole('alert');
      expect(notice).toHaveTextContent('The template has changed');
      expect(notice).toHaveTextContent(
        /edited steps are the ones that will run/,
      );
    });

    it('explains a template that has left the catalog', async () => {
      await render({
        getRequest: async () => ({
          ...REQUEST,
          templateDrift: { changed: true, reasons: ['missing'] },
        }),
      });

      expect(await screen.findByRole('alert')).toHaveTextContent(
        /no longer in the catalog/,
      );
    });

    it('says nothing when the template is untouched', async () => {
      await render({
        getRequest: async () => ({
          ...REQUEST,
          templateDrift: { changed: false, reasons: [] },
        }),
      });

      await screen.findByText('Admin on backstage');
      expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    });

    it('says nothing when the backend could not check', async () => {
      // An unreachable catalog is not evidence of a change, and a warning that
      // fires on infrastructure trouble is one people learn to click past.
      await render({ getRequest: async () => REQUEST });

      await screen.findByText('Admin on backstage');
      expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    });
  });

  it('explains a redacted request rather than rendering a blank', async () => {
    // Redaction is a normal end state, not a failure.
    await render({
      getRequest: jest.fn().mockResolvedValue({
        ...REQUEST,
        status: 'completed' as const,
        values: null,
        summary: null,
        redactedAt: '2027-03-13T10:00:00.000Z',
        decisions: [
          {
            id: 'd1',
            requestId: REQUEST.id,
            approverRef: 'user:default/alice',
            decision: 'approve' as const,
            createdAt: '2026-09-13T10:05:00.000Z',
          },
        ],
      }),
    });

    expect(
      await screen.findByText(/parameters were removed/),
    ).toBeInTheDocument();
    // The decision history is what survives, and it is the point of keeping the
    // row at all.
    expect(screen.getByRole('link', { name: 'alice' })).toBeInTheDocument();
    // With no summary, the template's name stands in as the title: not its
    // raw ref (B16). The page's title, under the plugin header's "Approvals".
    expect(screen.getByRole('heading', { level: 2 })).toHaveTextContent(
      /^request-github-admin$/,
    );
  });

  describe('a settled request', () => {
    // B4 in the browser review: "This request has already been decided" on
    // requests nobody decided, "0 of 2 approvals needed" on settled ones, and
    // an "Expires" date on requests that can no longer expire.
    it.each([
      ['cancelled', 'Withdrawn by the requester before it was decided.'],
      ['expired', 'Timed out before it was approved.'],
      ['completed', 'Approved, and the template has run.'],
      ['failed', 'Approved, but the template did not complete.'],
    ] as const)('says what happened to a %s request', async (status, says) => {
      await render({
        getRequest: async () => ({
          ...REQUEST,
          status,
          expiresAt: '2026-09-16T10:00:00.000Z',
        }),
      });

      expect(await screen.findByText(says)).toBeInTheDocument();
      expect(
        screen.queryByText(/already been decided/),
      ).not.toBeInTheDocument();
      expect(screen.queryByText(/approvals needed/)).not.toBeInTheDocument();
      expect(screen.queryByText('Expires')).not.toBeInTheDocument();
    });

    it('names when an expired request timed out', async () => {
      await render({
        getRequest: async () => ({
          ...REQUEST,
          status: 'expired' as const,
          expiresAt: '2026-09-16T10:00:00.000Z',
        }),
      });

      expect(await screen.findByText('Timed out')).toBeInTheDocument();
    });

    it('does not call a running request denied because a denial lost the race', async () => {
      // An approval reached quorum first; the late denial stays on record, but
      // the request is running, and the page has to say so.
      await render({
        getRequest: async () => ({
          ...REQUEST,
          status: 'running' as const,
          decisions: [
            {
              id: 'd1',
              requestId: REQUEST.id,
              approverRef: 'user:default/bob',
              decision: 'deny' as const,
              createdAt: '2026-09-13T10:06:00.000Z',
            },
          ],
        }),
      });

      expect(
        await screen.findByText('Approved. The template is running.'),
      ).toBeInTheDocument();
      expect(
        screen.queryByText(/A single denial rejects/),
      ).not.toBeInTheDocument();
    });
  });

  it('says who can approve, how many it takes, and whether the requester may', async () => {
    // B5: the requester could see "0 of 2" but not whose two.
    await render({
      getRequest: async () => ({
        ...REQUEST,
        policySnapshot: {
          approvers: ['group:default/devx-team', 'user:default/lead'],
          quorum: 2,
          selfApprove: false,
        },
      }),
    });

    expect(
      await screen.findByText(/^Needs 2 approvals from/),
    ).toHaveTextContent(
      'Needs 2 approvals from devx-team or lead. The requester cannot approve their own request.',
    );
    // Each approver links to their catalog page, so a requester can see who
    // is in the group they are waiting on (B16).
    expect(screen.getByRole('link', { name: 'devx-team' })).toHaveAttribute(
      'href',
      '/catalog/default/group/devx-team',
    );
    expect(screen.getByRole('link', { name: 'lead' })).toHaveAttribute(
      'href',
      '/catalog/default/user/lead',
    );
  });

  it('names people and the template, each linked to its catalog page', async () => {
    // B16: "user:default/requester", "template:default/request-github-admin"
    // and "group:default/devx-team" everywhere, none of them links.
    await render({
      getRequest: async () => ({
        ...REQUEST,
        decisions: [
          {
            id: 'd1',
            requestId: REQUEST.id,
            approverRef: 'user:default/alice',
            decision: 'approve' as const,
            createdAt: '2026-09-13T10:05:00.000Z',
          },
        ],
      }),
    });

    await screen.findByText('Admin on backstage');
    const links = Object.fromEntries(
      screen
        .getAllByRole('link')
        .map(link => [link.textContent, link.getAttribute('href')]),
    );
    expect(links).toEqual(
      expect.objectContaining({
        requester: '/catalog/default/user/requester',
        'request-github-admin':
          '/catalog/default/template/request-github-admin',
        'devx-team': '/catalog/default/group/devx-team',
        alice: '/catalog/default/user/alice',
      }),
    );
    // The requester is named in the header, where the raw ref used to be, as
    // one piece of text: the header's description is a string.
    expect(screen.getByText('Requested by requester')).toBeInTheDocument();
    // And no raw ref is left anywhere a person reads.
    expect(document.body).not.toHaveTextContent(
      /(user|group|template):default\//,
    );
  });

  describe('a request past its deadline that the sweep has not reached yet', () => {
    // B9: still `pending` in the database for up to five minutes, but nobody
    // can decide it, so it must not read as waiting.
    const LAPSED = {
      ...REQUEST,
      expiresAt: '2020-01-01T00:00:00.000Z',
    };

    it('reads as expired, with nothing to decide', async () => {
      await render({ getRequest: async () => LAPSED });

      expect(await screen.findByText('Expired')).toBeInTheDocument();
      expect(
        screen.getByText('Timed out before it was approved.'),
      ).toBeInTheDocument();
      expect(
        screen.queryByRole('button', { name: 'Approve' }),
      ).not.toBeInTheDocument();
    });

    it('is not offered to its requester for withdrawal', async () => {
      await render(
        { getRequest: async () => LAPSED },
        identityOf('user:default/requester'),
      );

      await screen.findByText('Expired');
      expect(
        screen.queryByRole('button', { name: 'Withdraw' }),
      ).not.toBeInTheDocument();
    });
  });

  describe('when the request cannot be loaded', () => {
    // B6: a bare error bar with no page around it and no way back.
    // Shaped like the client's `ResponseError`, body included: the error
    // panel reads the body of anything named ResponseError.
    const failing = (statusCode: number, message: string) =>
      jest.fn().mockRejectedValue(
        Object.assign(new Error(message), {
          name: 'ResponseError',
          statusCode,
          cause: Object.assign(new Error(message), { name: 'Error' }),
          body: {
            error: { name: 'Error', message },
            request: { method: 'GET', url: '/requests/x' },
            response: { statusCode },
          },
        }),
      );

    it('says a missing request does not exist, and offers the way back', async () => {
      await render({
        getRequest: failing(404, 'No such approval request: x'),
      });

      expect(
        await screen.findByText('No such approval request'),
      ).toBeInTheDocument();
      expect(
        screen.getByRole('link', { name: 'Back to approvals' }),
      ).toHaveAttribute('href', '/scaffolder-approvals');
      // Inside the page, with its header, not a bar on its own.
      expect(
        screen.getByRole('heading', { name: 'Approval request' }),
      ).toBeInTheDocument();
    });

    it('says a malformed link is not a request link', async () => {
      await render({
        getRequest: failing(400, 'Invalid request id: must be a request id'),
      });

      expect(
        await screen.findByText('This is not a link to an approval request'),
      ).toBeInTheDocument();
    });

    it('keeps the error panel, inside the page, for anything else', async () => {
      await render({
        getRequest: failing(500, 'The database is on fire'),
      });

      expect(
        (await screen.findAllByText(/The database is on fire/)).length,
      ).toBeGreaterThan(0);
      expect(
        screen.getByRole('link', { name: 'Back to approvals' }),
      ).toBeInTheDocument();
    });
  });

  describe('live updates', () => {
    // B10: somebody else's decision, or the template finishing, appeared only
    // on a manual reload.
    it('refetches when the backend signals a change to this request', async () => {
      const signals = fakeSignals();
      const getRequest = jest
        .fn()
        .mockResolvedValueOnce(REQUEST)
        .mockResolvedValue({ ...REQUEST, status: 'running' as const });
      await render({ getRequest }, APPROVER, undefined, signals);

      expect(await screen.findByText('Awaiting approval')).toBeInTheDocument();

      await signals.publish('scaffolder-approvals', {
        action: 'decided',
        requestId: REQUEST.id,
        status: 'approved',
      });

      expect(await screen.findByText('Running')).toBeInTheDocument();
      expect(getRequest).toHaveBeenCalledTimes(2);
    });

    it('ignores a signal about another request', async () => {
      const signals = fakeSignals();
      const getRequest = jest.fn().mockResolvedValue(REQUEST);
      await render({ getRequest }, APPROVER, undefined, signals);
      await screen.findByText('Awaiting approval');

      await signals.publish('scaffolder-approvals', {
        action: 'decided',
        requestId: 'someone-elses',
        status: 'approved',
      });

      expect(getRequest).toHaveBeenCalledTimes(1);
    });
  });

  it('surfaces a failure to load the request', async () => {
    await render({
      getRequest: jest.fn().mockRejectedValue(new Error('Request not found')),
    });

    // The error panel repeats the message in its summary and its body.
    expect(
      (await screen.findAllByText(/Request not found/)).length,
    ).toBeGreaterThan(0);
  });
});
