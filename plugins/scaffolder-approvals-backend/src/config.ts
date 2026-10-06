import { type Config, readDurationFromConfig } from '@backstage/config';
import { durationToMilliseconds, type HumanDuration } from '@backstage/types';

/** Applied when `scaffolderApprovals.grantTtl` is not configured. */
export const DEFAULT_GRANT_TTL: HumanDuration = { hours: 1 };

/** Applied when `scaffolderApprovals.retention.redactAfter` is absent. */
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
 * the message. Zero is refused too: it is never what an operator means, and it
 * would disable every launch or redact every settled request.
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
