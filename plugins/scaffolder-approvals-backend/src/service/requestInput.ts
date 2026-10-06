import {
  DEFAULT_NAMESPACE,
  parseEntityRef,
  stringifyEntityRef,
} from '@backstage/catalog-model';
import { InputError } from '@backstage/errors';

/**
 * How deeply submitted values may nest.
 *
 * No template form comes anywhere near this: an object field inside an array
 * inside an object is three. The limit exists because the values are hashed
 * by a recursive serialiser, and a few thousand levels of `{"a":` — well
 * inside the body size limit — would overflow the stack.
 */
export const MAX_VALUES_DEPTH = 64;

/**
 * Read an entity ref a client sent, in the one spelling this plugin stores.
 *
 * The kind may be left out, since every place that takes a ref from a client
 * knows which kind it means: `request-github-admin` is the template
 * `template:default/request-github-admin`. Case and namespace are normalised
 * as they are on submit, so a filter written the way a request was submitted
 * finds it.
 *
 * A ref that does not parse is the client's mistake, so it is a 400 naming
 * the field rather than the parser's `TypeError`, which would be a 500.
 */
export function readEntityRef(
  raw: string,
  options: { defaultKind: string; field: string },
): string {
  try {
    return stringifyEntityRef(
      parseEntityRef(raw.trim(), {
        defaultKind: options.defaultKind,
        defaultNamespace: DEFAULT_NAMESPACE,
      }),
    );
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new InputError(`Invalid ${options.field}: ${detail}`);
  }
}

/**
 * Refuse values nested deeper than {@link MAX_VALUES_DEPTH}.
 *
 * Walks with its own stack rather than recursing, so that the check cannot
 * fail the way the code it protects did.
 */
export function assertValuesDepth(values: unknown): void {
  const pending: Array<[unknown, number]> = [[values, 1]];
  while (pending.length) {
    const [value, depth] = pending.pop()!;
    if (value === null || typeof value !== 'object') {
      continue;
    }
    if (depth > MAX_VALUES_DEPTH) {
      throw new InputError(
        `Submitted values are nested more than ${MAX_VALUES_DEPTH} levels deep, which no template form produces`,
      );
    }
    for (const child of Object.values(value)) {
      pending.push([child, depth + 1]);
    }
  }
}
