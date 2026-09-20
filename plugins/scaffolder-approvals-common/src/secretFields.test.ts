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

import { findSecretParameters } from './secretFields';

describe('findSecretParameters', () => {
  it('finds a secret-typed parameter and says where it is', () => {
    expect(
      findSecretParameters([
        {
          properties: {
            repository: { type: 'string' },
            token: { type: 'string', 'ui:field': 'Secret' },
          },
        },
      ]),
    ).toEqual(['token']);
  });

  it('finds one nested inside an object', () => {
    expect(
      findSecretParameters({
        properties: {
          credentials: {
            type: 'object',
            properties: { password: { 'ui:field': 'Secret' } },
          },
        },
      }),
    ).toEqual(['credentials.password']);
  });

  it('looks inside array items and composed schemas', () => {
    // A template author reaching for `oneOf` is not trying to hide anything,
    // but a check that only walked `properties` would miss it all the same.
    expect(
      findSecretParameters({
        properties: {
          hosts: {
            type: 'array',
            items: { properties: { key: { 'ui:field': 'Secret' } } },
          },
          auth: {
            oneOf: [
              { properties: { anonymous: { type: 'boolean' } } },
              { properties: { token: { 'ui:field': 'Secret' } } },
            ],
          },
        },
      }).sort(),
    ).toEqual(['auth.token', 'hosts.key']);
  });

  it('matches however the field name is cased', () => {
    expect(
      findSecretParameters({ properties: { t: { 'ui:field': 'secret' } } }),
    ).toEqual(['t']);
  });

  it('says nothing about an ordinary template', () => {
    expect(
      findSecretParameters([
        { properties: { repository: { type: 'string' } } },
      ]),
    ).toEqual([]);
  });

  it('leaves a password widget alone', () => {
    // `ui:widget: password` hides the value on screen but still submits it as
    // an ordinary parameter, so it is a different thing. Warning about it
    // would be warning about the wrong risk.
    expect(
      findSecretParameters({
        properties: { p: { type: 'string', 'ui:widget': 'password' } },
      }),
    ).toEqual([]);
  });

  it('tolerates a template with no parameters at all', () => {
    expect(findSecretParameters(undefined)).toEqual([]);
    expect(findSecretParameters([])).toEqual([]);
  });
});
