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

import { resolvePackagePath } from '@backstage/backend-plugin-api';
import { readdirSync } from 'node:fs';
import { join } from 'node:path';
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

/**
 * Every migration, in order. Read from disk rather than listed, so a new
 * migration is covered the moment it is added instead of when somebody
 * remembers to add it here.
 */
const migrationsDir = resolvePackagePath(
  '@ferin79/backstage-plugin-scaffolder-approvals-backend',
  'migrations',
);

const migrations = readdirSync(migrationsDir)
  .filter(name => name.endsWith('.js'))
  .sort()
  // eslint-disable-next-line @typescript-eslint/no-var-requires, no-restricted-syntax
  .map(name => require(join(migrationsDir, name)));

const DIALECTS = ['better-sqlite3', 'pg', 'mysql2'] as const;

/**
 * Run the migration against a schema builder that compiles statements instead
 * of executing them.
 */
async function compile(
  client: string,
): Promise<string[] & { upCount: number }> {
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

  // A stand-in for the knex instance that compiles schema changes instead of
  // running them. It is also callable, because a migration that backfills data
  // uses the query builder — here that finds nothing to backfill, which is
  // correct: this suite is about the DDL, and there is no database behind it.
  const recorder: any = () => ({
    select: async () => [],
  });
  recorder.schema = {
    createTable: (...args: Parameters<Knex.SchemaBuilder['createTable']>) =>
      capture(knex.schema.createTable(...args)),
    dropTableIfExists: (
      ...args: Parameters<Knex.SchemaBuilder['dropTableIfExists']>
    ) => capture(knex.schema.dropTableIfExists(...args)),
    alterTable: (...args: Parameters<Knex.SchemaBuilder['alterTable']>) =>
      capture(knex.schema.alterTable(...args)),
    dropIndex: (...args: any[]) =>
      capture((knex.schema as any).dropIndex(...args)),
  };
  recorder.fn = knex.fn;
  recorder.batchInsert = async () => [];
  // A migration may compile differently per engine — the timestamp-precision
  // one skips SQLite, which has no datetime type to widen — so the recorder
  // has to be able to say which engine it is standing in for.
  recorder.client = { config: { client } };

  let upCount = 0;
  try {
    for (const migration of migrations) {
      await migration.up(recorder);
    }
    upCount = statements.length;
    for (const migration of [...migrations].reverse()) {
      await migration.down(recorder);
    }
  } finally {
    await knex.destroy();
  }

  // `up` alone matters for anything about the shape the schema ends up in;
  // `down` deliberately puts some of it back the way it was.
  return Object.assign(statements, { upCount });
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
  const compiled = new Map<string, string[] & { upCount: number }>();

  /** Only what the migrations do on the way up. */
  const up = (dialect: string) => {
    const all = compiled.get(dialect)!;
    return all.slice(0, all.upCount);
  };

  beforeAll(async () => {
    for (const dialect of DIALECTS) {
      compiled.set(dialect, await compile(dialect));
    }
  });

  it.each(DIALECTS)('compiles for %s', dialect => {
    const statements = compiled.get(dialect)!;

    // Every table created is also dropped.
    const created = statements.filter(s => /^create table/i.test(s));
    const dropped = statements.filter(s => /^drop table/i.test(s));
    expect(created).toHaveLength(4);
    expect(dropped).toHaveLength(created.length);
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

  it('stores MySQL timestamps to the millisecond', () => {
    // `dateTime(col)` with no precision is DATETIME(0) on MySQL, which rounds:
    // two decisions at 10:00:00.750 and 10:00:00.900 both read back as
    // 10:00:01.000, tie, and are then ordered by a random uuid. Postgres and
    // SQLite keep sub-second values already, so this is MySQL alone diverging.
    // Column *changes*, not additions: an `add column` belongs to whichever
    // migration introduced it.
    const altered = up('mysql2').filter(
      statement =>
        /^alter table/i.test(statement) &&
        !/add column/i.test(statement) &&
        /datetime/i.test(statement),
    );

    expect(altered.length).toBeGreaterThan(0);
    for (const statement of altered) {
      // Every datetime this migration touches carries its precision.
      for (const [, type] of statement.matchAll(/(datetime(?:\(\d\))?)/gi)) {
        expect(type.toLowerCase()).toBe('datetime(3)');
      }
    }
  });

  it('skips the precision change on SQLite, which has no datetime type', () => {
    // knex implements `.alter()` on SQLite by rebuilding the table. Rebuilding
    // four tables to change nothing is a real risk taken for no gain.
    expect(
      up('better-sqlite3').filter(
        statement =>
          /^alter table/i.test(statement) &&
          !/add column/i.test(statement) &&
          /datetime/i.test(statement),
      ),
    ).toEqual([]);
  });

  it('indexes the column every task event looks up', () => {
    // `findRequestByTaskId` runs for every `scaffolder.task` event in the
    // instance, gated template or not, against a table that is never pruned.
    for (const dialect of DIALECTS) {
      expect(
        indexStatements(up(dialect)).filter(s => /task_id/.test(s)),
      ).not.toEqual([]);
    }
  });

  it('gives every MySQL datetime column a precision, however it is added', () => {
    // The trap this closes: a later migration adding a plain `dateTime()`
    // column would silently get DATETIME(0) and round, and nothing else here
    // would notice.
    for (const statement of up('mysql2')) {
      for (const [, type] of statement.matchAll(/(datetime(?:\(\d\))?)/gi)) {
        expect(type.toLowerCase()).toBe('datetime(3)');
      }
    }
  });

  it('names no reserved word as a column', () => {
    // `values` is reserved in MySQL and standard SQL. It happens to work
    // because knex quotes every identifier, which makes the first piece of
    // hand-written SQL a trap; the column is `values_json` instead.
    for (const dialect of DIALECTS) {
      for (const body of tableBodies(compiled.get(dialect)!).values()) {
        expect(body).not.toMatch(/[`"]values[`"]/);
      }
      // Columns added by a later migration never appear in a `create table`
      // body, so they need checking where they are declared.
      for (const statement of compiled
        .get(dialect)!
        .filter(s => /^alter table/i.test(s))) {
        expect(statement).not.toMatch(/add [`"]values[`"]/i);
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
