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
import {
  assertValuesDepth,
  MAX_VALUES_DEPTH,
  readEntityRef,
} from './requestInput';

/** An object `levels` deep, counting the outermost one. */
function nested(levels: number, leaf: unknown = 'x'): unknown {
  let value: unknown = leaf;
  for (let level = 0; level < levels; level++) {
    value = { a: value };
  }
  return value;
}

describe('readEntityRef', () => {
  const asTemplate = { defaultKind: 'template', field: 'templateRef' };

  it.each([
    ['template:default/request-github-admin'],
    ['Template:Default/Request-GitHub-Admin'],
    ['default/request-github-admin'],
    ['request-github-admin'],
    ['  request-github-admin  '],
  ])('reads %j in the stored spelling', raw => {
    expect(readEntityRef(raw, asTemplate)).toBe(
      'template:default/request-github-admin',
    );
  });

  it('defaults to the kind it is given', () => {
    expect(
      readEntityRef('Requester', {
        defaultKind: 'user',
        field: 'requesterRef',
      }),
    ).toBe('user:default/requester');
  });

  it('keeps a kind that was given', () => {
    expect(readEntityRef('group:devx-team', asTemplate)).toBe(
      'group:default/devx-team',
    );
  });

  it.each(['', '   ', 'template:default/', '::::'])(
    'refuses %j as a client error naming the field',
    raw => {
      expect(() => readEntityRef(raw, asTemplate)).toThrow(InputError);
      expect(() => readEntityRef(raw, asTemplate)).toThrow(
        /^Invalid templateRef: /,
      );
    },
  );
});

describe('assertValuesDepth', () => {
  it('accepts flat and shallow values', () => {
    expect(() => assertValuesDepth({})).not.toThrow();
    expect(() =>
      assertValuesDepth({ repository: 'x', tags: ['a'], oncall: { a: 1 } }),
    ).not.toThrow();
  });

  it('accepts values exactly at the limit', () => {
    expect(() => assertValuesDepth(nested(MAX_VALUES_DEPTH))).not.toThrow();
  });

  it('refuses one level past the limit', () => {
    expect(() => assertValuesDepth(nested(MAX_VALUES_DEPTH + 1))).toThrow(
      InputError,
    );
  });

  it('counts arrays as levels too', () => {
    let value: unknown = 'x';
    for (let level = 0; level < MAX_VALUES_DEPTH + 1; level++) {
      value = level % 2 ? [value] : { a: value };
    }
    expect(() => assertValuesDepth(value)).toThrow(/nested more than 64/);
  });

  it('refuses very deep values without overflowing the stack itself', () => {
    expect(() => assertValuesDepth(nested(100_000))).toThrow(InputError);
  });

  it('ignores primitives and null at any position', () => {
    expect(() => assertValuesDepth(null)).not.toThrow();
    expect(() => assertValuesDepth({ a: null, b: 1, c: 'x' })).not.toThrow();
  });
});
