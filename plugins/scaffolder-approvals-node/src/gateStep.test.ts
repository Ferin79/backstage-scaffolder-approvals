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

import { GATE_ACTION_ID } from '@backstage-community/plugin-scaffolder-approvals-common';
import type { Entity } from '@backstage/catalog-model';
import { findGateStep, GateStepError, isGated } from './gateStep';

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
    expect(findGateStep(template([GATE, PUBLISH]))).toEqual({
      step: GATE,
      index: 0,
    });
  });

  it('reports no gate for an ungated template', () => {
    // Not an error: most templates are ungated.
    expect(findGateStep(template([PUBLISH]))).toEqual({});
    expect(findGateStep(template([]))).toEqual({});
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

  it('tolerates a template with no spec or malformed steps', () => {
    expect(
      findGateStep({
        apiVersion: 'scaffolder.backstage.io/v1beta3',
        kind: 'Template',
        metadata: { name: 'broken' },
      } as Entity),
    ).toEqual({});

    expect(findGateStep(template([null, undefined] as unknown[]))).toEqual({});
  });
});

describe('isGated', () => {
  it('is true for a template carrying the gate action', () => {
    expect(isGated(template([GATE, PUBLISH]))).toBe(true);
  });

  it('is true even for a malformed gate', () => {
    // A template trying to be gated and failing must not read as freely
    // runnable, so `isGated` is deliberately more permissive than
    // `findGateStep`. This is what the catalog processor stamps its annotation
    // from, so an operator can still see that the template intends a gate.
    expect(isGated(template([PUBLISH, GATE]))).toBe(true);
    expect(isGated(template([GATE, GATE]))).toBe(true);
  });

  it('is false for an ungated template and for other kinds', () => {
    expect(isGated(template([PUBLISH]))).toBe(false);
    expect(
      isGated({
        apiVersion: 'backstage.io/v1alpha1',
        kind: 'Component',
        metadata: { name: 'svc' },
        spec: { steps: [GATE] },
      } as Entity),
    ).toBe(false);
  });
});
