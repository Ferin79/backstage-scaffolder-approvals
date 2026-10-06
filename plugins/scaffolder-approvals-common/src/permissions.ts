import { createPermission } from '@backstage/plugin-permission-common';
import { RESOURCE_TYPE_APPROVAL_REQUEST } from './constants';

/**
 * Submit a new approval request.
 *
 * A basic rather than a resource permission: at create time there is no
 * resource to authorize against yet.
 *
 * @public
 */
export const approvalRequestCreatePermission = createPermission({
  name: 'scaffolderApprovals.request.create',
  attributes: { action: 'create' },
});

/**
 * Read approval requests and their decision history.
 *
 * Installed open to any signed-in user by default, matching the scaffolder's
 * own task list. It is registered as a resource permission so that an adopter
 * can narrow it — to the requester and the designated approvers, say — without
 * this plugin changing.
 *
 * @public
 */
export const approvalRequestReadPermission = createPermission({
  name: 'scaffolderApprovals.request.read',
  attributes: { action: 'read' },
  resourceType: RESOURCE_TYPE_APPROVAL_REQUEST,
});

/**
 * Approve or deny an approval request.
 *
 * The load-bearing permission. Routing the check through the permission
 * framework rather than hard-coding it means this shows up in the RBAC plugin
 * as something an admin can see and manage, and lets adopters layer policy this
 * plugin never anticipated — a security-team break-glass rule, or tighter rules
 * on production-tagged templates — without forking.
 *
 * @public
 */
export const approvalRequestDecidePermission = createPermission({
  name: 'scaffolderApprovals.request.decide',
  attributes: { action: 'update' },
  resourceType: RESOURCE_TYPE_APPROVAL_REQUEST,
});

/**
 * Withdraw a pending approval request.
 *
 * @public
 */
export const approvalRequestCancelPermission = createPermission({
  name: 'scaffolderApprovals.request.cancel',
  attributes: { action: 'update' },
  resourceType: RESOURCE_TYPE_APPROVAL_REQUEST,
});

/**
 * Every permission this plugin defines, for registration with the permissions
 * registry and for RBAC discovery.
 *
 * @public
 */
export const scaffolderApprovalsPermissions = [
  approvalRequestCreatePermission,
  approvalRequestReadPermission,
  approvalRequestDecidePermission,
  approvalRequestCancelPermission,
];
