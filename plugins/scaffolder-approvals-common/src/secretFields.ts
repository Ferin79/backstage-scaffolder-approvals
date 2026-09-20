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
 * The scaffolder field that keeps a value out of the task's parameters.
 *
 * A `ui:field: Secret` parameter is not submitted as a value at all: the
 * wizard puts it into the task's `secrets`, which the API never returns. That
 * is the whole point of it.
 */
const SECRET_FIELD = 'secret';

/** Where a secret-typed parameter was found, as a dotted path. */
function walk(schema: unknown, path: string[], found: string[]): void {
  if (typeof schema !== 'object' || schema === null || Array.isArray(schema)) {
    return;
  }

  const node = schema as Record<string, unknown>;

  const field = node['ui:field'];
  if (
    typeof field === 'string' &&
    field.toLocaleLowerCase('en-US') === SECRET_FIELD
  ) {
    found.push(path.join('.') || '(root)');
  }

  // `ui:widget: password` hides the value on screen but still submits it as a
  // parameter, so it is not the same thing and is deliberately not matched
  // here. Warning about it would be warning about the wrong risk.

  const properties = node.properties;
  if (typeof properties === 'object' && properties !== null) {
    for (const [name, child] of Object.entries(
      properties as Record<string, unknown>,
    )) {
      walk(child, [...path, name], found);
    }
  }

  for (const key of ['items', 'then', 'else', 'not']) {
    walk(node[key], path, found);
  }

  for (const key of ['allOf', 'anyOf', 'oneOf']) {
    const branches = node[key];
    if (Array.isArray(branches)) {
      for (const branch of branches) {
        walk(branch, path, found);
      }
    }
  }
}

/**
 * Parameters a gated template must not declare, and where they are.
 *
 * A gated template cannot carry secret-typed parameters, and the reason is not
 * that they would leak — it is that they would not arrive at all. The
 * scaffolder puts a `ui:field: Secret` value into the task's `secrets`, which
 * are never returned by the API and are not part of `values`. An approval
 * request is submitted days before the task exists, so there is nothing to
 * carry the secret across the wait: the request would be approved and the
 * template would run without it.
 *
 * There is a disclosure risk too, and it is the sharper one. If such a value
 * *were* submitted as an ordinary parameter, it would be stored in
 * `approval_requests.values` and every signed-in user can read every request
 * (Q12) — so a password typed into a gated template would be published to the
 * whole organisation until the retention sweep redacted it months later.
 *
 * Returns the paths of any such parameters, empty when there are none.
 *
 * @public
 */
export function findSecretParameters(parameters: unknown): string[] {
  const pages = Array.isArray(parameters) ? parameters : [parameters];
  const found: string[] = [];
  for (const page of pages) {
    walk(page, [], found);
  }
  return [...new Set(found)];
}
