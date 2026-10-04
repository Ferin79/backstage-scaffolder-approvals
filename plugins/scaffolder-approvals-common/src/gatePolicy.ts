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

import { parseEntityRef } from '@backstage/catalog-model';
import type { HumanDuration } from '@backstage/types';
import { DEFAULT_QUORUM, DEFAULT_SELF_APPROVE } from './constants';
import { normaliseEntityRef } from './entityRefs';
import type { GatePolicy } from './types';

/**
 * Thrown when a template's gate step does not describe a usable policy.
 *
 * Callers map this onto whatever their layer needs — the backend turns it into
 * an `InputError`, the catalog processor into an entity error.
 *
 * @public
 */
export class GatePolicyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'GatePolicyError';
  }
}

/** Kinds that can appear in `approvers`. */
const APPROVER_KINDS = ['group', 'user'];

const DURATION_UNITS: (keyof HumanDuration)[] = [
  'years',
  'months',
  'weeks',
  'days',
  'hours',
  'minutes',
  'seconds',
  'milliseconds',
];

function readApprovers(raw: unknown): string[] {
  if (!Array.isArray(raw) || raw.length === 0) {
    throw new GatePolicyError(
      'approvers must be a non-empty array of group or user entity refs',
    );
  }

  const seen = new Set<string>();
  for (const [index, entry] of raw.entries()) {
    if (typeof entry !== 'string' || !entry.trim()) {
      throw new GatePolicyError(
        `approvers[${index}] must be an entity ref string`,
      );
    }

    // "Approved by whoever owns what is being created" is the first thing a
    // template author tries. It cannot work: the policy is read from the
    // catalog before anyone has filled in the form, so there is nothing to
    // template. Saying that beats "not a valid entity ref".
    if (entry.includes('${{')) {
      throw new GatePolicyError(
        `approvers[${index}] is a template expression (${entry.trim()}). ` +
          'Approvers are read from the catalog before anyone fills in the ' +
          'form, so they must be fixed group or user refs',
      );
    }

    let normalised: string;
    try {
      // Normalised through the same helper the approver check uses, so the two
      // can never disagree about whether a ref matches.
      normalised = normaliseEntityRef(entry);

      const parsed = parseEntityRef(entry.trim(), {
        defaultNamespace: 'default',
      });
      if (!APPROVER_KINDS.includes(parsed.kind.toLocaleLowerCase('en-US'))) {
        throw new GatePolicyError(
          `approvers[${index}] must be a group or user ref, got kind '${parsed.kind}'`,
        );
      }
    } catch (error) {
      if (error instanceof GatePolicyError) {
        throw error;
      }
      throw new GatePolicyError(
        `approvers[${index}] is not a valid entity ref: ${entry}`,
      );
    }

    // Listing the same approver twice must not inflate the achievable quorum.
    seen.add(normalised);
  }

  return [...seen];
}

function readQuorum(raw: unknown): number {
  if (raw === undefined || raw === null) {
    return DEFAULT_QUORUM;
  }
  if (typeof raw !== 'number' || !Number.isInteger(raw) || raw < 1) {
    throw new GatePolicyError('quorum must be an integer of at least 1');
  }
  return raw;
}

function readSelfApprove(raw: unknown): boolean {
  if (raw === undefined || raw === null) {
    return DEFAULT_SELF_APPROVE;
  }
  if (typeof raw !== 'boolean') {
    throw new GatePolicyError('selfApprove must be a boolean');
  }
  return raw;
}

function readTimeout(raw: unknown): HumanDuration | undefined {
  if (raw === undefined || raw === null) {
    return undefined;
  }
  if (typeof raw !== 'object' || Array.isArray(raw)) {
    throw new GatePolicyError(
      'timeout must be an object such as { hours: 72 }',
    );
  }

  const source = raw as Record<string, unknown>;
  const unknownKeys = Object.keys(source).filter(
    key => !(DURATION_UNITS as string[]).includes(key),
  );
  if (unknownKeys.length) {
    throw new GatePolicyError(
      `timeout has unsupported field(s): ${unknownKeys.join(', ')}`,
    );
  }

  const result: HumanDuration = {};
  let total = 0;
  for (const unit of DURATION_UNITS) {
    const value = source[unit];
    if (value === undefined) {
      continue;
    }
    if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
      throw new GatePolicyError(
        `timeout.${unit} must be a non-negative number`,
      );
    }
    (result as Record<string, number>)[unit] = value;
    total += value;
  }

  // A timeout of zero would expire every request on the first sweep, which is
  // never what an author means; treating it as "no timeout" would be worse,
  // since it silently disables the thing they asked for.
  if (total <= 0) {
    throw new GatePolicyError(
      'timeout must be greater than zero; omit it entirely for no timeout',
    );
  }

  return result;
}

function readSummary(raw: unknown): string | undefined {
  if (raw === undefined || raw === null) {
    return undefined;
  }
  if (typeof raw !== 'string') {
    throw new GatePolicyError('summary must be a string');
  }
  const trimmed = raw.trim();
  return trimmed ? trimmed : undefined;
}

/**
 * Read and normalise a {@link GatePolicy} from an `approval:gate` step's input.
 *
 * Applies the defaults ({@link DEFAULT_QUORUM}, {@link DEFAULT_SELF_APPROVE}),
 * normalises and de-duplicates approver refs, and rejects anything malformed
 * with a {@link GatePolicyError}.
 *
 * Shared between the backend, which snapshots the policy when a request is
 * submitted, and the catalog processor, which validates a template at
 * ingestion — so a template that ingests cleanly cannot then fail at submit.
 *
 * Note this validates *shape*, not existence: it does not check that the
 * approver groups are real catalog entities.
 *
 * @public
 */
export function readGatePolicy(input: unknown): GatePolicy {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) {
    throw new GatePolicyError('gate step input must be an object');
  }

  const source = input as Record<string, unknown>;

  const policy: GatePolicy = {
    approvers: readApprovers(source.approvers),
    quorum: readQuorum(source.quorum),
    selfApprove: readSelfApprove(source.selfApprove),
  };

  const timeout = readTimeout(source.timeout);
  if (timeout) {
    policy.timeout = timeout;
  }

  const summary = readSummary(source.summary);
  if (summary) {
    policy.summary = summary;
  }

  return policy;
}
