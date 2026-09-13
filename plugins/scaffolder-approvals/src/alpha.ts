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
import { discoveryApiRef, fetchApiRef } from '@backstage/core-plugin-api';
import { createElement } from 'react';
import { ApprovalsClient, approvalsApiRef } from './api';
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

const approvalsPage = PageBlueprint.make({
  params: {
    path: '/scaffolder-approvals',
    routeRef: convertLegacyRouteRef(rootRouteRef),
    // `createElement` rather than JSX, so this entrypoint stays a `.ts` file
    // and the `./alpha` export in package.json needs no special casing.
    loader: () => import('./components').then(m => createElement(m.Router)),
  },
});

/**
 * The scaffolder-approvals frontend plugin, for the new frontend system.
 *
 * @public
 */
export default createFrontendPlugin({
  pluginId: 'scaffolder-approvals',
  extensions: [approvalsApi, approvalsPage],
  routes: {
    root: convertLegacyRouteRef(rootRouteRef),
    request: convertLegacyRouteRef(requestRouteRef),
  },
});
