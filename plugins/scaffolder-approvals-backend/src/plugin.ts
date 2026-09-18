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
import { eventsServiceRef } from '@backstage/plugin-events-node';
import { notificationService } from '@backstage/plugin-notifications-node';
import { scaffolderServiceRef } from '@backstage/plugin-scaffolder-node';
import { signalsServiceRef } from '@backstage/plugin-signals-node';
import type { HumanDuration } from '@backstage/types';
import { initApprovalStore } from './database';
import {
  ApprovalNotifier,
  ApprovalService,
  ApprovalSweeps,
  createRouter,
  subscribeToTaskEvents,
} from './service';

/** Applied when `scaffolderApprovals.grantTtl` is not configured (Q7). */
const DEFAULT_GRANT_TTL: HumanDuration = { hours: 1 };

/** Applied when `scaffolderApprovals.retention.redactAfter` is absent (Q6). */
const DEFAULT_RETENTION: HumanDuration = { days: 180 };

/**
 * Often enough that a stuck launch is noticed quickly, rarely enough that the
 * scaffolder is not polled into the ground.
 */
const RECONCILE_FREQUENCY: HumanDuration = { minutes: 2 };
const TIMEOUT_FREQUENCY: HumanDuration = { minutes: 5 };
const RETENTION_FREQUENCY: HumanDuration = { hours: 6 };

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
        scheduler: coreServices.scheduler,
        userInfo: coreServices.userInfo,
        catalog: catalogServiceRef,
        events: eventsServiceRef,
        scaffolder: scaffolderServiceRef,
        // Soft dependencies (§7.5). Both refs carry a default factory, so they
        // always resolve and the backend starts whether or not the plugins
        // behind them are installed — what degrades is the call, not startup.
        // `ApprovalNotifier` swallows and logs those failures, so a deployment
        // with neither plugin simply gets no notifications and no live updates.
        notifications: notificationService,
        signals: signalsServiceRef,
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
        scheduler,
        userInfo,
        catalog,
        events,
        scaffolder,
        notifications,
        signals,
      }) {
        const store = await initApprovalStore(database);

        const grantTtl =
          config.getOptional<HumanDuration>('scaffolderApprovals.grantTtl') ??
          DEFAULT_GRANT_TTL;
        const retention =
          config.getOptional<HumanDuration>(
            'scaffolderApprovals.retention.redactAfter',
          ) ?? DEFAULT_RETENTION;

        // `getResources` is what lets the permission framework load a request
        // by id, so a conditional policy's rules can be applied to it. Without
        // it, conditional decisions could not be resolved here at all.
        permissionsRegistry.addResourceType({
          resourceRef: approvalRequestResourceRef,
          permissions: scaffolderApprovalsPermissions,
          rules: [isDesignatedApprover, isNotRequester, hasTemplateRef],
          getResources: async resourceRefs => store.getManyByIds(resourceRefs),
        });

        const notifier = new ApprovalNotifier({
          logger,
          appBaseUrl: config.getString('app.baseUrl'),
          notifications,
          signals,
          events,
        });

        const service = new ApprovalService({
          store,
          catalog,
          scaffolder,
          auth,
          userInfo,
          logger,
          grantTtl,
          observer: notifier,
        });

        const sweeps = new ApprovalSweeps({
          store,
          service,
          scaffolder,
          auth,
          logger,
          notifier,
          retention,
        });

        httpRouter.use(
          await createRouter({
            service,
            store,
            httpAuth,
            userInfo,
            permissions,
            logger,
            grantConsumers: config.getOptionalStringArray(
              'scaffolderApprovals.grantConsumers',
            ),
          }),
        );

        // The fast path for task status. The sweep below is what makes it
        // optional rather than load-bearing.
        await subscribeToTaskEvents({ events, store, sweeps, logger });

        await scheduler.scheduleTask({
          id: 'scaffolder-approvals-reconcile',
          frequency: RECONCILE_FREQUENCY,
          timeout: { minutes: 5 },
          // Wait before the first run so a fleet restarting together does not
          // all sweep at once.
          initialDelay: { seconds: 30 },
          fn: async () => {
            await sweeps.reconcile();
          },
        });

        await scheduler.scheduleTask({
          id: 'scaffolder-approvals-timeouts',
          frequency: TIMEOUT_FREQUENCY,
          timeout: { minutes: 5 },
          initialDelay: { seconds: 45 },
          fn: async () => {
            await sweeps.expireTimedOut();
          },
        });

        await scheduler.scheduleTask({
          id: 'scaffolder-approvals-retention',
          frequency: RETENTION_FREQUENCY,
          timeout: { minutes: 15 },
          initialDelay: { minutes: 1 },
          fn: async () => {
            await sweeps.redactOld();
          },
        });
      },
    });
  },
});
