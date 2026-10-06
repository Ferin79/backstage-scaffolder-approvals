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

import { SCAFFOLDER_APPROVALS_PLUGIN_ID } from '@ferin79/backstage-plugin-scaffolder-approvals-common';
import { createRouteRef, createSubRouteRef } from '@backstage/core-plugin-api';

/**
 * The approvals page: the inbox and your own requests.
 *
 * @public
 */
export const rootRouteRef = createRouteRef({
  id: SCAFFOLDER_APPROVALS_PLUGIN_ID,
});

/**
 * One request.
 *
 * This is the canonical view of a gated run, not the scaffolder's task page:
 * the task is created by the service principal, so it cannot say who asked or
 * who agreed.
 *
 * @public
 */
export const requestRouteRef = createSubRouteRef({
  id: `${SCAFFOLDER_APPROVALS_PLUGIN_ID}:request`,
  parent: rootRouteRef,
  path: '/requests/:requestId',
});
