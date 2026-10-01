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
  formatGrant,
  generateGrantToken,
  GrantFormatError,
  hashGrantToken,
  parseGrant,
} from './grantToken';
import { isSha256Hex } from './hashes';

describe('generateGrantToken', () => {
  it('is unguessable and unique per call', () => {
    const tokens = new Set(
      Array.from({ length: 500 }, () => generateGrantToken()),
    );
    expect(tokens.size).toBe(500);

    // 32 random bytes, base64url encoded, unpadded.
    for (const token of tokens) {
      expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    }
  });

  it('is safe to carry as a task secret without escaping', () => {
    const token = generateGrantToken();
    expect(JSON.parse(JSON.stringify({ token })).token).toBe(token);
    expect(encodeURIComponent(token)).toBe(token);
  });
});

describe('hashGrantToken', () => {
  it('produces a storable digest that does not reveal the token', () => {
    const token = generateGrantToken();
    const hash = hashGrantToken(token);

    expect(isSha256Hex(hash)).toBe(true);
    expect(hash).not.toContain(token);
    expect(hashGrantToken(token)).toBe(hash);
    expect(hashGrantToken(generateGrantToken())).not.toBe(hash);
  });
});

describe('formatGrant and parseGrant', () => {
  const requestId = '3f1e4c8a-0000-4000-8000-000000000001';

  it('round-trips a request id and token', () => {
    const token = generateGrantToken();
    const grant = formatGrant(requestId, token);

    expect(grant).toBe(`${requestId}.${token}`);
    expect(parseGrant(grant)).toEqual({ requestId, token });
  });

  it('splits on the first dot only, so a token is never truncated', () => {
    // base64url has no dot today, but splitting greedily would be a silent
    // corruption if that ever changed.
    expect(parseGrant('id.a.b.c')).toEqual({ requestId: 'id', token: 'a.b.c' });
  });

  it('rejects a grant with no token or no id', () => {
    expect(() => parseGrant('no-separator')).toThrow(GrantFormatError);
    expect(() => parseGrant('.token-only')).toThrow(/Malformed/);
    expect(() => parseGrant('id-only.')).toThrow(/Malformed/);
    expect(() => parseGrant('')).toThrow(/Malformed/);
  });

  it('refuses to build an ambiguous grant', () => {
    expect(() => formatGrant('has.a.dot', 'token')).toThrow(
      /cannot contain a dot/,
    );
  });
});
