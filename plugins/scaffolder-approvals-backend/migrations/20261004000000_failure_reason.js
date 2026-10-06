// @ts-check

/**
 * Why a request failed, in words a requester can act on.
 *
 * A failed request used to say only that it had failed. The reason went into
 * the notification and the log and nowhere else, so somebody opening the
 * request page — the canonical view of a gated run — could not find out what
 * happened. Worse, a launch the scaffolder refused outright (the template's
 * parameters had changed under the request) was retried until the grant lapsed
 * and then blamed on the lapse.
 *
 * Text and nullable: existing rows, and requests that have not failed, have no
 * reason. Not indexed; nothing queries by it.
 *
 * @param {import('knex').Knex} knex
 */
exports.up = async function up(knex) {
  await knex.schema.alterTable('approval_requests', table => {
    table
      .text('failure_reason')
      .nullable()
      .comment('Why the request failed, for the request page');
  });
};

/**
 * @param {import('knex').Knex} knex
 */
exports.down = async function down(knex) {
  await knex.schema.alterTable('approval_requests', table => {
    table.dropColumn('failure_reason');
  });
};
