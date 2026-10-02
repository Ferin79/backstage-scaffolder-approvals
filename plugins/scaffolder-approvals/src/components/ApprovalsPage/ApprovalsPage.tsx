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

import { Content, Header, Page } from '@backstage/core-components';
import { useApi } from '@backstage/core-plugin-api';
import { Tabs, TabList, Tab, TabPanel } from '@backstage/ui';
import { approvalsApiRef } from '../../api';
import { RequestsTable } from './RequestsTable';

/**
 * The approvals page: what is waiting on you, and what you asked for.
 *
 * Two tabs rather than one filtered table, because they answer different
 * questions and belong to different people. An approver opens this to find work
 * to do; a requester opens it to find out what happened.
 *
 * Page chrome comes from core-components (Q24) so this sits inside Backstage
 * the way every other page does, while the contents are BUI (Q15).
 *
 * @public
 */
export function ApprovalsPage() {
  const api = useApi(approvalsApiRef);

  return (
    <Page themeId="tool">
      <Header
        title="Approvals"
        subtitle="Requests to run templates that need a decision"
      />
      <Content>
        <Tabs>
          <TabList>
            <Tab id="inbox">Waiting on you</Tab>
            <Tab id="mine">Your requests</Tab>
          </TabList>

          <TabPanel id="inbox">
            <RequestsTable
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
          </TabPanel>

          <TabPanel id="mine">
            <RequestsTable
              api={api}
              viewAs="requester"
              // Everything, because "what happened to the thing I asked for" is
              // the question, and the answer is often that it failed.
              emptyTitle="You have not asked for anything yet"
              emptyDescription="Gated templates you submit will appear here with their progress."
            />
          </TabPanel>
        </Tabs>
      </Content>
    </Page>
  );
}
