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
  '@backstage-community/plugin-scaffolder-approvals-backend',
  'migrations',
);

const ALL_TABLES = [
  TABLE_REQUESTS,
  TABLE_DECISIONS,
  TABLE_GRANTS,
  TABLE_REQUEST_APPROVERS,
];

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
        'id',
        'launch_attempt',
        'launch_attempted_at',
        'policy_snapshot',
        'redacted_at',
        'requester_ref',
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
      await expect(knex(TABLE_REQUEST_APPROVERS).insert(row)).rejects.toThrow();
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

      await expect(
        knex(TABLE_DECISIONS).insert(
          vote('3f1e4c8a-0000-4000-8000-000000000003'),
        ),
      ).rejects.toThrow();
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

      await expect(
        knex(TABLE_GRANTS).insert(
          grant('3f1e4c8a-0000-4000-8000-000000000012'),
        ),
      ).rejects.toThrow();
    });
  });
});
