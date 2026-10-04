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

import { findSecretParameters } from '@ferin79/backstage-plugin-scaffolder-approvals-common';
import { findGateStep } from '@ferin79/backstage-plugin-scaffolder-approvals-node';
import type { Entity } from '@backstage/catalog-model';
import { readFileSync } from 'fs';
import { parse } from 'yaml';
import { resolve } from 'path';
import { validateValues } from './validateValues';

/**
 * The README's worked example, checked against the code rather than read.
 *
 * D2: the example previously gave its action inputs that did not exist, so
 * copying it produced a template that failed validation. A worked example is
 * the first thing an adopter runs, and a broken one costs more trust than no
 * example at all — so it is extracted from the README and put through the same
 * checks a real submission goes through.
 */
function readmeTemplate(): Entity {
  // The template authors' guide, which holds the worked example.
  const readme = readFileSync(
    resolve(__dirname, '../../../../docs/writing-gated-templates.md'),
    'utf8',
  );
  const start = readme.indexOf('## The smallest gated template');
  expect(start).toBeGreaterThan(-1);

  const open = readme.indexOf('```yaml', start);
  const close = readme.indexOf('```', open + 7);
  return parse(readme.slice(open + 7, close)) as Entity;
}

describe('the README worked example', () => {
  const template = readmeTemplate();

  it('is a gated template with a usable gate', () => {
    // Every shape `findGateStep` refuses, refused here too: an example that
    // the plugin itself would reject is worse than none.
    const { step, index } = findGateStep(template);
    expect(index).toBe(0);
    expect(step?.input?.values).toBe('${{ parameters }}');
  });

  it('declares no secret-typed parameter', () => {
    expect(findSecretParameters((template as any).spec?.parameters)).toEqual(
      [],
    );
  });

  it('accepts the values its own parameters describe', () => {
    expect(() =>
      validateValues(template as any, {
        repository: 'backstage',
        githubUsername: 'octocat',
        justification: 'on-call rotation needs admin to manage webhooks',
      }),
    ).not.toThrow();
  });

  it('rejects values that miss a required parameter', () => {
    // Proves the check above is doing something.
    expect(() =>
      validateValues(template as any, { repository: 'backstage' }),
    ).toThrow();
  });

  it('never reads the user context, which is empty on an approved run', () => {
    // §10.1: the task is launched by the service principal, so
    // `${{ user.* }}` renders empty. The example asks for the GitHub username
    // as a parameter instead, and this is what keeps it that way.
    const steps = JSON.stringify((template as any).spec?.steps);
    expect(steps).not.toMatch(/\{\{[^}]*\buser\s*\./);
  });
});
