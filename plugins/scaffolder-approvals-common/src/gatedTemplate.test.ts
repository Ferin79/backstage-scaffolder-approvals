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

import type { Entity } from '@backstage/catalog-model';
import { GATE_ACTION_ID } from './constants';
import { checkGatedTemplate } from './gatedTemplate';

const REF = 'template:default/probe';

function template(
  steps: unknown[],
  parameters: unknown = { properties: { repository: { type: 'string' } } },
): Entity {
  return {
    apiVersion: 'scaffolder.backstage.io/v1beta3',
    kind: 'Template',
    metadata: { name: 'probe' },
    spec: { type: 'service', parameters, steps },
  } as Entity;
}

const gate = (extra: Record<string, unknown> = {}, input = {}) => ({
  id: 'gate',
  action: GATE_ACTION_ID,
  input: {
    approvers: ['group:default/devx-team'],
    quorum: 2,
    values: '${{ parameters }}',
    ...input,
  },
  ...extra,
});

const after = { id: 'after', action: 'debug:log', input: { message: 'x' } };

describe('checkGatedTemplate', () => {
  it('passes an ordinary template through as not gated', () => {
    expect(checkGatedTemplate(template([after]), REF)).toEqual({
      gated: false,
    });
  });

  it('returns the step and the frozen policy for a usable gate', () => {
    const check = checkGatedTemplate(template([gate(), after]), REF);

    expect(check).toMatchObject({
      gated: true,
      usable: true,
      step: { id: 'gate' },
      policy: {
        approvers: ['group:default/devx-team'],
        quorum: 2,
        selfApprove: false,
      },
    });
  });

  // B8 in the browser review: the wizard offered "Request approval" for these,
  // and only the backend said no. These are the backend's own sentences.
  it.each([
    ['an if: on the gate', [gate({ if: '${{ parameters.go }}' }), after]],
    [
      'an each: on the gate',
      [gate({ each: '${{ parameters.items }}' }), after],
    ],
    ['a gate that is not first', [after, gate()]],
    ['a later always() step', [gate(), { ...after, if: '${{ always() }}' }]],
  ])('refuses %s as an unusable gate', (_, steps) => {
    const check = checkGatedTemplate(template(steps), REF);

    expect(check).toMatchObject({ gated: true, usable: false });
    expect(check.gated && !check.usable && check.problem).toMatch(
      /^template:default\/probe has an unusable gate: /,
    );
  });

  // H1 in the second browser review: these were accepted, offered on Create…
  // and approved, then failed at the gate on every run — an approval spent on
  // a request that could never run.
  it.each([
    ['no values input', { values: undefined }, /no 'values' input/],
    [
      'a subset of the parameters',
      { values: { repository: '${{ parameters.repository }}' } },
      /passes something other than/,
    ],
    [
      'one parameter as an expression',
      { values: '${{ parameters.repository }}' },
      /passes something other than/,
    ],
  ])('refuses a gate given %s', (_, input, reason) => {
    const check = checkGatedTemplate(template([gate({}, input), after]), REF);

    expect(check).toMatchObject({ gated: true, usable: false });
    expect(check.gated && !check.usable && check.problem).toMatch(
      /^template:default\/probe has an unusable gate: /,
    );
    expect(check.gated && !check.usable && check.problem).toMatch(reason);
  });

  it('accepts the whole parameters however it is spaced', () => {
    for (const values of ['${{parameters}}', '  ${{   parameters  }} ']) {
      expect(
        checkGatedTemplate(template([gate({}, { values }), after]), REF),
      ).toMatchObject({ gated: true, usable: true });
    }
  });

  it('refuses a secret-typed parameter', () => {
    const check = checkGatedTemplate(
      template([gate(), after], {
        properties: { token: { type: 'string', 'ui:field': 'Secret' } },
      }),
      REF,
    );

    expect(check).toEqual({
      gated: true,
      usable: false,
      problem: expect.stringMatching(
        /^template:default\/probe cannot be gated: its parameter\(s\) token are secret-typed/,
      ),
    });
  });

  it('refuses a policy the backend cannot read', () => {
    const check = checkGatedTemplate(
      template([gate({}, { quorum: 0 }), after]),
      REF,
    );

    expect(check).toEqual({
      gated: true,
      usable: false,
      problem: expect.stringMatching(
        /^template:default\/probe has an unusable gate policy: .*quorum/,
      ),
    });
  });

  it('checks the shape before the parameters, as the backend does', () => {
    // A template wrong in two ways reports the same one at submit and in the
    // wizard.
    const check = checkGatedTemplate(
      template([gate({ if: 'x' }), after], {
        properties: { token: { type: 'string', 'ui:field': 'Secret' } },
      }),
      REF,
    );

    expect(check.gated && !check.usable && check.problem).toMatch(
      /unusable gate: /,
    );
  });
});
