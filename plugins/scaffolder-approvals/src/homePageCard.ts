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
 * The home-page card's parts, loaded on demand, for both plugin entrypoints.
 *
 * The card's own module rather than the components barrel: the barrel also
 * carries the wizard's review step, and with it the scaffolder's form and
 * review code, none of which a home page needs to load.
 *
 * The extensions draw their own card around `Content`, so the way to the
 * approvals page has to be handed over as `Actions`, or the home page has
 * none.
 */
export const loadPendingApprovalsCard = () =>
  import('./components/PendingApprovalsCard').then(m => ({
    Content: m.PendingApprovalsContent,
    Actions: m.PendingApprovalsActions,
  }));
