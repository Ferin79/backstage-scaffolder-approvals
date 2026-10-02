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

import { GATE_ACTION_ID } from '@ferin79/backstage-plugin-scaffolder-approvals-common';
import type { Entity } from '@backstage/catalog-model';
import { compareTemplate, computeTemplateStepsHash } from './templateDrift';

const GATE = {
  id: 'gate',
  action: GATE_ACTION_ID,
  input: { approvers: ['group:default/devx-team'] },
};

function template(overrides: {
  uid?: string;
  steps?: unknown[];
  owner?: string;
}): Entity {
  return {
    apiVersion: 'scaffolder.backstage.io/v1beta3',
    kind: 'Template',
    metadata: {
      name: 'request-github-admin',
      ...(overrides.uid ? { uid: overrides.uid } : {}),
    },
    spec: {
      type: 'service',
      ...(overrides.owner ? { owner: overrides.owner } : {}),
      steps: overrides.steps ?? [GATE],
    },
  } as Entity;
}

describe('computeTemplateStepsHash', () => {
  it('is stable across reserialisation', () => {
    // The catalog rebuilds entities, so key order is not something to depend
    // on. Without canonical serialisation this would report drift on every
    // refresh.
    const a = template({ steps: [{ id: 'x', action: 'debug:log', if: 'y' }] });
    const b = template({ steps: [{ if: 'y', action: 'debug:log', id: 'x' }] });

    expect(computeTemplateStepsHash(a)).toBe(computeTemplateStepsHash(b));
  });

  it('changes when a step is added', () => {
    const before = computeTemplateStepsHash(template({}));
    const after = computeTemplateStepsHash(
      template({ steps: [GATE, { id: 'extra', action: 'debug:log' }] }),
    );

    expect(after).not.toBe(before);
  });

  it('ignores everything outside the steps', () => {
    // A template gets commits for reasons that have nothing to do with what
    // runs. Warning on those is how a warning stops being read.
    expect(
      computeTemplateStepsHash(template({ owner: 'group:default/a' })),
    ).toBe(computeTemplateStepsHash(template({ owner: 'group:default/b' })));
  });

  it('tolerates a template with no steps at all', () => {
    expect(
      computeTemplateStepsHash({
        apiVersion: 'scaffolder.backstage.io/v1beta3',
        kind: 'Template',
        metadata: { name: 'bare' },
      } as Entity),
    ).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe('compareTemplate', () => {
  const entity = template({ uid: 'uid-1' });
  const submitted = {
    submittedUid: 'uid-1',
    submittedStepsHash: computeTemplateStepsHash(entity),
  };

  it('reports no drift for an untouched template', () => {
    expect(compareTemplate({ template: entity, ...submitted })).toEqual({
      changed: false,
      reasons: [],
    });
  });

  it('reports a template that has left the catalog', () => {
    expect(compareTemplate({ template: undefined, ...submitted })).toEqual({
      changed: true,
      reasons: ['missing'],
    });
  });

  it('reports a template that was deleted and recreated', () => {
    // Same name, new entity. The steps hash alone would miss this if the new
    // template happened to have the same steps.
    expect(
      compareTemplate({ template: template({ uid: 'uid-2' }), ...submitted }),
    ).toEqual({ changed: true, reasons: ['replaced'] });
  });

  it('reports steps edited in place', () => {
    // The uid alone would miss this, which is why both are recorded.
    expect(
      compareTemplate({
        template: template({
          uid: 'uid-1',
          steps: [GATE, { id: 'extra', action: 'debug:log' }],
        }),
        ...submitted,
      }),
    ).toEqual({ changed: true, reasons: ['steps'] });
  });

  it('reports both when both changed', () => {
    expect(
      compareTemplate({
        template: template({ uid: 'uid-2', steps: [] }),
        ...submitted,
      }),
    ).toEqual({ changed: true, reasons: ['replaced', 'steps'] });
  });

  it('says so when there is nothing recorded to compare against', () => {
    // A request submitted before drift was tracked. "Unknown" is not
    // "unchanged", and claiming the latter would mislead an approver.
    expect(compareTemplate({ template: entity })).toEqual({
      changed: false,
      reasons: ['unknown'],
    });
  });
});
