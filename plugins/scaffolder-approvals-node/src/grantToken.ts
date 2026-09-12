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
