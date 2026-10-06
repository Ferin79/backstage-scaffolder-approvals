// @ts-check

/**
 * Every `dateTime` column this plugin writes, by table.
 *
 * Named rather than discovered, so that adding a column without thinking about
 * its precision shows up here as a missing entry rather than silently
 * inheriting whole-second storage.
 *
 * @type {Record<string, string[]>}
 */
const TIMESTAMP_COLUMNS = {
  approval_requests: [
    'created_at',
    'updated_at',
    'expires_at',
    'decided_at',
    'redacted_at',
    'launch_attempted_at',
  ],
  approval_decisions: ['created_at'],
  approval_grants: ['expires_at', 'consumed_at', 'revoked_at'],
};

/**
 * Columns that may not be null, so `.alter()` does not quietly relax them.
 *
 * @type {Record<string, string[]>}
 */
const NOT_NULL = {
  approval_requests: ['created_at', 'updated_at'],
  approval_decisions: ['created_at'],
  approval_grants: ['expires_at'],
};

/**
 * Store timestamps to the millisecond, and index the column task events look up.
 *
 * **Precision.** `table.dateTime(col)` with no precision compiles to
 * `DATETIME(0)` on MySQL, which *rounds* rather than truncates: two decisions
 * recorded at `10:00:00.750` and `10:00:00.900` both read back as
 * `10:00:01.000`, half a second in the future. Two approvals in the same second
 * then tie, and a tie is broken by a random UUID — which scrambles the
 * "oldest decision first" contract of `ConsumeGrantResponse.approvedBy` and the
 * audit history with it. Postgres and SQLite already keep sub-second values, so
 * this is MySQL alone diverging from the other two.
 *
 * SQLite is skipped deliberately. It has no datetime type to widen, so the
 * change would be a no-op — but knex implements `.alter()` there by rebuilding
 * the table, and rebuilding four tables to change nothing is a real risk taken
 * for no gain.
 *
 * **The index.** `findRequestByTaskId` runs for *every* `scaffolder.task` event
 * in the instance — every open, claim, status change and cancellation, for
 * every template, gated or not — against a table that is never pruned. It was
 * a full scan.
 *
 * @param {import('knex').Knex} knex
 */
exports.up = async function up(knex) {
  await knex.schema.alterTable('approval_requests', table => {
    table.index(['task_id'], 'ar_task_idx');
  });

  if (isSqlite(knex)) {
    return;
  }

  for (const [tableName, columns] of Object.entries(TIMESTAMP_COLUMNS)) {
    await knex.schema.alterTable(tableName, table => {
      for (const column of columns) {
        const builder = table.dateTime(column, { precision: 3 });
        if (NOT_NULL[tableName]?.includes(column)) {
          builder.notNullable().alter();
        } else {
          builder.nullable().alter();
        }
      }
    });
  }
};

/**
 * @param {import('knex').Knex} knex
 */
exports.down = async function down(knex) {
  if (!isSqlite(knex)) {
    for (const [tableName, columns] of Object.entries(TIMESTAMP_COLUMNS)) {
      await knex.schema.alterTable(tableName, table => {
        for (const column of columns) {
          const builder = table.dateTime(column);
          if (NOT_NULL[tableName]?.includes(column)) {
            builder.notNullable().alter();
          } else {
            builder.nullable().alter();
          }
        }
      });
    }
  }

  await knex.schema.alterTable('approval_requests', table => {
    table.dropIndex(['task_id'], 'ar_task_idx');
  });
};

/**
 * @param {import('knex').Knex} knex
 */
function isSqlite(knex) {
  return /sqlite/.test(knex.client.config.client);
}
