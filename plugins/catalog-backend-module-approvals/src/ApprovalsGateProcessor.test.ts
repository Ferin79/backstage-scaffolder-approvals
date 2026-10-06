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

import {
  GATE_ACTION_ID,
  GATED_ANNOTATION,
} from '@ferin79/backstage-plugin-scaffolder-approvals-common';
import { mockServices } from '@backstage/backend-test-utils';
import type { Entity } from '@backstage/catalog-model';
import type {
  CatalogProcessorCache,
  LocationSpec,
} from '@backstage/plugin-catalog-node';
import { ApprovalsGateProcessor } from './ApprovalsGateProcessor';

const LOCATION: LocationSpec = { type: 'url', target: 'https://x/t.yaml' };

/** The per-entity cache the catalog hands every processor. */
function memoryCache(store = new Map<string, unknown>()) {
  return {
    store,
    get: async <T>(key: string) => store.get(key) as T | undefined,
    set: async (key: string, value: unknown) => void store.set(key, value),
  } as CatalogProcessorCache & { store: Map<string, unknown> };
}

const GATE = {
  id: 'gate',
  action: GATE_ACTION_ID,
  input: {
    approvers: ['group:default/devx-team'],
    values: '${{ parameters }}',
  },
};

const PUBLISH = { id: 'publish', action: 'publish:github' };

function template(
  steps: unknown[],
  annotations?: Record<string, string>,
): Entity {
  return {
    apiVersion: 'scaffolder.backstage.io/v1beta3',
    kind: 'Template',
    metadata: {
      name: 'request-github-admin',
      ...(annotations ? { annotations } : {}),
    },
    spec: { type: 'service', steps },
  } as Entity;
}

