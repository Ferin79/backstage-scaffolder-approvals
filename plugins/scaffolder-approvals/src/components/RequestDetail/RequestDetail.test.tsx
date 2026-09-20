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

import type { ApprovalRequestWithDecisions } from '@backstage-community/plugin-scaffolder-approvals-common';
import { alertApiRef, identityApiRef } from '@backstage/core-plugin-api';
import { renderInTestApp, TestApiProvider } from '@backstage/test-utils';
import { screen, waitFor } from '@testing-library/react';
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

function render(
  api: Partial<ApprovalsApi>,
  identity: ReturnType<typeof identityOf> = APPROVER,
  alertApi = { post: jest.fn(), alert$: jest.fn() },
) {
  return renderInTestApp(
    <TestApiProvider
      apis={[
        [approvalsApiRef, api as ApprovalsApi],
        [identityApiRef, identity as any],
        [alertApiRef, alertApi as any],
      ]}
    >
      <RequestDetail requestId={REQUEST.id} />
    </TestApiProvider>,
    {
      // Only the root ref: `mountedRoutes` takes route refs, not sub route
      // refs, and a sub route resolves relative to its parent anyway.
      mountedRoutes: { '/scaffolder-approvals': rootRouteRef },
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

    it('explains that the request is already decided', async () => {
      await render({
        getRequest: jest
          .fn()
          .mockResolvedValue({ ...REQUEST, status: 'rejected' as const }),
      });

      expect(
        await screen.findByText('This request has already been decided.'),
      ).toBeInTheDocument();
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

      expect(cancel).toHaveBeenCalledWith(REQUEST.id);
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
    expect(
      screen.getByText('user:default/alice', { exact: false }),
    ).toBeInTheDocument();
    // With no summary, the template ref stands in as the title.
    expect(screen.getAllByText(/request-github-admin/).length).toBeGreaterThan(
      0,
    );
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
