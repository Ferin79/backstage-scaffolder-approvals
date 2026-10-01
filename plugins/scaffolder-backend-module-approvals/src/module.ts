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
  coreServices,
  createBackendModule,
} from '@backstage/backend-plugin-api';
import { scaffolderActionsExtensionPoint } from '@backstage/plugin-scaffolder-node';
import { createApprovalGateAction } from './createApprovalGateAction';

/**
 * Registers the `approval:gate` action with the scaffolder.
 *
 * Install this in the same backend as the scaffolder. Without it a gated
 * template cannot run at all: the step names an action the scaffolder does not
 * know, so the task fails at step one — which is the right way round for a
 * missing gate to fail.
 *
 * @public
 */
export const scaffolderModuleApprovals = createBackendModule({
  pluginId: 'scaffolder',
  moduleId: 'approvals',
  register(env) {
    env.registerInit({
      deps: {
        scaffolder: scaffolderActionsExtensionPoint,
        auth: coreServices.auth,
        discovery: coreServices.discovery,
      },
      async init({ scaffolder, auth, discovery }) {
        scaffolder.addActions(createApprovalGateAction({ auth, discovery }));
      },
    });
  },
});
