import { resolvePackagePath } from '@backstage/backend-plugin-api';
import { TestDatabases } from '@backstage/backend-test-utils';
import type { Knex } from 'knex';
import {
  TABLE_DECISIONS,
  TABLE_GRANTS,
  TABLE_REQUEST_APPROVERS,
  TABLE_REQUESTS,
} from './tables';

jest.setTimeout(60_000);

const migrationsDir = resolvePackagePath(
  '@ferin79/backstage-plugin-scaffolder-approvals-backend',
  'migrations',
);

const ALL_TABLES = [
  TABLE_REQUESTS,
  TABLE_DECISIONS,
  TABLE_GRANTS,
  TABLE_REQUEST_APPROVERS,
];

/**
 * What the database said when it refused a write, or that it did not refuse.
 *
 * Not `rejects.toThrow()`, which is what these tests used and why they failed
 * intermittently. The write
 * *was* refused every time. But better-sqlite3 registers its error class with
 * its native addon once per process, and Jest gives each test file its own
 * realm. So in a worker that has already run another SQLite suite, a
 * constraint error is built from that earlier suite's class, fails Jest's
 * `instanceof Error`, and `toThrow` reports "did not throw". Which file runs
 * first in a worker varies run to run, hence the flake; with the order forced,
 * it failed every time.
 *
 * So the tests ask the realm-independent question instead: what was the
 * reason? Matching it against {@link UNIQUE_VIOLATION} matters as much as the
 * refusal itself, because "no such table" is a refusal too, and would
 * otherwise hide a broken schema.
 */
function refusal(write: PromiseLike<unknown>): Promise<string> {
  return Promise.resolve(write).then(
    () => 'nothing: the write succeeded',
    (reason: unknown) =>
      String((reason as { message?: unknown } | null)?.message),
  );
}

/**
 * How SQLite ("UNIQUE constraint failed"), Postgres ("duplicate key value
 * violates unique constraint") and MySQL ("Duplicate entry") word it, since
 * this suite runs on all three.
 */
const UNIQUE_VIOLATION = /unique|duplicate/i;

