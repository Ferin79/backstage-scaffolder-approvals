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

import { parameterStanding, parameterTitles } from './templateParameters';

// The shapes the provision-service example uses, cut down.
const PAGES = [
  {
    properties: {
      language: { title: 'Language', enum: ['typescript', 'go'] },
      containerised: { title: 'Run as a container', type: 'boolean' },
      oncall: {
        title: 'On-call',
        properties: { primaryContact: { title: 'Primary contact' } },
      },
      environments: {
        title: 'Environments',
        items: { properties: { url: { title: 'Base URL' } } },
      },
    },
    dependencies: {
      language: {
        oneOf: [
          {
            properties: {
              language: { const: 'typescript' },
              // An `enum` of its own, which must not decide the branch.
              nodeVersion: { title: 'Node.js version', enum: ['20', '22'] },
            },
          },
          {
            properties: {
              language: { const: 'go' },
              goVersion: { title: 'Go version', type: 'string' },
            },
          },
        ],
      },
      containerised: {
        oneOf: [
          {
            properties: {
              containerised: { const: true },
              baseImage: { title: 'Base image' },
            },
          },
          { properties: { containerised: { const: false } } },
        ],
      },
    },
  },
  {
    properties: {
      dataClassification: { enum: ['public', 'restricted'] },
      publish: { type: 'boolean' },
    },
    if: { properties: { dataClassification: { enum: ['restricted'] } } },
    then: { properties: { securityReview: { title: 'Security review' } } },
    dependencies: {
      // The other form of `dependencies`: names, no schema.
      publish: ['dataClassification'],
    },
  },
];

describe('parameterTitles', () => {
  it('finds titles on pages, in conditional branches and inside objects and arrays', () => {
    const titles = parameterTitles(PAGES);
    expect(titles.get('language')).toBe('Language');
    expect(titles.get('nodeVersion')).toBe('Node.js version');
    expect(titles.get('goVersion')).toBe('Go version');
    expect(titles.get('securityReview')).toBe('Security review');
    expect(titles.get('oncall.primaryContact')).toBe('Primary contact');
    expect(titles.get('environments[].url')).toBe('Base URL');
    // A branch repeating `language` only to pin it does not erase its title.
    expect(titles.get('language')).toBe('Language');
  });

  it('tolerates a template with no parameters', () => {
    expect(parameterTitles(undefined).size).toBe(0);
  });
});

describe('parameterStanding', () => {
  const standing = parameterStanding(PAGES);

  it('calls the fields of the branch the answers chose shown', () => {
    const values = { language: 'go', goVersion: '1.24', containerised: true };
    expect(standing(values)('goVersion')).toBe('shown');
    expect(standing(values)('baseImage')).toBe('shown');
    expect(standing(values)('language')).toBe('shown');
  });

  it('calls a value the form kept from another branch hidden', () => {
    // What the browser test found: the TypeScript branch is shown first, so
    // a Go service is submitted with Node.js version 22 as well.
    const values = { language: 'go', goVersion: '1.24', nodeVersion: '22' };
    expect(standing(values)('nodeVersion')).toBe('hidden');
    expect(standing({ containerised: false })('baseImage')).toBe('hidden');
  });

  it('follows if/then on the page', () => {
    expect(
      standing({ dataClassification: 'restricted' })('securityReview'),
    ).toBe('shown');
    expect(standing({ dataClassification: 'public' })('securityReview')).toBe(
      'hidden',
    );
  });

  it('calls what no page mentions undeclared', () => {
    expect(standing({ language: 'go' })('sneaky')).toBe('undeclared');
  });

  it('does not guess when a condition pins nothing', () => {
    const vague = parameterStanding({
      properties: { a: { type: 'string' } },
      if: { properties: { a: { minLength: 3 } } },
      then: { properties: { b: { type: 'string' } } },
      else: { properties: { c: { type: 'string' } } },
    });
    expect(vague({ a: 'x' })('b')).toBe('shown');
    expect(vague({ a: 'xxxx' })('c')).toBe('shown');
  });
});
