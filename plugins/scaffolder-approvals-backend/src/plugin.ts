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
  scaffolderApprovalsPermissions,
  SCAFFOLDER_APPROVALS_PLUGIN_ID,
} from '@backstage-community/plugin-scaffolder-approvals-common';
import {
  approvalRequestResourceRef,
  hasTemplateRef,
  isDesignatedApprover,
  isNotRequester,
} from '@backstage-community/plugin-scaffolder-approvals-node';
import {
  coreServices,
  createBackendPlugin,
} from '@backstage/backend-plugin-api';
import { catalogServiceRef } from '@backstage/plugin-catalog-node';
import { scaffolderServiceRef } from '@backstage/plugin-scaffolder-node';
import type { HumanDuration } from '@backstage/types';
import { initApprovalStore } from './database';
import { ApprovalService, createRouter } from './service';

/** Applied when `scaffolderApprovals.grantTtl` is not configured (Q7). */
const DEFAULT_GRANT_TTL: HumanDuration = { hours: 1 };

/**
 * The scaffolder-approvals backend plugin.
 *
 * @public
 */
export const scaffolderApprovalsPlugin = createBackendPlugin({
  pluginId: SCAFFOLDER_APPROVALS_PLUGIN_ID,
  register(env) {
    env.registerInit({
      deps: {
        auth: coreServices.auth,
        config: coreServices.rootConfig,
        database: coreServices.database,
        httpAuth: coreServices.httpAuth,
        httpRouter: coreServices.httpRouter,
        logger: coreServices.logger,
        permissions: coreServices.permissions,
        permissionsRegistry: coreServices.permissionsRegistry,
        userInfo: coreServices.userInfo,
        catalog: catalogServiceRef,
        scaffolder: scaffolderServiceRef,
      },
      async init({
        auth,
        config,
        database,
        httpAuth,
        httpRouter,
        logger,
        permissions,
        permissionsRegistry,
        userInfo,
        catalog,
        scaffolder,
      }) {
        const store = await initApprovalStore(database);

        const grantTtl =
          config.getOptional<HumanDuration>('scaffolderApprovals.grantTtl') ??
          DEFAULT_GRANT_TTL;

        // `getResources` is what lets the permission framework load a request
        // by id, so a conditional policy's rules can be applied to it. Without
        // it, conditional decisions could not be resolved here at all.
        permissionsRegistry.addResourceType({
          resourceRef: approvalRequestResourceRef,
          permissions: scaffolderApprovalsPermissions,
          rules: [isDesignatedApprover, isNotRequester, hasTemplateRef],
          getResources: async resourceRefs => store.getManyByIds(resourceRefs),
        });

        const service = new ApprovalService({
          store,
          catalog,
          scaffolder,
          auth,
          userInfo,
          logger,
          grantTtl,
        });

        httpRouter.use(
          await createRouter({
            service,
            store,
            httpAuth,
            userInfo,
            permissions,
            logger,
          }),
        );
      },
    });
  },
});
