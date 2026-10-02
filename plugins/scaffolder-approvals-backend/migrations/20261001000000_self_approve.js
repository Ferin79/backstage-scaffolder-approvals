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
 * Whether the requester may approve their own request, as a column.
 *
 * The policy snapshot already holds this, inside a JSON `text` column. The
 * "waiting on you" inbox needs it in SQL: a requester who is also in the
 * approver group must not see their own request as work to do when the gate
 * forbids self-approval, and answering that from JSON would mean filtering in
 * memory, which can neither page nor report a correct total. The same argument
 * made the approvers table, and it is safe for the same reason — the policy is
 * a frozen snapshot, so this is written once and never changes.
 *
 * Not nullable. The inbox query excludes `requester = caller AND self_approve
 * = false`, and a NULL there would make the whole condition unknown, which
 * excludes the row whatever it held. False is also what an absent
 * `selfApprove` means (`DEFAULT_SELF_APPROVE`).
 *
 * @param {import('knex').Knex} knex
 */
exports.up = async function up(knex) {
  await knex.schema.alterTable('approval_requests', table => {
    table
      .boolean('self_approve')
      .notNullable()
      .defaultTo(false)
      .comment('selfApprove from the policy snapshot, for the inbox query');
  });

  // Backfill the requests that allow self-approval; the default covers the
  // rest. Done in JavaScript because parsing JSON in SQL is not portable across
  // the three engines this has to run on.
  const requests = await knex('approval_requests').select(
    'id',
    'policy_snapshot',
  );

  const allowing = [];
  for (const request of requests) {
    let selfApprove;
    try {
      selfApprove = JSON.parse(request.policy_snapshot).selfApprove;
    } catch {
      // A snapshot that will not parse is already broken. Leaving it at the
      // default keeps it out of its requester's inbox, which is the safe side.
      continue;
    }
    if (selfApprove === true) {
      allowing.push(request.id);
    }
  }

  // Chunked so a large backlog does not build one oversized statement.
  for (let start = 0; start < allowing.length; start += 500) {
    await knex('approval_requests')
      .whereIn('id', allowing.slice(start, start + 500))
      .update({ self_approve: true });
  }
};

/**
 * @param {import('knex').Knex} knex
 */
exports.down = async function down(knex) {
  await knex.schema.alterTable('approval_requests', table => {
    table.dropColumn('self_approve');
  });
};
