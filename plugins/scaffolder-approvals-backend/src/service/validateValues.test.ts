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

import { InputError } from '@backstage/errors';
import type { TemplateEntityV1beta3 } from '@backstage/plugin-scaffolder-common';
import type { JsonObject } from '@backstage/types';
import { validateValues } from './validateValues';

function template(parameters: unknown): TemplateEntityV1beta3 {
  return {
    apiVersion: 'scaffolder.backstage.io/v1beta3',
    kind: 'Template',
    metadata: { name: 'request-github-admin' },
    spec: { type: 'service', steps: [], parameters },
  } as TemplateEntityV1beta3;
}

const SINGLE = template({
  required: ['repository', 'justification'],
  properties: {
    repository: { type: 'string' },
    justification: { type: 'string', minLength: 10 },
    durationDays: { type: 'integer', minimum: 1, maximum: 30 },
  },
});

describe('validateValues', () => {
  it('accepts values that fit the schema', () => {
    expect(() =>
      validateValues(SINGLE, {
        repository: 'backstage',
        justification: 'on-call rotation',
        durationDays: 7,
      }),
    ).not.toThrow();
  });

  it('rejects a missing required field, naming it', () => {
    // The whole reason validation happens at submit (Q3): an approver's time
    // must not be spent on a request that cannot run.
    expect(() => validateValues(SINGLE, { repository: 'backstage' })).toThrow(
      InputError,
    );
    expect(() => validateValues(SINGLE, { repository: 'backstage' })).toThrow(
      /justification/,
    );
  });

  it('rejects a wrong type rather than coercing it', () => {
    // Coercion would change what gets hashed, so the values an approver saw
    // would stop matching the values that run.
    expect(() =>
      validateValues(SINGLE, {
        repository: 'backstage',
        justification: 'on-call rotation',
        durationDays: '7' as unknown as number,
      }),
    ).toThrow(/durationDays/);
  });

  it('enforces constraints, not just types', () => {
    expect(() =>
      validateValues(SINGLE, { repository: 'backstage', justification: 'why' }),
    ).toThrow(/justification/);
    expect(() =>
      validateValues(SINGLE, {
        repository: 'backstage',
        justification: 'on-call rotation',
        durationDays: 99,
      }),
    ).toThrow(/durationDays/);
  });

  it('does nothing when the template declares no parameters', () => {
    expect(() =>
      validateValues(template(undefined), { anything: true }),
    ).not.toThrow();
  });

  it('tolerates the react-jsonschema-form vocabulary', () => {
    // Real scaffolder schemas are also UI descriptions. Ajv's strict mode
    // rejects a schema carrying these keys outright, which would fail every
    // realistic template — so the validator turns strict mode off.
    const withUi = template({
      required: ['repository'],
      properties: {
        repository: {
          type: 'string',
          title: 'Repository',
          'ui:field': 'EntityPicker',
          'ui:options': { allowedKinds: ['Component'] },
        },
        visibility: {
          type: 'string',
          enum: ['public', 'private'],
          enumNames: ['Public', 'Private'],
          'ui:widget': 'radio',
        },
      },
    });

    expect(() =>
      validateValues(withUi, {
        repository: 'backstage',
        visibility: 'private',
      }),
    ).not.toThrow();
    // Still enforced underneath.
    expect(() =>
      validateValues(withUi, { repository: 'backstage', visibility: 'secret' }),
    ).toThrow(/visibility/);
  });

  it('enforces string formats', () => {
    const withFormat = template({
      required: ['contact'],
      properties: { contact: { type: 'string', format: 'email' } },
    });

    expect(() =>
      validateValues(withFormat, { contact: 'dev@example.com' }),
    ).not.toThrow();
    expect(() =>
      validateValues(withFormat, { contact: 'not-an-email' }),
    ).toThrow(/contact/);
  });

  it('validates against every page of a multi-page schema', () => {
    const pages = template([
      {
        title: 'Repository',
        required: ['repository'],
        properties: { repository: { type: 'string' } },
      },
      {
        title: 'Justification',
        required: ['justification'],
        properties: { justification: { type: 'string', minLength: 10 } },
      },
    ]);

    expect(() =>
      validateValues(pages, {
        repository: 'backstage',
        justification: 'on-call rotation',
      }),
    ).not.toThrow();

    // A field missing from the second page must still be caught.
    expect(() => validateValues(pages, { repository: 'backstage' })).toThrow(
      /justification/,
    );
    expect(() =>
      validateValues(pages, { justification: 'on-call rotation' }),
    ).toThrow(/repository/);
  });

  it('does not let one page reject another page fields', () => {
    // Each page only describes its own properties, so applying its
    // `additionalProperties: false` to the whole value object would reject
    // everything the other pages contributed.
    const pages = template([
      {
        title: 'Repository',
        required: ['repository'],
        additionalProperties: false,
        properties: { repository: { type: 'string' } },
      },
      {
        title: 'Justification',
        required: ['justification'],
        additionalProperties: false,
        properties: { justification: { type: 'string' } },
      },
    ]);

    expect(() =>
      validateValues(pages, {
        repository: 'backstage',
        justification: 'on-call',
      }),
    ).not.toThrow();
  });

  it('honours additionalProperties on a single-page schema', () => {
    const strict = template({
      required: ['repository'],
      additionalProperties: false,
      properties: { repository: { type: 'string' } },
    });

    expect(() =>
      validateValues(strict, { repository: 'backstage', admin: true }),
    ).toThrow(/additional properties/i);
  });

  it('accepts properties the schema does not mention, as the scaffolder does', () => {
    // Not rejected, because diverging from the scaffolder here would break
    // templates that pass extra values through. They are still bound by the
    // values hash and shown to approvers, so what an approver sees is what runs.
    expect(() =>
      validateValues(SINGLE, {
        repository: 'backstage',
        justification: 'on-call rotation',
        somethingElse: true,
      }),
    ).not.toThrow();
  });

  it('blames the template, not the caller, for an uncompilable schema', () => {
    const broken = template({
      properties: { repository: { type: 'not-a-json-schema-type' } },
    });

    expect(() =>
      validateValues(broken, { repository: 'backstage' } as JsonObject),
    ).toThrow(/is not valid JSON Schema/);
  });
});
