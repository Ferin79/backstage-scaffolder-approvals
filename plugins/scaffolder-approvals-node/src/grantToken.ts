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

import { randomBytes } from 'node:crypto';
import { sha256Hex } from './hashes';

/** 256 bits, which is why a plain indexed lookup on the hash is safe. */
const GRANT_TOKEN_BYTES = 32;

/**
 * Mint a single-use approval grant token.
 *
 * This is bearer credential: whoever holds it can run the approved template
 * once. It is handed to the scaffolder as a task secret and never stored — only
 * {@link hashGrantToken} of it is.
 *
 * @public
 */
export function generateGrantToken(): string {
  // base64url so the token survives being carried as a task secret and through
  // JSON without escaping.
  return randomBytes(GRANT_TOKEN_BYTES).toString('base64url');
}

/**
 * Hash a grant token for storage and lookup.
 *
 * Only the hash is persisted, so a database leak does not yield usable grants.
 *
 * Lookup by hash equality is not constant-time, but the token carries 256 bits
 * of entropy and is single-use, so there is no candidate to distinguish — a
 * timing oracle on an index probe buys an attacker nothing. This is why the
 * token must come from {@link generateGrantToken} and never from user input.
 *
 * @public
 */
export function hashGrantToken(token: string): string {
  return sha256Hex(token);
}

/**
 * The separator between the request id and the token in a formatted grant.
 *
 * A dot, because neither half can contain one: a UUID is hex and hyphens, and
 * base64url has no `.`.
 */
const GRANT_SEPARATOR = '.';

/**
 * Thrown when a grant string is not in the expected form.
 *
 * @public
 */
export class GrantFormatError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'GrantFormatError';
  }
}

/**
 * Bundle a request id and its token into the single string handed to a task.
 *
 * The request id travels with the token because the redeeming end needs it and
 * has no other way to learn it. It cannot ride along as a template *value*: the
 * values hash is computed over exactly what the requester submitted, so adding
 * a field would break the binding the grant exists to enforce. And it cannot be
 * inferred from the token alone without giving up the store's `request_id`
 * guard, which is a real cross-check that a task cannot redeem another
 * request's grant.
 *
 * The id half is not secret — it appears in URLs — so bundling it with the
 * secret half costs nothing and keeps this to one task secret.
 *
 * @public
 */
export function formatGrant(requestId: string, token: string): string {
  if (requestId.includes(GRANT_SEPARATOR)) {
    throw new GrantFormatError('A request id cannot contain a dot');
  }
  return `${requestId}${GRANT_SEPARATOR}${token}`;
}

/**
 * Split a grant back into its request id and token.
 *
 * @public
 */
export function parseGrant(grant: string): {
  requestId: string;
  token: string;
} {
  const separator = grant.indexOf(GRANT_SEPARATOR);
  if (separator <= 0 || separator === grant.length - 1) {
    throw new GrantFormatError('Malformed approval grant');
  }
  return {
    requestId: grant.slice(0, separator),
    token: grant.slice(separator + 1),
  };
}
