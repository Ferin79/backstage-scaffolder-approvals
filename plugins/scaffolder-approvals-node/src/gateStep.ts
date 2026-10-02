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

// The gate checks moved to `-common`, so the wizard can run the same ones the
// backend does before it offers "Request approval" (B8 in the browser review).
// They were always isomorphic: nothing in them needed Node. Re-exported here
// so every existing import of them from this package keeps working.
export {
  findGateStep,
  GateStepError,
  isGated,
  type GateStepLookup,
} from '@backstage-community/plugin-scaffolder-approvals-common';