describe('migrations', () => {
  const databases = TestDatabases.create();

  describe.each(databases.eachSupportedId())('%s', databaseId => {
    let knex: Knex;

    beforeEach(async () => {
      // A fresh database per test; TestDatabases does not run plugin
      // migrations itself, which is what lets this suite drive them.
      knex = await databases.init(databaseId);
    });

    afterEach(async () => {
      await knex.destroy();
    });

    it('creates every table on the way up', async () => {
      await knex.migrate.latest({ directory: migrationsDir });

      for (const table of ALL_TABLES) {
        await expect(knex.schema.hasTable(table)).resolves.toBe(true);
      }
    });

    it('creates the columns the store reads and writes', async () => {
      await knex.migrate.latest({ directory: migrationsDir });

      // Named explicitly rather than snapshotted: a renamed column is a
      // breaking change to the store, and a snapshot would let it be blessed.
      expect(
        Object.keys(await knex(TABLE_REQUESTS).columnInfo()).sort(),
      ).toEqual([
        'created_at',
        'decided_at',
        'expires_at',
        'failure_reason',
        'id',
        'last_checked_at',
        'launch_attempt',
        'launch_attempted_at',
        'policy_snapshot',
        'redacted_at',
        'requester_ref',
        'self_approve',
        'status',
        'summary',
        'task_id',
        'template_ref',
        'template_steps_hash',
        'template_uid',
        'updated_at',
        'values_hash',
        'values_json',
      ]);

      expect(
        Object.keys(await knex(TABLE_DECISIONS).columnInfo()).sort(),
      ).toEqual([
        'approver_ref',
        'comment',
        'created_at',
        'decision',
        'id',
        'request_id',
      ]);

      expect(Object.keys(await knex(TABLE_GRANTS).columnInfo()).sort()).toEqual(
        [
          'consumed_at',
          'consumed_by_task_id',
          'expires_at',
          'id',
          'request_id',
          'revoked_at',
          'token_hash',
          'values_hash',
        ],
      );

      expect(
        Object.keys(await knex(TABLE_REQUEST_APPROVERS).columnInfo()).sort(),
      ).toEqual(['approver_ref', 'request_id']);
    });

    it('backfills approvers from the snapshots already stored', async () => {
      // The realistic upgrade path: a deployment that ran only the first
      // migration has requests whose approvers exist solely inside the JSON.
      await knex.migrate.up({ directory: migrationsDir });

      const requestId = '3f1e4c8a-0000-4000-8000-000000000100';
      await knex(TABLE_REQUESTS).insert({
        id: requestId,
        template_ref: 'template:default/gated',
        values_json: '{}',
        values_hash: 'a'.repeat(64),
        requester_ref: 'user:default/requester',
        status: 'pending',
        policy_snapshot: JSON.stringify({
          approvers: ['group:default/devx-team', 'user:default/lead'],
          quorum: 1,
          selfApprove: false,
        }),
        created_at: new Date(),
        updated_at: new Date(),
      });

      // A snapshot that will not parse must not fail the whole migration for
      // every other request.
      await knex(TABLE_REQUESTS).insert({
        id: '3f1e4c8a-0000-4000-8000-000000000101',
        template_ref: 'template:default/gated',
        values_json: '{}',
        values_hash: 'b'.repeat(64),
        requester_ref: 'user:default/requester',
        status: 'pending',
        policy_snapshot: '{not json',
        created_at: new Date(),
        updated_at: new Date(),
      });

      await knex.migrate.latest({ directory: migrationsDir });

      const rows = await knex(TABLE_REQUEST_APPROVERS).orderBy('approver_ref');
      expect(rows).toEqual([
        { request_id: requestId, approver_ref: 'group:default/devx-team' },
        { request_id: requestId, approver_ref: 'user:default/lead' },
      ]);
    });

    it('backfills self_approve from the snapshots already stored', async () => {
      // The upgrade path: requests stored before the column existed hold
      // `selfApprove` only inside their JSON, and the inbox query reads the
      // column. Roll back just that migration, by name, to get there: it is no
      // longer the newest.
      await knex.migrate.latest({ directory: migrationsDir });
      await knex.migrate.down({
        directory: migrationsDir,
        name: '20261001000000_self_approve.js',
      });

      const snapshotted = (id: string, policySnapshot: string) => ({
        id,
        template_ref: 'template:default/gated',
        values_json: '{}',
        values_hash: id.slice(-1).repeat(64),
        requester_ref: 'user:default/requester',
        status: 'pending',
        policy_snapshot: policySnapshot,
        created_at: new Date(),
        updated_at: new Date(),
      });
      const allows = '3f1e4c8a-0000-4000-8000-00000000000a';
      const forbids = '3f1e4c8a-0000-4000-8000-00000000000b';
      const silent = '3f1e4c8a-0000-4000-8000-00000000000c';
      const broken = '3f1e4c8a-0000-4000-8000-00000000000d';
      await knex(TABLE_REQUESTS).insert([
        snapshotted(
          allows,
          JSON.stringify({ approvers: [], quorum: 1, selfApprove: true }),
        ),
        snapshotted(
          forbids,
          JSON.stringify({ approvers: [], quorum: 1, selfApprove: false }),
        ),
        // Written before `readGatePolicy` filled in the default.
        snapshotted(silent, JSON.stringify({ approvers: [], quorum: 1 })),
        // Must not fail the migration for every other request.
        snapshotted(broken, '{not json'),
      ]);

      await knex.migrate.latest({ directory: migrationsDir });

      const rows = await knex(TABLE_REQUESTS)
        .select('id', 'self_approve')
        .orderBy('id');
      // Drivers disagree on the type — a boolean on Postgres, 0/1 elsewhere —
      // and what matters here is only which way each one went.
      expect(rows.map(row => [row.id, Boolean(row.self_approve)])).toEqual([
        [allows, true],
        [forbids, false],
        [silent, false],
        [broken, false],
      ]);
    });

    it('normalises the approver refs decisions were stored with', async () => {
      // Votes recorded before the service normalised them kept the token's
      // spelling, and the quorum count compares refs exactly.
      await knex.migrate.latest({ directory: migrationsDir });
      await knex.migrate.down({
        directory: migrationsDir,
        name: '20261006000000_normalise_decision_refs.js',
      });

      const requestId = '3f1e4c8a-0000-4000-8000-00000000000a';
      await knex(TABLE_REQUESTS).insert({
        id: requestId,
        template_ref: 'template:default/gated',
        values_json: '{}',
        values_hash: 'a'.repeat(64),
        requester_ref: 'user:default/requester',
        status: 'pending',
        policy_snapshot: JSON.stringify({ approvers: [], quorum: 2 }),
        created_at: new Date(),
        updated_at: new Date(),
      });
      const vote = (id: string, approverRef: string) => ({
        id: `3f1e4c8a-0000-4000-8000-0000000000${id}`,
        request_id: requestId,
        approver_ref: approverRef,
        decision: 'approve',
        created_at: new Date(),
      });
      // MySQL's default collation already treats the two Carols as one vote,
      // so it refuses to store them both and there is no collision to keep.
      const caseSensitive = !databaseId.startsWith('MYSQL');
      await knex(TABLE_DECISIONS).insert([
        vote('b1', 'User:Default/Alice'),
        vote('b2', 'user:bob'),
        vote('b3', 'user:default/carol'),
        ...(caseSensitive ? [vote('b4', 'User:Default/Carol')] : []),
        vote('b5', 'not a ref'),
      ]);

      await knex.migrate.latest({ directory: migrationsDir });

      const refs = await knex(TABLE_DECISIONS)
        .select('id', 'approver_ref')
        .orderBy('id');
      expect(refs.map(row => row.approver_ref)).toEqual([
        'user:default/alice',
        'user:default/bob',
        'user:default/carol',
        // Normalising it would collide with the vote above; the audit trail
        // keeps both rows rather than deleting one.
        ...(caseSensitive ? ['User:Default/Carol'] : []),
        // Not a ref at all, so there is nothing to normalise it to.
        'not a ref',
      ]);
    });

    it('refuses to list one approver twice for a request', async () => {
      // The composite primary key is what keeps a duplicate from inflating an
      // inbox or a count.
      await knex.migrate.latest({ directory: migrationsDir });

      const requestId = '3f1e4c8a-0000-4000-8000-000000000110';
      await knex(TABLE_REQUESTS).insert({
        id: requestId,
        template_ref: 'template:default/gated',
        values_json: '{}',
        values_hash: 'a'.repeat(64),
        requester_ref: 'user:default/requester',
        status: 'pending',
        policy_snapshot: '{}',
        created_at: new Date(),
        updated_at: new Date(),
      });

      const row = {
        request_id: requestId,
        approver_ref: 'group:default/devx-team',
      };
      await knex(TABLE_REQUEST_APPROVERS).insert(row);
      expect(await refusal(knex(TABLE_REQUEST_APPROVERS).insert(row))).toMatch(
        UNIQUE_VIOLATION,
      );
    });

    it('drops every table on the way down', async () => {
      await knex.migrate.latest({ directory: migrationsDir });
      await knex.migrate.rollback({ directory: migrationsDir }, true);

      for (const table of ALL_TABLES) {
        await expect(knex.schema.hasTable(table)).resolves.toBe(false);
      }
    });

    it('can be migrated up again after a rollback', async () => {
      // The realistic failure: a `down` that leaves an index or constraint
      // behind, so the next `up` collides with it.
      await knex.migrate.latest({ directory: migrationsDir });
      await knex.migrate.rollback({ directory: migrationsDir }, true);
      await knex.migrate.latest({ directory: migrationsDir });

      for (const table of ALL_TABLES) {
        await expect(knex.schema.hasTable(table)).resolves.toBe(true);
      }
    });

    it('is idempotent when run twice', async () => {
      await knex.migrate.latest({ directory: migrationsDir });
      await expect(
        knex.migrate.latest({ directory: migrationsDir }),
      ).resolves.toBeDefined();
    });

    it('refuses a second vote from the same approver', async () => {
      // The unique index is load-bearing for quorum counting, so assert the
      // database really enforces it rather than trusting the DDL.
      await knex.migrate.latest({ directory: migrationsDir });

      const requestId = '3f1e4c8a-0000-4000-8000-000000000001';
      await knex(TABLE_REQUESTS).insert({
        id: requestId,
        template_ref: 'template:default/gated',
        values_json: '{}',
        values_hash: 'a'.repeat(64),
        requester_ref: 'user:default/requester',
        status: 'pending',
        policy_snapshot: '{}',
        created_at: new Date(),
        updated_at: new Date(),
      });

      const vote = (id: string) => ({
        id,
        request_id: requestId,
        approver_ref: 'user:default/approver',
        decision: 'approve',
        created_at: new Date(),
      });

      await knex(TABLE_DECISIONS).insert(
        vote('3f1e4c8a-0000-4000-8000-000000000002'),
      );

      expect(
        await refusal(
          knex(TABLE_DECISIONS).insert(
            vote('3f1e4c8a-0000-4000-8000-000000000003'),
          ),
        ),
      ).toMatch(UNIQUE_VIOLATION);
    });

    it('refuses two grants with the same token for one request', async () => {
      await knex.migrate.latest({ directory: migrationsDir });

      const requestId = '3f1e4c8a-0000-4000-8000-000000000010';
      await knex(TABLE_REQUESTS).insert({
        id: requestId,
        template_ref: 'template:default/gated',
        values_json: '{}',
        values_hash: 'a'.repeat(64),
        requester_ref: 'user:default/requester',
        status: 'approved',
        policy_snapshot: '{}',
        created_at: new Date(),
        updated_at: new Date(),
      });

      const grant = (id: string) => ({
        id,
        request_id: requestId,
        token_hash: 'b'.repeat(64),
        values_hash: 'a'.repeat(64),
        expires_at: new Date(Date.now() + 3_600_000),
      });

      await knex(TABLE_GRANTS).insert(
        grant('3f1e4c8a-0000-4000-8000-000000000011'),
      );

      expect(
        await refusal(
          knex(TABLE_GRANTS).insert(
            grant('3f1e4c8a-0000-4000-8000-000000000012'),
          ),
        ),
      ).toMatch(UNIQUE_VIOLATION);
    });
  });
});
