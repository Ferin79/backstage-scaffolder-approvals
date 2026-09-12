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

// @ts-check

/**
 * Approval requests, the decisions made on them, and the single-use grants that
 * let an approved request actually run.
 *
 * Portability notes, all load-bearing — this has to run on SQLite, Postgres and
 * MySQL:
 *
 *  - No partial indexes. Postgres supports them, the other two do not.
 *  - JSON is stored as `text`, not a native JSON column type.
 *  - Every indexed string column has an explicit length. MySQL cannot index an
 *    unbounded `text` column, so omitting one fails there and nowhere else.
 *  - `dateTime` rather than `timestamp`, matching how the scaffolder stores
 *    times.
 *  - Identifiers this plugin mints use `uuid`; identifiers owned by the
 *    scaffolder use `string`, because Postgres validates its native `uuid` type
 *    and we do not control that format.
 *
 * @param {import('knex').Knex} knex
 */
exports.up = async function up(knex) {
  await knex.schema.createTable('approval_requests', table => {
    table.comment('One request to run a gated template, and its outcome');

    table.uuid('id').primary().notNullable();
    table
      .string('template_ref', 255)
      .notNullable()
      .comment('Entity ref of the gated template');
    // Named `values_json`, not `values`: VALUES is a reserved word in MySQL and
    // in standard SQL, so a column called `values` works only because knex
    // quotes every identifier. That is an implicit dependency on the query
    // builder, and the first piece of hand-written SQL — a debugging session, a
    // later migration — breaks on it. The suffix also pairs it with
    // `values_hash`.
    table.text('values_json').nullable().comment('JSON; nulled on redaction');
    table
      .string('values_hash', 64)
      .notNullable()
      .comment('SHA-256 of the canonical values; survives redaction');
    table
      .string('requester_ref', 255)
      .notNullable()
      .comment('Entity ref of the user who submitted');
    table.string('status', 32).notNullable();
    table.text('summary').nullable().comment('Nulled on redaction');
    table
      .text('policy_snapshot')
      .notNullable()
      .comment('JSON gate policy, frozen at submit time');
    table
      .string('task_id', 255)
      .nullable()
      .comment('Scaffolder task, once launched');
    table.dateTime('created_at').defaultTo(knex.fn.now()).notNullable();
    table.dateTime('updated_at').defaultTo(knex.fn.now()).notNullable();
    table.dateTime('expires_at').nullable();
    table.dateTime('decided_at').nullable();
    table.dateTime('redacted_at').nullable();

    // The timeout sweep.
    table.index(['status', 'expires_at'], 'ar_status_expires_idx');
    // The inbox, newest first.
    table.index(['status', 'created_at'], 'ar_status_created_idx');
    // "My requests".
    table.index(['requester_ref'], 'ar_requester_idx');
    // Duplicate collapse; see ApprovalStore.createOrCollapse.
    //
    // Index key budget: InnoDB allows 3072 bytes, and utf8mb4 costs 4 bytes per
    // character, so this index spends (255 + 255 + 64 + 32) * 4 = 2424 bytes of
    // it. Adding another string column here would overflow on MySQL only.
    table.index(
      ['requester_ref', 'template_ref', 'values_hash', 'status'],
      'ar_collapse_idx',
    );
    // The retention sweep looks for old terminal requests not yet redacted.
    table.index(['redacted_at', 'updated_at'], 'ar_retention_idx');
  });

  await knex.schema.createTable('approval_decisions', table => {
    table.comment('Append-only record of who decided what, and why');

    table.uuid('id').primary().notNullable();
    table
      .uuid('request_id')
      .notNullable()
      .references('id')
      .inTable('approval_requests')
      .onDelete('CASCADE');
    table
      .string('approver_ref', 255)
      .notNullable()
      .comment('Entity ref of the deciding user');
    table.string('decision', 16).notNullable().comment('approve | deny');
    table.text('comment').nullable();
    table.dateTime('created_at').defaultTo(knex.fn.now()).notNullable();

    // One vote each. This is what makes a quorum count trustworthy under
    // concurrency: the database refuses a second vote rather than the service
    // having to read-then-write.
    table.unique(['request_id', 'approver_ref'], {
      indexName: 'ad_one_vote_each',
    });
  });

  await knex.schema.createTable('approval_grants', table => {
    table.comment('Single-use capability to launch one approved request');

    table.uuid('id').primary().notNullable();
    table
      .uuid('request_id')
      .notNullable()
      .references('id')
      .inTable('approval_requests')
      .onDelete('CASCADE');
    table
      .string('token_hash', 64)
      .notNullable()
      .comment('SHA-256 of the grant token; the token itself is never stored');
    table
      .string('values_hash', 64)
      .notNullable()
      .comment('Binds the grant to the exact values that were approved');
    table.dateTime('expires_at').notNullable();
    table.dateTime('consumed_at').nullable();
    table.string('consumed_by_task_id', 255).nullable();

    table.unique(['request_id', 'token_hash'], {
      indexName: 'ag_token_unique',
    });
    // The orphaned-grant sweep.
    table.index(['consumed_at', 'expires_at'], 'ag_sweep_idx');
  });
};

/**
 * @param {import('knex').Knex} knex
 */
exports.down = async function down(knex) {
  // Reverse order: both child tables carry a foreign key into approval_requests.
  await knex.schema.dropTableIfExists('approval_grants');
  await knex.schema.dropTableIfExists('approval_decisions');
  await knex.schema.dropTableIfExists('approval_requests');
};
