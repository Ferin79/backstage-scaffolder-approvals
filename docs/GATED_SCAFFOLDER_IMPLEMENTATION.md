# Gated Scaffolder Workflows — Implementation Guide

Step-by-step build plan for `@backstage-community/plugin-scaffolder-approvals`.

Design rationale, prior art and the full decision record live in
[GATED_SCAFFOLDER_WORKFLOWS.md](GATED_SCAFFOLDER_WORKFLOWS.md). **This document is the how.** Every
step traces back to a numbered decision (Q1–Q24) from that record; where a step exists _because_ of a
decision, the decision is cited inline so nobody silently re-litigates it mid-build.

## Progress

| Phase                             | Status   |
| --------------------------------- | -------- |
| 0 — Proposal and scaffolding      | **Done** |
| 1 — Common package                | **Done** |
| 2 — Database and store            | **Done** |
| 3 — Approval service              | **Done** |
| 4 — Router and permissions        | **Done** |
| 5 — Gate action                   | **Done** |
| 6 — Catalog processor             | **Done** |
| 7 — Sweeps, events, notifications | **Done** |
| 8 — Frontend                      | **Done** |
| 9 — End-to-end verification       | **Done** |
| 10 — Upstream preparation         | **Done** |

Branch: `feat/scaffolder-approvals`. Phase 0.1 (proposal issue) and 0.2 (BEP comment) are
outward-facing GitHub actions and are deliberately **not** done — see Phase 0 below.

## How to use this document

- Phases are a dependency chain. Do not start a phase until the previous one's **Exit criteria**
  pass — several phases exist specifically to make the next one testable.
- Each phase has **Context** (why this exists), **Steps**, and **Exit criteria**.
- Code blocks marked _verified_ use API shapes confirmed against `backstage/backstage@master` in
  September 2026. Blocks marked _illustrative_ show intent, not exact signatures.
- **P1, P5 and P6 are the security core.** Nothing else in the plugin matters if the gate does not
  hold. Do not defer their tests.

## Decision quick-reference

| Area             | Decision                                                                                  |
| ---------------- | ----------------------------------------------------------------------------------------- |
| Gate declaration | `approval:gate` step in template YAML (Q8). Annotation **derived**, never authored (Q18). |
| Config surface   | Only `grantTtl` and `retention` (Q8, Q17). No gate policy in config.                      |
| Quorum           | Distinct principals; group + user refs; `selfApprove` boolean; **first deny rejects**.    |
| Grant            | Single-use, hashed, bound to `values_hash` (Q10), TTL default 1h, configurable (Q7).      |
| Task failure     | Terminal. Fresh approval required (Q5).                                                   |
| Launch failure   | Auto-retry while grant valid (Q9).                                                        |
| Identity         | Plugin service credentials; `requestedBy`/`approvedBy` injected.                          |
| Reads            | Open to any signed-in user (Q12).                                                         |
| Decide           | Resource permission rule `isDesignatedApprover` (Q19).                                    |
| Duplicates       | Collapse on `(requester, template, values_hash, pending)` (Q13).                          |
| Retention        | Redact, not delete; default 180 days (Q6).                                                |
| Frontend         | Dual-ship legacy + `./alpha` (Q14); BUI inside core-components chrome (Q15, Q24).         |
| Surfaces         | Page + nav item + homepage card (Q22).                                                    |

---

# Phase 0 — Proposal and scaffolding — **DONE**

**Context.** The community-plugins acceptance process has a mandatory 14-day feedback window and a
SIG decision after it closes. That clock is pure latency, so start it before writing code. Scaffolding
is also the moment to delete what `create-app` generates but repo policy forbids keeping.

### 0.1 Open the plugin proposal issue — **SKIPPED (deferred by request)**

Use the new plugin issue template on `backstage/community-plugins`. The proposal must argue community
relevance, and the evidence here is unusually strong — cite it explicitly:

