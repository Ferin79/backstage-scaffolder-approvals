import type { ApprovalRequest } from '@ferin79/backstage-plugin-scaffolder-approvals-common';
import { renderInTestApp } from '@backstage/test-utils';
import { screen } from '@testing-library/react';
import type { ApprovalsApi } from '../../api';
import { rootRouteRef } from '../../routes';
import { RequestsTable } from './RequestsTable';

// A phone. In a file of its own because BUI caches the breakpoint the first
// time anything asks, and after that only a `matchMedia` change event moves
// it, which the stand-in in setupTests never fires. So the window has to be
// narrow before anything renders.
window.innerWidth = 390;

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

describe('RequestsTable on a narrow screen', () => {
  it('keeps what a request is and where it stands, and drops the rest', async () => {
    // At phone width all four columns truncated and the status pills were
    // clipped mid-word.
    const api = {
      listRequests: jest
        .fn()
        .mockResolvedValue({ items: [PENDING], totalItems: 1 }),
    } as Partial<ApprovalsApi> as ApprovalsApi;

    await renderInTestApp(
      <RequestsTable
        api={api}
        query={{ role: 'approver' }}
        emptyTitle="Nothing is waiting on you"
        emptyDescription="Requests you can decide on will appear here."
      />,
      { mountedRoutes: { '/scaffolder-approvals': rootRouteRef } },
    );

    expect(await screen.findByText('Admin on backstage')).toBeInTheDocument();
    expect(screen.getByText('Awaiting approval')).toBeInTheDocument();
    const headers = screen
      .getAllByRole('columnheader')
      .map(header => header.textContent);
    expect(headers).toEqual(['Template', 'Status']);
  });
});
