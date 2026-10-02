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
import {
  attachComponentData,
  identityApiRef,
} from '@backstage/core-plugin-api';
import { createDevApp } from '@backstage/dev-utils';
import { entityRouteRef } from '@backstage/plugin-catalog-react';
import { Text } from '@backstage/ui';
import { useParams } from 'react-router-dom';
import {
  ApprovalsIndexPage,
  approvalsApiRef,
  PendingApprovalsCard,
  scaffolderApprovalsPlugin,
} from '../src';
import { createMockApprovalsApi } from './mockApprovalsApi';

/**
 * Where the catalog's entity page would be.
 *
 * People, groups and templates link to their catalog pages (B16), and those
 * links need the catalog's entity route to exist. The harness has no catalog,
 * so this stands in for it, and says which page a real app would show.
 */
function EntityPageStandIn() {
  const { kind, namespace, name } = useParams();
  return (
    <Page themeId="tool">
      <Header title={`${kind}:${namespace}/${name}`} />
      <Content>
        <Text>
          In an app, this is the catalog's page for this entity. The harness has
          no catalog.
        </Text>
      </Content>
    </Page>
  );
}
attachComponentData(EntityPageStandIn, 'core.mountPoint', entityRouteRef);

/** The home-page card, on a page of its own: its count follows your votes. */
function HomeCardPage() {
  return (
    <Page themeId="home">
      <Header title="Home card" />
      <Content>
        <div style={{ maxWidth: 560 }}>
          <PendingApprovalsCard />
        </div>
      </Content>
    </Page>
  );
}

createDevApp()
  .registerPlugin(scaffolderApprovalsPlugin)
  .registerApi({
    api: approvalsApiRef,
    // The mock names whoever the harness signed in as as an approver, so
    // approving, denying and withdrawing can all be tried here (B21).
    deps: { identityApi: identityApiRef },
    factory: ({ identityApi }) => createMockApprovalsApi(identityApi),
  })
  .addPage({
    element: <ApprovalsIndexPage />,
    title: 'Approvals',
    path: '/scaffolder-approvals',
  })
  .addPage({
    element: <HomeCardPage />,
    title: 'Home card',
    path: '/home-card',
  })
  .addPage({
    element: <EntityPageStandIn />,
    path: '/catalog/:namespace/:kind/:name',
  })
  .render();
