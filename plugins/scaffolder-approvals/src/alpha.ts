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

/**
 * New frontend system entrypoint for the scaffolder-approvals plugin.
 *
 * This package dual-ships (Q14). Both entrypoints mount the same components —
 * only the wiring differs (Q23), so there is one implementation to maintain and
 * two ways to install it.
 *
 * @packageDocumentation
 */

import {
  ApiBlueprint,
  createFrontendPlugin,
  PageBlueprint,
} from '@backstage/frontend-plugin-api';
import { convertLegacyRouteRef } from '@backstage/core-compat-api';
import { HomePageWidgetBlueprint } from '@backstage/plugin-home-react/alpha';
import { discoveryApiRef, fetchApiRef } from '@backstage/core-plugin-api';
import { createElement } from 'react';
import { ApprovalsClient, approvalsApiRef } from './api';
import { ApprovalsIcon } from './components/ApprovalsIcon';
import { requestRouteRef, rootRouteRef } from './routes';

const approvalsApi = ApiBlueprint.make({
  name: 'approvals',
  params: define =>
    define({
      api: approvalsApiRef,
      deps: { discoveryApi: discoveryApiRef, fetchApi: fetchApiRef },
      factory: ({ discoveryApi, fetchApi }) =>
        new ApprovalsClient({ discoveryApi, fetchApi }),
    }),
});

/**
 * The nav entry, as Backstage 1.54 expects one.
 *
 * There is no `NavItemBlueprint` to reach for: a page carries its own `title`
 * and `icon`, outputs them as `core.title` and `core.icon`, and the app builds
 * the sidebar entry from that. An earlier `NavItemBlueprint` did exist and is
 * what other workspaces on older versions still use.
 */
const navIcon = createElement(ApprovalsIcon);

const approvalsPage = PageBlueprint.make({
  params: {
    path: '/scaffolder-approvals',
    // Q22: page *and* nav item. Without a title the page is reachable only by
    // URL, which for an inbox means the people who need it never see it.
    title: 'Approvals',
    icon: navIcon,
    routeRef: convertLegacyRouteRef(rootRouteRef),
    // `createElement` rather than JSX, so this entrypoint stays a `.ts` file
    // and the `./alpha` export in package.json needs no special casing.
    loader: () => import('./components').then(m => createElement(m.Router)),
  },
});

/**
 * The home-page card, as a widget the grid can place (Q22).
 *
 * The same component the legacy entrypoint exposes through
 * `createCardExtension`: only the wiring differs, which is the whole point of
 * dual-shipping.
 */
const approvalsWidget = HomePageWidgetBlueprint.make({
  name: 'pendingApprovals',
  params: {
    title: 'Approvals',
    description: 'Approval requests waiting on your decision',
    components: () =>
      // The card's own module, not the components barrel: the barrel also
      // carries the wizard's review step, and with it the scaffolder's form
      // and review code, none of which a home page needs to load.
      import('./components/PendingApprovalsCard').then(m => ({
        Content: m.PendingApprovalsContent,
        // The extension draws its own card, so the way to the page has to be
        // handed over as well, or the home page has none (B19).
        Actions: m.PendingApprovalsActions,
      })),
  },
});

/**
 * The scaffolder-approvals frontend plugin, for the new frontend system.
 *
 * @public
 */
export default createFrontendPlugin({
  pluginId: 'scaffolder-approvals',
  extensions: [approvalsApi, approvalsPage, approvalsWidget],
  routes: {
    root: convertLegacyRouteRef(rootRouteRef),
    request: convertLegacyRouteRef(requestRouteRef),
  },
});
