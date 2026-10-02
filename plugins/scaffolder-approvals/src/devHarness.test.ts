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

// The dev harness's mock lives in `dev/`, which Jest does not search; its
// tests live here instead.
import { createMockApprovalsApi } from '../dev/mockApprovalsApi';

/** The harness signs in as a guest in no group, as `yarn start` does. */
const GUEST = 'user:development/guest';

function harnessApi() {
  return createMockApprovalsApi({
    getBackstageIdentity: async () => ({
      type: 'user' as const,
      userEntityRef: GUEST,
      ownershipEntityRefs: [GUEST],
    }),
  });
}

const INBOX = {
  role: 'approver' as const,
  actionable: true,
  status: ['pending' as const],
};

describe('the dev harness', () => {
  it('gives its own user something to decide', async () => {
    // B21: every request named devx-team, which the guest is not in, so the
    // inbox listed requests nobody in the harness could act on.
    const api = harnessApi();

    const inbox = await api.listRequests(INBOX);

    expect(inbox.items.map(request => request.summary)).toEqual([
      'Admin on backstage',
      'Production access for a deploy',
    ]);
    expect(inbox.totalItems).toBe(2);
  });

  it('lists only your own on "Your requests"', async () => {
    const api = harnessApi();

    const mine = await api.listRequests({ role: 'requester' });

    expect(mine.items.map(request => request.requesterRef)).toEqual([GUEST]);
  });

  it('completes a request whose quorum your approval meets', async () => {
    const api = harnessApi();
    const before = await api.getRequest('1');

    await api.decide('1', { decision: 'approve' });

    const after = await api.getRequest('1');
    expect(after.status).toBe('completed');
    expect(after.taskId).toBeDefined();
    expect(after.decisions.map(decision => decision.approverRef)).toEqual([
      'user:default/alice',
      GUEST,
    ]);
    // A new object, so a page holding the old one re-renders.
    expect(after).not.toBe(before);
    // And it is no longer waiting on you.
    const inbox = await api.listRequests(INBOX);
    expect(inbox.items.map(request => request.id)).toEqual(['2']);
  });

  it('rejects a request you deny, with your comment', async () => {
    const api = harnessApi();

    await api.decide('2', { decision: 'deny', comment: 'Not this week.' });

    const denied = await api.getRequest('2');
    expect(denied.status).toBe('rejected');
    expect(denied.decisions[0].comment).toBe('Not this week.');
  });

  it('refuses what the backend would refuse', async () => {
    const api = harnessApi();
    await api.decide('2', { decision: 'approve' });

    await expect(api.decide('2', { decision: 'approve' })).rejects.toThrow(
      'This request has already been decided',
    );
    // Your own, under a gate that forbids self-approval.
    await expect(api.decide('3', { decision: 'approve' })).rejects.toThrow(
      'You cannot approve your own request',
    );
    // Somebody else's, to withdraw.
    await expect(api.cancel('1')).rejects.toThrow(
      'Only the requester can withdraw a request',
    );
  });

  it('withdraws your own request', async () => {
    const api = harnessApi();

    await api.cancel('3');

    expect((await api.getRequest('3')).status).toBe('cancelled');
    await expect(api.cancel('3')).rejects.toThrow('no longer pending');
  });
});
