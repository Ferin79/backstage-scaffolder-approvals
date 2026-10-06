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

  it('finds one that only appears when another field has a value', () => {
    // How Backstage templates make a field conditional. The probe template in
    // the browser test was offered for approval: the run would have had a
    // mask of asterisks, the length of the token, where the token should be.
    expect(
      findSecretParameters([
        {
          properties: {
            repository: { type: 'string' },
            useToken: { type: 'boolean' },
          },
          dependencies: {
            // The other form of `dependencies`, which names properties and
            // holds no schema, must not trip the walk.
            repository: ['useToken'],
            useToken: {
              oneOf: [
                {
                  properties: {
                    useToken: { const: true },
                    token: { type: 'string', 'ui:field': 'Secret' },
                  },
                },
                { properties: { useToken: { const: false } } },
              ],
            },
          },
        },
      ]),
    ).toEqual(['token']);
  });

  it('finds one under a root-level if/then and the 2019-09 keyword', () => {
    expect(
      findSecretParameters({
        if: { properties: { kind: { const: 'private' } } },
        then: { properties: { key: { 'ui:field': 'Secret' } } },
        dependentSchemas: {
          mode: { properties: { pin: { 'ui:field': 'Secret' } } },
        },
      }).sort(),
    ).toEqual(['key', 'pin']);
  });

  it('finds one in a free-form map, a tuple or a shared definition', () => {
    expect(
      findSecretParameters({
        properties: {
          headers: {
            type: 'object',
            additionalProperties: { 'ui:field': 'Secret' },
          },
          env: {
            type: 'object',
            patternProperties: { '^[A-Z_]+$': { 'ui:field': 'Secret' } },
          },
          pair: {
            type: 'array',
            prefixItems: [{ type: 'string' }, { 'ui:field': 'Secret' }],
          },
          login: { $ref: '#/$defs/credentials' },
        },
        $defs: {
          credentials: { properties: { password: { 'ui:field': 'Secret' } } },
        },
      }).sort(),
    ).toEqual([
      '$defs.credentials.password',
      'env.^[A-Z_]+$',
      'headers.*',
      'pair',
    ]);
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
