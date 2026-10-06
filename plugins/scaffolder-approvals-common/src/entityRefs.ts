import { parseEntityRef, stringifyEntityRef } from '@backstage/catalog-model';

/**
 * Put an entity ref into the one spelling this plugin compares.
 *
 * Refs are case-insensitive and the namespace is optional, so `Group:DevX` and
 * `group:default/devx` denote the same group. Approver refs come from a
 * template author's YAML while the refs they are matched against come from the
 * catalog, and the two are spelled differently often enough that comparing them
 * as written would silently lock an approver out of their own gate.
 *
 * Throws if the input is not a parseable ref.
 *
 * @public
 */
export function normaliseEntityRef(ref: string): string {
  return stringifyEntityRef(
    parseEntityRef(ref.trim(), { defaultNamespace: 'default' }),
  );
}

/**
 * {@link normaliseEntityRef}, or `undefined` for a ref that does not parse.
 *
 * For comparisons: a ref that cannot be read cannot match anything, so it is
 * dropped rather than failing the whole check.
 *
 * @public
 */
export function tryNormaliseEntityRef(ref: string): string | undefined {
  try {
    return normaliseEntityRef(ref);
  } catch {
    return undefined;
  }
}

/**
 * Whether two refs name the same entity, whatever their casing or namespace
 * spelling. False when either does not parse, so a malformed ref never
 * matches.
 *
 * @public
 */
export function isSameEntityRef(a: string, b: string): boolean {
  const left = tryNormaliseEntityRef(a);
  return left !== undefined && left === tryNormaliseEntityRef(b);
}

/**
 * {@link tryNormaliseEntityRef} over a list, dropping the refs that do not
 * parse: a ref that cannot be read cannot match anything.
 *
 * @public
 */
export function normaliseEntityRefs(refs: readonly string[]): string[] {
  return refs
    .map(tryNormaliseEntityRef)
    .filter((ref): ref is string => ref !== undefined);
}
