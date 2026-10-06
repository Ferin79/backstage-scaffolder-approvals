import { SCAFFOLDER_APPROVALS_PLUGIN_ID } from '@ferin79/backstage-plugin-scaffolder-approvals-common';
import {
  createExternalRouteRef,
  createRouteRef,
  createSubRouteRef,
} from '@backstage/core-plugin-api';

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

/**
 * A task's page in the scaffolder, where an approved run's log is.
 *
 * The requester cannot find that task under "my tasks", because the plugin's
 * service principal created it, so the request page links here. The new
 * frontend system binds it to the scaffolder's task page by default; a legacy
 * app binds it to `scaffolderPlugin.routes.ongoingTask`. Left unbound, the
 * request page names the task without linking it.
 *
 * @public
 */
export const scaffolderTaskRouteRef = createExternalRouteRef({
  id: `${SCAFFOLDER_APPROVALS_PLUGIN_ID}:scaffolder-task`,
  optional: true,
  params: ['taskId'],
  defaultTarget: 'scaffolder.ongoingTask',
});

/**
 * A template's form in the scaffolder.
 *
 * Resubmitting a request whose template no longer takes its values opens this
 * form with the values filled in, for the requester to correct. The new
 * frontend system binds it to the scaffolder by default; a legacy app binds it
 * to `scaffolderPlugin.routes.selectedTemplate`. Left unbound, Resubmit says
 * why it failed and stays on the request.
 *
 * @public
 */
export const scaffolderTemplateRouteRef = createExternalRouteRef({
  id: `${SCAFFOLDER_APPROVALS_PLUGIN_ID}:scaffolder-template`,
  optional: true,
  params: ['namespace', 'templateName'],
  defaultTarget: 'scaffolder.selectedTemplate',
});
