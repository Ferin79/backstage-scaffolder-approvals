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

import { GATE_ACTION_ID } from './constants';
import type { Entity } from '@backstage/catalog-model';
import { findGateStep, GateStepError } from './gateStep';

const GATE = {
  id: 'gate',
  action: GATE_ACTION_ID,
  input: { approvers: ['group:default/devx-team'] },
};

const PUBLISH = { id: 'publish', action: 'publish:github' };

function template(steps: unknown[]): Entity {
  return {
    apiVersion: 'scaffolder.backstage.io/v1beta3',
    kind: 'Template',
    metadata: { name: 'request-github-admin' },
    spec: { type: 'service', steps },
  } as Entity;
}

describe('findGateStep', () => {
  it('finds a gate that is the first step, with its input', () => {
    expect(findGateStep(template([GATE, PUBLISH]))).toEqual(GATE);
  });

  it('reports no gate for an ungated template', () => {
    // Not an error: most templates are ungated.
    expect(findGateStep(template([PUBLISH]))).toBeUndefined();
    expect(findGateStep(template([]))).toBeUndefined();
  });

  it('rejects a gate that is not the first step', () => {
    // The dangerous shape: the template looks gated, but everything before the
    // gate runs before anyone has approved.
    expect(() => findGateStep(template([PUBLISH, GATE]))).toThrow(
      GateStepError,
    );
    expect(() => findGateStep(template([PUBLISH, GATE]))).toThrow(
      /must be the first step, but is step 2 of 2/,
    );
  });

  it('rejects more than one gate', () => {
    // Which policy applies would be ambiguous, and the second gate could never
    // be satisfied by a single-use grant.
    expect(() => findGateStep(template([GATE, PUBLISH, GATE]))).toThrow(
      /declares 2 .* steps; exactly one is allowed/,
    );
  });

  it('rejects an `if:` on the gate', () => {
    // The runner skips a step whose condition is falsy, so whoever starts the
    // run would choose whether the gate applied to them.
    expect(() =>
      findGateStep(
        template([{ ...GATE, if: '${{ parameters.gate }}' }, PUBLISH]),
      ),
    ).toThrow(/must not carry an 'if:' condition/);
  });

  it('rejects an `each:` on the gate', () => {
    // An `each:` over an empty list runs the gate zero times and still reports
    // the step as completed.
    expect(() =>
      findGateStep(
        template([{ ...GATE, each: '${{ parameters.items }}' }, PUBLISH]),
      ),
    ).toThrow(/must not carry an 'each:' loop/);
  });

  it('rejects a later step that runs after a failure', () => {
    // The gate throws on an unapproved run, and the runner goes on to execute
    // every failure-aware step after it.
    for (const condition of ['${{ always() }}', '${{ failure() }}']) {
      expect(() =>
        findGateStep(template([GATE, { ...PUBLISH, if: condition }])),
      ).toThrow(/run even after an earlier step fails/);
    }
  });

  it('allows an ordinary condition on a later step', () => {
    expect(
      findGateStep(
        template([GATE, { ...PUBLISH, if: '${{ parameters.publish }}' }]),
      ),
    ).toEqual(GATE);
  });

  it('rejects a later step tagged where the gate is not', () => {
    // Under a `HAS_TAG` step-read policy an untagged gate is dropped from the
    // caller's run while the tagged step survives.
    expect(() =>
      findGateStep(
        template([
          GATE,
          { ...PUBLISH, 'backstage:permissions': { tags: ['admin'] } },
        ]),
      ),
    ).toThrow(/is missing the 'backstage:permissions.tags' value\(s\) 'admin'/);
  });

  it('allows tags a gate also carries', () => {
    expect(
      findGateStep(
        template([
          { ...GATE, 'backstage:permissions': { tags: ['admin', 'extra'] } },
          { ...PUBLISH, 'backstage:permissions': { tags: ['admin'] } },
        ]),
      ),
    ).toBeDefined();
  });

  it('tolerates a template with no spec or malformed steps', () => {
    expect(
      findGateStep({
        apiVersion: 'scaffolder.backstage.io/v1beta3',
        kind: 'Template',
        metadata: { name: 'broken' },
      } as Entity),
    ).toBeUndefined();

    expect(
      findGateStep(template([null, undefined] as unknown[])),
    ).toBeUndefined();
  });
});
