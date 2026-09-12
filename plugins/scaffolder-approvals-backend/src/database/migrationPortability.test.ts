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

import knexFactory, { type Knex } from 'knex';

/**
 * The migration has to run on SQLite, Postgres and MySQL, but only SQLite is
 * reachable without a container runtime — so `migrations.test.ts` covers
 * whichever engines the machine can start, and CI is the first place all three
 * run.
 *
 * This suite closes that gap for the errors that are worth catching early:
 * anything that fails to *compile* for a dialect, plus the portability rules
 * that fail on exactly one engine and are therefore easy to break without
 * noticing. It needs no database, so it runs everywhere.
 */

// eslint-disable-next-line @typescript-eslint/no-var-requires, no-restricted-syntax
const migration = require('../../migrations/20260911000000_init.js');

const DIALECTS = ['better-sqlite3', 'pg', 'mysql2'] as const;

/**
 * Run the migration against a schema builder that compiles statements instead
 * of executing them.
 */
async function compile(client: string): Promise<string[]> {
  const knex = knexFactory({
    client,
    connection: { filename: ':memory:' },
    useNullAsDefault: true,
  });

  const statements: string[] = [];
  const capture = (builder: Knex.SchemaBuilder) => {
    statements.push(...builder.toSQL().map(s => s.sql));
    return Promise.resolve();
  };

  const recorder = {
    schema: {
      createTable: (...args: Parameters<Knex.SchemaBuilder['createTable']>) =>
        capture(knex.schema.createTable(...args)),
      dropTableIfExists: (
        ...args: Parameters<Knex.SchemaBuilder['dropTableIfExists']>
      ) => capture(knex.schema.dropTableIfExists(...args)),
    },
    fn: knex.fn,
  };

  try {
    await migration.up(recorder);
    await migration.down(recorder);
  } finally {
    await knex.destroy();
  }

  return statements;
}

/** Every `create table` body, keyed by table name. */
function tableBodies(statements: string[]): Map<string, string> {
  const bodies = new Map<string, string>();
  for (const statement of statements) {
    const match = /^create table [`"](\w+)[`"] \((.*)\)/is.exec(statement);
    if (match) {
      bodies.set(match[1], match[2]);
    }
  }
  return bodies;
}

/** Statements that build an index or a unique constraint. */
function indexStatements(statements: string[]): string[] {
  return statements.filter(s =>
    /create (unique )?index|add (unique|index|constraint \S+ unique)/i.test(s),
  );
}

describe('migration portability', () => {
  const compiled = new Map<string, string[]>();

  beforeAll(async () => {
    for (const dialect of DIALECTS) {
      compiled.set(dialect, await compile(dialect));
    }
  });

  it.each(DIALECTS)('compiles for %s', dialect => {
    const statements = compiled.get(dialect)!;

    // Three tables up, three down.
    expect(statements.filter(s => /^create table/i.test(s))).toHaveLength(3);
    expect(statements.filter(s => /^drop table/i.test(s))).toHaveLength(3);
  });

  it.each(DIALECTS)('declares no partial index on %s', dialect => {
    // Postgres would accept `create index ... where status = 'pending'`; SQLite
    // and MySQL would not. Keeping them out means one schema everywhere.
    for (const statement of indexStatements(compiled.get(dialect)!)) {
      expect(statement).not.toMatch(/\bwhere\b/i);
    }
  });

  it.each(DIALECTS)('indexes no unbounded column on %s', dialect => {
    // MySQL cannot index a `text` column without a prefix length, and fails at
    // migration time. The other two engines accept it happily, so this is the
    // portability rule most likely to be broken by a later migration.
    const statements = compiled.get(dialect)!;
    const bodies = tableBodies(statements);

    const unboundedByTable = new Map<string, string[]>();
    for (const [table, body] of bodies) {
      const unbounded = [...body.matchAll(/[`"](\w+)[`"] text\b/gi)].map(
        m => m[1],
      );
      unboundedByTable.set(table, unbounded);
    }

    // Sanity: the fixture only means something if there are such columns.
    expect(unboundedByTable.get('approval_requests')).toEqual(
      expect.arrayContaining(['values_json', 'summary', 'policy_snapshot']),
    );

    for (const statement of indexStatements(statements)) {
      const table = /[`"](\w+)[`"]/.exec(statement)?.[1];
      const columns = /\(([^)]*)\)\s*$/.exec(statement)?.[1] ?? '';
      for (const column of unboundedByTable.get(table ?? '') ?? []) {
        expect(columns).not.toContain(column);
      }
    }
  });

  it.each(DIALECTS)('stores JSON as text on %s, not a native type', dialect => {
    // A native json/jsonb column would change how each engine validates and
    // returns the value, and the store parses the text itself.
    const body = tableBodies(compiled.get(dialect)!).get('approval_requests')!;

    expect(body).toMatch(/[`"]policy_snapshot[`"] text\b/i);
    expect(body).toMatch(/[`"]values_json[`"] text\b/i);
    // Matched against the type that follows an identifier, since MySQL inlines
    // column comments into the same statement and those mention JSON.
    expect(body).not.toMatch(/[`"]\w+[`"] jsonb?\b/i);
  });

  it('names no reserved word as a column', () => {
    // `values` is reserved in MySQL and standard SQL. It happens to work
    // because knex quotes every identifier, which makes the first piece of
    // hand-written SQL a trap; the column is `values_json` instead.
    for (const dialect of DIALECTS) {
      for (const body of tableBodies(compiled.get(dialect)!).values()) {
        expect(body).not.toMatch(/[`"]values[`"]/);
      }
    }
  });

  it('sizes the MySQL index keys within the InnoDB limit', () => {
    // utf8mb4 costs 4 bytes per character and InnoDB allows 3072 bytes per
    // index key, so a wide composite index over string columns can overflow on
    // MySQL alone. The collapse index is the one with a real budget.
    const statements = compiled.get('mysql2')!;
    const widths = new Map<string, number>();
    for (const [, body] of tableBodies(statements)) {
      for (const match of body.matchAll(
        /[`"](\w+)[`"] (?:var)?char\((\d+)\)/gi,
      )) {
        widths.set(match[1], Number(match[2]));
      }
    }

    for (const statement of indexStatements(statements)) {
      const columns = (/\(([^)]*)\)\s*$/.exec(statement)?.[1] ?? '')
        .split(',')
        .map(c => c.trim().replace(/[`"]/g, ''));

      const bytes = columns.reduce(
        (total, column) => total + (widths.get(column) ?? 0) * 4,
        0,
      );

      expect(bytes).toBeLessThanOrEqual(3072);
    }
  });
});
