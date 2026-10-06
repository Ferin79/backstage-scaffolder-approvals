import { canonicalJson, CanonicalJsonError } from './canonicalJson';

describe('canonicalJson', () => {
  it('is independent of object key order, at every depth', () => {
    // The property the whole values-hash binding rests on: the same parameters
    // built in a different order must hash identically.
    const a = {
      repository: 'backstage',
      justification: 'on-call',
      nested: { b: 2, a: 1, deeper: { z: true, y: null } },
    };
    const b = {
      nested: { deeper: { y: null, z: true }, a: 1, b: 2 },
      justification: 'on-call',
      repository: 'backstage',
    };

    expect(canonicalJson(a)).toBe(canonicalJson(b));
    expect(canonicalJson(a)).toBe(
      '{"justification":"on-call",' +
        '"nested":{"a":1,"b":2,"deeper":{"y":null,"z":true}},' +
        '"repository":"backstage"}',
    );

    // Guard against the naive implementation: JSON.stringify does *not* have
    // this property, which is why this function exists.
    expect(JSON.stringify(a)).not.toBe(JSON.stringify(b));
  });

  it('preserves array order while normalising objects inside them', () => {
    expect(canonicalJson([3, 1, 2])).toBe('[3,1,2]');
    expect(canonicalJson([1, 2, 3])).not.toBe(canonicalJson([3, 2, 1]));

    expect(canonicalJson([{ b: 1, a: 2 }])).toBe(
      canonicalJson([{ a: 2, b: 1 }]),
    );
    expect(canonicalJson([{ b: 1, a: 2 }])).toBe('[{"a":2,"b":1}]');
  });

  it('handles the JSON primitives, empty containers and key escaping', () => {
    expect(canonicalJson(null)).toBe('null');
    expect(canonicalJson(true)).toBe('true');
    expect(canonicalJson(false)).toBe('false');
    expect(canonicalJson(0)).toBe('0');
    expect(canonicalJson(-0)).toBe('0'); // -0 and 0 are one JSON number
    expect(canonicalJson(1.5)).toBe('1.5');
    expect(canonicalJson('')).toBe('""');
    expect(canonicalJson({})).toBe('{}');
    expect(canonicalJson([])).toBe('[]');

    // Quotes, newlines and unicode in both keys and values must survive.
    expect(canonicalJson({ 'a"b': 'c\nd', é: '☃' })).toBe(
      '{"a\\"b":"c\\nd","é":"☃"}',
    );
  });

  it('drops undefined object properties but keeps array slots', () => {
    // Matching JSON.stringify here matters: a caller building parameters with
    // optional fields must not get a different hash depending on whether an
    // absent field was omitted or set to undefined.
    expect(canonicalJson({ a: 1, b: undefined })).toBe('{"a":1}');
    expect(canonicalJson({ a: 1 })).toBe(canonicalJson({ a: 1, b: undefined }));

    expect(canonicalJson([1, undefined, 2])).toBe('[1,null,2]');
  });

  it('honours toJSON, so a Date behaves as callers expect', () => {
    const date = new Date('2026-09-12T10:30:00.000Z');
    expect(canonicalJson({ at: date })).toBe(
      '{"at":"2026-09-12T10:30:00.000Z"}',
    );
  });

  it('rejects values that cannot be represented, rather than coercing them', () => {
    // JSON.stringify turns these into null. Doing the same would let two
    // different inputs share a hash, so they throw instead.
    expect(() => canonicalJson(NaN)).toThrow(CanonicalJsonError);
    expect(() => canonicalJson({ n: Infinity })).toThrow(/non-finite/);
    expect(() => canonicalJson({ n: -Infinity })).toThrow(/non-finite/);

    expect(() => canonicalJson(undefined)).toThrow(/undefined/);
    expect(() => canonicalJson({ f: () => {} })).toThrow(/function/);
    expect(() => canonicalJson({ s: Symbol('x') })).toThrow(/symbol/);
    expect(() => canonicalJson({ b: BigInt(1) })).toThrow(/bigint/);
  });

  it('reports where the offending value was', () => {
    expect(() => canonicalJson({ outer: { inner: [1, NaN] } })).toThrow(
      /at outer\.inner\[1\]/,
    );
    expect(() => canonicalJson(NaN)).toThrow(/at <root>/);
  });

  it('detects circular references instead of overflowing the stack', () => {
    const cyclic: Record<string, unknown> = { a: 1 };
    cyclic.self = cyclic;
    expect(() => canonicalJson(cyclic)).toThrow(/circular/);

    const viaArray: unknown[] = [];
    viaArray.push(viaArray);
    expect(() => canonicalJson(viaArray)).toThrow(/circular/);
  });

  it('allows the same object to appear twice without calling it circular', () => {
    // Repetition is not recursion; a shared sub-object is perfectly valid JSON.
    const shared = { a: 1 };
    expect(canonicalJson({ x: shared, y: shared })).toBe(
      '{"x":{"a":1},"y":{"a":1}}',
    );
  });
});
