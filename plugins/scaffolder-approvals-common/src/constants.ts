/**
 * The plugin id, used for route and discovery lookups.
 *
 * @public
 */
export const SCAFFOLDER_APPROVALS_PLUGIN_ID = 'scaffolder-approvals';

/**
 * The signals channel the approvals backend broadcasts every change to a
 * request on, as `{ action, requestId, status }`.
 *
 * Defined here because it is a contract between the backend that publishes and
 * the pages that subscribe to refresh themselves; a typo on either side would
 * fail silently, with pages that simply never update.
 *
 * @public
 */
export const APPROVALS_SIGNAL_CHANNEL = SCAFFOLDER_APPROVALS_PLUGIN_ID;

/**
 * The id of the scaffolder action that gates a template.
 *
 * A gated template carries this action as its first step. The action is the
 * enforcement point: it demands a single-use grant that the approvals backend
 * mints only once a request has been approved, and throws without one.
 *
 * @public
 */
export const GATE_ACTION_ID = 'approval:gate';

/**
 * Marks a Template entity as gated.
 *
 * This annotation is *derived*, never authored. A catalog processor stamps it
 * whenever it sees a {@link GATE_ACTION_ID} step in `spec.steps`, which is what
 * keeps it from drifting out of sync with the gate itself. Template authors
 * declare the step and nothing else.
 *
 * @public
 */
export const GATED_ANNOTATION = 'scaffolder-approvals.backstage.io/gated';

/**
 * The task secret carrying the approval grant.
 *
 * The approvals backend passes the grant token to
 * `scaffolderService.scaffold()` under this key. The gate action reads it from
 * `ctx.secrets` and exchanges it with the backend.
 *
 * Secrets are used rather than template values because values are visible to
 * the requester and are echoed back by the scaffolder API, whereas secrets are
 * not returned to callers.
 *
 * @public
 */
export const APPROVAL_GRANT_SECRET = 'APPROVAL_GRANT';

/**
 * The resource type that approval requests are authorized against.
 *
 * @public
 */
export const RESOURCE_TYPE_APPROVAL_REQUEST = 'scaffolder-approval-request';

/**
 * Applied when a gate step does not specify `quorum`.
 *
 * @public
 */
export const DEFAULT_QUORUM = 1;

/**
 * Applied when a gate step does not specify `selfApprove`.
 *
 * Defaults to denying self-approval: a gate whose requester can satisfy it
 * alone is not a four-eyes control, so opting in has to be explicit.
 *
 * @public
 */
export const DEFAULT_SELF_APPROVE = false;
