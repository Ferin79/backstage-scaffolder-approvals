// @ts-check

/**
 * Bookkeeping that makes launching a template exactly-once and retryable.
 *
 * Two problems, both of which need a column to fix:
 *
 * - **Two launchers could run the template twice.** Deciding a request launches
 *   it, and so does the reconciliation sweep. The old guard read the grants
 *   table and then wrote to it, which two replicas can interleave. A launch is
 *   now *claimed* with a compare-and-set on `launch_attempted_at`, so exactly
 *   one caller proceeds.
 * - **A failed launch was never retried.** The grant it minted stayed live, the
 *   sweep saw a live grant and waited, and the request failed when the grant
 *   lapsed, when it should have been retried. A launch that has had its grace period
 *   can now have its grant *revoked* and a new one minted, and `revoked_at` is
 *   what makes that safe: revoking is a compare-and-set that loses to a task
 *   redeeming the grant at the same moment.
 *
 * `revoked_at` is a separate column rather than an `expires_at` of now, because
 * the earliest grant's `expires_at` is the deadline for the whole launch — the
 * point at which the approval really is spent — and overwriting it would move
 * the finish line on every retry.
 *
 * @param {import('knex').Knex} knex
 */
exports.up = async function up(knex) {
  await knex.schema.alterTable('approval_requests', table => {
    table
      .integer('launch_attempt')
      .notNullable()
      .defaultTo(0)
      .comment('How many times a launch has been claimed, for diagnostics');
    table
      // Millisecond precision, or MySQL rounds to the second (DATETIME(0)).
      .dateTime('launch_attempted_at', { precision: 3 })
      .nullable()
      .comment('When a launch was last claimed; null means never');
  });

  await knex.schema.alterTable('approval_grants', table => {
    table
      .dateTime('revoked_at', { precision: 3 })
      .nullable()
      .comment('When a failed launch withdrew this grant; null means live');
  });
};

/**
 * @param {import('knex').Knex} knex
 */
exports.down = async function down(knex) {
  await knex.schema.alterTable('approval_grants', table => {
    table.dropColumn('revoked_at');
  });

  await knex.schema.alterTable('approval_requests', table => {
    table.dropColumn('launch_attempted_at');
    table.dropColumn('launch_attempt');
  });
};
