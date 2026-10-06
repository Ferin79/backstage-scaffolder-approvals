/**
 * Frontend for the scaffolder-approvals plugin: the approvals inbox, your own
 * requests, and one request in detail.
 *
 * @packageDocumentation
 */

export {
  scaffolderApprovalsPlugin,
  ApprovalsIndexPage,
  PendingApprovalsHomePageCard,
} from './plugin';
export { approvalsApiRef, ApprovalsClient } from './api';
export type { ApprovalsApi } from './api';
export { rootRouteRef, requestRouteRef } from './routes';
// `Router` is exported because `ApprovalsIndexPage`'s inferred type refers to
// it, and because an app that wants to mount the page itself can.
export {
  GatedReviewStep,
  GatedTemplateCard,
  PendingApprovalsCard,
  Router,
  StatusPill,
} from './components';
export type {
  GatedReviewStepProps,
  GatedTemplateCardProps,
  StatusPillProps,
} from './components';
