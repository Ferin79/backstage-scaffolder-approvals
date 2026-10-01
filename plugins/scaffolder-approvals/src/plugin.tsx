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

import {
  createApiFactory,
  createPlugin,
  createRoutableExtension,
  discoveryApiRef,
  fetchApiRef,
} from '@backstage/core-plugin-api';
import { createCardExtension } from '@backstage/plugin-home-react';
import { ApprovalsClient, approvalsApiRef } from './api';
import { requestRouteRef, rootRouteRef } from './routes';

/**
 * The scaffolder-approvals frontend plugin, for the legacy frontend system.
 *
 * @public
 */
export const scaffolderApprovalsPlugin = createPlugin({
  id: 'scaffolder-approvals',
  routes: {
    root: rootRouteRef,
    request: requestRouteRef,
  },
  apis: [
    createApiFactory({
      api: approvalsApiRef,
      deps: { discoveryApi: discoveryApiRef, fetchApi: fetchApiRef },
      factory: ({ discoveryApi, fetchApi }) =>
        new ApprovalsClient({ discoveryApi, fetchApi }),
    }),
  ],
});

/**
 * The approvals page: the inbox, your own requests, and one request in detail.
 *
 * @public
 */
export const ApprovalsIndexPage = scaffolderApprovalsPlugin.provide(
  createRoutableExtension({
    name: 'ApprovalsIndexPage',
    // Lazy so the plugin costs nothing until somebody opens it.
    component: () => import('./components').then(m => m.Router),
    mountPoint: rootRouteRef,
  }),
);

/**
 * A home-page card showing how many requests are waiting on you (Q22).
 *
 * `createCardExtension` rather than a plain component export, because that is
 * what lets the home plugin place it, size it and remember where somebody put
 * it. A bare component would have to be wired by hand into every app.
 *
 * @public
 */
export const PendingApprovalsHomePageCard = scaffolderApprovalsPlugin.provide(
  createCardExtension({
    name: 'PendingApprovalsCard',
    title: 'Approvals',
    description: 'Approval requests waiting on your decision',
    components: () =>
      import('./components').then(m => ({
        Content: m.PendingApprovalsContent,
      })),
  }),
);
