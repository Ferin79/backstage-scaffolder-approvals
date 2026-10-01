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

import type { JsonObject, JsonValue } from '@backstage/types';

/** `${{ parameters.some.path }}`, with any amount of surrounding space. */
const PARAMETER_EXPRESSION = /\$\{\{\s*parameters\.([A-Za-z0-9_$.]+)\s*\}\}/g;

function lookup(values: JsonObject, path: string): JsonValue | undefined {
  let current: JsonValue | undefined = values;
  for (const segment of path.split('.')) {
    if (
      typeof current !== 'object' ||
      current === null ||
      Array.isArray(current)
    ) {
      return undefined;
    }
    current = (current as JsonObject)[segment];
  }
  return current;
}

/**
 * Fill a gate summary's `${{ parameters.x }}` references from the submitted
 * values.
 *
 * A gate's `summary` is the one line an approver reads to decide, and template
 * authors naturally write it with parameter references. Those references are
 * *not* rendered by the time this plugin sees them: the approvals backend reads
 * the gate step straight from the catalog entity, and the scaffolder's
 * templating only runs when a task executes — which, for a gated template, is
 * after the approval it was supposed to inform. Without this, approvers would
 * be shown the literal `${{ parameters.repository }}`.
 *
 * Deliberately **not** a templating engine. It resolves `parameters.<path>` and
 * nothing else: no filters, no conditionals, no expressions. Two reasons —
 * running a real engine over catalog-authored text with user-supplied values is
 * a much larger surface than a human-readable label justifies, and a partial
 * imitation of nunjucks would invite people to expect the rest of it.
 *
 * An expression that cannot be resolved is left exactly as written, so a
 * template author sees what they typed rather than a silent blank.
 *
 * @public
 */
export function renderGateSummary(summary: string, values: JsonObject): string {
  return summary.replace(PARAMETER_EXPRESSION, (whole, path: string) => {
    const value = lookup(values, path);

    if (value === undefined || value === null) {
      return whole;
    }
    if (typeof value === 'string') {
      return value;
    }
    if (typeof value === 'number' || typeof value === 'boolean') {
      return String(value);
    }
    // An object or array in a one-line label helps nobody; leaving the
    // expression at least says which parameter was meant.
    return whole;
  });
}
