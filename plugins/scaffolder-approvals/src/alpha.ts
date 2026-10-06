/**
 * New frontend system entrypoint for the scaffolder-approvals plugin.
 *
 * Both entrypoints mount the same components — only the wiring differs, so
 * there is one implementation to maintain and two ways to install it.
 *
 * @packageDocumentation
 */

import { SCAFFOLDER_APPROVALS_PLUGIN_ID } from '@ferin79/backstage-plugin-scaffolder-approvals-common';
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
import { loadPendingApprovalsCard } from './homePageCard';
import { requestRouteRef, rootRouteRef } from './routes';

const approvalsApi = ApiBlueprint.make({
  name: 'approvals',
  params: define =>
    define({
      api: approvalsApiRef,
      deps: { discoveryApi: discoveryApiRef, fetchApi: fetchApiRef },
      factory: deps => new ApprovalsClient(deps),
    }),
});

const approvalsPage = PageBlueprint.make({
  params: {
    path: '/scaffolder-approvals',
    // A page carries its own title and icon, and the app builds the sidebar
    // entry from them. Without a title the page is reachable only by URL,
    // which for an inbox means the people who need it never see it.
    title: 'Approvals',
    icon: createElement(ApprovalsIcon),
    routeRef: convertLegacyRouteRef(rootRouteRef),
    // The pages draw BUI's plugin header themselves, tabs included, so that
    // they look the same in both frontend systems. The app's own header would
    // be a second one above it.
    noHeader: true,
    // `createElement` rather than JSX, so this entrypoint stays a `.ts` file
    // and the `./alpha` export in package.json needs no special casing.
    loader: () => import('./components').then(m => createElement(m.Router)),
  },
});

/**
 * The home-page card, as a widget the grid can place: the same component the
 * legacy entrypoint exposes through `createCardExtension`.
 */
const approvalsWidget = HomePageWidgetBlueprint.make({
  name: 'pendingApprovals',
  params: {
    title: 'Approvals',
    description: 'Approval requests waiting on your decision',
    components: loadPendingApprovalsCard,
  },
});

/**
 * The scaffolder-approvals frontend plugin, for the new frontend system.
 *
 * @public
 */
export default createFrontendPlugin({
  pluginId: SCAFFOLDER_APPROVALS_PLUGIN_ID,
  extensions: [approvalsApi, approvalsPage, approvalsWidget],
  routes: {
    root: convertLegacyRouteRef(rootRouteRef),
    request: convertLegacyRouteRef(requestRouteRef),
  },
});
