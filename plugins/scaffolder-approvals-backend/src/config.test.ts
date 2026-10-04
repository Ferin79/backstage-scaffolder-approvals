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

import { ConfigReader } from '@backstage/config';
import { durationToMilliseconds, type JsonValue } from '@backstage/types';
import {
  DEFAULT_GRANT_TTL,
  DEFAULT_RETENTION,
  readApprovalsConfig,
} from './config';

function read(scaffolderApprovals: JsonValue) {
  return readApprovalsConfig(new ConfigReader({ scaffolderApprovals }));
}

const HOUR = 60 * 60 * 1000;

describe('readApprovalsConfig', () => {
  it('applies the defaults when nothing is configured', () => {
    expect(readApprovalsConfig(new ConfigReader({}))).toEqual({
      grantTtl: DEFAULT_GRANT_TTL,
      retention: DEFAULT_RETENTION,
      grantConsumers: undefined,
    });
  });

  it('reads durations as objects or as strings', () => {
    const config = read({
      grantTtl: '2h',
      retention: { redactAfter: 'P90D' },
      grantConsumers: ['plugin:scaffolder', 'plugin:other'],
    });

    expect(durationToMilliseconds(config.grantTtl)).toBe(2 * HOUR);
    expect(durationToMilliseconds(config.retention)).toBe(90 * 24 * HOUR);
    expect(config.grantConsumers).toEqual([
      'plugin:scaffolder',
      'plugin:other',
    ]);

    expect(read({ grantTtl: { minutes: 30 } }).grantTtl).toEqual({
      minutes: 30,
    });
  });

  // H2 in the second browser review: each of these used to be read as zero,
  // which stopped every launch without a word in the log.
  it.each([
    [
      'a misspelt unit',
      { hour: 1 },
      /scaffolderApprovals\.grantTtl.*Needs one or more of .*'hours'/,
    ],
    [
      'a misspelt unit beside a good one',
      { hours: 1, minute: 5 },
      /Unknown property 'minute'/,
    ],
    ['a bare number', 3600, /scaffolderApprovals\.grantTtl/],
    ['a string with no unit', '3600', /cannot be a plain number/],
    ['zero', { hours: 0 }, /must be longer than zero/],
  ])('refuses a grant TTL given as %s', (_, grantTtl, message) => {
    expect(() => read({ grantTtl })).toThrow(message);
  });

  it('refuses a zero retention window, which would redact everything at once', () => {
    expect(() => read({ retention: { redactAfter: { days: 0 } } })).toThrow(
      /scaffolderApprovals\.retention\.redactAfter.*must be longer than zero.*Redaction cannot be switched off/,
    );
  });

  it('refuses a retention window with a misspelt unit', () => {
    expect(() => read({ retention: { redactAfter: { day: 180 } } })).toThrow(
      /scaffolderApprovals\.retention\.redactAfter.*Needs one or more of .*'days'/,
    );
  });
});
