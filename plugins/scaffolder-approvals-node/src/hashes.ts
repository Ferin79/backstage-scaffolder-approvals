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

import { createHash } from 'node:crypto';
import { canonicalJson } from '@backstage-community/plugin-scaffolder-approvals-common';
import type { JsonObject } from '@backstage/types';

/**
 * The width of a hex-encoded SHA-256 digest.
 *
 * The database columns holding these are sized to match, so changing the digest
 * would need a migration.
 *
 * @public
 */
export const SHA256_HEX_LENGTH = 64;

const SHA256_HEX = /^[0-9a-f]{64}$/;

/**
 * Hex-encoded SHA-256 of a UTF-8 string.
 *
 * @public
 */
export function sha256Hex(input: string): string {
  return createHash('sha256').update(input, 'utf8').digest('hex');
}

/**
 * Whether a value is a lowercase hex SHA-256 digest.
 *
 * @public
 */
export function isSha256Hex(value: unknown): value is string {
  return typeof value === 'string' && SHA256_HEX.test(value);
}

/**
 * Assert that a value is a hex SHA-256 digest, naming the field if it is not.
 *
 * Used on the way into the store. Both hashes it persists are security
 * bindings, and the failure mode without this check is silent: passing a raw
 * grant token where a hash is expected would store the token in plaintext and
 * still appear to work.
 *
 * @public
 */
export function assertSha256Hex(value: unknown, field: string): string {
  if (!isSha256Hex(value)) {
    throw new TypeError(`${field} must be a lowercase hex SHA-256 digest`);
  }
  return value;
}

/**
 * Hash template parameters so a grant can be bound to exactly what was
 * approved.
 *
 * Canonical serialisation makes this independent of key order, so the same
 * parameters submitted twice always agree. The gate action recomputes this from
 * the running task and refuses on mismatch, which is what stops "approved for
 * X, executed as Y".
 *
 * Throws `CanonicalJsonError` if the values cannot be canonically serialised.
 *
 * @public
 */
export function computeValuesHash(values: JsonObject): string {
  return sha256Hex(canonicalJson(values));
}
