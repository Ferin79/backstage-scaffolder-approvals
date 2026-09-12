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
 * New frontend system entrypoint for the scaffolder-approvals plugin.
 *
 * This package dual-ships: the default export carries the legacy
 * `createPlugin` definition and this entrypoint carries the
 * `createFrontendPlugin` one. Both mount the same components, so only the
 * wiring is duplicated.
 *
 * @packageDocumentation
 */

// Populated in the frontend phase; see GATED_SCAFFOLDER_IMPLEMENTATION.md.
export {};
