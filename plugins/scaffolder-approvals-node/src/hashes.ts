import { createHash } from 'node:crypto';
import { canonicalJson } from '@ferin79/backstage-plugin-scaffolder-approvals-common';
import type { JsonObject } from '@backstage/types';

const SHA256_HEX = /^[0-9a-f]{64}$/;

/**
 * Hex-encoded SHA-256 of a UTF-8 string: 64 characters, which the database
 * columns holding these are sized for, so changing the digest needs a
 * migration.
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