describe('ApprovalsGateProcessor', () => {
  let logger: ReturnType<typeof mockServices.logger.mock>;
  let processor: ApprovalsGateProcessor;
  let cache: ReturnType<typeof memoryCache>;

  /** One processing cycle, sharing this test's cache as the catalog would. */
  const run = (entity: Entity) =>
    processor.preProcessEntity(entity, LOCATION, () => {}, LOCATION, cache);

  beforeEach(() => {
    logger = mockServices.logger.mock();
    processor = new ApprovalsGateProcessor(logger);
    cache = memoryCache();
  });

  it('names itself', () => {
    expect(processor.getProcessorName()).toBe('ApprovalsGateProcessor');
  });

  describe('deriving the annotation', () => {
    it('stamps a gated template', async () => {
      const result = await run(template([GATE, PUBLISH]));

      expect(result.metadata.annotations).toEqual({
        [GATED_ANNOTATION]: 'true',
      });
    });

    it('keeps the annotations the template already had', async () => {
      const result = await run(
        template([GATE], { 'backstage.io/source-location': 'url:https://x' }),
      );

      expect(result.metadata.annotations).toEqual({
        'backstage.io/source-location': 'url:https://x',
        [GATED_ANNOTATION]: 'true',
      });
    });

    it('returns an ungated template untouched', async () => {
      const entity = template([PUBLISH]);
      const result = await run(entity);

      // The very same object, not merely an equal one: the catalog re-processes
      // every entity on each refresh, and rebuilding it would be pure churn.
      expect(result).toBe(entity);
    });

    it('leaves a non-Template kind alone', async () => {
      const component = {
        apiVersion: 'backstage.io/v1alpha1',
        kind: 'Component',
        metadata: { name: 'svc' },
        // Even one that somehow carries a gate step.
        spec: { steps: [GATE] },
      } as Entity;

      expect(await run(component)).toBe(component);
    });

    it('is idempotent across refresh cycles', async () => {
      const first = await run(template([GATE]));
      const second = await run(first);

      expect(second).toBe(first);
      expect(second).toEqual(first);
    });

    it('strips a hand-written annotation from a template with no gate', async () => {
      // The mismatch that matters: annotated but ungated would send people
      // through an approval flow for something they can simply run. Deriving
      // the annotation only works if the processor owns it in both directions.
      const result = await run(
        template([PUBLISH], { [GATED_ANNOTATION]: 'true' }),
      );

      expect(result.metadata.annotations).toEqual({});
      expect(logger.info).toHaveBeenCalledWith(
        expect.stringMatching(/Removing a .* annotation/),
      );
    });

    it('leaves other annotations in place when stripping', async () => {
      const result = await run(
        template([PUBLISH], {
          [GATED_ANNOTATION]: 'true',
          'backstage.io/source-location': 'url:https://x',
        }),
      );

      expect(result.metadata.annotations).toEqual({
        'backstage.io/source-location': 'url:https://x',
      });
    });

    it('corrects an annotation that says the wrong thing', async () => {
      const result = await run(
        template([GATE], { [GATED_ANNOTATION]: 'false' }),
      );

      expect(result.metadata.annotations?.[GATED_ANNOTATION]).toBe('true');
    });

    it('treats a malformed gate as gated', async () => {
      // A template trying to be gated and failing must not read as freely
      // runnable, so the annotation follows the presence of the step rather
      // than its validity.
      const lateGate = await run(template([PUBLISH, GATE]));
      expect(lateGate.metadata.annotations?.[GATED_ANNOTATION]).toBe('true');

      const twoGates = await run(template([GATE, GATE]));
      expect(twoGates.metadata.annotations?.[GATED_ANNOTATION]).toBe('true');
    });

    it('survives a template with no spec or malformed steps', async () => {
      const bare = {
        apiVersion: 'scaffolder.backstage.io/v1beta3',
        kind: 'Template',
        metadata: { name: 'bare' },
      } as Entity;

      expect(await run(bare)).toBe(bare);
      await expect(
        run(template([null, undefined] as unknown[])),
      ).resolves.toBeDefined();
    });
  });

  describe('warning about gates that will bite later', () => {
    it('never blocks ingestion, whatever is wrong', async () => {
      // An error that kept a template out of the catalog would make deleting
      // the gate the way to make it appear again — the wrong incentive for the
      // one step that enforces anything.
      for (const steps of [
        [PUBLISH, GATE],
        [GATE, GATE],
        [{ id: 'gate', action: GATE_ACTION_ID, input: {} }],
      ]) {
        const result = await run(template(steps));
        expect(result.metadata.annotations?.[GATED_ANNOTATION]).toBe('true');
      }
      expect(logger.warn).toHaveBeenCalled();
    });

    it('warns about a gate that is not the first step', async () => {
      await run(template([PUBLISH, GATE]));

      expect(logger.warn).toHaveBeenCalledWith(
        expect.stringMatching(/unusable gate.*must be the first step/),
      );
    });

    it('warns about more than one gate', async () => {
      await run(template([GATE, GATE]));

      expect(logger.warn).toHaveBeenCalledWith(
        expect.stringMatching(/unusable gate.*exactly one is allowed/),
      );
    });

    it('warns when the gate does not pass the parameters', async () => {
      // Without `values`, the gate cannot check the run against what was
      // approved, so the action refuses every run. Saying so at ingestion beats
      // finding out when somebody finally uses the template.
      await run(
        template([
          { id: 'gate', action: GATE_ACTION_ID, input: { approvers: ['g'] } },
        ]),
      );

      expect(logger.warn).toHaveBeenCalledWith(
        expect.stringMatching(/no 'values' input/),
      );
    });

    it('says nothing about a well-formed gate', async () => {
      await run(template([GATE, PUBLISH]));
      expect(logger.warn).not.toHaveBeenCalled();
    });

    it('warns when a later step depends on the requester OAuth token', async () => {
      // The token belongs to whoever submitted the request and will be
      // dead by the time a multi-day approval completes.
      await run(
        template([
          GATE,
          {
            id: 'publish',
            action: 'publish:github',
            input: { token: '${{ secrets.USER_OAUTH_TOKEN }}' },
          },
        ]),
      );

      expect(logger.warn).toHaveBeenCalledWith(
        expect.stringMatching(/USER_OAUTH_TOKEN.*will have expired/s),
      );
    });

    it('warns about an `if:` or an `each:` on the gate', async () => {
      // Both let a direct run past the gate: a falsy condition skips the step,
      // and a loop over an empty list runs it zero times.
      await run(template([{ ...GATE, if: '${{ parameters.gate }}' }, PUBLISH]));
      expect(logger.warn).toHaveBeenCalledWith(
        expect.stringMatching(/unusable gate.*must not carry an 'if:'/),
      );

      await run(
        template([{ ...GATE, each: '${{ parameters.items }}' }, PUBLISH]),
      );
      expect(logger.warn).toHaveBeenCalledWith(
        expect.stringMatching(/unusable gate.*must not carry an 'each:'/),
      );
    });

    it('warns about a later step that runs after a failure', async () => {
      await run(template([GATE, { ...PUBLISH, if: '${{ always() }}' }]));

      expect(logger.warn).toHaveBeenCalledWith(
        expect.stringMatching(/run even after an earlier step fails/),
      );
    });

    it('warns about a later step tagged where the gate is not', async () => {
      await run(
        template([
          GATE,
          { ...PUBLISH, 'backstage:permissions': { tags: ['admin'] } },
        ]),
      );

      expect(logger.warn).toHaveBeenCalledWith(
        expect.stringMatching(/missing the 'backstage:permissions.tags'/),
      );
    });

    it('warns about a policy that could never be satisfied', async () => {
      // gatePolicy.ts promises a template that ingests cleanly cannot then
      // fail at submit, which only holds if the policy is read here too.
      await run(template([{ ...GATE, input: { ...GATE.input, quorum: 0 } }]));
      expect(logger.warn).toHaveBeenCalledWith(
        expect.stringMatching(/unusable gate policy.*quorum/),
      );

      await run(
        template([
          { ...GATE, input: { ...GATE.input, approvers: ['component:x/y'] } },
        ]),
      );
      expect(logger.warn).toHaveBeenCalledWith(
        expect.stringMatching(/unusable gate policy.*group or user ref/),
      );
    });

    it('warns when the gate is handed less than the whole parameters', async () => {
      // The gate hashes what it is handed, so a subset never matches what was
      // approved and every run is refused.
      await run(
        template([
          {
            ...GATE,
            input: {
              ...GATE.input,
              values: { repository: '${{ parameters.repository }}' },
            },
          },
        ]),
      );

      expect(logger.warn).toHaveBeenCalledWith(
        expect.stringMatching(/passes something other than/),
      );
    });

    it('warns when a later step reads the user context', async () => {
      // An approved run launches as a service principal, so there is no
      // user on the task and the reference renders empty.
      await run(
        template([
          GATE,
          {
            id: 'grant',
            action: 'github:repo:collaborator:add',
            input: { username: '${{ user.entity.metadata.name }}' },
          },
        ]),
      );

      expect(logger.warn).toHaveBeenCalledWith(
        expect.stringMatching(/render empty/),
      );
    });

    it('warns about a secret-typed parameter', async () => {
      // The backend refuses these at submit, so saying so here is the
      // difference between an author finding out now and a requester finding
      // out when they try to use the template.
      const entity = {
        apiVersion: 'scaffolder.backstage.io/v1beta3',
        kind: 'Template',
        metadata: { name: 'request-github-admin' },
        spec: {
          type: 'service',
          parameters: [
            {
              properties: { token: { type: 'string', 'ui:field': 'Secret' } },
            },
          ],
          steps: [GATE, PUBLISH],
        },
      } as Entity;

      await run(entity);

      expect(logger.warn).toHaveBeenCalledWith(
        expect.stringMatching(/secret-typed/),
      );
    });

    it('says each thing once, not on every refresh cycle', async () => {
      // The catalog re-processes every entity on every cycle; a repeated
      // warning becomes a permanent stream that nobody reads.
      const entity = template([PUBLISH, GATE]);
      for (let cycle = 0; cycle < 3; cycle++) {
        await run(entity);
      }

      expect(logger.warn).toHaveBeenCalledTimes(1);
    });

    it('keeps what it has said in the processor cache', async () => {
      await run(template([PUBLISH, GATE]));

      expect(cache.store.size).toBe(1);
    });

    it('does not warn about user tokens on an ungated template', async () => {
      // Nothing waits, so nothing expires.
      await run(
        template([
          {
            id: 'publish',
            action: 'publish:github',
            input: { token: '${{ secrets.USER_OAUTH_TOKEN }}' },
          },
        ]),
      );

      expect(logger.warn).not.toHaveBeenCalled();
    });
  });
});
