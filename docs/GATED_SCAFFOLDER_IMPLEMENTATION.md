# Gated Scaffolder Workflows — Implementation Guide

Step-by-step build plan for `@backstage-community/plugin-scaffolder-approvals`.

Design rationale, prior art and the full decision record live in
[GATED_SCAFFOLDER_WORKFLOWS.md](GATED_SCAFFOLDER_WORKFLOWS.md). **This document is the how.** Every
step traces back to a numbered decision (Q1–Q24) from that record; where a step exists _because_ of a
decision, the decision is cited inline so nobody silently re-litigates it mid-build.

## Progress

| Phase                             | Status      |
| --------------------------------- | ----------- |
| 0 — Proposal and scaffolding      | **Done**    |
| 1 — Common package                | Not started |
| 2 — Database and store            | Not started |
| 3 — Approval service              | Not started |
| 4 — Router and permissions        | Not started |
| 5 — Gate action                   | Not started |
| 6 — Catalog processor             | Not started |
| 7 — Sweeps, events, notifications | Not started |
| 8 — Frontend                      | Not started |
| 9 — End-to-end verification       | Not started |
| 10 — Upstream preparation         | Not started |

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

# Phase 2 — Database and store

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
    table.text('template_ref').notNullable();
    table.text('values').nullable().comment('JSON; nulled on redaction');
    table.string('values_hash', 64).notNullable();
    table.text('requester_ref').notNullable();
    table.string('status', 32).notNullable();
    table.text('summary').nullable();
    table
      .text('policy_snapshot')
      .notNullable()
      .comment('JSON, frozen at submit');
    table.uuid('task_id').nullable();
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
    table.text('approver_ref').notNullable();
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
    table.uuid('consumed_by_task_id').nullable();

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

- [ ] Migrations run up **and down** cleanly on SQLite, Postgres and MySQL
      (`TestDatabases.create()` from `@backstage/backend-test-utils`).
- [ ] Test: two concurrent `transition(id, 'pending', 'approved')` calls — exactly one returns true.
- [ ] Test: two concurrent grant consumes — exactly one succeeds.
- [ ] Test: grant consume with a mismatched `values_hash` fails.
- [ ] Test: grant consume after `expires_at` fails.
- [ ] Test: `createOrCollapse` returns the same id for an identical pending request.

---

# Phase 3 — Approval service (state machine)

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

- [ ] `quorum: 2` stays pending after one approval, moves to `approved` after a second from a
      different principal.
- [ ] A second vote from the same approver throws `ConflictError`.
- [ ] One deny among three approvals still rejects.
- [ ] `selfApprove: false` blocks the requester even when they are in an approver group.
- [ ] A failing `scaffold()` leaves the request `approved` with no `task_id` (not `failed`).
- [ ] Invalid values are rejected at submit and nothing is stored.

---

# Phase 4 — Router and permissions

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

- [ ] `/grants/consume` rejects a user principal with 403.
- [ ] A non-approver gets 403 on `/decision`; a designated approver succeeds.
- [ ] A group member of a listed approver group succeeds.
- [ ] Any signed-in user can `GET /requests` and see everything (Q12).
- [ ] Pagination returns a correct `totalItems` independent of `limit`.

---

# Phase 5 — The gate action

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

- [ ] **Bypass test.** `POST /api/scaffolder/v2/tasks` directly with a gated `templateRef`: the task
      fails at step 1, and no subsequent step executes. Assert on step status, not just task status.
- [ ] **Replay test.** A consumed grant used a second time is rejected.
- [ ] **Tamper test.** A valid grant with altered `values` is rejected on `values_hash` mismatch.
- [ ] **Expiry test.** A grant past `expires_at` is rejected.
- [ ] **Happy path.** A grant minted by the service unlocks the run and `requestedBy` / `approvedBy`
      appear in the task output.

---

# Phase 6 — Catalog processor

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

- [ ] A template with an `approval:gate` step gets the annotation.
- [ ] A template without one is returned byte-identical.
- [ ] Non-Template kinds pass through untouched.
- [ ] An already-annotated entity is unchanged (idempotent across refresh cycles).

---

# Phase 7 — Sweeps, events and notifications

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

- [ ] `approved` with no `task_id` is retried, then fails once the grant expires.
- [ ] Retention nulls `values` but leaves the row and decisions intact.
- [ ] A dropped event still converges via the sweep.
- [ ] The backend starts and functions with notifications and signals absent.

---

# Phase 8 — Frontend

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

- [ ] Both exports construct and expose the expected route refs (smoke test, Q23).
- [ ] Component tests via `renderInTestApp` + `TestApiProvider` cover: empty inbox, pending list,
      approve flow, deny-with-comment, and a **redacted** request rendering without error.
- [ ] `yarn start` in the plugin shows a working, styled page.

---

# Phase 9 — End-to-end verification

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

- [ ] All seven steps pass by hand.
- [ ] Steps 1–7 scripted as an integration test.
- [ ] A backend restart mid-`pending` loses nothing.

---

# Phase 10 — Upstream preparation

- [ ] `yarn build:api-reports` for every package.
- [ ] Changeset per package (`yarn changeset` from the workspace, not the repo root).
- [ ] Apache-2.0 headers on all new `.ts`/`.tsx`, current year.
- [ ] READMEs: workspace-level with a worked example, plus one per package.
- [ ] Document the §10.1 identity consequence and the §10.2 OAuth-token caveat prominently — both
      will otherwise become support questions.
- [ ] CODEOWNERS entry; org membership request for maintainer rights.
- [ ] `yarn lint --since origin/main`, `yarn tsc`, `yarn test` clean.
- [ ] Link the proposal issue in the PR description.

---

## Appendix — Deferred, deliberately

Recorded so they are not mistaken for oversights:

| Item                           | Why deferred                                                      |
| ------------------------------ | ----------------------------------------------------------------- |
| Slack approvals                | Out of scope for v1. Events already emitted, so additive later.   |
| Entity card on Templates       | Q22 — page, nav and home card first.                              |
| "Expiring soon" notification   | Q20 — needs its own tick; easy to get wrong.                      |
| `requireGate` config allowlist | Q17 — declined; accepted risk documented in Phase 6.              |
| Mid-workflow gating            | Needs core `ctx.suspend` (BEP-0016). One seam in `-node` changes. |
| Restricting reads              | Q12 — open for now; `toQuery` already exists to tighten it.       |
