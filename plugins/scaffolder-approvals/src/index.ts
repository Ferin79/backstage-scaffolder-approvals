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
  PendingApprovalsCard,
  Router,
  StatusPill,
} from './components';
export type { GatedReviewStepProps, StatusPillProps } from './components';
