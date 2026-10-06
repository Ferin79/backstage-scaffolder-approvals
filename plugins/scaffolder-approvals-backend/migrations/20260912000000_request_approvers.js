// @ts-check

/**
 * The approver refs of each request, unpacked from its policy snapshot.
 *
 * The snapshot already holds these, but inside a JSON `text` column, and "which
 * requests am I an approver for" is the approvals inbox — the primary view of
 * the whole feature. Answering it from JSON would mean scanning and filtering in
 * memory, which cannot page and cannot report a correct total. This table makes
 * it an indexed join instead.
 *
 * It is safe to denormalise precisely because the policy is a frozen snapshot:
 * these rows are written once, with the request, and never change. Group
 * membership is deliberately *not* expanded here — a row holds the `group:` ref
 * as written, and the caller's own ownership refs are matched against it at
 * query time. That is what lets a group's membership change without rewriting
 * every request it approves.
 *
 * @param {import('knex').Knex} knex
 */
exports.up = async function up(knex) {
  await knex.schema.createTable('approval_request_approvers', table => {
    table.comment('Approver refs of each request, from its policy snapshot');

    table
      .uuid('request_id')
      .notNullable()
      .references('id')
      .inTable('approval_requests')
      .onDelete('CASCADE');
    table
      .string('approver_ref', 255)
      .notNullable()
      .comment(
        'A group: or user: ref, normalised, exactly as the policy lists it',
      );

    // One row per approver per request, and the natural key is the whole row.
    table.primary(['request_id', 'approver_ref']);
    // The inbox: every request a set of refs may decide on.
    table.index(['approver_ref'], 'ara_approver_idx');
  });

  // Backfill from the snapshots already stored. Done in JavaScript rather than
  // SQL because parsing JSON in SQL is not portable across the three engines
  // this has to run on.
  const requests = await knex('approval_requests').select(
    'id',
    'policy_snapshot',
  );

  const rows = [];
  for (const request of requests) {
    let approvers;
    try {
      approvers = JSON.parse(request.policy_snapshot).approvers;
    } catch {
      // A row whose snapshot will not parse is already broken; skipping it
      // leaves it invisible to the inbox rather than failing the migration for
      // every other request.
      continue;
    }
    if (!Array.isArray(approvers)) {
      continue;
    }
    for (const approverRef of new Set(approvers)) {
      if (typeof approverRef === 'string' && approverRef) {
        rows.push({ request_id: request.id, approver_ref: approverRef });
      }
    }
  }

  if (rows.length) {
    // Chunked so a large backlog does not build one oversized statement.
    await knex.batchInsert('approval_request_approvers', rows, 500);
  }
};

/**
 * @param {import('knex').Knex} knex
 */
exports.down = async function down(knex) {
  await knex.schema.dropTableIfExists('approval_request_approvers');
};