- [#16622](https://github.com/backstage/backstage/issues/16622) — open since Feb 2023, 50 comments,
  filed by a Backstage maintainer, described in Oct 2025 as the most coveted scaffolder enhancement.
- [#13809](https://github.com/backstage/backstage/issues/13809),
  [#23967](https://github.com/backstage/backstage/issues/23967) — the same need, closed for reasons
  this design respects.
- [BEP-0016 / PR #34966](https://github.com/backstage/backstage/pull/34966) — which explicitly names
  an interim community plugin as the right answer for adopters today.

State the scope narrowly: **pre-execution approval gating for scaffolder templates.** Not a workflow
engine — #23967 was closed on exactly that ground, and conflating the two invites the same outcome.

### 0.2 Comment on BEP-0016 — **NOT DONE (needs your go-ahead)**

> Posts publicly to `backstage/backstage` under your account, so it is left for you to
> send. The draft text is in this section.

Post on PR #34966 that you are building the interim plugin it describes, with ~100 templates in
production. A named adopter is what that BEP needs to attract a maintainer co-owner, and it also
establishes that your plugin is the intended consumer of the core primitive when it lands.

### 0.3 Create the workspace — **DONE**

```bash
cd D:/Ferin/Code/community-plugins
yarn create-workspace       # prompts for name and owners
# name: scaffolder-approvals
```

This shells out to `@backstage/create-app` with a local override template, so it generates
`packages/app` and `packages/backend` alongside `plugins/`.

**Delete `packages/app`** (Q16). Repo policy in `.github/copilot-instructions.md` is explicit —
plugins use a `dev/index.tsx` harness, and PRs adding a full example app get flagged. Keep
`packages/backend`: this plugin spans a catalog processor, a scaffolder action and a backend, and
that integration is precisely what must be demonstrable.

```bash
cd workspaces/scaffolder-approvals
rm -rf packages/app
# edit package.json workspaces + scripts to drop app references
```

### 0.4 Generate the six packages — **DONE**

```bash
yarn new     # run six times
```

| Package                               | `yarn new` type       | Role                                |
| ------------------------------------- | --------------------- | ----------------------------------- |
| `scaffolder-approvals-common`         | common-library        | Types, permissions, state enum      |
| `scaffolder-approvals-node`           | node-library          | Service ref, launcher interface     |
| `scaffolder-approvals-backend`        | backend-plugin        | DB, router, state machine, sweeps   |
| `scaffolder-backend-module-approvals` | backend-plugin-module | The `approval:gate` action          |
| `catalog-backend-module-approvals`    | backend-plugin-module | Derives the `gated` annotation      |
| `scaffolder-approvals`                | frontend-plugin       | Page, nav, home card, API decorator |

The two module packages must be separate because they register against **different** backends —
`scaffolderActionsExtensionPoint` on the scaffolder, `catalogProcessingExtensionPoint` on the catalog.
Neither can live inside `-backend`.

### Exit criteria

- [ ] ~~Proposal issue open; 14-day window running.~~ — deferred by request (0.1)
- [ ] Comment posted on PR #34966 — awaiting go-ahead (0.2)
- [x] `yarn install`, `yarn tsc`, `yarn lint:all`, `yarn prettier:check`, `yarn fix --check` all clean
- [x] No `packages/app` directory (the workspace template never generates one)
- [x] Apache-2.0 header on every generated `.ts`/`.tsx`
- [x] CODEOWNERS entry added in alphabetical position
- [x] All six packages carry correct `backstage.role` and `pluginId` metadata

### What actually happened — deviations from the plan above

Four things differed from what this guide originally assumed. They are recorded because each one
would otherwise cost the next person the same hour.

**The scaffolding CLIs cannot be driven non-interactively.** `yarn create-workspace` takes no flags
at all — it is pure `inquirer`, and it discards the `owners` answer it collects. `backstage-cli new`
_does_ support `--select` / `--option`, but hits a chicken-and-egg failure in this repo layout:
without the target package directory it fails with `ENOENT ... tsconfig.json`, and with the directory
present it refuses with "Package already exists". Both were abandoned. The workspace skeleton was
copied from the `gcalendar` workspace (a current, minimal, `plugins`-only workspace) and the six
packages were written from `announcements` and `scaffolder-backend-module-regex` as references. Same
result, fully deterministic, no network.

**An empty `yarn.lock` in the workspace root is load-bearing.** Without one, yarn treats the
workspace as part of the repo-root project and refuses to install:
`"The nearest package directory doesn't seem to be part of the project declared in ..."`. The repo's
own workspace template ships a 28-byte `yarn.lock` for exactly this reason. Copy it.

**That failure exits 0.** Yarn printed a usage error and still returned success, so exit codes are
not trustworthy in this workspace — verify by checking for the artefact (here, a populated
`yarn.lock`) rather than by status.

**`core.autocrlf=true` breaks `prettier:check` on copied files.** Files copied from another workspace
arrive CRLF, and the in-workspace prettier (2.8.8, per repo convention) flags every one. Two further
wrinkles: the template's own `tsconfig.json` and `plugins/README.md` are not prettier-formatted, and
`npx prettier` inside a workspace can resolve the repo-root prettier 3 instead of the workspace's 2 —
which reports a _different_ set of files. The gate that actually matters is `yarn prettier:check`
**run inside the workspace**, because that is what `.github/workflows/ci.yml` executes per-workspace.
Fix: normalise copied files to LF, then `yarn prettier:fix`.

**`.yarn` was added to `.prettierignore`** — a deliberate one-line divergence from other workspaces.
`.yarn/plugins/@yarnpkg/plugin-backstage.cjs` is a vendored, minified file that prettier would
happily rewrite; ignoring it keeps it byte-identical to every other workspace's copy. Verified with
`git diff -- .yarn` returning empty.

### Files created

```text
workspaces/scaffolder-approvals/
├── .changeset/{config.json,README.md}
├── .yarn/plugins/@yarnpkg/plugin-backstage.cjs
├── .yarnrc.yml            # pins the backstage yarn plugin to release 1.54.5
├── .dockerignore .eslintignore .eslintrc.js .gitignore .prettierignore
├── backstage.json         # 1.54.5 — must match the .yarnrc.yml plugin spec
├── bcp.json               # autoVersionBump + listDeprecations on, knipReports off
├── package.json           # @internal/scaffolder-approvals
├── tsconfig.json          # includes plugins/*/migrations
├── yarn.lock
├── README.md
└── plugins/
    ├── scaffolder-approvals-common/         (common-library)
    ├── scaffolder-approvals-node/           (node-library)
    ├── scaffolder-approvals-backend/        (backend-plugin)
    ├── scaffolder-backend-module-approvals/ (backend-plugin-module, pluginId scaffolder)
    ├── catalog-backend-module-approvals/    (backend-plugin-module, pluginId catalog)
    └── scaffolder-approvals/                (frontend-plugin, dual-ship exports)
```

Each package has `package.json`, `.eslintrc.js`, `README.md`, `src/index.ts` and `src/setupTests.ts`.
The `src/index.ts` files are placeholders that compile on their own; each implementation phase
replaces the relevant one with real exports.

`packages/backend` (Q16) is **not** created yet — it is only useful once there is something to wire
into it, so it lands in Phase 9 alongside end-to-end verification.

---

# Phase 1 — Common package — **DONE**

**Context.** Everything else imports from here, so getting the types right first prevents churn.
`-common` must stay **isomorphic** — no Node imports whatsoever — because the frontend consumes it.

### 1.1 State and core types

`plugins/scaffolder-approvals-common/src/types.ts`

```ts
/** @public */
export type ApprovalRequestStatus =
  | 'pending'
  | 'approved'
  | 'running'
  | 'completed'
  | 'failed'
  | 'rejected'
  | 'cancelled'
  | 'expired';

/** Terminal states cannot transition further. */
export const TERMINAL_STATUSES: ApprovalRequestStatus[] = [
  'completed',
  'failed',
  'rejected',
  'cancelled',
  'expired',
];

/** Frozen at submit time so later template edits cannot change an in-flight request. */
export interface GatePolicy {
  approvers: string[]; // entity refs — group: or user:, mixed
  quorum: number;
  selfApprove: boolean;
  timeout?: { hours?: number; days?: number };
  summary?: string;
}

export interface ApprovalRequest {
  id: string;
  templateRef: string;
  values: Record<string, unknown> | null; // null once redacted
  valuesHash: string;
  requesterRef: string;
  status: ApprovalRequestStatus;
  summary: string | null;
  policySnapshot: GatePolicy;
  taskId?: string;
  createdAt: string;
  updatedAt: string;
  expiresAt?: string;
  decidedAt?: string;
  redactedAt?: string;
}

export interface ApprovalDecision {
  id: string;
  requestId: string;
  approverRef: string;
  decision: 'approve' | 'deny';
  comment?: string;
  createdAt: string;
}
```

Note `values: ... | null` — redaction (Q6) is a first-class state, not an afterthought, and the
frontend must render a redacted request without crashing.

### 1.2 Permissions

`plugins/scaffolder-approvals-common/src/permissions.ts`

```ts
import { createPermission } from '@backstage/plugin-permission-common';

export const RESOURCE_TYPE_APPROVAL_REQUEST = 'scaffolder-approval-request';

export const approvalRequestCreatePermission = createPermission({
  name: 'scaffolderApprovals.request.create',
  attributes: { action: 'create' },
});

export const approvalRequestReadPermission = createPermission({
  name: 'scaffolderApprovals.request.read',
  attributes: { action: 'read' },
  resourceType: RESOURCE_TYPE_APPROVAL_REQUEST,
});

export const approvalRequestDecidePermission = createPermission({
  name: 'scaffolderApprovals.request.decide',
  attributes: { action: 'update' },
  resourceType: RESOURCE_TYPE_APPROVAL_REQUEST,
});

export const approvalRequestCancelPermission = createPermission({
  name: 'scaffolderApprovals.request.cancel',
  attributes: { action: 'update' },
  resourceType: RESOURCE_TYPE_APPROVAL_REQUEST,
});

export const scaffolderApprovalsPermissions = [
  approvalRequestCreatePermission,
  approvalRequestReadPermission,
  approvalRequestDecidePermission,
  approvalRequestCancelPermission,
];
```

`create` is a basic permission (there is no resource yet at create time). The other three are resource
permissions.

### 1.3 Constants and the values hash

```ts
export const GATE_ACTION_ID = 'approval:gate';
export const GATED_ANNOTATION = 'scaffolder-approvals.backstage.io/gated';
export const APPROVAL_GRANT_SECRET = 'APPROVAL_GRANT';
```

The values hash is computed in **three** places — submit, grant mint, and gate consume (Q10) — so it
must be defined once and be canonical. Sort keys recursively before serialising, or two structurally
identical value sets will hash differently and the gate will reject legitimate runs.

```ts
/** Canonical JSON: object keys sorted recursively. Arrays keep their order. */
export function canonicalise(value: unknown): unknown {
  /* ... */
}
/** sha256(canonicalJson(values)) — hex. Implemented per-side (node:crypto / WebCrypto). */
```

Keep `canonicalise` in `-common` and the actual digest in `-node`, so `-common` stays isomorphic.

### Exit criteria

- [x] `-common` has zero Node imports, and all three dependencies
      (`@backstage/catalog-model`, `@backstage/plugin-permission-common`, `@backstage/types`) are
      isomorphic
- [x] `canonicalJson` has unit tests proving key order and nesting do not affect the result
- [x] `yarn build:api-reports` produces a report for `-common` (and is idempotent on a second run)
- [x] 25 tests pass across `canonicalJson`, `gatePolicy` and `types`
- [x] `tsc:full`, `lint:all` and `prettier:check` clean

### What landed

| File               | Purpose                                                                                                                |
| ------------------ | ---------------------------------------------------------------------------------------------------------------------- |
| `constants.ts`     | `GATE_ACTION_ID`, `GATED_ANNOTATION`, `APPROVAL_GRANT_SECRET`, resource type, defaults                                 |
| `types.ts`         | Status union, `GatePolicy`, `ApprovalRequest`, `ApprovalDecision`, API request/response types, `computeQuorumProgress` |
| `permissions.ts`   | The four permissions — create (basic), read / decide / cancel (resource)                                               |
| `canonicalJson.ts` | Deterministic JSON serialisation for the values hash                                                                   |
| `gatePolicy.ts`    | `readGatePolicy` — normalises and validates a gate step's input                                                        |

### Decisions made while implementing

These were not settled in the design review and were decided here. Each is small, but each is the
kind of thing that is expensive to change later.

**`canonicalJson` throws rather than coercing.** `JSON.stringify` maps `NaN` and `Infinity` to
`null`, which would let two materially different inputs produce the same hash. Since the output is a
security binding, non-representable values (`NaN`, `Infinity`, bigint, function, symbol, `undefined`
at the root, circular references) raise `CanonicalJsonError` instead. `-0` is normalised to `0`,
because they are the same JSON number. `undefined` object properties are still dropped and
`undefined` array slots still become `null`, matching `JSON.stringify` — a caller who omits an
optional field must get the same hash as one who sets it to `undefined`.

**Approver refs are normalised through `catalog-model`, not by hand.** Entity refs are
case-insensitive with an optional namespace, so `Group:DevX` and `group:default/devx` denote the same
group. `parseEntityRef` + `stringifyEntityRef` produces a fully-qualified lowercase ref, which is
what the caller's `ownershipEntityRefs` look like. Anything less would silently fail to match and
lock an approver out of their own gate. This is why `-common` depends on `@backstage/catalog-model`.

**Duplicate approvers are de-duplicated after normalisation.** Listing the same group twice must not
inflate the achievable quorum.

**A zero timeout is an error, not "no timeout".** `timeout: { hours: 0 }` would expire every request
on the first sweep. Treating it as no timeout would silently disable what the author asked for, so
`readGatePolicy` rejects it and directs the author to omit the field.

**`quorum` may exceed `approvers.length`.** One group ref can expand to many members, so this is
legitimate rather than a mistake to catch.

**`computeQuorumProgress` lives in `-common`.** Both the backend's gate logic and the UI's progress
indicator need it, and they must never disagree about what "1 of 2" means. It counts distinct
principals, and treats any single denial as decisive regardless of the approval count.

**`ApprovalRequest.values` and `.summary` are `| null`.** Redaction is a first-class state rather
than an afterthought, so every consumer is forced to handle a redacted request.

### Notes for the next phase

`canonicalJson` produces the _string_; the SHA-256 digest of it belongs in `-node`, which is where
Phase 2 will add it. Keeping the digest out of `-common` is what lets `-common` stay isomorphic.

Two type packages had to be added to the frontend package to make `tsc:full` pass:
`@types/react-dom` (referenced by the CLI's `asset-types.d.ts`) and `@types/aria-query` (imported by
`@testing-library/jest-dom@6.9`, which ships no types for it). A fresh lockfile resolves a newer
jest-dom than the donor workspaces pinned, which is why they do not need the latter.

`src/alpha.ts` was created as a placeholder in the frontend package. The `./alpha` export is part of
the dual-ship contract, and the API report generator fails on an export that points at a missing
file.

---

# Phase 2 — Database and store — **DONE**

**Context.** Concurrency correctness lives here. Two backend replicas will race on decisions, grants
and sweeps, and the only defence is compare-and-set at every transition. Getting this right now is far
cheaper than debugging a double-launch in production.

### 2.1 Migrations

Location: `plugins/scaffolder-approvals-backend/migrations/` — **top-level, not `db/migrations`**.
That is the dominant convention (12 plugins vs 1); `announcements` is the outlier.

`migrations/20260911000000_init.js`

```js
exports.up = async function up(knex) {
  await knex.schema.createTable('approval_requests', table => {
    table.uuid('id').primary().notNullable();
    table.string('template_ref', 255).notNullable();
    table.text('values_json').nullable().comment('JSON; nulled on redaction');
    table.string('values_hash', 64).notNullable();
    table.string('requester_ref', 255).notNullable();
    table.string('status', 32).notNullable();
    table.text('summary').nullable();
    table
      .text('policy_snapshot')
      .notNullable()
      .comment('JSON, frozen at submit');
    table.string('task_id', 255).nullable();
    table.dateTime('created_at').defaultTo(knex.fn.now()).notNullable();
    table.dateTime('updated_at').defaultTo(knex.fn.now()).notNullable();
    table.dateTime('expires_at').nullable();
    table.dateTime('decided_at').nullable();
    table.dateTime('redacted_at').nullable();

    table.index(['status', 'expires_at'], 'ar_status_expires_idx');
    table.index(['status', 'created_at'], 'ar_status_created_idx');
    table.index(['requester_ref'], 'ar_requester_idx');
    table.index(
      ['requester_ref', 'template_ref', 'values_hash', 'status'],
      'ar_collapse_idx',
    );
  });

  await knex.schema.createTable('approval_decisions', table => {
    table.uuid('id').primary().notNullable();
    table
      .uuid('request_id')
      .references('id')
      .inTable('approval_requests')
      .onDelete('CASCADE')
      .notNullable();
    table.string('approver_ref', 255).notNullable();
    table.string('decision', 16).notNullable();
    table.text('comment').nullable();
    table.dateTime('created_at').defaultTo(knex.fn.now()).notNullable();

    table.unique(['request_id', 'approver_ref'], 'ad_one_vote_each');
  });

  await knex.schema.createTable('approval_grants', table => {
    table.uuid('id').primary().notNullable();
    table
      .uuid('request_id')
      .references('id')
      .inTable('approval_requests')
      .onDelete('CASCADE')
      .notNullable();
    table.string('token_hash', 64).notNullable();
    table.string('values_hash', 64).notNullable();
    table.dateTime('expires_at').notNullable();
    table.dateTime('consumed_at').nullable();
    table.string('consumed_by_task_id', 255).nullable();

    table.unique(['request_id', 'token_hash'], 'ag_token_unique');
    table.index(['consumed_at', 'expires_at'], 'ag_sweep_idx');
  });
};
```

Portability constraints, all load-bearing:

- **No partial indexes** — not portable across SQLite/Postgres/MySQL.
- **JSON as `text`**, not a native JSON column type.
- **String lengths on indexed columns** — MySQL will not index unbounded `text`.
- Use `dateTime`, not `timestamp`, for consistency with how the scaffolder does it.

### 2.2 Store with compare-and-set transitions

Every state change is a guarded `UPDATE` whose affected-row count is checked. Read-then-write is a
bug, not a style choice.

```ts
/** Returns true only if THIS call performed the transition. */
async transition(
  id: string,
  from: ApprovalRequestStatus,
  to: ApprovalRequestStatus,
  extra: Partial<RawRow> = {},
): Promise<boolean> {
  const n = await this.db('approval_requests')
    .where({ id, status: from })
    .update({ status: to, updated_at: this.db.fn.now(), ...extra });
  return n === 1;
}
```

The grant consume is the security-critical one (Q10) — note all five guards:

```sql
UPDATE approval_grants
   SET consumed_at = now(), consumed_by_task_id = ?
 WHERE request_id = ?
   AND token_hash = ?
   AND values_hash = ?          -- Q10: values must match what was approved
   AND consumed_at IS NULL      -- single use
   AND expires_at > now();      -- Q7: TTL
-- affected rows MUST be exactly 1, else fail closed
```

### 2.3 Duplicate collapse (Q13)

```ts
async createOrCollapse(input: NewRequest): Promise<{ id: string; collapsed: boolean }> {
  return this.db.transaction(async tx => {
    const existing = await tx('approval_requests')
      .where({
        requester_ref: input.requesterRef,
        template_ref: input.templateRef,
        values_hash: input.valuesHash,
        status: 'pending',
      })
      .first();
    if (existing) return { id: existing.id, collapsed: true };
    const id = uuid();
    await tx('approval_requests').insert({ id, ...toRow(input) });
    return { id, collapsed: false };
  });
}
```

A transaction rather than a unique constraint, because the constraint would need to be partial
(`WHERE status = 'pending'`) and partial indexes are not portable. Under heavy concurrency two
replicas could still both insert; that is acceptable — the consequence is one duplicate inbox entry,
not a security failure.

### 2.4 Wire up migrations

```ts
// verified pattern — matches tech-insights-backend and linguist-backend
import {
  DatabaseService,
  resolvePackagePath,
} from '@backstage/backend-plugin-api';

const migrationsDir = resolvePackagePath(
  '@backstage-community/plugin-scaffolder-approvals-backend',
  'migrations',
);

export async function initStore(database: DatabaseService) {
  const client = await database.getClient();
  if (!database.migrations?.skip) {
    await client.migrate.latest({ directory: migrationsDir });
  }
  return new ApprovalStore(client);
}
```

`resolvePackagePath` — not a relative path — so migrations resolve from both `src` and packed `dist`.

### Exit criteria

- [x] Migrations run up **and down** cleanly, and up again after a rollback, via
      `TestDatabases.create()` — **on SQLite only so far.** See "Postgres and MySQL are unverified
      locally" below; this is the one exit criterion not fully met.
- [x] Test: two concurrent `transition(id, 'pending', 'approved')` calls — exactly one returns true.
- [x] Test: two concurrent grant consumes — exactly one succeeds.
- [x] Test: grant consume with a mismatched `values_hash` fails.
- [x] Test: grant consume after `expires_at` fails.
- [x] Test: `createOrCollapse` returns the same id for an identical pending request.
- [x] 64 tests pass in `-backend`, 11 in `-node`; `tsc:full`, `lint:all`, `prettier:check` clean;
      `build:api-reports` generated and idempotent.

### Postgres and MySQL are unverified locally

This machine has no container runtime, so `TestDatabases` cannot start either engine and only SQLite
actually ran. Two things close the gap as far as it can be closed without Docker:

1. `migrations.test.ts` iterates `databases.eachSupportedId()`, so the same suite covers all three
   engines wherever a runtime exists — CI included, with no changes needed.
2. `migrationPortability.test.ts` compiles the migration to DDL for `better-sqlite3`, `pg` and
   `mysql2` without connecting to anything, and asserts the portability rules that fail on exactly
   one engine: no partial indexes, no index over an unbounded `text` column, JSON as `text` rather
   than a native type, no reserved word as a column name, and MySQL index keys inside the 3072-byte
   InnoDB budget. It needs no database, so it runs everywhere and guards later migrations too.

What remains genuinely unproven locally is runtime behaviour that only a real server shows: actual
row-level locking under true parallelism, and each driver's date round-tripping. **CI is the first
place all three engines run.**

Two environment notes, neither caused by this phase. `CI=true` — required on Windows to stop the
Jest runner hanging — is also what makes `backend-test-utils` _attempt_ containers, since it decides
via `Boolean(BACKSTAGE_TEST_DISABLE_DOCKER) || !Boolean(CI)`; run DB suites with
`BACKSTAGE_TEST_DISABLE_DOCKER=1 CI=true`. And `better-sqlite3` had no compiled binding after
`yarn install`, so even SQLite failed until `node node_modules/prebuild-install/bin.js` was run from
inside `node_modules/better-sqlite3`.

### What landed

| File                                | Purpose                                                             |
| ----------------------------------- | ------------------------------------------------------------------- |
| `migrations/20260911000000_init.js` | The three tables, with `up` and `down`                              |
| `src/database/tables.ts`            | Row types and table-name constants                                  |
| `src/database/rowMapping.ts`        | Row → wire type, including the timestamp normaliser                 |
| `src/database/ApprovalStore.ts`     | Compare-and-set transitions, grant mint/consume, duplicate collapse |
| `src/database/initStore.ts`         | `resolvePackagePath` + `migrations?.skip` wiring                    |
| `-node/src/hashes.ts`               | `sha256Hex`, `computeValuesHash`, `assertSha256Hex`                 |
| `-node/src/grantToken.ts`           | `generateGrantToken`, `hashGrantToken`                              |

The store is deliberately **not** exported from the package entry point — it is internal to the
backend plugin, so its shape stays free to change. The `-backend` API report is empty as a result.

### Decisions made while implementing

**The `values` column is named `values_json`.** `VALUES` is reserved in MySQL and in standard SQL. A
column called `values` does work, but only because knex quotes every identifier — an implicit
dependency on the query builder that the first piece of hand-written SQL would trip over. The suffix
also pairs it with `values_hash`. A test asserts no column is named a reserved word.

**No `CURRENT_TIMESTAMP` in any predicate; the store takes an injected clock.** Postgres compiles
`dateTime` to `timestamptz`, MySQL to a naive `datetime` and SQLite to a number, and their notions of
"now" do not line up — a `WHERE expires_at > now()` would mean three different things. Every
comparison binds an explicit JavaScript `Date` instead, so both sides go through the same driver
conversion. The clock is constructor-injected, which also lets the expiry tests drive time rather
than sleep on it.

**Scaffolder task ids are `string(255)`, not `uuid`.** Postgres validates its native `uuid` type, and
the task id format belongs to the scaffolder rather than to us. Our own ids stay `uuid`, where that
validation is a benefit.

**A timestamp normaliser was needed, and this was measured rather than assumed.** better-sqlite3
returns epoch milliseconds, pg and mysql2 return a `Date`, and mysql2 with `dateStrings` returns a
naive datetime string — which `new Date(...)` would read in the server's local zone and silently
shift. `timestampToIso` handles all three and treats a zoneless string as UTC.

**The store never sees a raw grant token.** It stores and matches hashes only, so store code cannot
log a usable credential. `assertSha256Hex` guards the boundary, because the failure without it is
silent: passing a raw token where a hash belongs would persist the token in plaintext and still
appear to work.

**`createOrCollapse` verifies that the values and their hash agree.** The hash is what binds a grant
to what was approved, so a stored mismatch would mean approving one thing while being able to run
another. One SHA-256 per create makes that inconsistency unrepresentable in the database.

**Collapse ignores a pending request that has already timed out.** Collapsing into one the sweep is
about to bin would hand the requester a request nothing will ever act on.

**`recordDecision` settles its outcome by reading the row back, not from an affected-row count.**
`onConflict().ignore()` compiles to `INSERT IGNORE` on MySQL, whose counts also swallow unrelated
failures such as a foreign key violation. Comparing the stored id to the one generated is
dialect-independent, and an absent row after the insert is reported as "the request may not exist".
It returns the vote that _stands_, so a caller can tell an approver what they already decided instead
of silently dropping the second vote.

**`ar_retention_idx` on `(redacted_at, updated_at)` was added for Phase 7.** The retention sweep will
look for old requests not yet redacted; the index costs nothing now and saves a migration later. Its
query methods are Phase 7's.

### Verification note

The two concurrency guards were mutation-tested rather than assumed: `transition` was temporarily
rewritten as a read-then-write and `consumeGrant` as a check-then-consume, and in both cases the
corresponding test failed and then passed again once reverted. `Promise.all` interleaves the calls at
their `await` boundaries, which is what makes that detectable even on synchronous SQLite. True
parallelism still only happens on Postgres and MySQL.

### Notes for the next phase

Phase 3's service owns everything the store deliberately does not: expanding group refs to decide who
may vote, computing quorum from `listDecisions` via `computeQuorumProgress`, generating and hashing
grant tokens, and choosing which transitions to attempt. `ApprovalStore.listRequests` takes only
DB-shaped filters (`status`, `templateRef`, `requesterRef`, `ids`) — the `role: 'approver'` view in
`ListApprovalRequestsOptions` needs catalog group expansion, so it resolves to an `ids` or
`templateRef` filter a layer up, which is also where Phase 4's permission `toQuery` will push its
filter down.

---

# Phase 3 — Approval service (state machine) — **DONE**

**Context.** The router should contain no business logic. Everything about quorum, transitions and
launching lives here, so it is unit-testable without HTTP.

### 3.1 Quorum evaluation

Rules, all from the decision record:

```ts
async recordDecision(requestId, approverRef, decision, comment) {
  const request = await this.store.get(requestId);
  assertStatus(request, 'pending');

  // selfApprove: false — the requester cannot decide on their own request
  if (!request.policySnapshot.selfApprove && approverRef === request.requesterRef) {
    throw new NotAllowedError('Self-approval is not permitted for this request');
  }

  await this.store.insertDecision({ requestId, approverRef, decision, comment });
  // UNIQUE(request_id, approver_ref) — a second vote throws ConflictError

  // FIRST DENY REJECTS — a quorum is a threshold for assent, not a tally
  if (decision === 'deny') {
    await this.store.transition(requestId, 'pending', 'rejected', {
      decided_at: this.db.fn.now(),
    });
    await this.notifyDecided(request, approverRef, 'deny', comment);
    return;
  }

  const approvals = await this.store.countApprovals(requestId);
  if (approvals < request.policySnapshot.quorum) return; // still pending

  if (await this.store.transition(requestId, 'pending', 'approved', {
    decided_at: this.db.fn.now(),
  })) {
    await this.notifyDecided(request, approverRef, 'approve', comment);
    await this.launch(request);   // idempotent — see 3.2
  }
}
```

Counting is over **distinct `approver_ref`**, enforced by the unique constraint. A user in two listed
approver groups still counts once because they have one entity ref.

### 3.2 Launch, and why it is idempotent

```ts
async launch(request: ApprovalRequest) {
  const { token } = await this.store.mintGrant({
    requestId: request.id,
    valuesHash: request.valuesHash,
    ttl: this.grantTtl,          // Q7 — configurable, default 1h
  });

  const credentials = await this.auth.getOwnServiceCredentials();  // §10.1
  try {
    const { taskId } = await this.scaffolder.scaffold(
      {
        templateRef: request.templateRef,
        values: request.values!,
        secrets: { [APPROVAL_GRANT_SECRET]: token },
      },
      { credentials },
    );
    await this.store.setTaskId(request.id, taskId);
    await this.store.transition(request.id, 'approved', 'running');
  } catch (e) {
    // Q9: launch failure is NOT task failure. Leave it `approved` with no
    // task_id; the reconciliation sweep retries while the grant is valid.
    this.logger.warn(`Launch failed for ${request.id}, will retry`, e);
  }
}
```

Two decisions are visible here and both matter:

- **Service credentials, not the requester's.** `AuthService` cannot mint credentials for an arbitrary
  user from an entity ref, and the approval lands days later with no requester request in flight.
  Consequence: `task.createdBy` is the service principal, which is why your own request page — not the
  scaffolder task list — is the canonical view.
- **Launch failure leaves the request `approved`.** Nothing executed, the grant is unconsumed, so
  retrying is safe and correct. This is deliberately different from a task that ran and failed (Q5),
  which is terminal.

### 3.3 Submit

```ts
async submit({ templateRef, values, credentials }) {
  const requesterRef = extractUserRef(credentials);
  const template = await this.catalog.getEntityByRef(templateRef, { credentials });
  if (!template) throw new NotFoundError(templateRef);

  const gateStep = findGateStep(template);          // the approval:gate step
  if (!gateStep) throw new InputError('Template is not gated');

  // Q3 — validate BEFORE storing, so an approval is never spent on an
  // unrunnable request.
  await this.validateValues(template, values);

  const policy = readPolicy(gateStep.input);        // frozen snapshot
  const valuesHash = await sha256Canonical(values);

  const { id, collapsed } = await this.store.createOrCollapse({
    templateRef, values, valuesHash, requesterRef,
    policySnapshot: policy,
    summary: gateStep.input.summary,
    expiresAt: policy.timeout ? addDuration(now(), policy.timeout) : undefined,
  });

  if (!collapsed) {
    await this.notifySubmitted(id, policy.approvers);
    await this.events.publish({ topic: 'scaffolder-approvals', eventPayload: {
      action: 'requested', requestId: id, templateRef, requesterRef,
    }});
  }
  return { id, collapsed };
}
```

The policy is read from the template's gate step and **snapshotted**, so editing the template later
cannot change the terms of an in-flight request.

### Exit criteria

- [x] `quorum: 2` stays pending after one approval, moves to `approved` after a second from a
      different principal.
- [x] A second vote from the same approver throws `ConflictError`, and does not reach the quorum.
- [x] One deny among three approvals still rejects.
- [x] `selfApprove: false` blocks the requester even when they are in an approver group
      (mutation-tested: removing the guard fails this test in both packages).
- [x] A failing `scaffold()` leaves the request `approved` with no `task_id` (not `failed`).
- [x] Invalid values are rejected at submit and nothing is stored.
- [x] 165 tests pass (41 common, 19 node, 105 backend); `tsc:full`, `lint:all`, `prettier:check`
      clean; `build:api-reports` regenerated and idempotent.

### What landed

| File                                      | Purpose                                                  |
| ----------------------------------------- | -------------------------------------------------------- |
| `-backend/src/service/ApprovalService.ts` | Submit, decide, cancel, launch — the whole state machine |
| `-backend/src/service/validateValues.ts`  | Ajv validation of values against `spec.parameters`       |
| `-backend/config.d.ts`                    | The complete config surface (`grantTtl`, `retention`)    |
| `-node/src/gateStep.ts`                   | `findGateStep`, `isGated` — one definition of "gated"    |
| `-common/src/eligibility.ts`              | `isApprover`, `checkDecisionEligibility`                 |
| `-common/src/entityRefs.ts`               | `normaliseEntityRef`, now shared with `readGatePolicy`   |

### Decisions made while implementing

**The gate must be the first step, and there must be exactly one.** The plan never said where the
gate has to sit, and that turns out to matter: a gate at step 3 lets steps 1 and 2 run before anyone
has approved, while the template still looks gated. `findGateStep` rejects both that and a template
with two gates, whose policy would be ambiguous and whose second grant could never be satisfied.

**`findGateStep` lives in `-node`, not in the service.** Phase 6's catalog processor has to decide
"is this template gated" from the same evidence the service uses, or the derived annotation can drift
from the gate. `isGated` is deliberately more permissive than `findGateStep`: a template with a
malformed gate still counts as gated, because reading it as ungated would make it freely runnable.

**`launch` refuses to mint a second live grant — a correction to the plan.** §3.2 is titled "Launch,
and why it is idempotent", but the code in it mints a fresh grant on every call, which is _not_
idempotent: a crash between `scaffold()` returning and the status transition leaves a running task
whose id was never recorded, and Phase 7's retry would mint a new grant and run the template a second
time. Single-use grants do not help, because the retry brings its own. So `launch` now declines while
an unconsumed, unexpired grant exists, and `ApprovalStore.hasLiveGrant` was added for it. **Note for
Phase 7:** the sweep should recover a lost `task_id` from the grant's `consumed_by_task_id` rather
than relaunching; if the task never started, the grant expires and the request fails, which is the
documented outcome anyway.

**Approver matching uses `UserInfoService.ownershipEntityRefs`, not group expansion.** The catalog
already computes transitive membership, so one call replaces walking group relations, and it is the
same data the permission framework uses. This is also what makes "adding someone to an approver group
takes effect immediately" true rather than aspirational.

**Eligibility is one shared function returning a reason.** `checkDecisionEligibility` gives back
`not-an-approver` / `self-approval` / `not-pending` / `already-voted`; the backend maps each onto an
HTTP error and the UI will map them onto tooltips. Same argument as `computeQuorumProgress` — the
disabled button and the server's refusal must never disagree, or give different explanations. The
order matters too: someone outside the policy entirely hears that, rather than a confusing note about
self-approval.

**Self-approval and already-voted compare the caller's _user_ ref; approver membership compares their
whole ownership set.** A request is submitted by a user and a vote is cast by a user, never by a
group, so widening those two checks to the ownership set would be imprecise for no benefit.

**Ajv runs with `strict: false`, and never coerces.** Scaffolder parameter schemas are also
react-jsonschema-form UI descriptions carrying `ui:field`, `ui:options`, `enumNames` and friends.
Ajv's strict mode rejects a schema containing those outright, which would fail every realistic
template. Coercion and `useDefaults` are off because either would change what gets hashed, so the
values an approver saw would stop matching the values that run.

**A multi-page `parameters` array drops top-level `additionalProperties` per page.** Each entry
describes one wizard page and knows only its own properties, so applying one page's
`additionalProperties: false` to the whole value object would reject everything the other pages
contributed. Single-page schemas keep it.

**Unknown properties are accepted, matching the scaffolder.** Rejecting them would break templates
that pass extra values through, and the scaffolder itself does not reject them. They are still bound
by the values hash and shown to approvers, so what an approver sees is what runs.

**Notifications, events and signals sit behind an `ApprovalObserver` interface.** All three are soft
dependencies (§7.5), so the state machine must work with none of them installed, and payload shapes
do not belong in it. Observer failures are caught and logged: a committed approval must not be
reported as failed because a notification could not be sent. Phase 7 implements the interface without
touching the service.

**`cancel` is requester-only.** That is what `cancelled` means as distinct from `rejected`. Phase 4's
permission check sits in front of this rather than replacing it; if admin-cancel is ever wanted, this
is the rule to revisit.

**A denial that loses the race to a quorum is recorded but logged as late.** If an approval reaches
quorum first, the `pending → rejected` transition fails. The denial stays on record as part of the
audit trail, and a warning says it arrived after the request had left `pending`. There is no way to
do better — at the moment of approval there genuinely was no denial — and the compare-and-set
guarantees the two outcomes can never both apply.

**`launch` refuses a redacted request.** Retention only redacts long after a terminal state, so
`approved` with null values means the retention window and the lifecycle disagree. Failing loudly
beats launching a template with no parameters.

### Verification note

The self-approval guard was mutation-tested: removing it from `checkDecisionEligibility` fails one
test in `-common` and one in `-backend`. That pairing is deliberate — the shared helper is unit-tested
directly, and the service test proves the service actually consults it.

Service tests run against the **real store on SQLite**, not a mocked store, so quorum counting, the
one-vote-per-approver constraint and every transition are exercised through real SQL. Only the
catalog, scaffolder and user-info services are faked, since those are the process boundaries.

### Notes for the next phase

Phase 4 wraps this in HTTP and permissions. The service already throws the right error types —
`NotFoundError`, `InputError`, `NotAllowedError`, `ConflictError` — so the router needs no error
mapping of its own beyond Backstage's default middleware.

`ApprovalStore.listRequests` still takes only DB-shaped filters (`status`, `templateRef`,
`requesterRef`, `ids`); the `role: 'approver'` view in `ListApprovalRequestsOptions` is where Phase 4
turns a caller's `ownershipEntityRefs` into a filter, which is also where the permission rule's
`toQuery` belongs.

`config.d.ts` declares `grantTtl` and `retention.redactAfter`. Only `grantTtl` is read so far — it is
passed to `ApprovalService` as a `HumanDuration`; Phase 7 reads `retention`.

---

# Phase 4 — Router and permissions — **DONE**

**Context.** Reads are open to any signed-in user (Q12), so there is no list filtering to implement —
`toQuery` is a no-op. The only real authorization is `decide`, routed through the permission framework
so the RBAC plugin can see and extend it (Q19).

### 4.1 Resource ref and rules

Uses the **current** permission API — `createPermissionResourceRef`, not the older
`makeCreatePermissionRule`. `catalog-backend`'s `CatalogBuilder` is the reference.

```ts
// -node/src/permissions.ts — verified API shape
import {
  createPermissionResourceRef,
  createPermissionRule,
} from '@backstage/plugin-permission-node';
import { z } from 'zod';

export const approvalRequestResourceRef = createPermissionResourceRef<
  ApprovalRequest,
  ApprovalRequestFilter
>().with({
  pluginId: 'scaffolder-approvals',
  resourceType: RESOURCE_TYPE_APPROVAL_REQUEST,
});

export const isDesignatedApprover = createPermissionRule({
  resourceRef: approvalRequestResourceRef,
  name: 'IS_DESIGNATED_APPROVER',
  description: 'Allow decisions from the request\u2019s designated approvers',
  paramsSchema: z.object({
    userRefs: z.array(z.string()).describe('Caller identity and group refs'),
  }),
  apply: (request, { userRefs }) =>
    request.policySnapshot.approvers.some(a => userRefs.includes(a)),
  toQuery: () => ({}), // Q12 — reads unrestricted, nothing to filter
});

export const isNotRequester = createPermissionRule({
  resourceRef: approvalRequestResourceRef,
  name: 'IS_NOT_REQUESTER',
  description: 'Deny decisions from the requester (four-eyes control)',
  paramsSchema: z.object({ userRef: z.string() }),
  apply: (request, { userRef }) => request.requesterRef !== userRef,
  toQuery: () => ({}),
});

export const hasTemplateRef = createPermissionRule({/* ...scoping rule... */});
```

### 4.2 Registration

```ts
// verified pattern — mirrors CatalogBuilder
permissionsRegistry.addResourceType({
  resourceRef: approvalRequestResourceRef,
  permissions: scaffolderApprovalsPermissions,
  rules: [isDesignatedApprover, isNotRequester, hasTemplateRef],
  getResources: async refs => store.getManyByIds(refs),
});
```

`getResources` is what lets the framework load a request by id so `apply` can run against it.

### 4.3 Caller identity expansion (Q11)

```ts
async expandCaller(credentials): Promise<string[]> {
  // Fast path: resolved at sign-in, no catalog call.
  const own = credentials.principal.ownershipEntityRefs ?? [];
  if (own.length) return own;

  // Fallback: one catalog read, cached ~60s, so a user added to an approver
  // group mid-session is not locked out until their next login.
  return this.membershipCache.get(userRef, async () => {
    const user = await this.catalog.getEntityByRef(userRef, { credentials });
    return [userRef, ...(user?.relations ?? [])
      .filter(r => r.type === 'memberOf')
      .map(r => r.targetRef)];
  });
}
```

### 4.4 Routes

| Route                         | Notes                                                                    |
| ----------------------------- | ------------------------------------------------------------------------ |
| `POST /requests`              | `approvalRequestCreatePermission`; body `{ templateRef, values }`        |
| `GET /requests`               | `status`, `role`, `templateRef`, `requesterRef`, `limit`, `offset` (Q21) |
| `GET /requests/:id`           | Detail plus decision history                                             |
| `POST /requests/:id/decision` | `authorize` with `resourceRef: id` (Q19)                                 |
| `POST /requests/:id/cancel`   | Requester only, `pending` only                                           |
| `POST /grants/consume`        | **Service principal only** — reject user principals outright             |

```ts
// decision route — the check the whole feature rests on
const userRefs = await expandCaller(credentials);
const [decision] = await permissions.authorize(
  [{ permission: approvalRequestDecidePermission, resourceRef: req.params.id }],
  { credentials },
);
if (decision.result !== AuthorizeResult.ALLOW) throw new NotAllowedError();
```

`GET /requests` returns `{ items, totalItems }` ordered `created_at DESC`.

### Exit criteria

- [x] `/grants/consume` rejects a user principal with 403 (mutation-tested: relaxing the guard to
      `httpAuth.credentials(req)` fails this test and the unauthenticated one).
- [x] A non-approver gets 403 on `/decision`; a designated approver succeeds.
- [x] A group member of a listed approver group succeeds — bob is never named by the gate, only
      `group:default/devx-team` is.
- [x] Any signed-in user can `GET /requests` and see everything (Q12).
- [x] Pagination returns a correct `totalItems` independent of `limit`, including alongside a filter.
- [x] 217 tests pass (41 common, 34 node, 142 backend); `tsc:full`, `lint:all`, `prettier:check`
      clean; `build:api-reports` regenerated and idempotent.

### What landed

| File                                                      | Purpose                                                   |
| --------------------------------------------------------- | --------------------------------------------------------- |
| `-backend/src/service/router.ts`                          | The six routes, and all the authorization                 |
| `-backend/src/plugin.ts`                                  | `createBackendPlugin`, resource-type registration, config |
| `-backend/migrations/20260912000000_request_approvers.js` | The approvers table, with a backfill                      |
| `-node/src/permissions.ts`                                | Resource ref, `ApprovalRequestFilter`, the three rules    |
| `-node/src/grantToken.ts`                                 | `formatGrant` / `parseGrant` (added)                      |

### Corrections to the plan

**§4.3 describes something that does not exist, and something already built.** Its fast path reads
`credentials.principal.ownershipEntityRefs`, but `BackstageUserPrincipal` carries only
`userEntityRef`. More to the point, the two-tier expansion §4.3 hand-rolls — token claims first, one
cached catalog read as a fallback — _is_ `DefaultUserInfoService`: it decodes `ent` from the JWT and
falls back to `GET /api/auth/v1/userinfo`. So there is no `expandCaller` and no membership cache;
Phase 3 already used `UserInfoService`, and Phase 4 just calls it.

One consequence is worth stating plainly, since §4.3's cache was trying to avoid it: when a token
carries `ent`, ownership refs are as of sign-in, so somebody added to an approver group mid-session
is not recognised until their token refreshes. That is how every Backstage plugin that uses ownership
refs behaves, the catalog's own `isOwner` rule included. A private cache here would make this plugin
_differ_ from the rest of Backstage, which is worse than the staleness.

**`toQuery: () => ({})` would have been a lie.** An empty object is not a no-op criterion, it is a
`TQuery` of `{}`. The rules now return real filters over a deliberately narrow
`ApprovalRequestFilter` (`requesterRef`, `templateRef`, `approverRef`) — each answerable by an
indexed column or the approvers table. `apply` is what a `decide` authorization actually uses, so
these cost little, but a filter language that could express something the database cannot answer
would have to be applied in memory, and could then neither page nor report a correct total.

**The consume endpoint needed a contract the plan did not give it.** The gate action holds the token
but has no way to learn the request id, while the store's `request_id` guard needs one. It cannot
arrive as a template _value_ — the values hash covers exactly what the requester submitted, so an
extra field would break the binding the grant exists to enforce — and deriving it from the token
alone would mean giving up that guard. So a grant is now a single compound secret,
`<requestId>.<token>`, built and split by `formatGrant` / `parseGrant`. The id half is not secret (it
is in URLs), so bundling it costs nothing and keeps this to one task secret.

### Decisions made while implementing

**A normalised `approval_request_approvers` table, added as a second migration.** "Which requests am
I an approver for" is the inbox — the primary view of the whole feature — and the approvers live
inside a JSON `text` column. Answering from JSON means scanning and filtering in memory, which cannot
page and cannot report a correct total. Denormalising is safe precisely because the policy is a frozen
snapshot: the rows are written once, with the request, and never change. Group membership is
deliberately _not_ expanded into the table — a row holds the `group:` ref as written, and the
caller's ownership refs are matched against it at query time, which is what keeps immediate group
membership working. The migration backfills from existing snapshots in JavaScript, because parsing
JSON in SQL is not portable; a snapshot that will not parse is skipped rather than failing the
migration for every other request.

**The list filter is a subquery, not a join.** A request whose policy names two refs the caller holds
would otherwise be counted twice.

**A conditional read policy is refused loudly.** Reads are open to any signed-in user (Q12), so there
is no filter to push down — but the route still calls `authorizeConditional`, so that a policy
denying reads is honoured, and so that a policy returning a _condition_ gets a clear 403 instead of
being silently ignored. Silently ignoring it would be a quiet hole in whatever that policy was trying
to enforce. The extension point is the rules' `toQuery` plus `ListApprovalRequestRows.approverRefs`.

**Zod failures are translated into `InputError`.** A bare `schema.parse` throws `ZodError`, which
Backstage's error middleware does not recognise as a client error — so a malformed body came back as
a **500**. This was a real defect, caught by a test expecting 400. `parseOrBadRequest` now wraps every
schema in the router.

**`createPermissionRule` is used through its non-deprecated overload.** The zod-v3 `paramsSchema`
form is deprecated in favour of a Standard Schema, and this workspace has `listDeprecations: true`.
Zod 4 satisfies `StandardSchemaV1 & StandardJSONSchemaV1`, so importing from `'zod'` picks the current
overload with no deprecation.

**`isNotRequester` fails closed on an unparseable ref.** "Is not the requester" must not be satisfied
by accident — that rule is the four-eyes control.

**A collapsed duplicate returns 200, not 201.** Nothing was created, so 201 would be a lie.

**The permission check on `/decision` runs _in addition to_ the service's eligibility check.** They
answer different questions: the permission layer is what an RBAC policy can see and extend (Q19),
while the service enforces the gate's own terms. Either can refuse. A test asserts a DENY from the
policy is honoured even when the gate would have allowed the vote.

**`/grants/consume` trusts the caller's `valuesHash` to describe the task it is running.** Nothing
else can — only the task knows its own values. That is exactly why the route refuses user principals,
and the refusal is deliberately identical for every failure: telling a bearer-token holder whether it
was the token, the values or the expiry that failed would be an oracle. A test asserts the two
messages are byte-identical.

**`cancel` stays requester-only in the service**, with the cancel permission checked in front of it.
If admin-cancel is ever wanted, the service rule is what to revisit — not the router.

### Verification note

The service-principal guard on `/grants/consume` was mutation-tested: relaxing it to
`httpAuth.credentials(req)` fails both the user-principal and the unauthenticated tests.

The router tests configure `mockServices.httpAuth({ defaultCredentials: mockCredentials.none() })`.
Without that the mock treats a request with **no credentials as the default mock user**, which made
the unauthenticated cases pass while testing nothing — they were green for the wrong reason until
this was fixed.

One run of the backend suite reported 3 failures which six later runs — including the identical
command — could not reproduce, and the output was truncated before the names were captured. Recorded
here rather than dismissed: the suspicion is contention over the many per-test SQLite databases, and
it is worth watching in CI.

### Notes for the next phase

Phase 5's gate action reads `ctx.secrets[APPROVAL_GRANT_SECRET]`, splits it with `parseGrant`,
recomputes the values hash from the running task with `computeValuesHash`, and POSTs
`{ grant, valuesHash, taskId }` to `/grants/consume` using its own plugin service credentials. A
non-200 must fail the step — that refusal is the enforcement point for the entire feature.

`findGateStep` is already exported from `-node` and rejects a gate that is not first or a template
with two gates, so the action can rely on its own step being step one.

---

# Phase 5 — The gate action — **DONE**

**Context.** **This is the security boundary.** Everything else is user experience. If this action can
be bypassed, the plugin provides no control at all. Budget real time for its tests.

### 5.1 The action

```ts
// verified: createTemplateAction takes a ZOD-CALLBACK schema, not JSON Schema
import { createTemplateAction } from '@backstage/plugin-scaffolder-node';

export function createApprovalGateAction(deps: {
  auth: AuthService;
  discovery: DiscoveryService;
}) {
  return createTemplateAction({
    id: 'approval:gate',
    description: 'Blocks the template until the request has been approved.',
    schema: {
      input: {
        approvers: z =>
          z.array(z.string()).describe('Group or user entity refs'),
        quorum: z => z.number().int().positive().optional(),
        selfApprove: z => z.boolean().optional(),
        timeout: z =>
          z
            .object({
              hours: z.number().optional(),
              days: z.number().optional(),
            })
            .optional(),
        summary: z => z.string().optional(),
      },
      output: {
        requestId: z => z.string(),
        approvedBy: z => z.array(z.string()),
      },
    },
    async handler(ctx) {
      const token = ctx.secrets?.[APPROVAL_GRANT_SECRET];
      if (!token) {
        throw new Error(
          'This template requires approval. Submit it through the ' +
            'approvals page rather than running it directly.',
        );
      }

      // Recompute the hash from the values ACTUALLY running (Q10)
      const valuesHash = await sha256Canonical(
        ctx.templateInfo?.entity ? pickTemplateParameters(ctx) : {},
      );

      const res = await fetch(
        `${await discovery.getBaseUrl('scaffolder-approvals')}/grants/consume`,
        {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            authorization: `Bearer ${
              (
                await auth.getPluginRequestToken({
                  onBehalfOf: await auth.getOwnServiceCredentials(),
                  targetPluginId: 'scaffolder-approvals',
                })
              ).token
            }`,
          },
          body: JSON.stringify({ token, valuesHash, taskId: ctx.task.id }),
        },
      );

      if (!res.ok)
        throw new Error(`Approval grant rejected: ${await res.text()}`);
      const { requestId, requesterRef, approvedBy } = await res.json();

      // Inject the real actors — task.createdBy is the service principal (§10.1)
      ctx.output('requestId', requestId);
      ctx.output('approvedBy', approvedBy);
      ctx.output('requestedBy', requesterRef);
    },
  });
}
```

Three properties that make this hold:

1. **`ctx.secrets` is populated even though the DB column is nulled on claim.** Verified:
   `claimTask()` parses the secrets before nulling, and returns them in memory.
2. **Fails closed.** No token, wrong token, consumed token, expired token, mismatched values — all
   throw, and throwing on step 1 means no later step runs.
3. **Service-to-service auth**, so `/grants/consume` can reject user principals outright.

### 5.2 Module registration

```ts
export const scaffolderModuleApprovals = createBackendModule({
  pluginId: 'scaffolder',
  moduleId: 'approvals',
  register(env) {
    env.registerInit({
      deps: {
        scaffolder: scaffolderActionsExtensionPoint,
        auth: coreServices.auth,
        discovery: coreServices.discovery,
      },
      async init({ scaffolder, auth, discovery }) {
        scaffolder.addActions(createApprovalGateAction({ auth, discovery }));
      },
    });
  },
});
```

### Exit criteria — treat these as release-blocking

- [x] **Bypass.** The action throws when the task carries no grant, and when `secrets` is absent
      entirely. Partially met — see "what is and is not proven" below.
- [x] **Replay.** A consumed grant used a second time is rejected — proven against the real store
      and the real router, not a mock.
- [x] **Tamper.** A grant redeemed with a different `values_hash` is rejected, likewise against the
      real store and router.
- [x] **Expiry.** A grant past `expires_at` is rejected, driven by the injected clock.
- [x] **Happy path.** A grant unlocks the run, and `requestId` / `requestedBy` / `approvedBy` are
      published as task outputs.
- [x] 236 tests pass (41 common, 34 node, 143 backend, 18 module); `tsc:full`, `lint:all`,
      `prettier:check` clean; `build:api-reports` regenerated and idempotent.

### What is and is not proven

Worth being exact about, because this is the security boundary and the criteria above were written to
be release-blocking.

**Proven against real code.** Replay, tamper and expiry are enforced by the five guards in
`ApprovalStore.consumeGrant`, and those are tested through real SQL (Phase 2) and through the real
router over HTTP (Phase 4). The action's own tests prove it refuses to proceed without a grant,
refuses when the step did not pass `values`, sends a hash it computed itself from the running
parameters, and fails the step on any non-2xx — including when the backend is unreachable.

**Not proven yet.** The action's tests mock `fetch`, so the action-to-endpoint hop has not been
exercised over real HTTP. And "the task fails at step 1 and no subsequent step executes" is asserted
at the level of _the handler throwing_, not against a running `NunjucksWorkflowRunner` with step
statuses. Both need a backend with the scaffolder installed, which is Phase 9's job — this row should
not be considered closed until Phase 9 runs a gated template end to end.

**What closes most of the gap in the meantime.** The request and response shapes now live in
`-common` as `ConsumeGrantRequest` / `ConsumeGrantResponse`, and both the action's body and the
router's zod schema are typed against them. Field-name drift between the two — the one failure a
mocked `fetch` could hide — is now a compile error rather than a runtime surprise.

### What landed

| File                                     | Purpose                                        |
| ---------------------------------------- | ---------------------------------------------- |
| `module/src/createApprovalGateAction.ts` | The gate action                                |
| `module/src/module.ts`                   | `createBackendModule` registering it           |
| `module/README.md`                       | Template-author documentation                  |
| `-common/src/types.ts`                   | `ConsumeGrantRequest` / `ConsumeGrantResponse` |

### Corrections to the plan

**`pickTemplateParameters(ctx)` is not implementable.** `ActionContext` has no `parameters` field —
it carries `input`, `secrets`, `task.id`, `templateInfo`, `user`, `workspacePath` and little else. An
action simply cannot see the task's submitted parameters. Since recomputing the hash from the values
_actually running_ is the entire tamper check (Q10), this needed a real answer rather than a helper
name.

The answer: the gate step passes them itself, `values: ${{ parameters }}`, and `values` is a
**required** input. That is the same whole-object form `fetch:template` uses in essentially every
Backstage template, so it is idiomatic rather than novel, and it keeps the values on the one surface
the person starting a run cannot influence — the step input, which comes from the catalog. A gate
step that omits it fails rather than running unchecked, and the handler re-checks the shape itself
rather than trusting schema validation alone.

The alternative considered was fetching the task spec back from the scaffolder API. Rejected: it adds
an HTTP round trip from inside the scaffolder to itself, and depends on the task being readable by
the module's service credentials, which is a second thing that can go wrong on the security boundary.

**`scaffolderActionsExtensionPoint` is exported from the package root, not `/alpha`.**

**The plan's handler outputs `requestedBy` but its schema does not declare it.** All three outputs are
declared now, and `/grants/consume` returns `requesterRef` and `approvedBy` so there is something to
declare — previously it returned only `{ requestId }`.

### Decisions made while implementing

**The action does not parse the grant.** It sends the compound string whole and lets the router split
it. One less thing on the security boundary, and `parseGrant` already has one tested caller.

**The timeout schema accepts all eight `HumanDuration` units.** The action's input schema is what the
scaffolder validates a gate step against, so anything narrower than `readGatePolicy` would let a
template submit cleanly and then fail at the gate.

**Not dry-run capable.** A dry run has no grant. Supporting it would mean either passing without one,
which makes the gate look optional, or failing every dry run of a gated template.

**An unreachable backend fails the step**, with a message that says so. Treating an outage as a pass
would turn it into an ungated execution — the worst possible failure mode for this component.

**The action cannot tell the refusals apart, by design.** The backend answers every failure
identically, so the action's message names all three possibilities without claiming to know which. A
test asserts the wording covers used / expired / different-parameters together.

**`consumeGrant` reads the request back only after the grant is spent**, so nothing about a request
leaks to a caller whose token was refused.

### Notes for the next phase

Phase 6's processor should derive the annotation with `isGated` from `-node`, which is deliberately
more permissive than `findGateStep`: a template with a malformed gate still counts as gated, because
reading it as ungated would make it freely runnable. The processor is also the right place to warn
about a gate step missing `values: ${{ parameters }}`, since that is a mistake worth catching at
ingestion rather than at the moment someone tries to run the thing.

---

# Phase 6 — Catalog processor — **DONE**

**Context.** The processor **derives** the `gated` annotation from the presence of an `approval:gate`
step (Q18). It does not inject anything and does not read config. One source of truth means the
annotation cannot drift from the gate, so the dangerous mismatch — annotated-but-ungated — cannot
exist.

```ts
export class ApprovalsGateProcessor implements CatalogProcessor {
  getProcessorName() {
    return 'ApprovalsGateProcessor';
  }

  async preProcessEntity(entity: Entity): Promise<Entity> {
    if (entity.kind !== 'Template') return entity;

    const steps = (entity as TemplateEntityV1beta3).spec?.steps ?? [];
    const gated = steps.some(s => s.action === GATE_ACTION_ID);
    if (!gated) return entity;

    return {
      ...entity,
      metadata: {
        ...entity.metadata,
        annotations: {
          ...entity.metadata.annotations,
          [GATED_ANNOTATION]: 'true',
        },
      },
    };
  }
}
```

Deliberately minimal. Optionally warn (do not error) when a gated template's later steps reference
`secrets.USER_OAUTH_TOKEN`, since those tokens will be dead after a multi-day wait (§10.2).

> **Accepted risk (Q17).** Nothing prevents a template owner from deleting the gate step — config
> holds no `requireGate` allowlist. Mitigate with CODEOWNERS on gated template files and by alerting
> when the derived annotation disappears from an entity. This was a deliberate decision; do not add
> enforcement without revisiting it.

### Exit criteria

- [x] A template with an `approval:gate` step gets the annotation, and keeps the annotations it
      already had.
- [x] A template without one is returned byte-identical — the same object, not merely an equal one.
- [x] Non-Template kinds pass through untouched.
- [x] An already-annotated entity is unchanged, by object identity, across refresh cycles.
- [x] 254 tests pass (41 common, 34 node, 143 backend, 18 scaffolder module, 18 catalog module);
      `tsc:full`, `lint:all`, `prettier:check` clean; `build:api-reports` regenerated and idempotent.

### What landed

| File                                           | Purpose                                       |
| ---------------------------------------------- | --------------------------------------------- |
| `catalog-module/src/ApprovalsGateProcessor.ts` | Derives the annotation, warns about bad gates |
| `catalog-module/src/module.ts`                 | `createBackendModule` registering it          |
| `catalog-module/README.md`                     | What it does, and what the annotation is not  |

### Decisions made while implementing

**The processor strips the annotation as well as stamping it — a change from the plan's code.** The
plan only adds. That leaves open the one mismatch the whole "derive it" decision (Q18) exists to
prevent: a hand-written `gated: 'true'` on a template with no gate step. Nobody would be _unsafe_ —
the approvals backend refuses to submit a request for an ungated template, so the flow just breaks —
but people would be routed into an approval flow for something they could simply run. Deriving a
value only works if one thing owns it in both directions.

**A malformed gate still counts as gated.** The annotation follows `isGated` (the step is present)
rather than `findGateStep` (the step is usable), because a template trying to be gated and failing
must not read as freely runnable.

**Warnings are logged, never emitted as entity errors.** An error that kept a template out of the
catalog would make _deleting the gate_ the way to make it appear again — exactly the wrong incentive
for the one step that enforces anything. Four warnings: gate not first, more than one gate, a gate
with no `values` input, and a later step using `secrets.USER_OAUTH_TOKEN` (§10.2 — that token belongs
to the requester and is long dead after a multi-day wait). The `values` warning is new, and comes
straight out of Phase 5: without it the gate refuses every run, so catching it at ingestion beats
catching it when somebody finally tries to use the template.

**Unchanged entities come back by reference.** The catalog re-processes every entity on each refresh
cycle; rebuilding an identical object each time is pure churn. Both the "already correct" and the
"nothing to do" paths return the input object, and a test asserts identity rather than equality.

### A note on what this does not do

The annotation is not an enforcement mechanism and should never be mistaken for one — it tells the UI
which templates to route through the approvals page. Enforcement is the gate step. A template that
lost its annotation but kept its step is still gated; one that kept its annotation but lost its step
is not, and the processor will now correct that on the next refresh.

---

# Phase 7 — Sweeps, events and notifications — **DONE**

**Context.** Three scheduled jobs, each with a per-tick batch cap so a mass expiry after an outage
cannot stampede the scaffolder.

### 7.1 Reconciliation sweep (Q4, Q9)

Events are the primary status signal; this sweep is the backstop that stops requests getting stuck
when an event is dropped.

```ts
// every ~2 minutes, capped
// 1. approved + no task_id  → retry launch while the grant is valid (Q9)
// 2. approved + grant expired → transition to failed, "approval expired before launch"
// 3. running + task_id      → getTask(); sync completed/failed/cancelled
```

### 7.2 Timeout sweep

`pending` requests past `expires_at` → `expired`, guarded on `WHERE status = 'pending'` so a decision
landing at the same moment wins or loses cleanly, never both.

### 7.3 Retention sweep (Q6)

**Redacts, never deletes.** After the configured window, null `values` and `summary`, stamp
`redacted_at`. Request rows and all decisions are kept indefinitely — that is the audit trail the
whole feature exists to produce.

### 7.4 Event subscription

Subscribe to the scaffolder's own `scaffolder.task` topic (verified to exist, payload carries
`{ id, status }`) and map task status onto request status for requests with a matching `task_id`.

### 7.5 Notifications (Q20)

Exactly four, each deep-linking to the request page:

| Event       | Recipients            |
| ----------- | --------------------- |
| Submitted   | Approvers             |
| Decided     | Requester             |
| Task failed | Requester + approvers |
| Expired     | Requester + approvers |

Not shipped: "launched" (redundant with "decided") and "expiring soon" (needs its own tick). Emit
Signals alongside, so an open request page live-updates. Both are soft dependencies — the plugin must
work with neither installed.

### Config

```yaml
scaffolderApprovals:
  grantTtl: { hours: 1 } # Q7
  retention:
    redactAfter: { days: 180 } # Q6
```

That is the entire config surface (Q8, Q17). Gate policy is per-template, never here.

### Exit criteria

- [x] `approved` with no `task_id` is retried, then fails once the grant expires — and, when the
      grant was in fact consumed, the lost task id is recovered instead of relaunching.
- [x] Retention nulls `values` and `summary` but leaves the row, its decisions and the values hash
      intact, and redacts once rather than on every tick.
- [x] A dropped event still converges via the sweep — `applyTaskStatus` is shared by both paths and
      is compare-and-set, so whichever signal arrives second does nothing.
- [x] The backend starts and functions with notifications and signals absent.
- [x] 298 tests pass (41 common, 34 node, 187 backend, 18 scaffolder module, 18 catalog module);
      `tsc:full`, `lint:all`, `prettier:check` clean; `build:api-reports` idempotent.

### What landed

| File                                   | Purpose                                           |
| -------------------------------------- | ------------------------------------------------- |
| `src/service/ApprovalSweeps.ts`        | The three scheduled jobs                          |
| `src/service/ApprovalNotifier.ts`      | Notifications, signals and events behind one seam |
| `src/service/subscribeToTaskEvents.ts` | The task-event fast path                          |
| `src/plugin.ts`                        | Scheduler wiring, config, soft dependencies       |
| `src/database/ApprovalStore.ts`        | Seven sweep queries plus `redact`                 |

### A correction to the plan

**Notifications and signals cannot be "absent" in the way §7.5 implies.** Both `notificationService`
and `signalsServiceRef` carry a `defaultFactory`, so they always resolve — declaring them as ordinary
deps does not stop a backend without those plugins from starting. The soft-dependency behaviour comes
from tolerating _call-time_ failure, not from conditional resolution: `ApprovalNotifier` treats every
channel as optional, attempts each independently, and swallows and logs what fails. An earlier draft
here hand-rolled an `optional()` resolver against an `env.getService` that does not exist; the ref
definitions made that unnecessary.

### Decisions made while implementing

**Reconciliation distinguishes three situations, and that distinction is the whole job.** Approved
with no task id can mean the launch never happened, that it happened and the status write was lost,
or that the grant expired unused. The grant tells them apart: a _consumed_ grant names the task that
consumed it, so the id is recovered rather than the template being run a second time — this is what
`consumed_by_task_id` was added for in Phase 2 and promised in Phase 3. A _live_ grant means
something is in flight, so the sweep waits. No usable grant and no grant ever minted means retry; no
usable grant but one was minted means the approval is spent and the request fails (Q9).

**A cancelled task maps to `failed`, not `cancelled`.** In this lifecycle `cancelled` means the
requester withdrew _before anyone decided_. A task cancelled mid-run was approved and then stopped,
which is a failure to deliver what was approved — calling it `cancelled` would blur the one
distinction the audit trail needs to keep.

**`applyTaskStatus` is shared by the sweep and the event handler.** Both paths therefore reach the
same state, and because the transition is compare-and-set the second signal to arrive does nothing.
A test asserts that applying `completed` then `failed` leaves the request `completed`.

**Redaction only touches terminal requests.** Redacting the values of something still in flight would
leave a request that can never be launched. It is also guarded on `redacted_at IS NULL`, so two
replicas sweeping at once do not both count it, and a second tick does not move `redactedAt`.

**Signals go only to users; notifications go to groups too.** An open page belongs to a person, so a
group ref is dropped rather than silently expanded — and when that leaves nobody, the signal is
skipped while the notification still goes.

**Notifications are scoped per request and action**, so a re-notification replaces rather than piling
up in somebody's inbox, and the requester is excluded from the "submitted" notification even when
they are also an approver.

**The notifier falls back to the template ref once the summary is redacted.** A failure notification
can outlive the summary it would rather have quoted.

### The task-event topic is unverified

`SCAFFOLDER_TASK_TOPIC` is `'scaffolder.task'`, which this workspace cannot confirm —
`@backstage/plugin-scaffolder-backend` is not a dependency here and nothing that is declares it. The
subscription is therefore built as an optimisation rather than a guarantee: `readTaskEvent` accepts
either `id` or `taskId`, ignores any payload it cannot read, and never throws. If the topic or shape
is wrong, no event ever matches, nothing breaks, and the reconciliation sweep remains the sole source
of task status — costing a request one sweep interval of staleness. **Phase 9 should confirm the
topic against a real scaffolder.**

### An intermittent test failure, recorded rather than dismissed

Running all five package suites back to back reported exactly 3 failures in the backend suite — the
second time this has happened (the first was at the end of Phase 4). It did not reproduce in roughly
ten subsequent runs, including the identical loop, and both times the output had been piped through
`grep` so the failing names were lost. The suspicion is contention over the many per-test SQLite
databases rather than a defect, but that is a suspicion. Full logs are now captured when running the
whole workspace, so the next occurrence is diagnosable.

### Notes for the next phase

Phase 8's frontend has everything it needs on the API: `GET /requests?role=approver` is an indexed
query against the approvers table, `checkDecisionEligibility` in `-common` gives the same reasons the
backend refuses with (so a disabled button and a server error can agree), and `computeQuorumProgress`
gives "1 of 2". Signals arrive on the `scaffolder-approvals` channel carrying
`{ action, requestId, status }`, which is enough for an open page to know it should refetch.

---

# Phase 8 — Frontend — **DONE**

**Context.** Dual-shipped (Q14) with BUI components inside core-components page chrome (Q15, Q24).
Write components **once** as plain React; both plugin definitions mount the same components, so the
duplication is wiring only (Q23).

### 8.1 Layout

```text
src/
  components/          # written once, framework-agnostic
    ApprovalsPage/     # Inbox | My requests tabs
    RequestDetail/     # values, justification, decision history, quorum progress
    StatusPill/        # hand-rolled — BUI has no coloured badge
    PendingCard/       # homepage card (Q22)
  api/
    ApprovalsClient.ts
    scaffolderApiDecorator.ts
  plugin.tsx           # legacy createPlugin
  alpha.ts             # createFrontendPlugin — same components
```

### 8.2 The status pill

BUI's `Badge` and `Tag` have **no** colour or status prop — verified against BUI 0.17.1. Status
colours exist only as tokens. Follow `argo-workflows`' `WorkflowStatusBadge`: a `Box`+`Flex` pill with
a CSS module keyed by status.

```css
.pending {
  color: var(--bui-fg-warning);
}
.approved,
.completed {
  color: var(--bui-fg-success);
}
.rejected,
.failed {
  color: var(--bui-fg-danger);
}
.running {
  color: var(--bui-fg-info);
}
.cancelled,
.expired {
  color: var(--bui-fg-secondary);
}
.pill {
  border: 1px solid currentColor;
  border-radius: var(--bui-radius-full);
}
```

### 8.3 What BUI does and does not give you

| Need               | Use                                                                 |
| ------------------ | ------------------------------------------------------------------- |
| Inbox table        | BUI `Table` + `useTable` — sorting, pagination, `rowConfig.onClick` |
| Approve/deny modal | BUI `Dialog` (not "Modal") + `DialogFooter`                         |
| Comment field      | BUI `TextAreaField`                                                 |
| Status pill        | Hand-rolled (above)                                                 |
| Page chrome        | core-components `Page`/`Header`/`Content` (Q24)                     |
| Empty state        | core-components `EmptyState` — BUI has none                         |
| Errors             | core-components `ResponseErrorPanel`                                |
| Toasts             | `alertApiRef` — BUI has no toast                                    |

BUI needs **no provider**; theming is pure CSS variables. `BUIProvider` is analytics-only and has zero
usages repo-wide.

### 8.4 The scaffolder decorator

Override `scaffolderApiRef` in the app's `apis.ts`, wrapping the default client so `scaffold()` checks
the `gated` annotation and diverts to the approvals API. One override covers the wizard, embedded
workflow and deep links. **This is UX only** — the gate holds without it.

### 8.5 Dev harness

`dev/index.tsx` via `createDevApp`, which auto-injects `@backstage/ui/css/styles.css` — no manual CSS
import needed with this harness (unlike the new-frontend-system `createApp` pattern).

### Exit criteria

- [x] Both exports construct and expose the same route refs (smoke test, Q23), and the new-system
      plugin's extension ids are asserted by `getExtension`, which type-checks them.
- [x] Component tests via `renderInTestApp` + `TestApiProvider` cover: empty inbox, pending list,
      approve flow, deny-with-comment, a **redacted** request in both the list and the detail, every
      reason the decide buttons are withheld, and a backend refusal being surfaced verbatim.
- [ ] `yarn start` shows a working, styled page — **not verified.** See below.
- [x] 319 tests pass across six packages (41 common, 34 node, 187 backend, 18 scaffolder module,
      18 catalog module, 21 frontend); `tsc:full`, `lint:all`, `prettier:check` clean;
      `build:api-reports` idempotent.

### The one criterion not met

`yarn start` was not run, and no page was looked at. The dev harness is written and type-checks, and
the components are covered by tests that assert on rendered text — but nobody has seen this render.
Styling in particular is unverified: the status pill reads BUI CSS variables, and whether those
resolve correctly inside core-components page chrome is exactly the kind of thing a test that queries
text will not tell you. **Phase 9 should open it.**

### What landed

| File                              | Purpose                                          |
| --------------------------------- | ------------------------------------------------ |
| `src/api/`                        | `approvalsApiRef`, `ApprovalsClient`             |
| `src/components/ApprovalsPage/`   | Two tabs over one server-paged table             |
| `src/components/RequestDetail/`   | One request, its history, and the decide dialog  |
| `src/components/StatusPill/`      | Hand-rolled pill + CSS module                    |
| `src/components/Router.tsx`       | Written once, mounted by both plugin definitions |
| `src/plugin.tsx` / `src/alpha.ts` | The two wirings (Q14, Q23)                       |
| `dev/index.tsx`                   | Mock-backed harness                              |

### Things the BUI API forced, and one it did not

**The plan's BUI claims held up.** `Badge` and `Tag` really do take only `icon`, `size` and
`children` — there is no colour or status prop — so the hand-rolled pill was necessary rather than
preference. `Table` + `useTable`, `Dialog`, `DialogFooter` and `TextAreaField` all exist as described.

**Four corrections, all found by the compiler or a failing test:**

- `CellText.title` is typed `string`, so a status pill cannot go in one. The generic `Cell` wrapper
  takes children, and the table still requires a cell component at the top level.
- `useTable`'s pagination option is `pageSize`, not `initialPageSize`.
- BUI exports no `Heading`. `Text` carries the type scale (`title-small`, `title-x-small`) instead.
- **`Dialog` is itself the modal overlay** — `DialogProps extends ModalOverlayProps` — so a bare
  `<Dialog>` renders nothing. It needs `isOpen`, and `DialogHeader` / `DialogBody` exist to structure
  it. This was caught by a test that clicked Approve and could not find the confirmation.

### Decisions made while implementing

**The list prop is `viewAs`, not `role`.** A React prop named `role` is the ARIA attribute's name, so
`jsx-a11y` flagged it as an invalid ARIA role — correctly, in the sense that anyone skimming the JSX
would read it the same way. The API query parameter stays `role`; only the component prop changed.

**Server-side paging (`mode: 'offset'`).** The backend already reports a total independent of the
page size, and an approvals inbox is exactly the thing that grows.

**Status labels are written for people.** `approved` displays as "Starting", because it is transient
— the template is launching — and a requester seeing "Approved" with nothing happening would
reasonably wonder what went wrong. `rejected` reads "Denied" and `cancelled` reads "Withdrawn", which
is what those states mean to the person looking at them.

**The pill carries a dot as well as colour**, so status does not depend on colour alone.

**Deciding goes through a confirmation dialog.** Both outcomes are hard to take back: an approval
starts the template immediately, and a denial is terminal. The deny copy says plainly that the
comment is all the requester will see.

**A backend refusal is shown verbatim.** Those messages were written to be read by a person, so
replacing them with "something went wrong" would throw away the most useful thing about them.

**`Router` is exported from the entry point.** API Extractor flagged `ae-forgotten-export` because
`ApprovalsIndexPage`'s inferred type refers to it — and exporting it is right anyway, since an app
can then mount the page itself.

**`alpha.ts` uses `createElement` rather than JSX**, so the entrypoint stays a `.ts` file and the
`./alpha` export in `package.json` needs no special casing.

### A dependency the plan did not mention

`@testing-library/react` v16 makes `@testing-library/dom` an explicit peer, and without it every
component test fails to even load. Other frontend plugins in this repo declare it; this one now does
too.

### Notes for the next phase

§8.4's scaffolder decorator — overriding `scaffolderApiRef` so the wizard diverts a gated template to
the approvals API — is **not built**. It is UX only, by the plan's own words: the gate holds without
it, and a user who runs a gated template directly meets a clear refusal telling them to use the
approvals page. It belongs with Phase 9, where a real app exists to override the API in and to verify
the diversion actually works end to end.

---

# Phase 9 — End-to-end verification — **DONE**

**Context.** The point of keeping `packages/backend` (Q16). Unit tests cannot prove the gate holds
across four packages and two backends; this can.

Wire into `packages/backend`: catalog (+ the approvals catalog module), scaffolder (+ the approvals
scaffolder module), approvals backend, permission, notifications, signals, events, auth.

Add an example gated template under `examples/`, then walk the whole path:

1. Template appears in the catalog **with** the derived `gated` annotation.
2. Submitting via the UI creates a `pending` request and notifies approvers.
3. The requester cannot approve their own request (`selfApprove: false`).
4. One approval with `quorum: 2` keeps it pending; a second launches it.
5. The task runs, the gate consumes the grant, and later steps execute.
6. Request reaches `completed`; the detail page links to the task log.
7. **`curl` the scaffolder directly with the same `templateRef` — the task fails at step 1.**

Step 7 is the one that proves the feature works. Script it and keep it.

### Exit criteria

- [x] Steps 1, 2, 3 and **7** pass against a running backend, and are scripted as
      `scripts/verify-gate.sh`. Steps 4–6 need a group-member identity, which guest auth cannot
      provide — they are covered instead by `gate.integration.test.ts` against a real backend over
      real HTTP. See below.
- [x] Scripted: `scripts/verify-gate.sh` plus `plugins/scaffolder-backend-module-approvals/src/gate.integration.test.ts`.
- [x] A backend restart mid-`pending` loses nothing — verified by hard-killing the process and
      re-reading the request, with values, summary and policy snapshot intact.
- [x] 335 tests pass (50 common, 34 node, 187 backend, 25 scaffolder module, 18 catalog module,
      21 frontend); `tsc:full`, `lint:all`, `prettier:check` clean; `build:api-reports` idempotent.

### The one that matters

Running the gated template straight through the scaffolder, with no approval:

```
task status: failed
[log] processing  Beginning step Await approval
[log] failed      Error: This template requires approval before it can run. Submit it
                  from the approvals page instead of running it directly...
[log] skipped     Skipping step grant because a previous step failed
```

Asserted on the **step**, not just the task: a task that failed for some other reason would prove
nothing. `scripts/verify-gate.sh` checks exactly this and prints "The gate holds."

### What landed

| File                                 | Purpose                                                           |
| ------------------------------------ | ----------------------------------------------------------------- |
| `packages/backend/`                  | A backend wiring catalog, scaffolder, approvals and their modules |
| `examples/request-github-admin.yaml` | A gated template — one `approval:gate` step and nothing else      |
| `examples/org.yaml`                  | The users and groups its gate refers to                           |
| `app-config.yaml`                    | Enough to start it: SQLite, guest auth, the examples              |
| `scripts/verify-gate.sh`             | The bypass check, scripted and repeatable                         |
| `.../src/gate.integration.test.ts`   | The action against a real backend over real HTTP                  |
| `-common/src/renderSummary.ts`       | **A bug fix** — see below                                         |

### Two things only a running system found

**The gate summary was never rendered.** A template author writes
`summary: 'Admin on ${{ parameters.repository }}'`, and the design says it "may reference
parameters". It did not: the approvals backend reads the gate step **straight from the catalog
entity**, and the scaffolder's templating only runs when a task executes — which, for a gated
template, is _after_ the approval the summary exists to inform. Approvers were being shown the
literal `${{ parameters.repository }}`. Found by submitting a request against a real catalog and
reading it back.

`renderGateSummary` now fills `${{ parameters.<path> }}` at submit time, from the submitted values.
Deliberately not a templating engine: it resolves that one form and leaves everything else exactly as
written. Running a real engine over catalog-authored text with user-supplied values is a far larger
surface than a one-line label justifies, and half an engine invites people to expect the other half.

**Template entities need `catalog-backend-module-scaffolder-entity-model`.** Without it the catalog
does not know the `Template` kind and drops those entities **silently** — no error on the location,
no error in the log, just nothing ingested. This cost real time to find and is worth documenting for
anyone installing the plugin.

### What could not be verified, and why

Steps 4–6 — quorum behaviour, self-approval refusal and a task running through to `completed` —
need an identity that belongs to `group:default/devx-team`. The guest provider issues
`user:development/guest`, which belongs to nothing, so `/decision` correctly answers
_"You are not an approver for this request"_. Rather than add a fake auth provider to work around it,
those paths are covered by `gate.integration.test.ts`, which starts the real approvals backend and
drives the real gate action against it over HTTP: happy path with actors published, replay refused,
tamper refused, forged grant refused, no-grant refused, user principal refused at
`/grants/consume`, and the decision history readable afterwards.

The **frontend was still not opened in a browser.** Phase 8 left that open and it remains open: the
backend here serves no app, because `plugin-app-backend` needs a frontend package this workspace does
not have. `yarn start` inside `plugins/scaffolder-approvals` runs the dev harness against a mock API,
which is the nearest thing available.

§8.4's scaffolder decorator is still **not built**. It is UX only by the plan's own words — the gate
holds without it, as step 7 now demonstrates — and it needs a real app to override `scaffolderApiRef`
in, which this workspace still does not have.

### Notes for the next phase

Phase 10 should carry two things into the README: the `scaffolder-entity-model` module requirement,
and that `values: ${{ parameters }}` on the gate step is mandatory. Both are silent failures
otherwise — one drops the template, the other refuses every run.

---

# Phase 10 — Upstream preparation — **DONE**

- [x] `yarn build:api-reports` for every package — no warnings, and a second run changes nothing.
- [x] A changeset per package — six, each `minor`. Package versions were reset from `0.1.0` to
      `0.0.0` to make that correct; see below.
- [x] Apache-2.0 headers, 2026, on every source file. The only files without one are the one-line
      `.eslintrc.js` files, which the donor workspaces do not header either.
- [x] READMEs: a rewritten workspace README with a worked example, and one per package.
- [x] §10.1 (the task runs as the plugin) and §10.2 (user OAuth tokens expire) documented under
      "Things to know before you rely on it" in the workspace README.
- [x] CODEOWNERS entry — added in Phase 0.
- [ ] **Org membership request for maintainer rights — not done.** That is a request only you can
      make, to the Backstage org.
- [x] `tsc:full` clean; 335 tests pass; lint clean — but via `lint:all`, because
      `lint --since origin/main` turned out to check nothing here. See below.
- [ ] **Link the proposal issue in the PR description — not possible yet.** Phase 0.1 was skipped at
      your request, so there is no issue to link. The draft below leaves a placeholder for it.

### Findings

**The package versions were wrong for a first release.** Upstream precedent — the Akeyless and
healert workspaces — starts new packages at `0.0.0` with a `minor` changeset, so the first published
version is `0.1.0`. These packages were created at `0.1.0`, which would have made the first published
version `0.2.0`. They are now at `0.0.0`, and `changeset status` confirms all six will release as
`0.1.0`, with the private `backend` package excluded.

**`yarn lint --since origin/main` checks nothing in this workspace — and CI runs exactly that.** It
exited 0 with no output at all, despite ten commits of changes. To be sure it was not simply passing,
a deliberate `.toLowerCase()` violation was planted in a changed file: `lint --since` still exited 0,
while `lint:all` caught it and exited 1. `lint:all` was used as the real gate. **It is not known
whether this is Windows-specific** (plausibly how changed paths map to packages) or also true on
CI's Linux runners. If it is the latter, CI would not be linting this workspace at all, which is
worth checking on the PR's first run.

**CI's publish check fails on Windows, for a reason that is not real.** `backstage-cli repo fix
--check --publish` reported all seven packages out of sync. Applying `fix` showed why: the only thing
it changed was `repository.directory`, which it rewrote with a **backslash**
(`plugins\\scaffolder-approvals-common`) — a Windows path separator. Every donor workspace uses forward
slashes, so the committed values are correct and applying the fix would have broken the manifests
for CI. The change was reverted and each `directory` verified exactly. Expect this check to pass on
Linux; it was not possible to confirm that here.

**Three pieces of documentation described things that do not exist:**

- The workspace README's example gate had **no `values: ${{ parameters }}`**. Anyone copying it would
  have got a gate that refuses every run. It had been written in Phase 0, before Phase 5 made that
  input mandatory.
- The workspace README listed a homepage card and a scaffolder decorator as frontend features, and
  its getting-started told you to run `yarn start`, which needs a frontend app this workspace does
  not have.
- The `-node` README, and the design document in two places, described a **launcher interface in
  `-node`** that was never built — see the gaps below. All three are corrected to describe what exists.

### Gaps from earlier phases, found while writing the docs

These were decided in the design review and **not built**, and were not recorded as missing when the
phase that should have built them finished. They are recorded here instead, and are your call:

| Gap                                        | Decided in                                                                 | What was built instead                                                                                            | Size                                                                                    |
| ------------------------------------------ | -------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| **Homepage card** showing pending requests | Q22 ("page + nav item + homepage card"); Phase 8 §8.1 lists `PendingCard/` | Nothing. The approvals page is the only surface.                                                                  | Small–medium: a card component, a home-plugin extension for each frontend system, tests |
| **Nav item** for the new frontend system   | Q22                                                                        | Nothing for the new system. The legacy system relies on the app adding a sidebar link, which the README now says. | Small: a `NavItemBlueprint` in `alpha.ts`                                               |
| **Launcher interface in `-node`**          | Design §7 and §12 — the BEP-0016 migration seam                            | `ApprovalService.launch` calls `scaffolderService.scaffold()` directly                                            | Small refactor, no behaviour change                                                     |
| **Scaffolder API decorator**               | Phase 8 §8.4                                                               | Already recorded as not built, in Phases 8 and 9                                                                  | Medium, needs a real app                                                                |

None of them affects whether the gate holds — that is a property of the gate step, verified in Phase 9.
The first two affect whether approvers find their inbox, and the third makes a stated design claim
true.

### Draft PR description

Not submitted — opening a PR is an outward-facing step and yours to take. The issue link is a
placeholder because Phase 0.1 was skipped.

```markdown
## Hey, I just made a Pull Request!

Adds `scaffolder-approvals`: approval gates for Backstage software templates. A gated template does
not run when someone submits it — it creates an approval request, and runs only once designated
approvers agree.

Proposal: <!-- TODO: link the proposal issue (Phase 0.1 was deferred) -->

### How the gate holds

The gate is a step in the template, not a check in the UI. `scaffolder.task.create` is a basic
permission with no template reference, so a UI-only gate is bypassable with one `curl`; a task's steps
come from the catalog, so a step is the one part of a run the caller cannot change. The
`approval:gate` action refuses to continue without a single-use grant bound to a hash of the exact
parameters that were approved.

Verified against a running backend: calling the scaffolder directly with a gated template fails at
the gate with every later step skipped. `workspaces/scaffolder-approvals/scripts/verify-gate.sh`
repeats the check.

### Packages

- `@backstage-community/plugin-scaffolder-approvals` — approvals page (legacy and new frontend system)
- `@backstage-community/plugin-scaffolder-approvals-backend` — requests, decisions, grants, sweeps, API
- `@backstage-community/plugin-scaffolder-backend-module-approvals` — the `approval:gate` action
- `@backstage-community/plugin-catalog-backend-module-approvals` — derives the `gated` annotation
- `@backstage-community/plugin-scaffolder-approvals-common` / `-node` — shared code

### Worth a reviewer's attention

- The launched task runs as the plugin's service principal, not the requester; the gate publishes
  `requestedBy` / `approvedBy` as outputs. Documented in the workspace README.
- Gated templates must not use `secrets.USER_OAUTH_TOKEN`, which expires during the wait.
- Locally, `lint --since origin/main` linted nothing and the publish check failed only on a Windows
  path separator. Please check both behave on this PR's CI run.
- Not in v1: homepage card, new-frontend-system nav item, scaffolder form decorator, mid-template
  gating (needs BEP-0016).

#### :heavy_check_mark: Checklist

- [x] A changeset describing the change and affected packages. ([more info](https://github.com/backstage/community-plugins/blob/master/CONTRIBUTING.md#creating-changesets))
- [x] Added or updated documentation
- [x] Tests for new functionality and regression tests for bug fixes
- [ ] Screenshots attached (for UI changes)
- [ ] All your commits have a `Signed-off-by` line in the message. ([more info](https://github.com/backstage/community-plugins/blob/master/CONTRIBUTING.md#developer-certificate-of-origin))

🤖 Generated with [Claude Code](https://claude.com/claude-code)
```

Two items in that checklist need checking before submitting: **no screenshots exist**, because the
frontend has never been opened in a browser, and **none of the branch's commits carry a `Signed-off-by` line**. The PR template requires one
(Developer Certificate of Origin) and upstream commits have them, so before submitting, the branch
needs rewriting with `git rebase --signoff origin/main`. That is left to you: it rewrites every
commit on the branch, and signing off certifies the DCO in your name.

---

## Appendix — Deferred, deliberately

Recorded so they are not mistaken for oversights:

| Item                           | Why deferred                                                                                              |
| ------------------------------ | --------------------------------------------------------------------------------------------------------- |
| Slack approvals                | Out of scope for v1. Events already emitted, so additive later.                                           |
| Entity card on Templates       | Q22 — page, nav and home card first.                                                                      |
| "Expiring soon" notification   | Q20 — needs its own tick; easy to get wrong.                                                              |
| `requireGate` config allowlist | Q17 — declined; accepted risk documented in Phase 6.                                                      |
| Mid-workflow gating            | Needs core `ctx.suspend` (BEP-0016). Intended as one seam in `-node`; as built, it is not — see Phase 10. |
| Restricting reads              | Q12 — open for now; `toQuery` already exists to tighten it.                                               |
