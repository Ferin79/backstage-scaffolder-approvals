/**
 * Thrown when a value cannot be canonicalised.
 *
 * Canonicalisation fails loudly rather than coercing, because the output feeds
 * a hash used as a security binding. Silently mapping `NaN` to `null` — as
 * `JSON.stringify` does — would let two different inputs produce the same hash.
 *
 * @public
 */
export class CanonicalJsonError extends Error {
  constructor(message: string, readonly path: string) {
    super(`${message} (at ${path || '<root>'})`);
    this.name = 'CanonicalJsonError';
  }
}

function serialise(
  value: unknown,
  path: string,
  seen: Set<object>,
  inArray: boolean,
): string {
  if (value === null) {
    return 'null';
  }

  // `undefined` is dropped from objects by the caller. Inside an array it has
  // to occupy its slot, and `null` is what JSON uses for that.
  if (value === undefined) {
    if (inArray) {
      return 'null';
    }
    throw new CanonicalJsonError('Cannot canonicalise undefined', path);
  }

  switch (typeof value) {
    case 'string':
      return JSON.stringify(value);
    case 'boolean':
      return value ? 'true' : 'false';
    case 'number':
      if (!Number.isFinite(value)) {
        throw new CanonicalJsonError(
          `Cannot canonicalise the non-finite number ${value}`,
          path,
        );
      }
      // -0 and 0 are the same JSON number; normalise so they hash alike.
      return JSON.stringify(value === 0 ? 0 : value);
    case 'bigint':
      throw new CanonicalJsonError('Cannot canonicalise a bigint', path);
    case 'function':
      throw new CanonicalJsonError('Cannot canonicalise a function', path);
    case 'symbol':
      throw new CanonicalJsonError('Cannot canonicalise a symbol', path);
    default:
      break;
  }

  const object = value as object;

  if (seen.has(object)) {
    throw new CanonicalJsonError('Cannot canonicalise a circular value', path);
  }

  // Match JSON.stringify and honour toJSON, so a Date behaves the way callers
  // expect rather than throwing.
  const withToJson = object as { toJSON?: (key?: string) => unknown };
  if (typeof withToJson.toJSON === 'function') {
    return serialise(withToJson.toJSON(), path, seen, inArray);
  }

  seen.add(object);
  try {
    if (Array.isArray(object)) {
      // Order is meaningful in an array and is preserved.
      const items = object.map((item, index) =>
        serialise(item, `${path}[${index}]`, seen, true),
      );
      return `[${items.join(',')}]`;
    }

    // Order is *not* meaningful in an object, so sort to make the output
    // independent of however the value was constructed or parsed.
    const entries = Object.keys(object as Record<string, unknown>)
      .sort()
      .reduce<string[]>((acc, key) => {
        const entry = (object as Record<string, unknown>)[key];
        if (entry === undefined) {
          return acc; // dropped, as JSON.stringify does
        }
        const child = serialise(
          entry,
          path ? `${path}.${key}` : key,
          seen,
          false,
        );
        acc.push(`${JSON.stringify(key)}:${child}`);
        return acc;
      }, []);

    return `{${entries.join(',')}}`;
  } finally {
    seen.delete(object);
  }
}

/**
 * Serialise a value to JSON deterministically.
 *
 * Two values that are structurally equal produce byte-identical output,
 * regardless of the order their object keys happen to be in. Array order is
 * preserved, because it carries meaning.
 *
 * This is the input to the values hash that binds an approval to exactly the
 * parameters that were approved. It is computed in three places — when a
 * request is submitted, when a grant is minted, and when the gate action
 * consumes that grant — so it has to be stable across all of them. Hashing
 * `JSON.stringify` output directly would not be: key order there depends on
 * insertion order, so the same parameters submitted through different code
 * paths could hash differently and the gate would reject a legitimate run.
 *
 * Throws {@link CanonicalJsonError} for anything not representable as JSON:
 * `undefined` at the root, non-finite numbers, bigints, functions, symbols and
 * circular references.
 *
 * @public
 */
export function canonicalJson(value: unknown): string {
  return serialise(value, '', new Set<object>(), false);
}
