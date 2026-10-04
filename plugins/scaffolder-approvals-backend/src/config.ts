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

import { type Config, readDurationFromConfig } from '@backstage/config';
import { durationToMilliseconds, type HumanDuration } from '@backstage/types';

/** Applied when `scaffolderApprovals.grantTtl` is not configured (Q7). */
export const DEFAULT_GRANT_TTL: HumanDuration = { hours: 1 };

/** Applied when `scaffolderApprovals.retention.redactAfter` is absent (Q6). */
export const DEFAULT_RETENTION: HumanDuration = { days: 180 };

/** The plugin's whole config surface, read and checked. */
export interface ApprovalsConfig {
  /** How long an approval stays redeemable once granted. */
  grantTtl: HumanDuration;
  /** How long submitted values are kept after a request settles. */
  retention: HumanDuration;
  /** Service principals allowed to redeem a grant; undefined for the default. */
  grantConsumers?: string[];
}

/**
 * Read a duration that must be longer than zero, or the default when the key
 * is absent.
 *
 * `readDurationFromConfig` does the parsing: it takes `{ hours: 1 }`, `1h` and
 * `PT1H`, and refuses a misspelt unit or a bare number with the key's name in
 * the message. Before it was used here these values were read with a plain
 * `getOptional`, and `durationToMilliseconds` quietly turns `'1h'`,
 * `{ hour: 1 }` and `3600` into zero — which disabled every launch, or redacted
 * every settled request, with nothing in the log to say why. Zero itself is
 * refused for the same reason: it is never what an operator means.
 */
function readPositiveDuration(
  config: Config,
  key: string,
  fallback: HumanDuration,
  whyZeroIsWrong: string,
): HumanDuration {
  if (!config.has(key)) {
    return fallback;
  }
  const duration = readDurationFromConfig(config, { key });
  const milliseconds = durationToMilliseconds(duration);
  if (!Number.isFinite(milliseconds) || milliseconds <= 0) {
    throw new Error(
      `Invalid duration in config at '${key}': it must be longer than zero, got ${JSON.stringify(
        duration,
      )}. ${whyZeroIsWrong}`,
    );
  }
  return duration;
}

/**
 * Read `scaffolderApprovals` from the root config, failing at start-up on a
 * value that would make the plugin misbehave rather than at the first approval.
 */
export function readApprovalsConfig(config: Config): ApprovalsConfig {
  return {
    grantTtl: readPositiveDuration(
      config,
      'scaffolderApprovals.grantTtl',
      DEFAULT_GRANT_TTL,
      'With no time to redeem it, every approval would lapse the moment it was granted and no approved request would launch.',
    ),
    retention: readPositiveDuration(
      config,
      'scaffolderApprovals.retention.redactAfter',
      DEFAULT_RETENTION,
      'Zero would redact the values of every settled request on the next sweep. Redaction cannot be switched off; to keep values longer, set a long window such as { years: 10 }.',
    ),
    grantConsumers: config.getOptionalStringArray(
      'scaffolderApprovals.grantConsumers',
    ),
  };
}
