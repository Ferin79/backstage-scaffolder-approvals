import {
  type ApprovalRequest,
  isApprover,
  isSameEntityRef,
  normaliseEntityRefs,
  RESOURCE_TYPE_APPROVAL_REQUEST,
  SCAFFOLDER_APPROVALS_PLUGIN_ID,
  tryNormaliseEntityRef,
} from '@ferin79/backstage-plugin-scaffolder-approvals-common';
import {
  createPermissionResourceRef,
  createPermissionRule,
} from '@backstage/plugin-permission-node';
import { z } from 'zod';

/**
 * A filter over approval requests, as a conditional decision expresses it.
 *
 * Deliberately narrow: these are the three questions a policy can usefully ask
 * about a request, and each maps onto an indexed column or the approvers table.
 * A filter that could not be answered by the database would have to be applied
 * in memory, which cannot page or report a correct total.
 *
 * @public
 */
export type ApprovalRequestFilter =
  | { key: 'requesterRef'; values: string[] }
  | { key: 'templateRef'; values: string[] }
  | { key: 'approverRef'; values: string[] }
  /**
   * Everything the inner filter does not match, which {@link isNotRequester}
   * needs. Negation is a member of the union rather than a flag on each
   * variant, so a `switch` over this type cannot forget to handle it.
   */
  | { not: ApprovalRequestFilter };

/**
 * The resource the approvals permissions act on.
 *
 * @public
 */
export const approvalRequestResourceRef = createPermissionResourceRef<
  ApprovalRequest,
  ApprovalRequestFilter
>().with({
  pluginId: SCAFFOLDER_APPROVALS_PLUGIN_ID,
  resourceType: RESOURCE_TYPE_APPROVAL_REQUEST,
});

/**
 * The caller is named by the request's own gate policy.
 *
 * Matches through groups: pass the caller's ownership refs and the rule matches
 * whichever of them the policy lists. This is the same check the service
 * applies, exposed as a rule so an RBAC policy can build conditions out of it.
 *
 * @public
 */
export const isDesignatedApprover = createPermissionRule({
  resourceRef: approvalRequestResourceRef,
  name: 'IS_DESIGNATED_APPROVER',
  description: "Allow actions by the request's designated approvers",
  paramsSchema: z.object({
    userRefs: z
      .array(z.string())
      .describe("The caller's own entity ref and group refs"),
  }),
  apply: (request: ApprovalRequest, { userRefs }) =>
    isApprover(request.policySnapshot, {
      // `isApprover` needs one ref to treat as the caller; every ref given here
      // is equally the caller, so the first stands in and the rest come through
      // as ownership.
      userEntityRef: userRefs[0] ?? '',
      ownershipEntityRefs: userRefs,
    }),
  toQuery: ({ userRefs }) => ({
    key: 'approverRef',
    values: normaliseEntityRefs(userRefs),
  }),
});

/**
 * The caller did not submit the request.
 *
 * The four-eyes control, as a rule. Note that a gate may set
 * `selfApprove: true`, in which case a policy should not apply this — the
 * service honours the gate's own setting, and this rule exists for deployments
 * that want to forbid self-approval regardless of what a template asks for.
 *
 * @public
 */
export const isNotRequester = createPermissionRule({
  resourceRef: approvalRequestResourceRef,
  name: 'IS_NOT_REQUESTER',
  description: 'Deny actions by the requester themselves',
  paramsSchema: z.object({
    userRef: z.string().describe("The caller's own entity ref"),
  }),
  apply: (request: ApprovalRequest, { userRef }) =>
    // An unparseable ref on either side must not accidentally satisfy "is not
    // the requester", so fail closed.
    tryNormaliseEntityRef(userRef) !== undefined &&
    tryNormaliseEntityRef(request.requesterRef) !== undefined &&
    !isSameEntityRef(userRef, request.requesterRef),
  /** Everything that is *not* the caller's own. */
  toQuery: ({ userRef }) => {
    const caller = tryNormaliseEntityRef(userRef);
    if (!caller) {
      // `apply` fails closed on a ref that will not parse, and so must this.
      // `not` over an empty set would match *everything*, which is the same
      // inversion by another route; an empty positive set matches nothing.
      return { key: 'requesterRef', values: [] };
    }
    return { not: { key: 'requesterRef', values: [caller] } };
  },
});

/**
 * The request is for one of the named templates.
 *
 * Lets a policy scope a rule to particular templates — "anyone in
 * platform-admins may decide on the production access templates".
 *
 * @public
 */
export const hasTemplateRef = createPermissionRule({
  resourceRef: approvalRequestResourceRef,
  name: 'HAS_TEMPLATE_REF',
  description: 'Allow actions on requests for the named templates',
  paramsSchema: z.object({
    templateRefs: z
      .array(z.string())
      .describe('Entity refs of the templates this applies to'),
  }),
  apply: (request: ApprovalRequest, { templateRefs }) =>
    templateRefs.some(ref => isSameEntityRef(ref, request.templateRef)),
  toQuery: ({ templateRefs }) => ({
    key: 'templateRef',
    values: normaliseEntityRefs(templateRefs),
  }),
});

/**
 * Every rule this plugin registers.
 *
 * @public
 */
export const scaffolderApprovalsPermissionRules = [
  isDesignatedApprover,
  isNotRequester,
  hasTemplateRef,
] as const;
