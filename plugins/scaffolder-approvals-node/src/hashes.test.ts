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

import { CanonicalJsonError } from '@ferin79/backstage-plugin-scaffolder-approvals-common';
import {
  assertSha256Hex,
  computeValuesHash,
  isSha256Hex,
  sha256Hex,
  SHA256_HEX_LENGTH,
} from './hashes';

describe('sha256Hex', () => {
  it('matches the known digest of the empty string', () => {
    // Pinned against a published vector rather than a snapshot, so a change to
    // the algorithm cannot be blessed by regenerating it.
    expect(sha256Hex('')).toBe(
      'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
    );
    expect(sha256Hex('abc')).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    );
  });

  it('produces a digest of the width the database columns are sized for', () => {
    expect(sha256Hex('anything')).toHaveLength(SHA256_HEX_LENGTH);
  });

  it('hashes bytes, not code units', () => {
    // If the encoding were wrong these would collide or throw; utf8 is explicit
    // in the implementation because the default has changed before.
    expect(sha256Hex('é')).not.toBe(sha256Hex('e'));
    expect(sha256Hex('é')).toBe(
      '4a99557e4033c3539de2eb65472017cad5f9557f7a0625a09f1c3f6e2ba69c4c',
    );
  });
});

describe('isSha256Hex', () => {
  it('accepts a lowercase digest and rejects everything else', () => {
    expect(isSha256Hex(sha256Hex('x'))).toBe(true);

    expect(isSha256Hex('a'.repeat(63))).toBe(false);
    expect(isSha256Hex('a'.repeat(65))).toBe(false);
    // Uppercase is rejected rather than normalised: two spellings of one digest
    // would not compare equal in SQL, so only one form may ever be stored.
    expect(isSha256Hex('A'.repeat(64))).toBe(false);
    expect(isSha256Hex('g'.repeat(64))).toBe(false);
    expect(isSha256Hex(undefined)).toBe(false);
    expect(isSha256Hex(null)).toBe(false);
    expect(isSha256Hex(123)).toBe(false);
  });
});

describe('assertSha256Hex', () => {
  it('returns the digest, or throws naming the field', () => {
    const digest = sha256Hex('x');
    expect(assertSha256Hex(digest, 'tokenHash')).toBe(digest);

    // The failure this guards against: handing the store a raw grant token
    // where a hash belongs would otherwise persist the token in plaintext.
    expect(() => assertSha256Hex('Zm9vYmFy', 'tokenHash')).toThrow(
      /tokenHash must be a lowercase hex SHA-256 digest/,
    );
  });
});

describe('computeValuesHash', () => {
  it('ignores key order, so the same parameters always agree', () => {
    expect(computeValuesHash({ a: 1, b: { c: 2, d: 3 } })).toBe(
      computeValuesHash({ b: { d: 3, c: 2 }, a: 1 }),
    );
  });

  it('distinguishes values that differ, including by type', () => {
    expect(computeValuesHash({ admin: true })).not.toBe(
      computeValuesHash({ admin: false }),
    );
    // '1' and 1 must not share a hash; a gate approved for a string must not be
    // satisfied by the number.
    expect(computeValuesHash({ n: 1 })).not.toBe(
      computeValuesHash({ n: '1' as unknown as number }),
    );
    expect(computeValuesHash({})).not.toBe(computeValuesHash({ a: 1 }));
  });

  it('propagates canonicalisation failures instead of hashing a coerced value', () => {
    expect(() => computeValuesHash({ n: NaN })).toThrow(CanonicalJsonError);
  });
});
