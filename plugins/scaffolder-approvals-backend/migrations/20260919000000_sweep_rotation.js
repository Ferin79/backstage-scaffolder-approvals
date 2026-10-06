// @ts-check

/**
 * When the reconciliation sweep last looked at a request's task.
 *
 * The sweep took the batch of `running` requests with the oldest `updated_at`,
 * which sounds like "whatever has been waiting longest" and is not. A request
 * whose task is still going does not change status, so nothing updates its
 * `updated_at` — and neither does one whose `getTask` keeps failing, which is
 * exactly the case that most needs attention. A long-running task therefore
 * holds its place in the batch forever, and with a batch of 50 the 51st request
 * is never looked at again however long it has been finished.
 *
 * Ordering by this column instead makes the sweep a rotation: looking at a
 * request moves it to the back of the queue whether or not anything about it
 * changed. Nullable, so existing rows sort first — they are the ones that have
 * been waiting longest by definition.
 *
 * @param {import('knex').Knex} knex
 */
exports.up = async function up(knex) {
  await knex.schema.alterTable('approval_requests', table => {
    table
      .dateTime('last_checked_at', { precision: 3 })
      .nullable()
      .comment('When the sweep last read this request task status');

    // The sweep's own query: running requests, least recently checked first.
    table.index(['status', 'last_checked_at'], 'ar_sweep_rotation_idx');
  });
};

/**
 * @param {import('knex').Knex} knex
 */
exports.down = async function down(knex) {
  await knex.schema.alterTable('approval_requests', table => {
    table.dropIndex(['status', 'last_checked_at'], 'ar_sweep_rotation_idx');
    table.dropColumn('last_checked_at');
  });
};
