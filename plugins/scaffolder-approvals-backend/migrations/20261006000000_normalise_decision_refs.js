// @ts-check

const {
  parseEntityRef,
  stringifyEntityRef,
} = require('@backstage/catalog-model');

/**
 * Store each decision's approver ref normalised, like every other ref.
 *
 * Requests, approver lists and the gate policy have always been stored
 * normalised, but a decision kept the ref as the voter's token spelled it. The
 * one-vote-each index and the quorum count both compare refs exactly, so one
 * person under two spellings could count twice. The service now normalises
 * before it records a vote; this brings the votes already stored in line.
 *
 * A row is left as it is when normalising it would collide with a vote
 * already stored under the normalised spelling: decisions are the audit
 * trail, so neither row is deleted.
 *
 * @param {string} ref
 * @returns {string | undefined}
 */
function normalise(ref) {
  try {
    return stringifyEntityRef(
      parseEntityRef(ref.trim(), { defaultNamespace: 'default' }),
    );
  } catch {
    return undefined;
  }
}

/**
 * @param {import('knex').Knex} knex
 */
exports.up = async function up(knex) {
  const rows = await knex('approval_decisions').select(
    'id',
    'request_id',
    'approver_ref',
  );

  const voted = new Set(
    rows.map(row => `${row.request_id}\n${row.approver_ref}`),
  );

  for (const row of rows) {
    const normalised = normalise(row.approver_ref);
    if (!normalised || normalised === row.approver_ref) {
      continue;
    }
    const key = `${row.request_id}\n${normalised}`;
    if (voted.has(key)) {
      continue;
    }
    await knex('approval_decisions')
      .where({ id: row.id })
      .update({ approver_ref: normalised });
    voted.add(key);
  }
};

/**
 * Nothing to undo: the normalised refs are valid refs for the same people,
 * and the spellings they replaced are not kept.
 *
 * @param {import('knex').Knex} _knex
 */
exports.down = async function down(_knex) {};
