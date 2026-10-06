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
 * What the template looked like when the request was submitted.
 *
 * `values` and `policy_snapshot` are frozen at submit, but the template itself
 * is loaded live from the catalog at launch time. A template edited during the
 * wait therefore runs in its edited form, and an approver who only ever sees
 * the values has no way to know. Steps can be added, and an added step runs.
 *
 * Two columns, because either on its own can be fooled:
 *
 * - `template_uid` catches the template being deleted and recreated, which
 *   gives a new entity that may share a name and nothing else.
 * - `template_steps_hash` catches the steps being edited in place, which
 *   leaves the uid untouched.
 *
 * The hash covers `spec.steps` rather than the whole spec, because the steps
 * are what execute. A change to the owner or the description is not something
 * to warn an approver about, and warning about everything is how a warning
 * stops being read.
 *
 * Both are nullable: a request submitted before this migration has neither,
 * and "unknown" has to be distinguishable from "unchanged".
 *
 * @param {import('knex').Knex} knex
 */
exports.up = async function up(knex) {
  await knex.schema.alterTable('approval_requests', table => {
    table
      .string('template_uid', 255)
      .nullable()
      .comment('metadata.uid of the template when the request was submitted');
    table
      .string('template_steps_hash', 64)
      .nullable()
      .comment('SHA-256 of spec.steps when the request was submitted');
  });
};

/**
 * @param {import('knex').Knex} knex
 */
exports.down = async function down(knex) {
  await knex.schema.alterTable('approval_requests', table => {
    table.dropColumn('template_steps_hash');
    table.dropColumn('template_uid');
  });
};
