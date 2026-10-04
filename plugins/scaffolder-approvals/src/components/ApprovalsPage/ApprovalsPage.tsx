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

import { useApi } from '@backstage/core-plugin-api';
import { Container, Header } from '@backstage/ui';
import { approvalsApiRef } from '../../api';
import { ApprovalsLayout } from '../ApprovalsLayout';
import { RequestsTable } from './RequestsTable';

/** @public */
export interface ApprovalsPageProps {
  /**
   * Which list to show: what is waiting on you, or what you asked for.
   * Defaults to the inbox.
   */
  view?: 'inbox' | 'mine';
}

/**
 * The approvals page: what is waiting on you, and what you asked for.
 *
 * Two lists rather than one filtered table, because they answer different
 * questions and belong to different people. An approver opens this to find work
 * to do; a requester opens it to find out what happened. Each is a tab in the
 * plugin header, with an address of its own.
 *
 * @public
 */
export function ApprovalsPage(props: ApprovalsPageProps) {
  const { view = 'inbox' } = props;
  const api = useApi(approvalsApiRef);

  return (
    <ApprovalsLayout title={view === 'inbox' ? 'Approvals' : 'Your requests'}>
      {view === 'inbox' ? (
        <>
          <Header
            title="Waiting on you"
            description="Requests to run a template that you can approve or deny. A template runs only once enough approvers agree."
          />
          <Container>
            <RequestsTable
              // Keyed, so switching tabs starts the table over rather than
              // carrying one list's page and sort into the other.
              key="inbox"
              api={api}
              viewAs="approver"
              // Only what still needs a decision from *this* person: not what
              // they have already voted on, nor their own request when the
              // gate forbids self-approval. Somebody looking for work does not
              // want a history of everything they were ever asked about.
              actionable
              status={['pending']}
              emptyTitle="Nothing is waiting on you"
              emptyDescription="Requests you can decide on will appear here."
            />
          </Container>
        </>
      ) : (
        <>
          <Header
            title="Your requests"
            description="Gated templates you have submitted, and what happened to each of them."
          />
          <Container>
            <RequestsTable
              key="mine"
              api={api}
              viewAs="requester"
              // Everything, because "what happened to the thing I asked for" is
              // the question, and the answer is often that it failed.
              emptyTitle="You have not asked for anything yet"
              emptyDescription="Gated templates you submit will appear here with their progress."
            />
          </Container>
        </>
      )}
    </ApprovalsLayout>
  );
}
