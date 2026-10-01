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

import { parseEntityRef, stringifyEntityRef } from '@backstage/catalog-model';

/**
 * Put an entity ref into the one spelling this plugin compares.
 *
 * Refs are case-insensitive and the namespace is optional, so `Group:DevX` and
 * `group:default/devx` denote the same group. Approver refs come from a
 * template author's YAML while the refs they are matched against come from the
 * catalog, and the two are spelled differently often enough that comparing them
 * as written would silently lock an approver out of their own gate.
 *
 * Throws if the input is not a parseable ref.
 *
 * @public
 */
export function normaliseEntityRef(ref: string): string {
  return stringifyEntityRef(
    parseEntityRef(ref.trim(), { defaultNamespace: 'default' }),
  );
}
