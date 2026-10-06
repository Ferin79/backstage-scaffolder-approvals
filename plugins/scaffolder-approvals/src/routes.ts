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
