# Scaffolder Approvals — Code Review

This review covers everything on `feat/scaffolder-approvals`, Phases 0–10. It checks the work against:

- the design and decision record, [GATED_SCAFFOLDER_WORKFLOWS.md](GATED_SCAFFOLDER_WORKFLOWS.md);
- the build plan, [GATED_SCAFFOLDER_IMPLEMENTATION.md](GATED_SCAFFOLDER_IMPLEMENTATION.md).

Every finding below comes with evidence: a test that fails, a run against a real engine, or an exact line of code. Nothing is taken on the implementer's word.

|                   |                                                                                                                                                                                                                                                                                                                                                                |
| ----------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Change**        | `git diff main...HEAD`: merge-base `2671277`, 11 commits, 143 files, ~18.7k lines (plus a 25k-line lockfile)                                                                                                                                                                                                                                                   |
| **Reviewed**      | 16–17 Sep 2026, at `1f2f509`                                                                                                                                                                                                                                                                                                                                   |
| **Method**        | Line-by-line read of all six packages. Every tooling claim re-run. Backend suites run on **real Postgres 18.4 and MySQL 8.4.9**. An end-to-end harness drives the **real scaffolder 4.1.0** over HTTP. The dev backend was started and probed. 40-mutant audit of the security guards. Independent Standards and Spec passes ([code-review skill](#standards)) |
| **Finding style** | One line each: `location: severity problem. fix.` Security issues get a paragraph ([caveman-review skill](#reading-this-review))                                                                                                                                                                                                                               |

## Contents

1. [Verdict](#1-verdict)
2. [Evidence base](#2-evidence-base)
3. [Security model](#3-security-model): the gate, and what it does not stop
4. [Review by phase](#4-review-by-phase), Phases 0–10, each with an exit-criteria audit
5. [Decision traceability](#5-decision-traceability): Q1–Q24, §3, §6, §10, P1–P5
6. [Test suite assessment](#6-test-suite-assessment), including the mutation audit
7. [Standards](#standards) and [Spec](#spec): the two independent passes
8. [Fix plan](#8-fix-plan)
9. [Appendices](#appendices): evidence tests you can run and keep

---

## 1. Verdict

**Request changes.** Most of what was built is careful and correct. The design's central promise is not yet true, though: "a gated template cannot be run without approval".

### What holds up, with evidence

- **The approved path works end to end through the real scaffolder** ([E2](#e2)):

  - with `quorum: 2`, the requester's own approval is refused with 403 and a second vote with 409;
  - the task starts only after the second approval and consumes its grant;
  - it publishes the real `requestedBy` and `approvedBy`;
  - the request reaches `completed` from scaffolder task events alone.

  The implementer never ran this path (Phase 9 used guest auth, which cannot approve).

- **The store holds on every supported engine** ([E1](#e1)). All 439 backend tests were run on Postgres 18.4, MySQL 8.4.9 and SQLite, and 438 pass, including every compare-and-set, replay, tamper and expiry test. That closes the Phase 2 exit criterion that was ticked on SQLite alone. The one failure is a real MySQL defect ([C9](#c9)).
- **The plain bypass is blocked** ([E2](#e2), [E6](#e6)). A direct `POST /v2/tasks` of an ordinary gated template fails at step 1 and every later step is skipped. The implementer's `verify-gate.sh` passes against the running dev backend.
- **Notifications reach the whole approver group** ([E6](#e6)). The `devx-team` members received "Approval requested", with a deep link.
- **Tooling is clean** ([E8](#e8)): 335 tests, `tsc:full`, `lint:all`, `prettier:check`, `api-reports --ci` and `repo fix --check` all pass, and the lockfile matches every manifest.
- **The tests mostly catch real breakage** ([E7](#e7)). 38 of 40 hand-written mutants of the security and lifecycle guards are caught by the implementer's own tests. The 2 that survive are listed in §6.

### What blocks it

| #   | Finding                                                                                                                                                                                                       | Evidence                                |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------- |
| 1   | [**S1**](#s1) Five template or policy shapes let a direct scaffolder call run real steps with no approval. All of them are still annotated `gated`, still accepted by the approvals API, and draw no warning. | [E2](#e2) [E5](#e5) [E6](#e6) [E4](#e4) |
| 2   | [**C1**](#c1) Q9 is not implemented. One failed launch means the request fails an hour later, and the launch is never retried.                                                                                | [E2](#e2) [E3](#e3)                     |
| 3   | [**G1**](#g1) A requester has no way to submit from the UI, yet the gate's error message and the README send them to a page that has no form.                                                                 | code                                    |
| 4   | [**P1**](#p1) / [**P2**](#p2) No `Signed-off-by` on any commit, and no proposal issue. Both are merge preconditions in this repo.                                                                             | git, CONTRIBUTING.md L137               |

Next in priority:

- [C2](#c2): a race that can run a template twice;
- [C3](#c3): lifecycle events report the wrong status;
- [S5](#s5): template drift is not detected;
- [S3](#s3): any service principal can redeem grants;
- [C8](#c8): Postgres returns 500s for malformed ids;
- [C9](#c9): MySQL timestamps lose sub-second precision.

### Scorecard

| Phase                    | Implementer says                 | This review found                                                          | Verdict |
| ------------------------ | -------------------------------- | -------------------------------------------------------------------------- | ------- |
| 0 Scaffolding            | Done (0.1, 0.2 deferred)         | Tooling clean; DCO and proposal missing                                    | ⚠️      |
| 1 Common                 | Done                             | Sound; stale docs                                                          | ✅      |
| 2 Database and store     | Done (Postgres/MySQL unverified) | Now verified on both; MySQL precision bug, Postgres id 500s, missing index | ⚠️      |
| 3 Approval service       | Done                             | Q9 missing, launch race, stale event status, no drift check                | ❌      |
| 4 Router and permissions | Done                             | Inverted rule filter, any service principal, no auditing                   | ⚠️      |
| 5 Gate action            | Done                             | The gate can be skipped (S1)                                               | ❌      |
| 6 Catalog processor      | Done                             | Misses every S1 shape and never validates the policy                       | ⚠️      |
| 7 Sweeps and events      | Done                             | No launch retry; sweep starvation; no `launched` event                     | ⚠️      |
| 8 Frontend               | Done (render unverified)         | No submit, withdraw, resubmit or task link; no nav item or home card       | ❌      |
| 9 End-to-end             | Done                             | Plain bypass holds; happy path now verified by this review; S1 not covered | ⚠️      |
| 10 Upstream prep         | Done (DCO, proposal left to you) | README describes features that do not exist                                | ⚠️      |

---

## 2. Evidence base

| ID                    | What                                | How                                                                                                                                                                                                                                                 | Result                                                                                                                                                                                                                                                              |
| --------------------- | ----------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| <a id="e1"></a>**E1** | Backend suites on three engines     | Real Postgres 18.4 and MySQL 8.4.9 started from embedded binaries, then `BACKSTAGE_TEST_DATABASE_{POSTGRES18,MYSQL8}_CONNECTION_STRING` set so every `TestDatabases` suite ran on them as well as SQLite                                            | 439 tests, 438 pass. The failure is MySQL ordering ([C9](#c9)). Two "hook timeout" suite failures came from slow `fsync` on this machine: with durability relaxed, as CI's tmpfs containers have it, the re-run passed 114/114 in 86 s                              |
| <a id="e2"></a>**E2** | End to end with the real scaffolder | One `startTestBackend` runs the real `@backstage/plugin-scaffolder-backend` 4.1.0 (task workers and runner), the approvals backend and the gate module, all over real HTTP. Only identity, catalog and scheduler are stand-ins ([Appendix A1](#a1)) | 13 scenarios, all behaving as described in this review                                                                                                                                                                                                              |
| <a id="e3"></a>**E3** | Backend spec tests                  | 42 tests: 13 per engine plus 3 engine-independent. Each states what the design requires and is written with `it.failing` ([A2](#a2))                                                                                                                | 30 spec violations confirmed in raw mode. The other 12 are controls and engine-specific passes. Every failure was read to make sure it failed on its assertion, not on a test bug                                                                                   |
| <a id="e4"></a>**E4** | Node and processor spec tests       | `findGateStep` and processor warnings ([A3](#a3), [A4](#a4))                                                                                                                                                                                        | 4 of 4 and 8 of 8 violations confirmed; the controls pass                                                                                                                                                                                                           |
| <a id="e5"></a>**E5** | Runner harness                      | The installed `NunjucksWorkflowRunner` driven directly, with a gate that throws ([A5](#a5))                                                                                                                                                         | 4 of 4 bypass shapes ran a real step                                                                                                                                                                                                                                |
| <a id="e6"></a>**E6** | Live dev backend                    | `packages/backend` started with the workspace config plus a review overlay: two probe templates and a separate database directory ([A6](#a6))                                                                                                       | `verify-gate.sh` prints "The gate holds." Both probe templates are annotated `gated=true`, accepted by the approvals API (201), draw no processor warning, and still ran their side effect on a direct call. Notifications were stored for alice, bob and requester |
| <a id="e7"></a>**E7** | Mutation audit                      | 40 hand-written mutants of the security and lifecycle guards. Each ran against its package's own suite, and the file was restored byte for byte afterwards ([A7](#a7))                                                                              | 38 killed, 2 survived, out of 40 (§6)                                                                                                                                                                                                                               |
| <a id="e8"></a>**E8** | Tooling                             | `package test` for all six packages, `tsc --skipLibCheck false`, `repo lint` (all), prettier 2 inside the workspace, `api-reports --ci`, `repo fix --check`, and a cross-check of every declared dependency against `yarn.lock`                     | All clean. 335 tests pass (50 common, 34 node, 187 backend, 25 gate module, 18 catalog module, 21 frontend). The two lockfile "misses" are `@types/react` and `@types/react-dom`, which root `resolutions` pins                                                     |

**Not verified:**

- rendering in a real browser;
- the Red Hat RBAC plugin;
- CI-only behaviour: whether `lint --since` and `fix --publish` behave on Linux;
- load behaviour.

**Environment notes, so the runs are reproducible ([Appendix B](#appendix-b--environment-notes)):**

- Postgres's `initdb` crashed on this machine until a matching MSVC runtime sat next to the binaries.
- MySQL runs in the machine's local time zone (America/Halifax) rather than UTC, which is a useful stress on the timestamp code.

### Reading this review

🔴 bug — broken or unsafe · 🟡 risk — works, but fragile or partial · 🔵 nit · ❓ question

**Finding IDs:**

| Prefix | Kind                 |
| ------ | -------------------- |
| **S**  | Security             |
| **C**  | Correctness          |
| **G**  | Gap against the spec |
| **P**  | Process or standards |
| **D**  | Documentation        |
| **T**  | Tests                |

**Path prefixes** (every location is also a link):

| Prefix            | Path                                              |
| ----------------- | ------------------------------------------------- |
| `ws/`             | `workspaces/scaffolder-approvals/`                |
| `common/`         | `ws/plugins/scaffolder-approvals-common/`         |
| `node/`           | `ws/plugins/scaffolder-approvals-node/`           |
| `backend/`        | `ws/plugins/scaffolder-approvals-backend/`        |
| `gate-module/`    | `ws/plugins/scaffolder-backend-module-approvals/` |
| `catalog-module/` | `ws/plugins/catalog-backend-module-approvals/`    |
| `frontend/`       | `ws/plugins/scaffolder-approvals/`                |

---

## 3. Security model

The design rests on one sentence from §3: "`approval:gate` throws on step 1, before any real step executes." The gate step itself is solid. The single-use, TTL and tamper guards all hold, and mutating each one breaks tests ([E7](#e7)). The findings below are about what happens _around_ the gate.

### <a id="s1"></a>S1 — Five ways a direct run executes real steps without approval (🔴) — ✅ fixed

Scaffolder 4.1.0, the version this workspace installs, lets a direct run get past the gate in five ways:

- **(a), (b) Failure-aware steps.** After a step fails, the runner still executes any later step whose `if:` calls `always()` or `failure()` (`NunjucksWorkflowRunner.cjs.js` L519–L526, L557–L571).
- **(c) Falsy `if:` on the gate.** The runner skips a step whose `if:` is falsy (L213), so a gate step with `if: ${{ parameters.x }}` can be switched off by whoever starts the run.
- **(d) Empty `each:` on the gate.** An `each:` step runs once per entry, so a gate given an empty list never runs and reports `completed` (L302).
- **(e) Step-read policy.** `authorizeTemplate` removes steps the caller's `templateStepReadPermission` decision rejects (`router.cjs.js` L910–L912). Under a tag allow-list policy (`HAS_TAG`), an untagged gate simply disappears from a user's run. The task started with "1 steps" in [E2](#e2).

All five were reproduced through the real scaffolder over HTTP ([E2](#e2)). Shapes (a)–(d) were also reproduced with the bare runner ([E5](#e5)), and (a) and (c) on the live dev backend with the real catalog ([E6](#e6)).

In every case the template still looks gated. It carries `scaffolder-approvals.backstage.io/gated: "true"`, the approvals API accepts it with 201, and the processor logs nothing.

- **Why nothing catches it.** `findGateStep` only checks position and count ([node/src/gateStep.ts:L74-L104](workspaces/scaffolder-approvals/plugins/scaffolder-approvals-node/src/gateStep.ts#L74-L104)). The processor warns about four other shapes, but none of these ([E4](#e4)). `verify-gate.sh` exercises a template with none of them.
- **Who controls these shapes.** All five are author- or policy-controlled, so they belong with Q17 ("a template owner can remove their own gate"). They are worse than removal, though. They pass every check this plugin has, and `always()` is an ordinary choice for a cleanup or notification step.

**Fix:**

1. `findGateStep` rejects a gate that has `if` or `each`.
2. A gated template is unusable if any later step's `if` mentions `always(` or `failure(`. Refuse it at submit and warn in the processor.
3. Require the gate to carry every `backstage:permissions.tags` value any other step carries, or refuse tagged steps in gated templates.
4. Document all of it. Then add the cheapest defence in depth, which [E2](#e2) proves works: a `scaffolder.action.execute` policy that denies the dangerous actions to **user** principals. Approved runs launch as a service principal, which the permission client allows without consulting policy, so only approved runs can execute those actions. In E2 that policy stopped the `always()` bypass ("Unauthorized action: debug:log") while the approved run of the same template completed.

**Fixed.** `findGateStep` now refuses `if:` and `each:` on the gate, any later step whose `if:` calls
`always()` or `failure()`, and any later step carrying a `backstage:permissions.tags` value the gate
does not. `submit` and the catalog processor both go through it, so the approvals API refuses these
templates and the catalog warns about them. Shape (e) is closed by the tag rule: a step-read policy
that admits a real step now always admits the gate too. Regression tests: A3 in `gateStep.test.ts`,
A4 in `ApprovalsGateProcessor.test.ts`, and a submit-level test in `ApprovalService.test.ts`. The
`actionExecutePermission` defence in depth is documented in the workspace README.

### <a id="s2"></a>S2 — An approved run is not the requester's run (🟡) — ✅ documented

`launch` uses `auth.getOwnServiceCredentials()` ([backend/src/service/ApprovalService.ts:L429](workspaces/scaffolder-approvals/plugins/scaffolder-approvals-backend/src/service/ApprovalService.ts#L429)). `ServerPermissionClient` answers ALLOW for service principals without asking any policy (`plugin-permission-node` `ServerPermissionClient.cjs.js` L24–L45, L69–L82). Three things follow:

1. **Every step runs.** An approved run executes all steps and parameters, including any the requester's own step or parameter policy would have removed. No `actionExecutePermission` policy applies to it either.
2. **`user` is empty.** The task's `spec.user` is `{}` and it has no `createdBy`. [E2](#e2) printed `USER-REF=[]`, so any `${{ user.* }}` renders empty. The design's own §9 example, `username: '${{ user.entity.metadata.name }}'` at [GATED_SCAFFOLDER_WORKFLOWS.md:L543](GATED_SCAFFOLDER_WORKFLOWS.md#L543), would pass an empty username.
3. **Downstream calls run as the plugin.** A step that calls another plugin "on behalf of the initiator" acts as the approvals plugin.

§10.1 weighed only `createdBy`. Two decisions are needed:

- whether an approval may grant _more_ than the requester could run (if not, check the requester's step and parameter permissions at submit);
- how to document `${{ user.* }}`, ideally with a processor warning.

**Decided and documented.** Both decisions are recorded in the workspace README and in a comment on
`ApprovalService.launch`:

1. **An approval may grant more than the requester could run, deliberately.** The approvers' assent
   is the authority, and an approval that silently did less than it said would be worse than one
   that does what it says. The consequence is stated plainly: the approver list, not the requester's
   own permissions, is the access-control boundary for a gated template.
2. **`${{ user.* }}` is documented as rendering empty**, and the catalog processor now warns when a
   gated template's later steps read the `user` context (part of [G9](#g9)).

The `scaffolder.action.execute` policy is written out in full in the README, with the two things
that trip people up: `permission.enabled: true` has to be set or no policy runs at all, and `anyOf`
needs a `NonEmptyArray`, so building it with `.map()` over a `string[]` does not type-check. The
snippet was compiled against the installed packages rather than transcribed — the first draft, taken
from this review, was wrong in three ways: `actionExecutePermission` lives in
`@backstage/plugin-scaffolder-common/alpha`, the conditions in
`@backstage/plugin-scaffolder-backend/alpha`, and `PolicyQuery` has no `principal` field, so the
`request.principal.type !== 'user'` guard neither compiles nor is needed —
`ServerPermissionClient.#servicePrincipalDecision` short-circuits before any policy is consulted
(verified in `ServerPermissionClient.cjs.js` L24-L45).

### <a id="s3"></a>S3 — Any service principal can redeem a grant (🟡) — ✅ fixed

`/grants/consume` accepts `allow: ['service']` ([backend/src/service/router.ts:L316](workspaces/scaffolder-approvals/plugins/scaffolder-approvals-backend/src/service/router.ts#L316)). In [E2](#e2) a user was refused at the principal check ("This endpoint does not allow 'user' credentials"). An `external:ci-bot` static-token principal got past that check and reached grant validation ("The approval grant is not valid"). In [E3](#e3) an `external:some-ci-job` principal, which is not the scaffolder, **redeemed a real grant** and got 200. That spends the approval: the legitimate task then fails at its gate.

Only the scaffolder's gate needs this route, so also require `credentials.principal.subject === 'plugin:scaffolder'` (configurable for split deployments).

**Fixed, as a configurable allow-list rather than an equality.** `backend-plugin-api` documents
`BackstageServicePrincipal.subject` as "only informational … should never be used to drive actual
logic in code", so hard-coding the comparison would make every approved run depend on an unstable
string: if the format ever changed, every gated template would fail closed at once. The route now
checks the subject against `scaffolderApprovals.grantConsumers`, defaulting to `['plugin:scaffolder']`,
and logs the subject it refused so an operator can see what to widen it to. The grant's own guards
remain the real control; this is the outer fence.

The integration test found the same dependency from the other side: it built the gate action with
`mockServices.auth()`, whose subject is `plugin:test`, and the backend refused it. It now uses
`pluginId: 'scaffolder'`, which is what the action really has — it is a module of the scaffolder
backend — so the test exercises the real arrangement instead of a permissive mock. Mutant M50, which
drops the check, breaks four tests.

### <a id="s4"></a>S4 — Grants are not bound to the template (🟡) — ✅ fixed

§3 says a grant is "bound to `(request_id, template_ref, values_hash)`" ([L167](GATED_SCAFFOLDER_WORKFLOWS.md#L167)). The consume path checks the request, the token and the values hash, but not the template ([backend/src/database/ApprovalStore.ts:L480-L487](workspaces/scaffolder-approvals/plugins/scaffolder-approvals-backend/src/database/ApprovalStore.ts#L480-L487)), and the action does not send one ([gate-module/src/createApprovalGateAction.ts:L191-L195](workspaces/scaffolder-approvals/plugins/scaffolder-backend-module-approvals/src/createApprovalGateAction.ts#L191-L195)).

A leaked grant would therefore redeem inside _any_ gated template given identical values. Send `ctx.templateInfo.entityRef` and compare it, normalised, with the request's `template_ref` inside the same `UPDATE`.

**Fixed, exactly that.** The action sends `ctx.templateInfo?.entityRef`, the service normalises it,
and `consumeGrant` compares it against the request inside the one statement, with a sub-select rather
than a denormalised copy on the grant — one source of truth, and the whole check stays atomic.

**[C5](#c5) came with it, ahead of fix 7.** The comparison is only meaningful if both sides are
spelled the same way, so `submit` now stores `normaliseEntityRef(templateRef)` instead of the ref as
sent. Mutant M49 (drop the binding) and M51 (send a fixed ref from the action) each break tests, and
an end-to-end test through the real approvals backend confirms both halves: a grant presented under
another template is refused, **and survives the attempt**, so the legitimate run still succeeds.

### <a id="s5"></a>S5 — Template drift is neither detected nor shown (🟡) — ✅ fixed

§10.3 asks for "`metadata.uid` plus a hash of its spec at submit, and warn the approver if it changed" ([L606](GATED_SCAFFOLDER_WORKFLOWS.md#L606)). Nothing is stored. In [E2](#e2) a step was added between submit and approval, and it ran after approval: "DRIFT STEP ADDED AFTER SUBMIT".

Approvers approve the _values_ and see nothing of the steps. Store the template uid and a hash of `spec.steps` at submit, and show a warning on the request page when either has changed. Refusing to launch a drifted template is a stronger option.

**Fixed.** `submit` records `metadata.uid` and a SHA-256 of `spec.steps`, and `GET /requests/:id`
compares both against the catalog and returns a `templateDrift`. The request page renders a
`role="alert"` notice above the request, so it is read before the Approve button rather than beside
it.

Both values are recorded because either alone can be fooled: a template deleted and recreated keeps
its name and takes a new uid, while one edited in place keeps its uid and changes its steps. The
hash covers `spec.steps` rather than the whole spec, because the steps are what execute — a warning
that fired on an owner or description edit is one people would learn to click past. Canonical
serialisation keeps it stable across the catalog's own reserialisation.

**Drift is shown, not enforced**, which is the weaker of the two options offered. Failing every
in-flight request whenever its template took an unrelated commit would make the feature unusable, so
the approver is told and decides; a drifted launch is also logged so the run can be tied to the
template it really ran. Refusing to launch remains available to anyone who wants it, on one `if`.

One case is deliberately silent: when the catalog cannot be reached, the backend returns nothing
rather than `changed: false`. An unreachable catalog is not evidence that a template is unchanged,
and a warning that fires on infrastructure trouble is one people click past. Requests submitted
before this landed report `unknown` for the same reason.

Five mutants — ignore edited steps, ignore a replaced uid, report "unchanged" on a catalog failure,
record nothing at submit, never render the notice — each break between two and six tests.

### <a id="s6"></a>S6 — `IS_NOT_REQUESTER` filters for the opposite set (🔴, latent) — ✅ fixed

`toQuery` returns `{ key: 'requesterRef', values: [caller] }`, which is exactly the requests the rule _excludes_ ([node/src/permissions.ts:L134-L137](workspaces/scaffolder-approvals/plugins/scaffolder-approvals-node/src/permissions.ts#L134-L137)). The comment above it claims a list query "gets nothing back rather than something wrong". [E3](#e3) confirms the inversion.

Nothing uses the filter today, because conditional reads are refused ([router.ts:L231-L235](workspaces/scaffolder-approvals/plugins/scaffolder-approvals-backend/src/service/router.ts#L231-L235)). It is a trap for whoever enables them, and no test covers it: `permissions.test.ts` tests `toQuery` for the other two rules only. Return `{ not: { key: 'requesterRef', values } }` and teach the store `not`, or throw.

**Fixed, the first way.** `ApprovalRequestFilter` gained a `{ not: ApprovalRequestFilter }` variant
and `toQuery` now returns it. Negation lives in the union rather than as a `negate` flag on each
variant precisely so that a future implementation cannot skip it: a `switch` over the type will not
compile without handling `not`. That is what turns this from a trap for whoever enables conditional
reads into something the compiler asks them about.

One case the review did not mention, and it is the same inversion by another route: `apply` fails
closed on a caller ref that will not parse, so `toQuery` has to as well. `not` over an empty set
matches _everything_, so that path returns an empty positive filter, which matches nothing.

The misleading comment is gone too. It claimed a list query using this rule "gets nothing back
rather than something wrong", which was the part that made the bug hard to see — it returned the
caller's own requests and nothing else, the exact inverse of a four-eyes control.

Four tests now cover it, including one that checks `apply` and `toQuery` against _each other_ rather
than against a literal, since disagreeing is the whole failure mode.
[M38](#m38) is killed, along with two new mutants for the unparseable-ref path and the rule itself.

### <a id="s7"></a>S7 — Secret-type parameters become world-readable (🟡) — ✅ fixed

Submitted values are stored as plain JSON ([backend/src/database/ApprovalStore.ts:L224](workspaces/scaffolder-approvals/plugins/scaffolder-approvals-backend/src/database/ApprovalStore.ts#L224)), and Q12 makes every request readable by any signed-in user. A gated template with a `ui:field: Secret` parameter would publish that secret to the whole organisation until retention runs.

Refuse secret-type fields at submit, and warn in the processor. **Done, both.** `findSecretParameters` walks `properties`, `items` and the composed keywords, so a `oneOf` branch does not hide one.

The disclosure this finding names is real, but it is the second reason. The first is that a `ui:field: Secret` value never reaches the request at all — the scaffolder puts it in the task's `secrets`, not its `values` — so a gated template declaring one would be approved and then run without it. That is why it is refused rather than redacted or warned about. `ui:widget: password` is deliberately not matched: it hides the value on screen but still submits it as an ordinary parameter, so warning about it would be warning about the wrong risk. Mutants M77, M78 and M81 break four, nine and four tests.

---

## 4. Review by phase

Each phase has three parts:

- **Plan:** what the plan asked for.
- **Exit-criteria audit:** the plan's original wording, where the implementer changed it; what the implementer ticked; and what this review established.
- **Findings.**

### Phase 0 — Proposal and scaffolding

**Plan:** open the proposal issue, comment on BEP-0016, create the workspace, and generate six packages.

| Exit criterion                                                           | Implementer  | This review                                                                                               |
| ------------------------------------------------------------------------ | ------------ | --------------------------------------------------------------------------------------------------------- |
| Proposal issue open, 14-day window running                               | deferred     | ❌ Not open. A merge precondition ([P2](#p2))                                                             |
| Comment on PR #34966                                                     | awaiting you | ❌ Your call                                                                                              |
| `yarn install`, `tsc`, `lint:all`, `prettier:check`, `fix --check` clean | ✅           | ✅ Reproduced ([E8](#e8))                                                                                 |
| No `packages/app`                                                        | ✅           | ✅                                                                                                        |
| Apache-2.0 header on every generated `.ts`/`.tsx`                        | ✅           | ✅ Only the one-line `.eslintrc.js` files and the vendored Yarn plugin lack one, as in sibling workspaces |
| CODEOWNERS entry                                                         | ✅           | ✅ (spacing nit)                                                                                          |
| Correct `backstage.role` / `pluginId`, versions `0.0.0`                  | ✅           | ✅                                                                                                        |

- <a id="p1"></a>**P1** git history: 🔴 bug: none of the 11 commits has a `Signed-off-by` line, which AGENTS.md L98 requires. Fix: `git rebase --signoff main`. That is your call, since it certifies the DCO in your name.
- <a id="p2"></a>**P2** process: 🔴 bug: no proposal issue. CONTRIBUTING.md L137 says one "must be opened and accepted before submitting a plugin PR", and acceptance follows a 14-day window ([docs/contributing-new-plugin.md](docs/contributing-new-plugin.md)). Open it now.
- <a id="p3"></a>**P3** [GATED_SCAFFOLDER_WORKFLOWS.md](GATED_SCAFFOLDER_WORKFLOWS.md), [GATED_SCAFFOLDER_IMPLEMENTATION.md](GATED_SCAFFOLDER_IMPLEMENTATION.md): 🟡 risk: about 2.9k lines of design notes sit at the repo root, which breaks copilot-instructions L23 ("scoped to a single workspace"). AGENTS.md L96 says design rationale belongs in an issue. Seven READMEs link to these files and will break on npm. Fix: move the rationale into the proposal issue and drop the files and links from the PR.
- <a id="p4"></a>**P4** [ws/packages/backend/](workspaces/scaffolder-approvals/packages/backend/src/index.ts): 🟡 risk: copilot-instructions L39 flags a full example backend where the `dev/index` pattern would do. Meanwhile [backend/package.json:L35](workspaces/scaffolder-approvals/plugins/scaffolder-approvals-backend/package.json#L35) declares a `start` script with no `dev/` directory behind it. Fix: move the wiring into `backend/dev/index.ts` and drop `packages/backend`. Q16 wanted "a real backend", and a plugin dev entry is exactly that.
- <a id="p5"></a>**P5** [.github/CODEOWNERS:L113](.github/CODEOWNERS#L113): 🔵 nit: one space before `@Ferin79`, where neighbouring entries use two. Align it.
- <a id="p6"></a>**P6** [ws/bcp.json:L3](workspaces/scaffolder-approvals/bcp.json#L3): 🔵 nit: `knipReports: false`, and 18 declared dependencies are unused (listed under Phases 4, 5 and 8). Enable knip, or prune by hand.
- <a id="p7"></a>**P7** [ws/examples/request-github-admin.yaml:L16](workspaces/scaffolder-approvals/examples/request-github-admin.yaml#L16): 🔵 nit: `type: service`. The design uses `access-request`, which keeps access templates out of "create a service".

### Phase 1 — Common package

**Plan:** an isomorphic package holding the types, permissions, constants and canonical JSON.

| Exit criterion                                  | Implementer | This review                                        |
| ----------------------------------------------- | ----------- | -------------------------------------------------- |
| Zero Node imports; isomorphic dependencies      | ✅          | ✅ `git grep` finds no Node imports                |
| Canonical JSON tested for key order and nesting | ✅          | ✅ Mutant M19 (no key sort) was killed ([E7](#e7)) |
| API report generated and idempotent             | ✅          | ✅ `api-reports --ci`                              |
| Tests pass, tooling clean                       | ✅          | ✅ 50 tests                                        |

The code is good. `canonicalJson` throws rather than coerce. `normaliseEntityRef` lowercases kind, namespace _and_ name, which I checked against catalog-model 1.10. The shared eligibility and quorum helpers keep the UI and the server in agreement. The problems are documentation.

- <a id="c12"></a>**C12** [common/src/types.ts:L107-L109](workspaces/scaffolder-approvals/plugins/scaffolder-approvals-common/src/types.ts#L107-L109), [common/src/eligibility.ts:L23-L27](workspaces/scaffolder-approvals/plugins/scaffolder-approvals-common/src/eligibility.ts#L23-L27): 🟡 risk: these say adding someone to an approver group "takes effect immediately". That is false while the token carries `ent`, and Phase 4's own correction says so. The same claim appears at `backend/src/service/router.ts:L244-L247` and `backend/migrations/20260912000000_request_approvers.js:L30-L33`. Fix the wording, or build Q11's fallback ([G6](#g6)).
- <a id="c13"></a>**C13** ✅ fixed (the processor now calls `readGatePolicy`): [common/src/gatePolicy.ts:L183-L185](workspaces/scaffolder-approvals/plugins/scaffolder-approvals-common/src/gatePolicy.ts#L183-L185): 🟡 risk: says the catalog processor validates the policy, "so a template that ingests cleanly cannot then fail at submit". The processor never calls `readGatePolicy` ([E4](#e4)). L27 says the same. Fix the processor (see [G9](#g9)).
- <a id="c14"></a>**C14** [common/src/types.ts:L141-L146](workspaces/scaffolder-approvals/plugins/scaffolder-approvals-common/src/types.ts#L141-L146): 🔵 nit: says the scaffolder renders `summary`. Since Phase 9 it is `renderGateSummary`, which resolves only `${{ parameters.x }}`.
- <a id="c29"></a>**C29** [common/src/renderSummary.ts:L60](workspaces/scaffolder-approvals/plugins/scaffolder-approvals-common/src/renderSummary.ts#L60): ❓ q: the approver's one-line summary is built from values the requester controls. `repository: "docs (read-only)"` renders as "Admin on docs (read-only)". Should the UI mark substituted text?
- <a id="p8"></a>**P8** [common/src/permissions.ts:L83-L88](workspaces/scaffolder-approvals/plugins/scaffolder-approvals-common/src/permissions.ts#L83-L88): 🔵 nit: the basic `create` permission ships in the array `plugin.ts` registers as a resource type's permissions. Register it with `addPermissions` instead.

### Phase 2 — Database and store

**Plan:** migrations for three tables, a compare-and-set store, duplicate collapse, and verification on SQLite, Postgres and MySQL.

| Exit criterion (original wording)                                | Implementer                | This review                                                                                                  |
| ---------------------------------------------------------------- | -------------------------- | ------------------------------------------------------------------------------------------------------------ |
| Migrations run up **and down** on SQLite, **Postgres and MySQL** | ✅ "on SQLite only so far" | ✅ **Now verified** on Postgres 18.4 and MySQL 8.4.9 ([E1](#e1)). The box should not have been ticked before |
| Concurrent `transition`: exactly one wins                        | ✅                         | ✅ Passes on three engines; M06 killed                                                                       |
| Concurrent consume: exactly one wins                             | ✅                         | ✅ Three engines                                                                                             |
| Mismatched `values_hash` fails                                   | ✅                         | ✅ Three engines; M01 killed                                                                                 |
| Expired grant fails                                              | ✅                         | ✅ Three engines; M03 killed                                                                                 |
| Identical pending request collapses                              | ✅                         | ✅, but a differently spelled template ref does not collapse on SQLite or Postgres ([C5](#c5))               |

- <a id="c9"></a>**C9** ✅ fixed: [backend/migrations/20260911000000_init.js:L72-L76](workspaces/scaffolder-approvals/plugins/scaffolder-approvals-backend/migrations/20260911000000_init.js#L72-L76), [L113](workspaces/scaffolder-approvals/plugins/scaffolder-approvals-backend/migrations/20260911000000_init.js#L113), [L141-L142](workspaces/scaffolder-approvals/plugins/scaffolder-approvals-backend/migrations/20260911000000_init.js#L141-L142): 🟡 risk: `dateTime()` with no precision is `DATETIME(0)` on MySQL, so sub-second values are **rounded**. [E3](#e3) stored decisions at `10:00:00.750` and `10:00:00.900`, and both read back as `10:00:01.000`, half a second in the future. Two approvals in the same second then tie, and `listDecisions` orders the tie by random UUID. That scrambles the "oldest decision first" contract of `ConsumeGrantResponse.approvedBy` and the audit history. The implementer's own `router.test.ts › reports each approver once` failed this way on MySQL in [E1](#e1), then passed on a re-run. Fix: `table.dateTime(col, { precision: 3 })` in a new migration, or order by an insertion sequence. **Done, in both places.** Every `dateTime` in the init migration now declares `{ precision: 3 }`, so a fresh database is right from the start, and a new migration alters the existing columns for databases already created. The alter skips SQLite deliberately: it has no datetime type to widen, and knex implements `.alter()` there by rebuilding the table — four rebuilds to change nothing. The two columns added by fix 3 also declare their precision, and a portability test now asserts that _every_ MySQL datetime column carries one, whichever migration introduced it, which is what stops the next one silently reintroducing `DATETIME(0)`.
- <a id="c8"></a>**C8** ✅ fixed: [backend/src/service/router.ts:L268-L305](workspaces/scaffolder-approvals/plugins/scaffolder-approvals-backend/src/service/router.ts#L268-L305), [L323-L326](workspaces/scaffolder-approvals/plugins/scaffolder-approvals-backend/src/service/router.ts#L323-L326): 🟡 risk: ids are never validated, and on Postgres the `uuid` column rejects anything malformed. On Postgres 18.4, `GET /requests/not-a-uuid`, `POST /requests/not-a-uuid/decision` and a forged grant `not-a-uuid.token` all returned **500** ([E3](#e3)). SQLite and MySQL answer 404 or 403. The implementer's forged-grant test uses a well-formed UUID, so it cannot see this. Fix: `z.string().uuid()` on every id, and on the request-id half of a parsed grant. **Done.** All three `:id` routes parse the id before authorizing, which also keeps a malformed one out of the permission framework's `getResources` — the same trip to the database by another road. The grant's id half is parsed with the same schema, and stays a 400 alongside every other malformed grant rather than becoming a 403, so the answer is still the same whatever is wrong with it.
- <a id="c10"></a>**C10** ✅ fixed: [backend/migrations/20260911000000_init.js:L68-L71](workspaces/scaffolder-approvals/plugins/scaffolder-approvals-backend/migrations/20260911000000_init.js#L68-L71): 🟡 risk: `task_id` has no index. Yet `findRequestByTaskId` runs for **every** `scaffolder.task` event in the instance ([backend/src/database/ApprovalStore.ts:L528-L535](workspaces/scaffolder-approvals/plugins/scaffolder-approvals-backend/src/database/ApprovalStore.ts#L528-L535)), against a table that is never pruned. That covers open, claim, each status change and cancel, for all templates, gated or not. Add `table.index(['task_id'])`. **Done**, as `ar_task_idx`, with a portability test asserting it exists on all three engines.
- <a id="c7"></a>**C7** [backend/src/database/ApprovalStore.ts:L590](workspaces/scaffolder-approvals/plugins/scaffolder-approvals-backend/src/database/ApprovalStore.ts#L590): 🔵 nit: retention counts from `updated_at`, while §6 says from `decided_at`, or `created_at` for undecided requests. [E3](#e3) confirms that a request decided 200 days ago but updated yesterday is kept. The deviation is conservative, but record it as a decision or align the code.
- <a id="c15"></a>**C15** ✅ fixed: cross-engine: 🔵 nit: MySQL's default `utf8mb4_0900_ai_ci` collation makes every `where` equality case-insensitive, while SQLite and Postgres compare bytes. [C5](#c5)'s collapse test passes on MySQL for that reason alone. Normalise refs before storing them, so the engines stop disagreeing. **Done.** `templateRef` landed with [S4](#s4) in fix 5, and `requester_ref` now goes through `normaliseEntityRef` too — so "is this the requester?" and duplicate collapse no longer depend on which database is underneath. Approver refs were already normalised by `readGatePolicy`.
- <a id="t1"></a>**T1** [backend/src/database/migrations.test.ts:L27](workspaces/scaffolder-approvals/plugins/scaffolder-approvals-backend/src/database/migrations.test.ts#L27): 🔵 nit: `jest.setTimeout(60_000)` also bounds the `TestDatabases` teardown hook, which dropped about nine MySQL databases. That hook timed out on a slow disk ([E1](#e1)). CI's tmpfs will likely hide it, but consider raising the timeout for the DB suites.
- <a id="t6"></a>**T6** [backend/src/database/migrations.test.ts:L185](workspaces/scaffolder-approvals/plugins/scaffolder-approvals-backend/src/database/migrations.test.ts#L185), [L250](workspaces/scaffolder-approvals/plugins/scaffolder-approvals-backend/src/database/migrations.test.ts#L250), [L285](workspaces/scaffolder-approvals/plugins/scaffolder-approvals-backend/src/database/migrations.test.ts#L285): 🟡 risk: **new finding, raised while fixing.** Under `backstage-cli repo test` (all six packages at once) the three "a duplicate insert must be refused" tests intermittently fail with `Received function did not throw` on `SQLITE_3`, while every schema test in the same file passes. Reproduced twice in a row, then not again in six further runs, then reliably again on four consecutive runs the following hour; never once under `backstage-cli package test` for the backend package alone, including three runs at `--maxWorkers=100%`. It reproduces with all fix work stashed, so it predates these fixes. The mechanism is not yet established: `TestDatabases`' SQLite engine gives each `init()` a fresh `:memory:` database, so cross-suite sharing is ruled out, and two separate attempts to instrument the assertion — one dumping the schema and pool state, one only counting rows — each made it stop reproducing. It is not caused by the fix-up work: a run with every change stashed, including the untracked migration, fails the same three tests. It matters because a green CI run here would be luck rather than evidence. Fix: find it before relying on these three tests — they are the only coverage of the composite primary key and the two unique constraints.

- <a id="p9"></a>**P9** [backend/migrations/20260912000000_request_approvers.js:L60-L92](workspaces/scaffolder-approvals/plugins/scaffolder-approvals-backend/migrations/20260912000000_request_approvers.js#L60-L92): 🔵 nit: backfills data that cannot exist, since nothing was ever released. Fold the table into the init migration before first publish, and record the fourth table against §6's "three tables".

### Phase 3 — Approval service

**Plan:** quorum, first-deny-rejects, `selfApprove`, idempotent launch, launch-failure versus task-failure, and submit-time validation.

| Exit criterion                                                     | Implementer | This review                                                         |
| ------------------------------------------------------------------ | ----------- | ------------------------------------------------------------------- |
| `quorum: 2` needs two distinct principals                          | ✅          | ✅ Through the real scaffolder ([E2](#e2)); M10 killed              |
| A second vote from the same approver is a conflict                 | ✅          | ✅ 409 in E2                                                        |
| One deny among three approvals rejects                             | ✅          | ✅ M09 killed                                                       |
| `selfApprove: false` blocks a requester who is a group member      | ✅          | ✅ 403 in E2; M08 killed                                            |
| A failing `scaffold()` leaves the request `approved`, not `failed` | ✅          | ✅ True, but the retry that should follow never happens ([C1](#c1)) |
| Invalid values rejected, nothing stored                            | ✅          | ✅ `verify-gate.sh` step 2; M23 killed                              |

<a id="c1"></a>**C1 — Q9 is not implemented (🔴).** ✅ **Fixed.** Q9 says: "Auto-retry the launch on the sweep while the grant is valid; `failed` only once the grant lapses." Phase 3's correction was right: never mint a second _live_ grant, because a lost `task_id` would otherwise run the template twice. But it also disables the retry:

1. `scaffold()` throws, and the grant it just minted stays live ([ApprovalService.ts:L447-L455](workspaces/scaffolder-approvals/plugins/scaffolder-approvals-backend/src/service/ApprovalService.ts#L447-L455)).
2. The sweep sees the live grant and waits ([ApprovalSweeps.ts:L147-L149](workspaces/scaffolder-approvals/plugins/scaffolder-approvals-backend/src/service/ApprovalSweeps.ts#L147-L149)).
3. When the grant expires, the sweep fails the request ([L158-L163](workspaces/scaffolder-approvals/plugins/scaffolder-approvals-backend/src/service/ApprovalSweeps.ts#L158-L163)).

Two pieces of evidence confirm this:

- **Through the real scaffolder** ([E2](#e2)): one simulated scaffolder outage led to `status=failed`, and only one launch ever reached the scaffolder, although it was healthy again seconds later.
- **At the service level on all three engines** ([E3](#e3)): `scaffold` was called once, never twice.

The comment at L448–L450 says "the reconciliation sweep retries". The implementer's own retry test only passes by deleting the grant by hand ([ApprovalSweeps.test.ts:L169-L171](workspaces/scaffolder-approvals/plugins/scaffolder-approvals-backend/src/service/ApprovalSweeps.test.ts#L169-L171)).

**Fix: revoke the unconsumed grant, then relaunch.**

- **Revoke with compare-and-set:** `UPDATE approval_grants SET expires_at = :now WHERE id = :id AND consumed_at IS NULL`.
- **One row changed:** no task can redeem that grant any more, so mint a new one and relaunch.
- **No rows changed:** a task already consumed it, so recover its id as the sweep does today.
- **When to revoke:** immediately if the scaffolder answered with an error (`ResponseError`, so no task exists); after a grace period on a timeout or network error.

**Fixed, with one deviation.** `launch` now claims the request, revokes whatever a failed attempt
left behind and mints a fresh grant, and `revoked_at` is a new column so that revoking is a
compare-and-set that loses to a task redeeming the grant at the same instant. `consumeGrant` gained
`revoked_at IS NULL` as a sixth guard, so a revoked grant stops being redeemable the moment it is
withdrawn.

**The deviation is when to revoke.** This review's "immediately if the scaffolder answered with an
error (`ResponseError`, so no task exists)" does not hold against the installed client:
`ScaffolderClient.scaffold` throws a plain `Error` for a non-2xx answer
(`ScaffolderClient.cjs.js` L90-L94), not a `ResponseError`, so there is nothing to key on but the
message text. Classifying it wrong in the unsafe direction would revoke a grant out from under a
task that had in fact started, failing a run that was about to succeed. Every failure is therefore
treated as an unknown outcome and waits out one grace period
(`LAUNCH_CLAIM_GRACE_MS`, 10 minutes), which costs at most one sweep interval of latency.

**The retry window is bounded.** Each new grant expires when the _first_ one would have, so a
scaffolder that stays down is retried until the original deadline and then the request fails — Q9's
"`failed` only once the grant lapses". Without that, every retry would push the deadline out by a
full TTL and the request would never reach `failed`.

Mutation-tested: making the claim never refuse (M41), making revoke a no-op (M42), dropping the
`revoked_at` guard from consume (M43), and giving each retry a fresh TTL (M44) each break between
one and three tests.

- <a id="c2"></a>**C2** ✅ fixed: [backend/src/service/ApprovalService.ts:L408-L421](workspaces/scaffolder-approvals/plugins/scaffolder-approvals-backend/src/service/ApprovalService.ts#L408-L421): 🟡 risk: `launch()` checks `hasLiveGrant`, then inserts a grant, which is read-then-write (§6 forbids it). A `decide()` whose launch overlaps a sweep tick mints **two grants and starts two tasks**, and each task redeems its own grant, so the template runs twice. [E3](#e3) reproduces it on all three engines. The Spec pass reproduced it independently. Fix: claim the launch with a guarded `UPDATE`, such as a `launch_attempt` compare-and-increment, before minting. Do it together with C1. **Done:** `claimLaunch` is a guarded `UPDATE` on `(status, task_id, launch_attempted_at)` that increments `launch_attempt`, and every launch goes through it first. A claim goes stale after the grace period, so a launcher that crashed mid-flight does not block its request forever.
- <a id="c3"></a>**C3** ✅ fixed: [backend/src/service/ApprovalService.ts:L295-L297](workspaces/scaffolder-approvals/plugins/scaffolder-approvals-backend/src/service/ApprovalService.ts#L295-L297), [L325-L327](workspaces/scaffolder-approvals/plugins/scaffolder-approvals-backend/src/service/ApprovalService.ts#L325-L327): 🔴 bug: `onDecided` receives the request as it was _before_ the transition. Every `decided` event and signal therefore carries `status: 'pending'`, whether the request is now approved or rejected. [E2](#e2) captured `{"action":"decided",…,"status":"pending","decision":"approve"}` from the real event bus, and [E3](#e3) shows the same on three engines. External subscribers, such as the deferred Slack integration, would act on a wrong status. Fix: re-read the request after the transition. **Done:** both notify sites in `decide` now go through `notifyDecided`, which reads the request back after the transition. Mutating it to announce the stale `pending` status (M45) breaks two tests.
- <a id="c4"></a>**C4** ✅ fixed: [backend/src/service/ApprovalService.ts:L262](workspaces/scaffolder-approvals/plugins/scaffolder-approvals-backend/src/service/ApprovalService.ts#L262): 🟡 risk: eligibility ignores `expiresAt`. A request whose timeout has passed can still be approved and launched until the next five-minute sweep. [E3](#e3) shows `decidedAt` a minute after `expiresAt`. `createOrCollapse` already treats such a request as dead ([ApprovalStore.ts:L206-L208](workspaces/scaffolder-approvals/plugins/scaffolder-approvals-backend/src/database/ApprovalStore.ts#L206-L208)). Fix: guard `pending → approved` on `expires_at`. **Done, in both halves.** `checkDecisionEligibility` gained an `expired` reason, so the vote is refused before it is recorded and the UI shows the same wording; and `transition` gained a `notExpired` guard that both decision transitions use, so a decision and the timeout sweep landing together produce exactly one winner rather than leaving a request both `expired` and `approved`. Mutants M61 and M62 break one test each.
- <a id="c5"></a>**C5** ✅ fixed (with [S4](#s4), which depends on it): [backend/src/service/ApprovalService.ts:L217-L218](workspaces/scaffolder-approvals/plugins/scaffolder-approvals-backend/src/service/ApprovalService.ts#L217-L218): 🟡 risk: `templateRef` is stored exactly as sent. `Template:Default/Gated` and `template:default/gated` therefore create two requests on SQLite and Postgres ([E3](#e3)), which defeats Q13 and misses `?templateRef=` filters. Fix: store `stringifyEntityRef(template)`.
- <a id="c16"></a>**C16** [backend/src/service/validateValues.ts:L33-L46](workspaces/scaffolder-approvals/plugins/scaffolder-approvals-backend/src/service/validateValues.ts#L33-L46): 🔵 nit: this uses Ajv, while the scaffolder validates with `jsonschema` against each page _without_ relaxing `additionalProperties`. The two can disagree, so Q3's "never spend an approval on an unrunnable request" can still fail at the edges. Note it.
- <a id="c17"></a>**C17** [backend/src/service/ApprovalService.ts:L256](workspaces/scaffolder-approvals/plugins/scaffolder-approvals-backend/src/service/ApprovalService.ts#L256): 🔵 nit: the load-or-`NotFoundError` pattern is written out three times (L256, L346, L387), although `requireRequest` (L524) exists. Use it.
- [S2](#s2) and [S5](#s5) also belong to this phase.

### Phase 4 — Router and permissions

**Plan:** six routes; a resource ref and three rules; `decide` routed through the permission framework; caller expansion.

| Exit criterion                                      | Implementer | This review                                                           |
| --------------------------------------------------- | ----------- | --------------------------------------------------------------------- |
| `/grants/consume` rejects a user principal with 403 | ✅          | ✅ E2; M07 killed. Other _service_ principals get through ([S3](#s3)) |
| A non-approver gets 403; an approver succeeds       | ✅          | ✅ M24 killed                                                         |
| A group member of a listed group succeeds           | ✅          | ✅ E2 (alice and bob approve only through the group)                  |
| Any signed-in user can list everything (Q12)        | ✅          | ✅                                                                    |
| `totalItems` is independent of `limit`              | ✅          | ✅ Three engines                                                      |

- <a id="g5"></a>**G5** ✅ fixed: [backend/src/plugin.ts:L69-L90](workspaces/scaffolder-approvals/plugins/scaffolder-approvals-backend/src/plugin.ts#L69-L90): 🟡 risk: P4 asks for "auditor events on every decision" ([L663](GATED_SCAFFOLDER_WORKFLOWS.md#L663)). `coreServices.auditor` is not a dependency anywhere. Fix: emit `auditor.createEvent` for submit, decision, cancel and consume, with decision and consume at `high` severity. **Done**, exactly those four and those severities. Wrapped around each operation rather than logged after it, so a _refused_ decision and a _rejected_ grant are audited as loudly as successful ones — "who tried to approve what and was told no" is the half of an audit trail that goes missing when only the happy path is recorded, and a rejected grant is what a replay looks like. A failing auditor is logged and swallowed: the approvals tables are the system of record, and losing the second copy is not a reason to refuse a decision. Mutants M79 and M80 break five tests each.
- <a id="g6"></a>**G6** ✅ decided: [backend/src/service/router.ts:L244-L253](workspaces/scaffolder-approvals/plugins/scaffolder-approvals-backend/src/service/router.ts#L244-L253): 🟡 risk: Q11 asked for a catalog fallback "so a freshly-added approver is not locked out until their next login" ([L484](GATED_SCAFFOLDER_WORKFLOWS.md#L484)). Only `UserInfoService` is used, which returns the token's `ent` claim when present. The Phase 4 correction argues this matches the rest of Backstage, which is a fair argument. But record it as a changed decision, and fix the comments that still say "immediately" ([C12](#c12)). **Done, both.** All four comments are corrected to say what is true — membership is resolved at _sign-in_, so a new approver can decide from their next sign-in rather than from the moment they are added — and the README records the deviation with its reasoning: the lookup would buy a few hours in an unusual case at the cost of a catalog read on the decision path and a cache whose staleness is its own surprise.
- <a id="g7"></a>**G7** ✅ answered: [backend/src/service/ApprovalService.ts:L262-L270](workspaces/scaffolder-approvals/plugins/scaffolder-approvals-backend/src/service/ApprovalService.ts#L262-L270): ❓ q: the permission decision can only narrow who may decide, because the service's approver check always runs as well. So §8's "security-team break-glass rule" ([L476](GATED_SCAFFOLDER_WORKFLOWS.md#L476)) cannot be written. Was that intended? If not, let an explicit ALLOW on `decide` bypass the not-an-approver check, but keep the self-approval and one-vote checks.

  **Intended, and the suggested alternative is unsafe.** Treating an explicit ALLOW as authority to
  bypass the approver check would mean that with `permission.enabled` unset — the Backstage default
  — _every signed-in user could approve every request_, because `ServerPermissionClient` answers
  ALLOW for every user query when permissions are disabled (`ServerPermissionClient.cjs.js`
  L24-L45). An ALLOW carries no information about whether a policy meant it. A four-eyes control
  that evaporates on a default config setting is not a control, so the behaviour stands: policies
  narrow, they do not widen. The README says so, and points at the mechanism that does work — name
  the break-glass group in the template's `approvers`.

- <a id="c18"></a>**C18** [backend/src/plugin.ts:L110-L116](workspaces/scaffolder-approvals/plugins/scaffolder-approvals-backend/src/plugin.ts#L110-L116): 🔵 nit: `config.getOptional<HumanDuration>` does no validation, so `grantTtl: 1h` becomes `NaN`. Fix: use `readDurationFromConfig`.
- <a id="c19"></a>**C19** [backend/src/service/router.ts:L75](workspaces/scaffolder-approvals/plugins/scaffolder-approvals-backend/src/service/router.ts#L75): 🔵 nit: re-implements `isSha256Hex`. `readStatuses` (L126) likewise re-implements `isApprovalRequestStatus`, and `plugin.ts:L124` re-lists the rules even though `scaffolderApprovalsPermissionRules` exists.
- <a id="p10"></a>**P10** [backend/src/index.ts:L25](workspaces/scaffolder-approvals/plugins/scaffolder-approvals-backend/src/index.ts#L25): 🔵 nit: exports `ApprovalObserver`, which no adopter can supply. That is speculative public API.
- <a id="p11"></a>**P11** [backend/package.json](workspaces/scaffolder-approvals/plugins/scaffolder-approvals-backend/package.json), [node/package.json:L38-L41](workspaces/scaffolder-approvals/plugins/scaffolder-approvals-node/package.json#L38-L41): 🔵 nit: unused dependencies, confirmed with `grep`. In the backend: `backend-defaults` (L40), `catalog-client` (L42), `plugin-permission-node`, `luxon` (L59) and `@types/luxon` (L67). In `-node`: `backend-plugin-api`, `errors` and `plugin-permission-common`, plus the dev dependency `backend-test-utils`. The gate module does the opposite: `gate.integration.test.ts` imports `@backstage/catalog-model` without declaring it.
- [S3](#s3) and [S6](#s6) also belong to this phase.

### Phase 5 — The gate action

**Plan:** "**This is the security boundary.**" The action refuses to run without a single-use grant bound to the values.

| Exit criterion (original wording)                                                                       | Implementer                                                 | This review                                                                     |
| ------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------- | ------------------------------------------------------------------------------- |
| **Bypass:** a direct `POST /v2/tasks` fails at step 1 and no later step executes; assert on step status | ✅, reworded to "the action throws", marked "partially met" | ❌ Holds only for templates without the [S1](#s1) shapes ([E2](#e2), [E6](#e6)) |
| **Replay** refused                                                                                      | ✅                                                          | ✅ M02 killed                                                                   |
| **Tamper** refused                                                                                      | ✅                                                          | ✅ M01, M12 killed                                                              |
| **Expiry** refused                                                                                      | ✅                                                          | ✅ M03 killed                                                                   |
| **Happy path:** a grant unlocks the run; `requestedBy`/`approvedBy` appear in the output                | ✅ with a mocked `scaffold`                                 | ✅ **Verified through the real scaffolder** ([E2](#e2))                         |

The action does its own job well. It fails closed without a grant or `values`, when the backend is unreachable, and on any non-2xx answer. It hashes what is actually running, and it leaks nothing about why a grant was refused.

- [S1](#s1) and [S4](#s4) belong to this phase.
- <a id="c11"></a>**C11** [gate-module/src/createApprovalGateAction.ts:L228-L230](workspaces/scaffolder-approvals/plugins/scaffolder-backend-module-approvals/src/createApprovalGateAction.ts#L228-L230): 🔵 nit: `approvedBy` is published straight from `response.json()`. Under Jest, `fetch` comes from another realm, and scaffolder 4.1.0's renderer rejects the foreign array ("Template arrays cannot use a custom prototype"). That failed every step after the gate in [E2](#e2) until the harness re-parsed JSON. Plain Node is unaffected (checked), but `ctx.output('approvedBy', [...consumed.approvedBy])` makes the action robust for anyone testing gated templates with Backstage's own test utilities.
- <a id="c20"></a>**C20** ✅ fixed: [gate-module/src/createApprovalGateAction.ts:L45-L48](workspaces/scaffolder-approvals/plugins/scaffolder-backend-module-approvals/src/createApprovalGateAction.ts#L45-L48): 🔵 nit: the comment "a throw on step one means no later step runs" is false on 4.1.0 ([S1](#s1)).
- <a id="g10"></a>**G10** ✅ fixed: [gate-module/src/createApprovalGateAction.ts:L129-L135](workspaces/scaffolder-approvals/plugins/scaffolder-backend-module-approvals/src/createApprovalGateAction.ts#L129-L135): ❓ q: the required `values: ${{ parameters }}` is a sound decision. But the design's own §9 example ([L526-L536](GATED_SCAFFOLDER_WORKFLOWS.md#L526-L536)) now refuses every run, and §9 says "Nothing else changes" ([L507](GATED_SCAFFOLDER_WORKFLOWS.md#L507)). Update the design doc. **Done.** §9 now carries `values: ${{ parameters }}`, asks for the GitHub username as a parameter instead of reading `${{ user.* }}`, and replaces "nothing else changes" with a correction note. Its notes also say that "no `if:` on the real steps" was never sufficient on its own.
- <a id="c21"></a>**C21** ✅ documented: recovery: 🟡 risk: a template with `EXPERIMENTAL_recovery: { EXPERIMENTAL_strategy: startOver }` keeps task secrets, grant included, in the scaffolder database for the whole run (`DatabaseTaskStore.cjs.js` L243–L244). A recovered task re-runs the gate and fails, because the grant was already consumed. Document that gated templates must not opt in, and warn about it.
- <a id="p12"></a>**P12** [gate-module/package.json:L44](workspaces/scaffolder-approvals/plugins/scaffolder-backend-module-approvals/package.json#L44), [L47](workspaces/scaffolder-approvals/plugins/scaffolder-backend-module-approvals/package.json#L47): 🔵 nit: `@backstage/errors` and `zod` are unused, because the schema uses the `z =>` callbacks.

### Phase 6 — Catalog processor

**Plan:** derive the `gated` annotation from the step, and optionally warn about user OAuth tokens.

| Exit criterion                                    | Implementer | This review                 |
| ------------------------------------------------- | ----------- | --------------------------- |
| A template with a gate step gets the annotation   | ✅          | ✅ Live catalog ([E6](#e6)) |
| A template without one is returned byte-identical | ✅          | ✅                          |
| Non-Template kinds untouched                      | ✅          | ✅                          |
| Idempotent across refresh cycles                  | ✅          | ✅                          |

Deriving _and stripping_ the annotation is a sound extension of Q18. So is warning rather than raising entity errors.

- <a id="g9"></a>**G9** ✅ fixed: [catalog-module/src/ApprovalsGateProcessor.ts:L115-L155](workspaces/scaffolder-approvals/plugins/catalog-backend-module-approvals/src/ApprovalsGateProcessor.ts#L115-L155): 🔴 bug: this is the only ingestion-time check, and [E4](#e4) confirms 8 things it misses:

  - `if:` on the gate;
  - `each:` on the gate;
  - a later `always()` step;
  - `quorum: 0`;
  - a `component:` approver;
  - `values` that is not `${{ parameters }}`;
  - `${{ user.* }}` in a gated template;
  - the same warning being repeated on every processing cycle.

  Fix: run `findGateStep`'s new checks ([S1](#s1)) and `readGatePolicy` here, and de-duplicate warnings through the processor `cache`.

  **Fixed.** The processor now runs the strengthened `findGateStep` and `readGatePolicy`, warns when
  `values` is anything but the whole parameters object and when a later step reads the `user`
  context, and reports each notice only when the set of them changes — through the processor cache
  when one is supplied, and an in-memory map keyed by entity ref otherwise. That also closes
  [C22](#c22).

- <a id="g11"></a>**G11** gate removal: 🟡 risk: §3's mitigation for Q17, "watch for the `approval.gate_removed` signal" ([L182](GATED_SCAFFOLDER_WORKFLOWS.md#L182)), does not exist, so the accepted risk has no detection. The processor can keep "was gated" in its `cache` and log or emit an event when the value flips.
- <a id="c22"></a>**C22** ✅ fixed: [catalog-module/src/ApprovalsGateProcessor.ts:L92-L96](workspaces/scaffolder-approvals/plugins/catalog-backend-module-approvals/src/ApprovalsGateProcessor.ts#L92-L96): 🔵 nit: the "Removing a hand-written annotation" info line repeats on every refresh, because the source YAML still carries the annotation.

### Phase 7 — Sweeps, events and notifications

**Plan:** reconciliation, timeout and retention sweeps with batch caps; task-event subscription; four notifications.

| Exit criterion (original wording)                                                     | Implementer | This review                                                                                                |
| ------------------------------------------------------------------------------------- | ----------- | ---------------------------------------------------------------------------------------------------------- |
| An `approved` request with no `task_id` is retried, then fails once the grant expires | ✅          | ✅ **Now true** — the sweep revokes the stale grant and relaunches until the original deadline ([C1](#c1)) |
| Retention nulls values but keeps the row and its decisions                            | ✅          | ✅ M18 killed                                                                                              |
| A dropped event still converges through the sweep                                     | ✅          | ✅, but see [C6](#c6)                                                                                      |
| Works with notifications and signals absent                                           | ✅          | ✅ E2 runs without either                                                                                  |

The `scaffolder.task` topic is confirmed in `DatabaseTaskStore`. `cancelTask` publishes the task id as `taskId`, so the defensive `taskId` fallback in `readTaskEvent` is _required_. Good call.

- <a id="c6"></a>**C6** ✅ fixed: [backend/src/database/ApprovalStore.ts:L554-L561](workspaces/scaffolder-approvals/plugins/scaffolder-approvals-backend/src/database/ApprovalStore.ts#L554-L561): 🟡 risk: `findRunning` takes the 50 oldest rows by `updated_at`. A still-running task, or one whose `getTask` keeps failing (a deleted task, say), never moves that timestamp. In [E3](#e3), with 50 slow tasks the 51st, already finished, stayed `running` after five ticks, on all three engines. Fix: rotate through the rows with a `last_checked_at` column or a cursor, and fail a request whose task is gone. **Done, both parts.** `findRunning` orders by `coalesce(last_checked_at, created_at)` — COALESCE because the engines disagree about where nulls sort, Postgres last and the other two first — and `markChecked` stamps every request in the batch after the pass, _including_ the ones nothing could be done about, which is the case that used to starve the queue. A `getTask` that 404s now fails the request: nothing can ever resolve it, since no event arrives for a task that does not exist. The check is narrow on purpose — `ResponseError.statusCode === 404` — because a 5xx or a dropped connection says nothing about whether the task exists, and failing a request over a restart would be worse than waiting.

**A note on the tests, because the first two were wrong.** The sweep-level rotation test passed with the fix reverted: the store's clock was frozen, so `last_checked_at` landed on the same instant as `created_at` and the ordering was a tie. The store-level test that replaced it _also_ passed reverted, for a subtler reason — with all three timestamps tied, SQLite returned rows in the order of the new `(status, last_checked_at)` index, so the wrong ordering looked right. Only once each request is created a minute apart do the two orderings disagree, and M63 is killed. Mutants M64 and M65 cover the other two halves.

- <a id="g4"></a>**G4** ✅ fixed: [backend/src/service/ApprovalNotifier.ts:L34-L39](workspaces/scaffolder-approvals/plugins/scaffolder-approvals-backend/src/service/ApprovalNotifier.ts#L34-L39): 🟡 risk: P3 lists `approval.launched` ([L658](GATED_SCAFFOLDER_WORKFLOWS.md#L658)). No `launched` or `completed` event exists ([E3](#e3)). **Done:** `launched` is raised when a request reaches `running` — from a fresh launch and from a recovered task alike — and `completed` when its task finishes. Both carry an event and a signal but deliberately no notification, since Q20 settles on four and "launched" duplicates "decided" in an inbox. Mutants M47 and M48 each break a test.
- <a id="g12"></a>**G12** ✅ fixed: [backend/src/service/ApprovalNotifier.ts:L196-L201](workspaces/scaffolder-approvals/plugins/scaffolder-approvals-backend/src/service/ApprovalNotifier.ts#L196-L201): 🟡 risk: signals go to `user:` refs only. Approvers are normally groups, so their open pages never update ([E3](#e3)). Reads are already open (Q12), so a broadcast carrying `{ requestId, status }` reveals nothing. **Done:** exactly that. The signal is now `{ type: 'broadcast' }` carrying `{ action, requestId, status }` and nothing else, so a page open on a group approver's screen updates. Mutant M46, which restores the user-only addressing, breaks two tests.
- <a id="c23"></a>**C23** ✅ documented: [backend/src/service/ApprovalNotifier.ts:L77-L79](workspaces/scaffolder-approvals/plugins/scaffolder-approvals-backend/src/service/ApprovalNotifier.ts#L77-L79): 🔵 nit: deep links assume the page is mounted at `/scaffolder-approvals`. Any other mount breaks every link, so say so in the install docs.
- <a id="c24"></a>**C24** [backend/src/service/ApprovalSweeps.ts:L129](workspaces/scaffolder-approvals/plugins/scaffolder-approvals-backend/src/service/ApprovalSweeps.ts#L129): 🔵 nit: reads the store's raw snake_case grant rows. Add a store query that returns the consumed task id instead.
- [C1](#c1) and [C3](#c3) show up here too.

### Phase 8 — Frontend

**Plan:** page, nav item, homepage card and `scaffolderApiRef` decorator; BUI inside core-components chrome; both frontend systems; a dev harness.

| Exit criterion                                              | Implementer | This review                                                         |
| ----------------------------------------------------------- | ----------- | ------------------------------------------------------------------- |
| Both exports construct and expose their routes              | ✅          | ✅                                                                  |
| Component tests: empty inbox, list, approve, deny, redacted | ✅          | ✅ M39 killed                                                       |
| `yarn start` shows a working, styled page                   | ❌ (honest) | ❌ Not verified here either. The BUI tokens used do exist in 0.17.1 |

What exists is well built. The problem is what does not exist.

- <a id="g1"></a>**G1** ✅ fixed: [frontend/src/api/ApprovalsClient.ts:L96-L100](workspaces/scaffolder-approvals/plugins/scaffolder-approvals/src/api/ApprovalsClient.ts#L96-L100): 🔴 bug: nothing calls `submitRequest`, and the §8.4 decorator was never built. Neither was the alternative `ReviewStepComponent`. The sequence a requester meets is:

  1. They run a gated template.
  2. The task fails, with a message telling them to "submit it from the approvals page" ([gate-module/src/createApprovalGateAction.ts:L37-L40](workspaces/scaffolder-approvals/plugins/scaffolder-backend-module-approvals/src/createApprovalGateAction.ts#L37-L40)).
  3. That page has no form.

  The README ([ws/README.md:L86](workspaces/scaffolder-approvals/README.md#L86)) describes the flow as working. "UX only" is true for security, but without this the feature cannot be used. Fix: build the decorator, or at least a "Request approval" form on the page.

  **Fixed, as a review step rather than a decorator.** `GatedReviewStep` replaces the scaffolder
  wizard's last screen: for a gated template it shows who will be asked and how many of them, and
  its button creates a request instead of a task. For every other template it renders whatever
  review step it is given as `children`, so installing it changes nothing else.

  Not a `scaffolderApiRef` decorator, because of what `scaffold()` has to return. A decorator
  diverting a gated submit would have no task id to hand back and would have to invent one or throw
  — reporting a successful request as a failure. Replacing the review step means `handleCreate` is
  simply never called. §4 lists both seams; this is the second one.

  `ReviewStepProps` carries no template ref, so the component reads it from the scaffolder's route
  parameters, with a `templateRef` prop as an escape hatch. If that URL shape ever changes it
  renders the ordinary review step rather than a broken screen — the behaviour an app had before
  installing it. Mutants M68 and M69 break four and one tests.

- <a id="g2"></a>**G2** ◨ three of four fixed: [frontend/src/components/RequestDetail/RequestDetail.tsx:L160](workspaces/scaffolder-approvals/plugins/scaffolder-approvals/src/components/RequestDetail/RequestDetail.tsx#L160), [L205-L224](workspaces/scaffolder-approvals/plugins/scaffolder-approvals/src/components/RequestDetail/RequestDetail.tsx#L205-L224): 🟡 risk: four things are missing:

  - the task id is plain text, although §10.1 and Phase 9 step 6 call for a link to the task log;
  - there is no Withdraw button (§5), so `api.cancel` is never called;
  - there is no Resubmit for a failed request (Q5, [L309](GATED_SCAFFOLDER_WORKFLOWS.md#L309));
  - nothing subscribes to signals (P3).

  **Three are done.** The task id is a link to `/create/tasks/:taskId`, which §10.1 asks for and is
  the only route a requester has to the log of a task they do not own. `RequesterActions` adds
  Withdraw while a request is pending and Resubmit once it has failed — a _new_ request with the
  same values, never a retry, since a spent approval cannot be spent twice (Q5). It renders nothing
  for anyone but the requester, and refuses to resubmit a request whose values retention has already
  redacted. Mutants M70, M71 and M72 each break a test.

  **The signal subscription is not done.** It needs `@backstage/plugin-signals-react`, which is not
  in this workspace, so it is a dependency addition and a lockfile change rather than a component.
  The backend half landed in fix 4 — the signals are broadcast and carry `{ action, requestId,
status }` — so what is missing is only the page subscribing to them. Until then the page reloads
  on its own actions and not on somebody else's.

- <a id="g3"></a>**G3** ✅ fixed: [frontend/src/alpha.ts:L64-L71](workspaces/scaffolder-approvals/plugins/scaffolder-approvals/src/alpha.ts#L64-L71): 🟡 risk: Q22 asks for "page + nav item + homepage card", and only the page exists. These gaps are recorded only in Phase 10, while Phase 8 is marked Done.

  **Both added.**

  **The nav item is not a `NavItemBlueprint`.** That blueprint does not exist in the
  `frontend-plugin-api` this workspace targets — sibling workspaces still calling it are on older
  Backstage versions. In 1.54.5 a page declares its own `title` and `icon`, outputs them as
  `core.title` and `core.icon`, and the app builds the sidebar entry from that. The icon is an
  inline SVG rather than one from an icon set, so the package takes no dependency for a single
  glyph.

  **The card is dual-shipped**: `createCardExtension` for the legacy system,
  `HomePageWidgetBlueprint` for the new one, both rendering the same component (Q14, Q23). It counts
  with `role=approver` and `status=pending` — the same query the inbox tab runs, so the number and
  the list cannot disagree — and it renders a message rather than throwing when the backend is
  unreachable, since a home card that throws takes the whole page with it.

  **One pin was needed.** `@backstage/plugin-home-react` resolved to 0.1.42, which requires
  `frontend-plugin-api ^0.18.1`, while Backstage 1.54.5 ships 0.18.0 — so yarn installed a second
  copy and the alpha plugin's inferred type stopped being nameable. 0.1.41 is what the 1.54.5
  manifest pins and it wants `^0.18.0`, so a `resolutions` entry holds it there. The alternative was
  annotating the plugin's type, which erases `getExtension` and would have cost the construction
  smoke tests (Q23).

  **M73 survived the first run**, because nothing asserted the page declared a nav entry at all.
  `createExtensionTester` reads `core.title` and `core.icon` off the page extension, which kills it.
  M74 and M75 cover the card's query and its failure mode.

- <a id="c25"></a>**C25** [frontend/src/components/RequestDetail/RequestDetail.tsx:L43-L48](workspaces/scaffolder-approvals/plugins/scaffolder-approvals/src/components/RequestDetail/RequestDetail.tsx#L43-L48): 🔵 nit: `WHY_NOT` re-words the backend's `INELIGIBILITY_MESSAGES` ([ApprovalService.ts:L110](workspaces/scaffolder-approvals/plugins/scaffolder-approvals-backend/src/service/ApprovalService.ts#L110)), although L221–L222 promises the two "can never tell different stories". Keep one map in `-common`.
- <a id="c26"></a>**C26** [frontend/src/components/RequestDetail/RequestDetail.tsx:L183-L187](workspaces/scaffolder-approvals/plugins/scaffolder-approvals/src/components/RequestDetail/RequestDetail.tsx#L183-L187): 🔵 nit: shows "Denied" whenever any denial exists, including one that lost the race to an approval, on a request that is actually running. Base the text on `request.status`.
- <a id="c27"></a>**C27** ✅ fixed: [frontend/src/components/ApprovalsPage/ApprovalsPage.tsx:L52-L60](workspaces/scaffolder-approvals/plugins/scaffolder-approvals/src/components/ApprovalsPage/ApprovalsPage.tsx#L52-L60): 🔵 nit: "Waiting on you" includes requests the caller has already voted on, and their own requests under `selfApprove: false`. **Fixed, and it was not a nit.** Seen in a browser, the home card counts the same thing, and a card that never reaches zero is one people stop reading ([B2 in the browser review](GATED_SCAFFOLDER_BROWSER_REVIEW.md#b2)). The inbox and the card now ask for `actionable` requests, which the store answers with `checkDecisionEligibility`'s rules: pending, not past the deadline, not voted on by the caller, and not their own when self-approval is forbidden. A test holds the two to agreement, request by request. `selfApprove` became a column, through a new migration with a backfill, so the filter can page and count in SQL.
- <a id="c28"></a>**C28** [frontend/src/components/ApprovalsPage/RequestsTable.tsx:L66-L67](workspaces/scaffolder-approvals/plugins/scaffolder-approvals/src/components/ApprovalsPage/RequestsTable.tsx#L66-L67), [L128-L129](workspaces/scaffolder-approvals/plugins/scaffolder-approvals/src/components/ApprovalsPage/RequestsTable.tsx#L128-L129): 🔵 nit: `reloadToken` is dead code. Nothing passes it, and `void reloadToken` triggers nothing. `when()` (L48) is also duplicated in `RequestDetail.tsx:L50`.
- <a id="t2"></a>**T2** [frontend/src/components/RequestDetail/RequestDetail.test.tsx:L118](workspaces/scaffolder-approvals/plugins/scaffolder-approvals/src/components/RequestDetail/RequestDetail.test.tsx#L118): 🔵 nit: uses `waitFor` on mock calls (also L143 and L175, and `ApprovalsPage.test.tsx:L99`), against AGENTS.md L44. Separately, jsdom logs 156 "Could not parse CSS stylesheet" errors against BUI's CSS.
- <a id="p13"></a>**P13** [frontend/package.json:L59-L62](workspaces/scaffolder-approvals/plugins/scaffolder-approvals/package.json#L59-L62), [L69](workspaces/scaffolder-approvals/plugins/scaffolder-approvals/package.json#L69), [L71](workspaces/scaffolder-approvals/plugins/scaffolder-approvals/package.json#L71), [L79](workspaces/scaffolder-approvals/plugins/scaffolder-approvals/package.json#L79): 🔵 nit: unused dependencies: `plugin-catalog-react`, `plugin-permission-react`, `plugin-scaffolder-common`, `plugin-scaffolder-react`, `core-app-api`, `frontend-test-utils` and `msw`. `@types/aria-query` _is_ needed, for `tsc`.

### Phase 9 — End-to-end verification

**Plan:** wire a real backend and walk seven steps, the most important being "curl the scaffolder directly and the task fails at step 1". Script all seven.

| Exit criterion (original wording)         | Implementer                           | This review                                                                                                                                                                                                                                                                          |
| ----------------------------------------- | ------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| All seven steps pass by hand              | ✅, reworded to "steps 1, 2, 3 and 7" | ⚠️ Steps 1, 2 (via curl; no UI exists), 3 and 7 re-verified on the dev backend ([E6](#e6)). Steps 4–6 **now verified** through the real scaffolder ([E2](#e2)), except "the detail page links to the task log" ([G2](#g2)). Step 7 holds only for templates without [S1](#s1) shapes |
| Steps 1–7 scripted as an integration test | ✅, reworded                          | ❌ `gate.integration.test.ts` mocks `scaffold`, uses quorum 1, has no self-approval case, and never reaches `completed`. [Appendix A1](#a1) covers steps 3–7 and could be adopted                                                                                                    |
| A restart mid-`pending` loses nothing     | ✅                                    | Not re-checked. It is plausible: the database is a file                                                                                                                                                                                                                              |

The two things Phase 9 found are real and valuable: the unrendered summary, and the silent drop of Template entities without the entity-model module.

- <a id="t3"></a>**T3** [gate-module/src/gate.integration.test.ts:L291](workspaces/scaffolder-approvals/plugins/scaffolder-backend-module-approvals/src/gate.integration.test.ts#L291): 🔵 nit: `items.find(item => item.id)` matches any item, so the "whole flow" test never looks at the request it created.
- <a id="t4"></a>**T4** [ws/scripts/verify-gate.sh:L111-L112](workspaces/scaffolder-approvals/scripts/verify-gate.sh#L111-L112): 🟡 risk: the script prints "The gate holds." after testing one template shape. Add probe templates for the [S1](#s1) shapes ([A6](#a6)) and assert that submit refuses them.
- <a id="p14"></a>**P14** [ws/scripts/verify-gate.sh](workspaces/scaffolder-approvals/scripts/verify-gate.sh): 🔵 nit: committed as mode `100644`, while sibling workspace scripts are `100755`. So `./scripts/verify-gate.sh`, as the README says ([L202](workspaces/scaffolder-approvals/README.md#L202)), fails on Linux and macOS. Fix: `git update-index --chmod=+x`.
- <a id="t5"></a>**T5** [ws/scripts/verify-gate.sh:L53-L58](workspaces/scaffolder-approvals/scripts/verify-gate.sh#L53-L58), [L38-L44](workspaces/scaffolder-approvals/scripts/verify-gate.sh#L38-L44): 🔵 nit: it checks the annotation on the _first_ template in the catalog rather than on `$TEMPLATE`, and its wait loop never times out.

### Phase 10 — Upstream preparation

**Plan:** API reports, changesets, headers, READMEs, documentation of §10.1 and §10.2, CODEOWNERS, clean tooling, and a link to the proposal.

| Exit criterion                     | Implementer     | This review                                                                |
| ---------------------------------- | --------------- | -------------------------------------------------------------------------- |
| API reports for every package      | ✅              | ✅ `--ci` clean                                                            |
| A changeset per package            | ✅              | ✅ Six `minor` changesets, versions `0.0.0` ([P15](#p15))                  |
| Headers                            | ✅              | ✅                                                                         |
| READMEs with a worked example      | ✅              | ⚠️ Inaccurate in several places (below)                                    |
| §10.1 and §10.2 documented         | ✅              | ⚠️ §10.1 omits empty `${{ user.* }}` and the permission bypass ([S2](#s2)) |
| CODEOWNERS; org membership request | partly          | ✅ / ❌ (yours)                                                            |
| Lint, `tsc` and tests clean        | ✅ (`lint:all`) | ✅                                                                         |
| Proposal issue linked              | ❌              | ❌ ([P2](#p2))                                                             |

- <a id="d1"></a>**D1** ✅ fixed: [ws/README.md:L86](workspaces/scaffolder-approvals/README.md#L86): 🔴 bug: "The requester submits the template from the approvals page" describes a form that does not exist ([G1](#g1)). **Fixed** — and the sentence was wrong twice over once [G1](#g1) was built, because the submit path is the scaffolder's own wizard, not the approvals page. It now says so, and names the review step that makes it true.
- <a id="d2"></a>**D2** ✅ fixed: [ws/README.md:L73-L79](workspaces/scaffolder-approvals/README.md#L73-L79): 🟡 risk: the worked example gives `github:repo:collaborator:add` made-up inputs (`repository`, `requestedBy`, `approvedBy`), so a copied example fails validation. **Fixed, and now checked rather than proofread.** The example uses the action's real inputs (`repoUrl`, `username`, `permission`) and asks for the GitHub username as a parameter, because an approved run has no user on it and `${{ user.* }}` would render empty. A test extracts the YAML from the README and puts it through `findGateStep`, `findSecretParameters` and `validateValues` — the same checks a real submission goes through — so the example cannot rot again without a test failing. Mutating it back to `${{ user.entity.metadata.name }}` breaks that test.
- <a id="d3"></a>**D3** ✅ fixed: [ws/README.md:L101](workspaces/scaffolder-approvals/README.md#L101), [L138](workspaces/scaffolder-approvals/README.md#L138): 🟡 risk: claims a task link and live updates through signals. Neither exists. **Fixed.** The task link exists now ([G2](#g2)); the live updates do not, and all four places that claimed otherwise now say the page needs a reload to show somebody else's decision. "Not yet" lists it.
- <a id="d4"></a>**D4** ✅ fixed: [ws/README.md](workspaces/scaffolder-approvals/README.md): 🟡 risk: "Things to know" leaves out:

  - the [S1](#s1) shapes;
  - empty `${{ user.* }}` ([S2](#s2));
  - `EXPERIMENTAL_recovery` ([C21](#c21));
  - secret-type fields ([S7](#s7));
  - the fixed mount path that notification links depend on;
  - the `actionExecutePermission` mitigation.

  **All six are covered now**, the last two here: `EXPERIMENTAL_recovery` ([C21](#c21)) gets its own
  section — a recovered gated task re-runs its gate and fails, because the grant it holds was spent
  by the first attempt, and no recovery strategy helps since single use is the point — and the
  mount path ([C23](#c23)) says plainly that notification deep links break if the page is mounted
  anywhere but `/scaffolder-approvals`. The other four landed with the fixes that made them true.

- <a id="p15"></a>**P15** [ws/.changeset/scaffolder-approvals-node-initial.md:L5](workspaces/scaffolder-approvals/.changeset/scaffolder-approvals-node-initial.md#L5): 🔵 nit: names functions (`findGateStep`, `isGated`), which AGENTS.md L89 rules out.
- <a id="p16"></a>**P16** ✅ fixed: [GATED_SCAFFOLDER_IMPLEMENTATION.md:L10-L24](GATED_SCAFFOLDER_IMPLEMENTATION.md#L10-L24): 🟡 risk: every phase is marked **Done**, yet the exit criteria of Phases 5, 7, 8 and 9 are unmet or were reworded after the fact ([L1302](GATED_SCAFFOLDER_IMPLEMENTATION.md#L1302), [L1557](GATED_SCAFFOLDER_IMPLEMENTATION.md#L1557), [L1846](GATED_SCAFFOLDER_IMPLEMENTATION.md#L1846)). Fix: mark those phases "Done with gaps", and link this review from each. **Done.** The progress table now has two columns — what was claimed before review, and what holds now — with each phase linking to the findings that moved it. Phases 0, 8, 9 and 10 are "Done with gaps"; the rest say what was wrong and that it is fixed. The table also says outright that where the two documents disagree, the review is the one that ran the code.

---

## 5. Decision traceability

✅ implemented as decided · ⚠️ implemented with a gap or deviation · ❌ not implemented

| Decision | Summary                                                   | Status | Where / evidence                                                            |
| -------- | --------------------------------------------------------- | ------ | --------------------------------------------------------------------------- |
| R0a      | Pre-execution gate only                                   | ✅     | —                                                                           |
| R0b      | Upstream to community-plugins                             | ⚠️     | Blocked by [P1](#p1) and [P2](#p2)                                          |
| R0c      | Policy in template YAML                                   | ✅     | `readGatePolicy`                                                            |
| Q1       | Workspace `scaffolder-approvals`                          | ✅     | —                                                                           |
| Q3       | Validate values at submit (400)                           | ✅     | M23; `verify-gate.sh` step 2; [C16](#c16)                                   |
| Q4       | Task events plus reconciliation sweep                     | ⚠️     | Events work ([E2](#e2)); sweep starvation [C6](#c6)                         |
| Q5       | Failed is terminal; UI offers Resubmit                    | ⚠️     | Terminal ✅; Resubmit ❌ ([G2](#g2))                                        |
| Q6       | Redact, never delete, after 180 days                      | ⚠️     | Clock from `updated_at` ([C7](#c7))                                         |
| Q7       | Grant TTL configurable, 1h default                        | ✅     | M31 (config not validated, [C18](#c18))                                     |
| Q8       | Gates in YAML; config holds only TTL and retention        | ✅     | `config.d.ts`                                                               |
| Q9       | Retry the launch while the grant is valid                 | ❌     | [C1](#c1)                                                                   |
| Q10      | Grant bound to `values_hash`                              | ✅     | M01, M12; but template binding missing ([S4](#s4))                          |
| Q11      | Ownership refs, plus catalog fallback with a ~1 min cache | ⚠️     | [G6](#g6)                                                                   |
| Q12      | Everything readable                                       | ✅     | Beware [S7](#s7)                                                            |
| Q13      | Collapse duplicates with 200                              | ⚠️     | Casing bypass ([C5](#c5)); racy under load (acknowledged)                   |
| Q14      | Dual-ship legacy and `./alpha`                            | ✅     | —                                                                           |
| Q15      | BUI                                                       | ✅     | —                                                                           |
| Q16      | `dev/index` plus a real backend, no `packages/app`        | ⚠️     | [P4](#p4)                                                                   |
| Q17      | No `requireGate` allowlist (accepted risk)                | ⚠️     | Risk larger than documented ([S1](#s1)); no removal detection ([G11](#g11)) |
| Q18      | Annotation derived, never authored                        | ✅     | Also stripped (a good extension)                                            |
| Q19      | `decide` through a registered rule                        | ⚠️     | Works; no break-glass ([G7](#g7)); inverted filter ([S6](#s6))              |
| Q20      | Four notifications                                        | ✅     | "Submitted" verified live ([E6](#e6))                                       |
| Q21      | List API parameters                                       | ✅     | —                                                                           |
| Q22      | Page, nav item, home card                                 | ❌     | Page only ([G3](#g3))                                                       |
| Q23      | Components tested once, both plugins smoke-tested         | ✅     | —                                                                           |
| Q24      | core-components chrome                                    | ✅     | —                                                                           |
| §3       | Direct run fails before any real step                     | ❌     | [S1](#s1)                                                                   |
| §3       | Grant bound to request, template and values               | ⚠️     | [S4](#s4)                                                                   |
| §6       | Compare-and-set everywhere                                | ⚠️     | Except launch ([C2](#c2))                                                   |
| §7/§12   | Launch behind a `-node` interface                         | ❌     | Acknowledged in Phase 10                                                    |
| §10.1    | Service credentials; real actors injected                 | ✅     | [E2](#e2); consequences in [S2](#s2)                                        |
| §10.2    | Warn on `USER_OAUTH_TOKEN`                                | ✅     | Processor and README                                                        |
| §10.3    | Store uid and spec hash; warn on drift                    | ❌     | [S5](#s5)                                                                   |
| §10.4    | Accepted risk, mitigated operationally                    | ⚠️     | [G11](#g11)                                                                 |
| P1       | Backend core, including "test the bypass path"            | ⚠️     | [S1](#s1)                                                                   |
| P2       | Frontend: page, card, decorator, pill, harness            | ⚠️     | [G1](#g1), [G3](#g3)                                                        |
| P3       | Notifications, signals, three events                      | ⚠️     | [C3](#c3), [G4](#g4), [G12](#g12)                                           |
| P4       | Sweeps, launch retry, auditor                             | ⚠️     | [C1](#c1), [G5](#g5)                                                        |
| P5       | Upstream prep                                             | ⚠️     | Phase 10                                                                    |

---

## 6. Test suite assessment

**Numbers.** 335 tests on SQLite, and 439 across three engines. The tests are well named, run against real SQL rather than a mocked store, and several guards were mutation-tested by the implementer. That discipline shows.

**Mutation audit ([E7](#e7)).** Each mutant disables one guard and runs that package's own suite; "killed" means at least one test failed.

| #   | Guard disabled                                              | Suite          | Result          | Suite outcome                   |
| --- | ----------------------------------------------------------- | -------------- | --------------- | ------------------------------- |
| M01 | consumeGrant: drop the values_hash guard (Q10 tamper check) | -backend       | ✅ killed       | 5 failed, 182 passed, 187 total |
| M02 | consumeGrant: drop the single-use guard (replay)            | -backend       | ✅ killed       | 3 failed, 184 passed, 187 total |
| M03 | consumeGrant: drop the TTL guard (Q7)                       | -backend       | ✅ killed       | 1 failed, 186 passed, 187 total |
| M04 | consumeGrant: drop the request_id guard                     | -backend       | ❌ **survived** | 187 passed, 187 total           |
| M05 | consumeGrant: report success regardless of the update       | -backend       | ✅ killed       | 8 failed, 179 passed, 187 total |
| M06 | transition: drop compare-and-set on status                  | -backend       | ✅ killed       | 5 failed, 182 passed, 187 total |
| M07 | /grants/consume: accept user principals                     | -backend       | ✅ killed       | 4 failed, 183 passed, 187 total |
| M08 | eligibility: drop the selfApprove guard (four-eyes)         | -common        | ✅ killed       | 1 failed, 49 passed, 50 total   |
| M09 | decide: first deny no longer rejects                        | -backend       | ✅ killed       | 2 failed, 185 passed, 187 total |
| M10 | quorum: count decisions, not distinct principals            | -common        | ✅ killed       | 1 failed, 49 passed, 50 total   |
| M11 | gate: do not stop early without a grant                     | gate module    | ✅ killed       | 4 failed, 21 passed, 25 total   |
| M12 | gate: hash something other than the running values          | gate module    | ✅ killed       | 5 failed, 20 passed, 25 total   |
| M13 | gate: ignore a refusal from the backend                     | gate module    | ✅ killed       | 10 failed, 15 passed, 25 total  |
| M14 | store: accept values and a hash that disagree               | -backend       | ✅ killed       | 4 failed, 183 passed, 187 total |
| M15 | launch: mint a second live grant (double run)               | -backend       | ✅ killed       | 1 failed, 186 passed, 187 total |
| M16 | findGateStep: accept a gate that is not first               | -node          | ✅ killed       | 1 failed, 33 passed, 34 total   |
| M17 | processor: never strip a hand-written annotation            | catalog module | ✅ killed       | 2 failed, 16 passed, 18 total   |
| M18 | retention: redact requests that are still in flight         | -backend       | ✅ killed       | 4 failed, 183 passed, 187 total |
| M19 | canonicalJson: stop sorting keys                            | -common        | ✅ killed       | 2 failed, 48 passed, 50 total   |
| M20 | hashGrantToken: store the raw token                         | -node          | ✅ killed       | 1 failed, 33 passed, 34 total   |
| M21 | cancel: let anyone withdraw                                 | -backend       | ✅ killed       | 2 failed, 185 passed, 187 total |
| M22 | /decision: skip the permission framework (Q19)              | -backend       | ✅ killed       | 4 failed, 183 passed, 187 total |
| M23 | submit: skip value validation (Q3)                          | -backend       | ✅ killed       | 1 failed, 186 passed, 187 total |
| M24 | eligibility: anyone may vote                                | -common        | ✅ killed       | 2 failed, 48 passed, 50 total   |
| M25 | eligibility: forget who already voted                       | -common        | ✅ killed       | 1 failed, 49 passed, 50 total   |
| M26 | store: do not index approvers (inbox)                       | -backend       | ✅ killed       | 5 failed, 182 passed, 187 total |
| M27 | GET /requests?role=approver: ignore the role                | -backend       | ✅ killed       | 4 failed, 183 passed, 187 total |
| M28 | sweep: do not recover a lost task id                        | -backend       | ✅ killed       | 1 failed, 186 passed, 187 total |
| M29 | isGated: nothing is gated                                   | -node          | ✅ killed       | 2 failed, 32 passed, 34 total   |
| M30 | GET /requests: silently ignore a conditional read policy    | -backend       | ✅ killed       | 4 failed, 183 passed, 187 total |
| M31 | launch: ignore the configured grant TTL                     | -backend       | ✅ killed       | 2 failed, 185 passed, 187 total |
| M32 | rowMapping: read naive datetimes as local time              | -backend       | ✅ killed       | 3 failed, 184 passed, 187 total |
| M33 | notifier: notify the requester about their own request      | -backend       | ✅ killed       | 1 failed, 186 passed, 187 total |
| M34 | sweep: a cancelled task counts as completed                 | -backend       | ✅ killed       | 1 failed, 186 passed, 187 total |
| M35 | decide: treat a lost double-vote race as a new vote         | -backend       | ✅ killed       | 3 failed, 184 passed, 187 total |
| M36 | collapse: fold into a request that already timed out        | -backend       | ✅ killed       | 1 failed, 186 passed, 187 total |
| M37 | IS_NOT_REQUESTER: always true                               | -node          | ✅ killed       | 1 failed, 33 passed, 34 total   |
| M38 | IS_NOT_REQUESTER: any list filter at all                    | -node          | ❌ **survived** | 34 passed, 34 total             |
| M39 | UI: always offer the decide buttons                         | frontend       | ✅ killed       | 4 failed, 6 passed, 10 total    |
| M40 | launch: launch a redacted request                           | -backend       | ✅ killed       | 4 failed, 183 passed, 187 total |

**What the survivors mean:**

- <a id="m04"></a>**M04** — removing `request_id` from the consume guard breaks no test. `ApprovalStore.test.ts › refuses a grant belonging to another request` presents a _different token_ as well as a different request, so the token guard refuses it on its own. The request guard is the one `formatGrant` exists to feed, yet nothing tests it. Fix the test so it presents request A's real token with request B's id.
- <a id="m38"></a>**M38** — no test covers `IS_NOT_REQUESTER.toQuery`. That is how [S6](#s6) shipped. ✅ **Now killed** — see [S6](#s6).
- <a id="m39"></a>**M39** — the first run reported this mutant as surviving. That was a bug in the audit runner: Jest read the test path as a second `--testPathIgnorePatterns` value, so the relevant test file never ran. Re-run with the arguments fixed, it was killed (4 of 10 `RequestDetail` tests failed).

**Gaps the suite does not cover, with where this review demonstrates them:**

- template shapes that bypass the gate ([S1](#s1));
- launch retry after a failed `scaffold()` ([C1](#c1));
- concurrent launches ([C2](#c2));
- the status inside events ([C3](#c3));
- decisions after expiry ([C4](#c4));
- ref spelling in collapse ([C5](#c5));
- sweep starvation ([C6](#c6));
- `IS_NOT_REQUESTER.toQuery` ([S6](#s6));
- malformed ids on Postgres ([C8](#c8));
- same-second ordering on MySQL ([C9](#c9));
- drift ([S5](#s5));
- a completed approved run through the real scaffolder ([E2](#e2)).

Appendices A1–A4 turn each gap into a test that can be kept. The spec tests use `it.failing`, so drop `.failing` as each fix lands.

---

## Standards

_This is the Standards pass from the `code-review` skill, run by a separate reviewer that read the change only from git objects. It is reproduced as reported, with light clean-up: list formatting, links, and two editor's notes where checking showed a claim to be wrong or incomplete. It is kept apart from the Spec pass and has not been re-ranked._

**🔴 marks a documented standard that is breached. 🟡 marks a judgement call against the generic code-smell checklist, which a documented repo standard always overrides.**

- commits `e073c108a..1f2f50918`: 🔴 None of the 11 commits has a `Signed-off-by` trailer (AGENTS.md L98). Fix: re-sign them with `git rebase --signoff main`.
- [GATED_SCAFFOLDER_IMPLEMENTATION.md:L65](GATED_SCAFFOLDER_IMPLEMENTATION.md#L65): 🔴 The proposal issue is marked SKIPPED, but CONTRIBUTING.md L137 requires an accepted proposal before a new-plugin PR. Fix: open the issue and wait for acceptance.
- [GATED_SCAFFOLDER_WORKFLOWS.md:L1](GATED_SCAFFOLDER_WORKFLOWS.md#L1): 🔴 Both root `GATED_*` design logs (~2.9k lines) sit outside the workspace (copilot-instructions.md L23), and design rationale belongs in an issue (AGENTS.md L96). Possible Shotgun Surgery: removing them also means fixing links in 7 READMEs and 39 `(Qn)`/`§` comments across 23 files. Fix: move the logs into the issue.
- [ws/packages/backend/src/index.ts:L26](workspaces/scaffolder-approvals/packages/backend/src/index.ts#L26): 🔴 This is a full example backend (copilot-instructions.md L39), yet the backend plugin's `start` script (package.json L35) has no `dev/index.ts` to run. Fix: move this wiring there and delete `packages/backend`.
- [ws/.changeset/scaffolder-approvals-node-initial.md:L5](workspaces/scaffolder-approvals/.changeset/scaffolder-approvals-node-initial.md#L5): 🔴 The changeset names the functions `findGateStep` and `isGated` (AGENTS.md L89). Fix: describe the behaviour instead.
- [frontend/src/components/ApprovalsPage/ApprovalsPage.test.tsx:L99](workspaces/scaffolder-approvals/plugins/scaffolder-approvals/src/components/ApprovalsPage/ApprovalsPage.test.tsx#L99): 🔴 Uses `waitFor` where a `findBy*` query would do, and L55-104 split one fixture across three tests (AGENTS.md L44). `renderSummary.test.ts` (9 tests for one pure function) and `RequestDetail.test.tsx` L185-245 have the same problem. Fix: merge them.
- [gate-module/src/createApprovalGateAction.test.ts:L72](workspaces/scaffolder-approvals/plugins/scaffolder-backend-module-approvals/src/createApprovalGateAction.test.ts#L72): 🔴 Assigns a mock to `global.fetch` (L73), where Backstage ADR007 prescribes MSW. Fix: use MSW.
- [frontend/package.json:L59](workspaces/scaffolder-approvals/plugins/scaffolder-approvals/package.json#L59): 🟡 Possible Speculative Generality: dependencies that nothing imports. Affected lines: here L59-62, 69, 71 and 79; backend L40, 42, 49, 59 and 67; node L38, 40, 41 and 48; module L44 and 47. Also, the module's `gate.integration.test.ts` L27 imports `@backstage/catalog-model` without declaring it. Fix: remove the unused dependencies, declare that one, and enable `knipReports`.
- [frontend/src/components/RequestDetail/RequestDetail.tsx:L43](workspaces/scaffolder-approvals/plugins/scaffolder-approvals/src/components/RequestDetail/RequestDetail.tsx#L43): 🟡 Possible Duplicated Code: `WHY_NOT` copies `INELIGIBILITY_MESSAGES` (ApprovalService.ts L110), and the self-approval wording has already drifted between the two. Fix: export one map from the common package.
- [common/src/eligibility.ts:L61](workspaces/scaffolder-approvals/plugins/scaffolder-approvals-common/src/eligibility.ts#L61): 🟡 Possible Duplicated Code: the same "normalise the ref, or skip it" try/catch appears four times (here, L90, L148, and node `permissions.ts` L59). Fix: export one helper.
- [backend/src/service/ApprovalService.ts:L204](workspaces/scaffolder-approvals/plugins/scaffolder-approvals-backend/src/service/ApprovalService.ts#L204): 🟡 Possible Duplicated Code: `error instanceof Error ?` appears 10 times across 7 files, and four `Error` subclasses repeat the same boilerplate (e.g. `gatePolicy.ts` L31). Fix: use `stringifyError`, `assertError` and `CustomErrorBase` from `@backstage/errors`.
- [backend/src/plugin.ts:L124](workspaces/scaffolder-approvals/plugins/scaffolder-approvals-backend/src/plugin.ts#L124): 🟡 Possible Duplicated Code: three places redo work that already has a helper:

  - `plugin.ts` re-lists the permission rules instead of using `scaffolderApprovalsPermissionRules` from the node package, which nothing uses;
  - `router.ts` L75 and L126 reimplement `isSha256Hex` and `isApprovalRequestStatus`;
  - `ApprovalService.ts` L256, L346 and L387 inline what `requireRequest` (L524) already does.

  Fix: reuse the existing helpers.

- [frontend/src/components/ApprovalsPage/RequestsTable.tsx:L48](workspaces/scaffolder-approvals/plugins/scaffolder-approvals/src/components/ApprovalsPage/RequestsTable.tsx#L48): 🟡 Possible Duplicated Code: `when()` is copied in `RequestDetail.tsx` L50, and it formats dates with native `toLocaleString`, where ADR010 and ADR012 prefer Luxon. Fix: share one Luxon helper.
- [backend/src/index.ts:L25](workspaces/scaffolder-approvals/plugins/scaffolder-approvals-backend/src/index.ts#L25): 🟡 Possible Speculative Generality in several places:

  - `ApprovalObserver` is public, but no public API accepts one;
  - the `ids` filter and `getGrant` are used only by tests (ApprovalStore.ts L121 and L622);
  - `subscribeToTaskEvents.ts` L63 guesses a `taskId` spelling;
  - `reloadToken` is never passed by any caller (RequestsTable.tsx L67);
  - signals are published that no UI consumes (ApprovalNotifier.ts L192).

  Fix: delete them. _Editor's note: the `taskId` spelling is not a guess. Scaffolder 4.1.0's `cancelTask` publishes `{ id: <event row id>, taskId }`, so without it cancelled tasks would be missed. Keep it._

- [backend/migrations/20260912000000_request_approvers.js:L60](workspaces/scaffolder-approvals/plugins/scaffolder-approvals-backend/migrations/20260912000000_request_approvers.js#L60): 🟡 Possible Speculative Generality: it backfills a schema that has never been released. Fix: fold this table into the init migration.

_Editor's note on the dependency finding: each listed line was checked against HEAD, and all of them are unused. That includes `-node` L48, the dev dependency `@backstage/backend-test-utils`, which no `-node` test imports. The frontend's `@types/aria-query` is **not** in the list; it is needed for `tsc:full`._

## Spec

_This is the Spec pass from the `code-review` skill, run by a separate reviewer. It is reproduced as reported, with light clean-up only: list formatting and links. It is kept apart from the Standards pass and has not been re-ranked. Each finding quotes the line of the spec it measures against._

- [node/src/gateStep.ts:L74](workspaces/scaffolder-approvals/plugins/scaffolder-approvals-node/src/gateStep.ts#L74): 🔴 The gate check covers only the gate's position and count, so a direct `POST /v2/tasks` can still reach real steps. Scaffolder-backend 4.1.0:

  - skips a gate whose `if:` is falsy (`NunjucksWorkflowRunner.cjs.js:L213`);
  - passes a gate whose `each:` resolves to an empty list (L302-311);
  - still runs later `always()`/`failure()` steps after the gate throws (L557-574);
  - drops the gate for a caller when a conditional `HAS_TAG` step-read policy excludes it (`router.cjs.js:L910`).

  Spec: "throws on step 1, before any real step executes" (§3). Reject these shapes.

- [backend/src/database/ApprovalStore.ts:L480](workspaces/scaffolder-approvals/plugins/scaffolder-approvals-backend/src/database/ApprovalStore.ts#L480): 🔴 Consuming a grant never checks the template, and the gate never sends it (`createApprovalGateAction.ts:L191`). A leaked grant can therefore run any other gated template that takes the same values. Spec: "bound to `(request_id, template_ref, values_hash)`" (§3). Send `templateInfo.entityRef` and match it.
- [backend/src/service/ApprovalSweeps.ts:L147](workspaces/scaffolder-approvals/plugins/scaffolder-approvals-backend/src/service/ApprovalSweeps.ts#L147): 🔴 After a failed `scaffold()`, the grant stays live, so the sweep waits and then fails the request (L160). The launch is never retried. The implementer's retry test only passes because it deletes the grant first (`ApprovalSweeps.test.ts:L169-171`). Spec: "Auto-retry the launch on the sweep while the grant is valid" (Q9). Revoke the grant on failure, then mint a new one.
- [gate-module/src/createApprovalGateAction.ts:L37](workspaces/scaffolder-approvals/plugins/scaffolder-backend-module-approvals/src/createApprovalGateAction.ts#L37): 🔴 The gate's error sends users to "the approvals page", but `submitRequest` is never called and there is no decorator, so no UI can create a request. README L86 claims one can. Spec: "`scaffolderApiRef` decorator diverting gated submits" (P2). Build the decorator.
- [backend/src/service/ApprovalService.ts:L408](workspaces/scaffolder-approvals/plugins/scaffolder-approvals-backend/src/service/ApprovalService.ts#L408): 🟡 The live-grant check and the mint are a read-then-write. A decision's launch can race the sweep's launch (`ApprovalSweeps.ts:L154`), mint two grants and run the template twice. Spec: "compare-and-set, not read-then-write" (§6). Claim the launch with compare-and-set.
- [backend/src/database/ApprovalStore.ts:L590](workspaces/scaffolder-approvals/plugins/scaffolder-approvals-backend/src/database/ApprovalStore.ts#L590): 🟡 Redaction counts from `updated_at`, which moves on every later status change. Spec: "180 days from `decided_at`, or `created_at` for terminal-without-decision states" (§6). Use those columns.
- [backend/src/service/router.ts:L244](workspaces/scaffolder-approvals/plugins/scaffolder-approvals-backend/src/service/router.ts#L244): 🟡 Group membership comes only from the sign-in `ent` claim, with no catalog fallback, yet the comment says changes apply "immediately". Spec: "fall back to one catalog read … cached ~1 minute" (§8/Q11). Add the fallback.
- [backend/migrations/20260911000000_init.js:L39](workspaces/scaffolder-approvals/plugins/scaffolder-approvals-backend/migrations/20260911000000_init.js#L39): 🟡 No template uid or spec hash is stored, and approvers get no drift warning. Spec: "Store the template's `metadata.uid` plus a hash of its spec at submit, and warn the approver" (§10.3). Add both.
- [backend/src/plugin.ts:L69](workspaces/scaffolder-approvals/plugins/scaffolder-approvals-backend/src/plugin.ts#L69): 🟡 Several spec items are missing:

  - auditor events;
  - a `launched` event (`ApprovalNotifier.ts:L35`);
  - a frontend signal subscription;
  - a link to the task (`RequestDetail.tsx:L160`);
  - Withdraw and Resubmit;
  - the homepage card and nav item.

  Spec: "Auditor events on every decision" (P4); "`approval.launched`" (P3); "Resubmit" (§5); "homepage card" (Q22). Add them.

- [gate-module/src/gate.integration.test.ts:L114](workspaces/scaffolder-approvals/plugins/scaffolder-backend-module-approvals/src/gate.integration.test.ts#L114): 🟡 The ticked "Steps 1–7 scripted" box is not met:

  - this test mocks `scaffold()`, uses quorum 1 and hard-coded `values`, and has no self-approval case;
  - `verify-gate.sh` covers only steps 1, 2 and 7;
  - the three-database box was ticked on SQLite alone.

  Spec: "Steps 1–7 scripted as an integration test" (Plan Phase 9). Run steps 3–6 against a real scaffolder.

- [node/src/permissions.ts:L134](workspaces/scaffolder-approvals/plugins/scaffolder-approvals-node/src/permissions.ts#L134): 🔵 `isNotRequester.toQuery` matches the caller's own requests, the opposite of what `apply` checks. Not asked for: `router.ts:L231` rejects any conditional read policy, and a fourth table was added. Spec: "`toQuery` a no-op" (Q19); "Three tables" (§6). Correct these or remove them.

**Summary:**

- **Standards:** 15 findings (7 hard, 8 judgement calls). Worst: no DCO sign-off on any commit and no accepted proposal issue. Either one blocks the merge on its own.
- **Spec:** 11 findings (4 🔴, 6 🟡, 1 🔵). Worst: the gate can be skipped with `if:`, `each:`, `always()`/`failure()` or a `HAS_TAG` step policy, against §3's "throws on step 1, before any real step executes".

---

## 8. Fix plan

In order: the security core first, then correctness, then the product surface, then submission hygiene. Effort: **S** is hours, **M** about a day, **L** a few days.

Each row lands in its own commit. **Status** tracks progress against this review.

| #   | Fix                                                                                                                                                                                                           | Closes                    | Effort | Status   |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------- | ------ | -------- |
| 1   | Reject `if` and `each` on the gate, later `always()`/`failure()` steps, and gate tags narrower than other steps' tags. Do it in `findGateStep`, at submit and in the processor; add A3/A4 as regression tests | S1, G9                    | M      | ✅ Done  |
| 2   | Document and recommend the user-principal `scaffolder.action.execute` policy (proven in E2)                                                                                                                   | S1 (defence in depth), S2 | S      | ✅ Done  |
| 3   | Revoke-then-relaunch with compare-and-set, and claim launches with compare-and-set                                                                                                                            | C1, C2                    | M      | ✅ Done  |
| 4   | Re-read the request before notifying; add `launched` and `completed` events; broadcast signals                                                                                                                | C3, G4, G12               | S      | ✅ Done  |
| 5   | Bind grants to the template; restrict consume to `plugin:scaffolder`                                                                                                                                          | S4, S3                    | S      | ✅ Done  |
| 6   | Store the template uid and a steps hash; show drift to approvers                                                                                                                                              | S5                        | M      | ✅ Done  |
| 7   | Validate ids as UUIDs; add a migration with `precision: 3` timestamps and a `task_id` index; normalise `templateRef`                                                                                          | C8, C9, C10, C5, C15      | S      | ✅ Done  |
| 8   | Guard approval on `expires_at`; rotate the running sweep                                                                                                                                                      | C4, C6                    | S      | ✅ Done  |
| 9   | Fix `IS_NOT_REQUESTER.toQuery` and test it                                                                                                                                                                    | S6                        | S      | ✅ Done  |
| 10  | Build the submit path (decorator or form), Withdraw, Resubmit and the task link                                                                                                                               | G1, G2                    | L      | ◨ Partly |
| 11  | Nav item and homepage card                                                                                                                                                                                    | G3                        | M      | ✅ Done  |
| 12  | Auditor events; a decision on Q11 and break-glass; refuse secret-type fields                                                                                                                                  | G5, G6, G7, S7            | S      | ✅ Done  |
| 13  | Correct the README, the design doc §9 and the progress table; document S1, S2, C21 and the mount path                                                                                                         | D1–D4, G10, P16           | S      | ✅ Done  |
| 14  | Signed-off commits, proposal issue, design notes into the issue, `dev/index` instead of `packages/backend`, script mode, unused dependencies                                                                  | P1–P4, P6, P9–P14         | S      | ⬜ Open  |

---

## Appendices

Every file below was run for this review and removed from the tree afterwards. Each is ready to adopt.

- **Location:** place a file under the package's `src/__review__/`, or any test path.
- **Command:** run it with `BACKSTAGE_TEST_DISABLE_DOCKER=1 CI=true npx backstage-cli package test --watchAll=false src/__review__` from the package directory.
- **Real engines:** add `BACKSTAGE_TEST_DATABASE_POSTGRES18_CONNECTION_STRING` and `BACKSTAGE_TEST_DATABASE_MYSQL8_CONNECTION_STRING` to run on Postgres and MySQL too.
- **Raw failures:** set `REVIEW_SHOW=1` to see the spec tests fail outright instead of passing as `it.failing`.

### <a id="a1"></a>A1 — End-to-end harness (gate module) · 13 passing scenarios

<details>
<summary><code>e2e.review.test.ts</code></summary>

```ts
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

/**
 * REVIEW EVIDENCE — end-to-end, real HTTP, real scaffolder.
 *
 * One test backend runs the real `@backstage/plugin-scaffolder-backend`
 * (4.1.0, with its task workers and NunjucksWorkflowRunner), the real
 * approvals backend and the real `approval:gate` module. Only identity
 * (mock auth), the catalog (in-memory) and the scheduler (manually
 * triggered) are stand-ins. Every call below is an HTTP request.
 */
import { scaffolderApprovalsPlugin } from '@backstage-community/plugin-scaffolder-approvals-backend';
import scaffolderPlugin from '@backstage/plugin-scaffolder-backend';
import {
  coreServices,
  createServiceFactory,
} from '@backstage/backend-plugin-api';
import {
  mockCredentials,
  mockServices,
  startTestBackend,
} from '@backstage/backend-test-utils';
import { type Entity, stringifyEntityRef } from '@backstage/catalog-model';
import { catalogServiceRef } from '@backstage/plugin-catalog-node';
import { catalogServiceMock } from '@backstage/plugin-catalog-node/testUtils';
import { eventsServiceRef } from '@backstage/plugin-events-node';
import { AuthorizeResult } from '@backstage/plugin-permission-common';
import { scaffolderModuleApprovals } from '../module';

jest.setTimeout(180_000);

const GROUP = 'group:default/devx-team';
const REQUESTER = 'user:default/requester';
const ALICE = 'user:default/alice';
const BOB = 'user:default/bob';

const PARAMETERS = [
  {
    title: 'What do you need?',
    required: ['repository', 'justification'],
    properties: {
      repository: { type: 'string' },
      justification: { type: 'string', minLength: 3 },
      gate: { type: 'boolean' },
      items: { type: 'array', items: { type: 'string' } },
    },
  },
];

function gateStep(extra: Record<string, unknown> = {}, quorum = 1) {
  return {
    id: 'gate',
    name: 'Await approval',
    action: 'approval:gate',
    input: {
      approvers: [GROUP],
      quorum,
      selfApprove: false,
      timeout: { hours: 72 },
      summary: 'Admin on ${{ parameters.repository }}',
      values: '${{ parameters }}',
    },
    ...extra,
  };
}

function logStep(
  id: string,
  message: string,
  extra: Record<string, unknown> = {},
) {
  return { id, name: id, action: 'debug:log', input: { message }, ...extra };
}

function template(name: string, steps: unknown[]): Entity {
  return {
    apiVersion: 'scaffolder.backstage.io/v1beta3',
    kind: 'Template',
    metadata: { name, namespace: 'default' },
    spec: { type: 'service', owner: GROUP, parameters: PARAMETERS, steps },
  } as Entity;
}

const TEMPLATES = {
  // The happy path, quorum 2, with a step that echoes the real actors and the
  // task's own notion of the user.
  happy: template('gated-happy', [
    gateStep({}, 2),
    logStep(
      'grant',
      'GRANTED ${{ parameters.repository }} requestedBy=${{ steps.gate.output.requestedBy }} approvedBy=${{ steps.gate.output.approvedBy }} USER-REF=[${{ user.ref }}]',
    ),
  ]),
  // S1 shapes: each looks gated, and each gets through a direct call.
  always: template('gated-always', [
    gateStep(),
    logStep('grant', 'SIDE-EFFECT always()', { if: '${{ always() }}' }),
  ]),
  failure: template('gated-failure', [
    gateStep(),
    logStep('grant', 'SIDE-EFFECT failure()', { if: '${{ failure() }}' }),
  ]),
  gateIf: template('gated-if', [
    gateStep({ if: '${{ parameters.gate }}' }),
    logStep('grant', 'SIDE-EFFECT gate-if'),
  ]),
  gateEach: template('gated-each', [
    gateStep({ each: '${{ parameters.items }}' }),
    logStep('grant', 'SIDE-EFFECT gate-each'),
  ]),
  // Q9: the scaffolder is briefly unable to launch this one.
  q9: template('gated-q9', [gateStep(), logStep('grant', 'GRANTED q9')]),
  // S1(e): a step-read policy that allow-lists tags drops the untagged gate.
  tagged: template('gated-tagged', [
    gateStep(),
    logStep('grant', 'SIDE-EFFECT tag-allowlist', {
      'backstage:permissions': { tags: ['allowed'] },
    }),
  ]),
  // Mitigation check: the same always() shape, and an approvable twin.
  mitigated: template('gated-mitigated', [
    gateStep(),
    logStep('grant', 'SIDE-EFFECT mitigated', { if: '${{ always() }}' }),
  ]),
  // §10.3: the steps are swapped between submit and approval.
  drift: template('gated-drift', [
    gateStep(),
    logStep('grant', 'APPROVED STEP'),
  ]),
};

const DRIFTED = template('gated-drift', [
  gateStep(),
  logStep('grant', 'APPROVED STEP'),
  logStep('extra', 'DRIFT STEP ADDED AFTER SUBMIT'),
]);

const ENTITIES: Entity[] = [
  ...Object.values(TEMPLATES),
  {
    apiVersion: 'backstage.io/v1alpha1',
    kind: 'Group',
    metadata: { name: 'devx-team', namespace: 'default' },
    spec: { type: 'team', children: [] },
  },
  ...['requester', 'alice', 'bob'].map(name => ({
    apiVersion: 'backstage.io/v1alpha1',
    kind: 'User',
    metadata: { name, namespace: 'default' },
    spec: { memberOf: ['devx-team'] },
  })),
];

const refOf = (e: Entity) => stringifyEntityRef(e);

describe('REVIEW e2e: approvals + real scaffolder over HTTP', () => {
  let backend: Awaited<ReturnType<typeof startTestBackend>>;
  let base: string;
  const scheduler = mockServices.scheduler();
  const events = mockServices.events();
  const approvalEvents: any[] = [];
  const taskEvents: any[] = [];

  // Catalog stand-in, with two injectable faults: a one-off failed lookup by
  // a service principal (the scaffolder, launching) and a template swap.
  const catalog = catalogServiceMock({ entities: ENTITIES });
  const failNextServiceLookup = new Set<string>();
  const swapped = new Map<string, Entity>();
  const serviceLookups: string[] = [];
  const wrappedCatalog = new Proxy(catalog, {
    get(target, prop, receiver) {
      if (prop === 'getEntityByRef') {
        return async (ref: any, options: any) => {
          const key =
            typeof ref === 'string'
              ? ref.toLocaleLowerCase('en-US')
              : stringifyEntityRef(ref);
          if (options?.credentials?.principal?.type === 'service') {
            serviceLookups.push(key);
            if (failNextServiceLookup.delete(key)) {
              return undefined;
            }
          }
          return swapped.get(key) ?? target.getEntityByRef(ref, options);
        };
      }
      const value = Reflect.get(target, prop, receiver);
      return typeof value === 'function' ? value.bind(target) : value;
    },
  });

  // A switchable permission policy. Service principals are always allowed,
  // as ServerPermissionClient does for real.
  let policy: 'allow' | 'tag-allowlist' | 'deny-debug-log-for-users' = 'allow';
  const permissionsService = {
    async authorize(requests: any[]) {
      return requests.map(() => ({ result: AuthorizeResult.ALLOW }));
    },
    async authorizeConditional(queries: any[], options?: any) {
      const isService = options?.credentials?.principal?.type === 'service';
      return queries.map(q => {
        const name = q.permission.name;
        if (isService || policy === 'allow') {
          return { result: AuthorizeResult.ALLOW };
        }
        if (
          policy === 'tag-allowlist' &&
          name === 'scaffolder.template.step.read'
        ) {
          return {
            result: AuthorizeResult.CONDITIONAL,
            pluginId: 'scaffolder',
            resourceType: 'scaffolder-template',
            conditions: {
              rule: 'HAS_TAG',
              resourceType: 'scaffolder-template',
              params: { tag: 'allowed' },
            },
          };
        }
        if (
          policy === 'deny-debug-log-for-users' &&
          name === 'scaffolder.action.execute'
        ) {
          return {
            result: AuthorizeResult.CONDITIONAL,
            pluginId: 'scaffolder',
            resourceType: 'scaffolder-action',
            conditions: {
              not: {
                rule: 'HAS_ACTION_ID',
                resourceType: 'scaffolder-action',
                params: { actionId: 'debug:log' },
              },
            },
          };
        }
        return { result: AuthorizeResult.ALLOW };
      });
    },
  };

  const membership: Record<string, string[]> = {
    [REQUESTER]: [GROUP],
    [ALICE]: [GROUP],
    [BOB]: [GROUP],
  };

  async function call(
    method: string,
    path: string,
    as: string,
    body?: unknown,
  ): Promise<{ status: number; json: any; text: string }> {
    const res = await fetch(`${base}${path}`, {
      method,
      headers: {
        'content-type': 'application/json',
        authorization: as.startsWith('external:')
          ? mockCredentials.service.header({
              onBehalfOf: mockCredentials.service(as),
              targetPluginId: 'scaffolder-approvals',
            })
          : mockCredentials.user.header(as),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await res.text();
    let json: any;
    try {
      json = JSON.parse(text);
    } catch {
      json = undefined;
    }
    return { status: res.status, json, text };
  }

  async function poll<T>(
    what: string,
    fn: () => Promise<T | undefined>,
    timeoutMs = 60_000,
  ): Promise<T> {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      const value = await fn();
      if (value !== undefined) {
        return value;
      }
      if (Date.now() > deadline) {
        throw new Error(`timed out waiting for ${what}`);
      }
      await new Promise(r => setTimeout(r, 250));
    }
  }

  async function settledTask(taskId: string) {
    return poll(`task ${taskId}`, async () => {
      const { json } = await call(
        'GET',
        `/scaffolder/v2/tasks/${taskId}`,
        REQUESTER,
      );
      return json && !['open', 'processing'].includes(json.status)
        ? json
        : undefined;
    });
  }

  async function taskLog(taskId: string): Promise<string> {
    const { json } = await call(
      'GET',
      `/scaffolder/v2/tasks/${taskId}/events`,
      REQUESTER,
    );
    return (json as any[])
      .map(e => `${e.body?.status ?? ''} ${e.body?.message ?? ''}`)
      .join('\n');
  }

  async function directRun(t: Entity, values: Record<string, unknown>) {
    const created = await call('POST', '/scaffolder/v2/tasks', REQUESTER, {
      templateRef: refOf(t),
      values,
    });
    expect(created.status).toBe(201);
    const task = await settledTask(created.json.id);
    return { task, log: await taskLog(created.json.id) };
  }

  async function submit(t: Entity, values: Record<string, unknown>) {
    const res = await call(
      'POST',
      '/scaffolder-approvals/requests',
      REQUESTER,
      {
        templateRef: refOf(t),
        values,
      },
    );
    return res;
  }

  const getRequest = async (id: string) =>
    (await call('GET', `/scaffolder-approvals/requests/${id}`, ALICE)).json;

  // Jest runs tests in a vm context while `fetch` comes from the outer realm,
  // so `response.json()` yields arrays whose prototype nunjitsu (inside the
  // vm) rejects: "Template arrays cannot use a custom prototype". Plain Node
  // has one realm, so this is a harness artifact; parse in this realm instead.
  const originalJson = Response.prototype.json;
  beforeAll(() => {
    Response.prototype.json = async function json(this: Response) {
      return JSON.parse(await this.text());
    };
  });
  afterAll(() => {
    Response.prototype.json = originalJson;
  });

  beforeAll(async () => {
    await events.subscribe({
      id: 'review-capture',
      topics: ['scaffolder-approvals', 'scaffolder.task'],
      async onEvent(e) {
        (e.topic === 'scaffolder.task' ? taskEvents : approvalEvents).push(
          e.eventPayload,
        );
      },
    });

    backend = await startTestBackend({
      features: [
        scaffolderPlugin,
        scaffolderModuleApprovals,
        scaffolderApprovalsPlugin,
        mockServices.rootConfig.factory({
          data: {
            app: { baseUrl: 'http://localhost:3000' },
            backend: { baseUrl: 'http://localhost:7007' },
            scaffolderApprovals: { grantTtl: { seconds: 20 } },
          },
        }),
        scheduler.factory({ skipTaskRunOnStartup: true }),
        // One bus for every plugin, as a real events backend would be.
        createServiceFactory({
          service: eventsServiceRef,
          deps: {},
          async factory() {
            return events;
          },
        }),
        createServiceFactory({
          service: coreServices.permissions,
          deps: {},
          async factory() {
            return permissionsService as any;
          },
        }),
        createServiceFactory({
          service: catalogServiceRef,
          deps: {},
          async factory() {
            return wrappedCatalog as any;
          },
        }),
        createServiceFactory({
          service: coreServices.userInfo,
          deps: {},
          async factory() {
            return {
              async getUserInfo(credentials: any) {
                const ref = credentials.principal.userEntityRef;
                return {
                  userEntityRef: ref,
                  ownershipEntityRefs: [ref, ...(membership[ref] ?? [])],
                };
              },
            };
          },
        }),
      ],
    });
    base = `http://localhost:${backend.server.port()}/api`;
  });

  afterAll(async () => {
    await backend?.stop();
  });

  it('happy path: quorum 2, self-approval refused, task runs to completion as the service principal', async () => {
    const values = {
      repository: 'acme/api',
      justification: 'on-call rotation',
    };
    const submitted = await submit(TEMPLATES.happy, values);
    expect(submitted.status).toBe(201);
    const id = submitted.json.id;
    expect((await getRequest(id)).summary).toBe('Admin on acme/api');

    const self = await call(
      'POST',
      `/scaffolder-approvals/requests/${id}/decision`,
      REQUESTER,
      { decision: 'approve' },
    );
    expect(self.status).toBe(403);

    const first = await call(
      'POST',
      `/scaffolder-approvals/requests/${id}/decision`,
      ALICE,
      { decision: 'approve' },
    );
    expect(first.status).toBe(200);
    expect(first.json.status).toBe('pending');

    const again = await call(
      'POST',
      `/scaffolder-approvals/requests/${id}/decision`,
      ALICE,
      { decision: 'approve' },
    );
    expect(again.status).toBe(409);

    const second = await call(
      'POST',
      `/scaffolder-approvals/requests/${id}/decision`,
      BOB,
      { decision: 'approve' },
    );
    expect(second.status).toBe(200);
    expect(['approved', 'running']).toContain(second.json.status);

    const running = await poll(
      'task id',
      async () => (await getRequest(id)).taskId,
    );
    const task = await settledTask(running);
    const log = await taskLog(running);
    // eslint-disable-next-line no-console
    console.log(
      `[review] happy task ${task.status}; createdBy=${
        task.createdBy
      }; spec.user=${JSON.stringify(task.spec.user)}\n${log}`,
    );
    expect(task.status).toBe('completed');
    expect(log).toContain(`requestedBy=${REQUESTER}`);
    expect(log).toContain(`${ALICE}`);
    expect(log).toContain(`${BOB}`);

    // Task events drive the request to completed without a sweep.
    const done = await poll('request completed', async () => {
      const r = await getRequest(id);
      return r.status === 'completed' ? r : undefined;
    });
    expect(done.status).toBe('completed');

    // Evidence for S2: the task has no user of its own.
    expect(log).toContain('USER-REF=[]');
  });

  it('decided events report the pre-transition status', async () => {
    const decided = approvalEvents.filter(e => e.action === 'decided');
    // eslint-disable-next-line no-console
    console.log('[review] decided events:', JSON.stringify(decided));
    expect(decided.length).toBeGreaterThan(0);
    expect(decided.every(e => e.status === 'pending')).toBe(true);
    expect(approvalEvents.some(e => e.action === 'launched')).toBe(false);
  });

  it('direct run of the plain gated template fails at the gate (the claim that holds)', async () => {
    const { task, log } = await directRun(TEMPLATES.happy, {
      repository: 'acme/api',
      justification: 'bypass attempt',
    });
    expect(task.status).toBe('failed');
    expect(log).toContain('requires approval before it can run');
    expect(log).not.toContain('GRANTED');
  });

  it.each([
    ['always()', TEMPLATES.always, {}, 'SIDE-EFFECT always()'],
    ['failure()', TEMPLATES.failure, {}, 'SIDE-EFFECT failure()'],
    ['gate if:', TEMPLATES.gateIf, { gate: false }, 'SIDE-EFFECT gate-if'],
    ['gate each:', TEMPLATES.gateEach, { items: [] }, 'SIDE-EFFECT gate-each'],
  ])(
    'S1 %s: a direct POST /v2/tasks runs a real step without approval',
    async (_label, t, extra, marker) => {
      // Each of these is accepted by the approvals backend as a gated template.
      const viaApprovals = await submit(t, {
        repository: 'r',
        justification: 'probe',
        ...extra,
      });
      expect(viaApprovals.status).toBe(201);

      const { task, log } = await directRun(t, {
        repository: 'acme/api',
        justification: 'bypass attempt',
        ...extra,
      });
      // eslint-disable-next-line no-console
      console.log(`[review] ${_label}: task ${task.status}\n${log}`);
      expect(log).toContain(marker);
    },
  );

  it('Q9: one failed launch is never retried, and the request fails once the grant lapses', async () => {
    failNextServiceLookup.add(refOf(TEMPLATES.q9));
    const submitted = await submit(TEMPLATES.q9, {
      repository: 'r',
      justification: 'q9 probe',
    });
    const id = submitted.json.id;
    const decided = await call(
      'POST',
      `/scaffolder-approvals/requests/${id}/decision`,
      ALICE,
      { decision: 'approve' },
    );
    expect(decided.status).toBe(200);
    expect(decided.json.status).toBe('approved');
    expect(decided.json.taskId).toBeUndefined();

    // The scaffolder is healthy again from here on.
    await scheduler.triggerTask('scaffolder-approvals-reconcile');
    expect((await getRequest(id)).status).toBe('approved');

    await new Promise(r => setTimeout(r, 21_000)); // past grantTtl (20s)
    await scheduler.triggerTask('scaffolder-approvals-reconcile');

    const after = await getRequest(id);
    const q9Lookups = serviceLookups.filter(
      k => k === refOf(TEMPLATES.q9),
    ).length;
    // eslint-disable-next-line no-console
    console.log(
      `[review] q9: status=${after.status} taskId=${after.taskId} scaffolderLookups=${q9Lookups}`,
    );
    expect(after.status).toBe('failed');
    expect(after.taskId).toBeUndefined();
    // Only the first (failed) launch ever reached the scaffolder.
    expect(q9Lookups).toBe(1);
  });

  it('§10.3: steps changed between submit and approval run without any warning', async () => {
    const submitted = await submit(TEMPLATES.drift, {
      repository: 'r',
      justification: 'drift probe',
    });
    const id = submitted.json.id;
    swapped.set(refOf(TEMPLATES.drift), DRIFTED);

    const decided = await call(
      'POST',
      `/scaffolder-approvals/requests/${id}/decision`,
      ALICE,
      { decision: 'approve' },
    );
    expect(decided.status).toBe(200);
    const taskId = await poll(
      'drift task',
      async () => (await getRequest(id)).taskId,
    );
    const task = await settledTask(taskId);
    const log = await taskLog(taskId);
    // eslint-disable-next-line no-console
    console.log(`[review] drift task ${task.status}\n${log}`);
    expect(log).toContain('DRIFT STEP ADDED AFTER SUBMIT');
    const request = await getRequest(id);
    // Nothing about the template as it was approved is kept to compare with.
    expect(Object.keys(request).sort()).toEqual(
      expect.not.arrayContaining([
        'templateUid',
        'templateSpecHash',
        'specHash',
        'uid',
      ]),
    );
  });

  it('S1(e): a tag allow-list step policy removes the untagged gate from a direct run', async () => {
    policy = 'tag-allowlist';
    try {
      const { task, log } = await directRun(TEMPLATES.tagged, {
        repository: 'acme/api',
        justification: 'bypass attempt',
      });
      // eslint-disable-next-line no-console
      console.log(`[review] tag-allowlist: task ${task.status}
${log}`);
      expect(task.status).toBe('completed');
      expect(log).toContain('SIDE-EFFECT tag-allowlist');
      expect(log).not.toContain('Await approval');
    } finally {
      policy = 'allow';
    }
  });

  it('mitigation: denying the dangerous action to users stops the bypass, and approved runs still work', async () => {
    policy = 'deny-debug-log-for-users';
    try {
      const direct = await directRun(TEMPLATES.mitigated, {
        repository: 'acme/api',
        justification: 'bypass attempt',
      });
      // eslint-disable-next-line no-console
      console.log(`[review] mitigated direct: task ${direct.task.status}
${direct.log}`);
      expect(direct.log).not.toContain('SIDE-EFFECT mitigated');
      expect(direct.log).toContain('Unauthorized action: debug:log');

      const submitted = await submit(TEMPLATES.mitigated, {
        repository: 'acme/api',
        justification: 'real request',
      });
      const decided = await call(
        'POST',
        `/scaffolder-approvals/requests/${submitted.json.id}/decision`,
        ALICE,
        { decision: 'approve' },
      );
      expect(decided.status).toBe(200);
      const taskId = await poll(
        'mitigated task',
        async () => (await getRequest(submitted.json.id)).taskId,
      );
      const task = await settledTask(taskId);
      const log = await taskLog(taskId);
      // eslint-disable-next-line no-console
      console.log(`[review] mitigated approved: task ${task.status}
${log}`);
      expect(task.status).toBe('completed');
      expect(log).toContain('SIDE-EFFECT mitigated');
    } finally {
      policy = 'allow';
    }
  });

  it('any service principal, including an external static token, is let through to redeem grants', async () => {
    const user = await call(
      'POST',
      '/scaffolder-approvals/grants/consume',
      ALICE,
      {
        grant: '00000000-0000-4000-8000-000000000000.x',
        valuesHash: 'a'.repeat(64),
        taskId: 't',
      },
    );
    const external = await call(
      'POST',
      '/scaffolder-approvals/grants/consume',
      'external:ci-bot',
      {
        grant: '00000000-0000-4000-8000-000000000000.x',
        valuesHash: 'a'.repeat(64),
        taskId: 't',
      },
    );
    // eslint-disable-next-line no-console
    console.log(
      `[review] consume as user: ${user.status} ${user.text}\n[review] consume as external service: ${external.status} ${external.text}`,
    );
    expect(user.text).not.toBe(external.text);
    expect(external.text).toContain('The approval grant is not valid');
  });

  it('a malformed request id is a clean 404 (SQLite; see the Postgres test for the contrast)', async () => {
    const res = await call(
      'GET',
      '/scaffolder-approvals/requests/not-a-uuid',
      ALICE,
    );
    expect(res.status).toBe(404);
  });
});
```

</details>

### <a id="a2"></a>A2 — Backend spec tests (three engines) · 42 tests, 30 violations in raw mode

<details>
<summary><code>backend-proofs.review.test.ts</code></summary>

```ts
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

/**
 * REVIEW EVIDENCE — spec tests for the backend.
 *
 * Each `spec(...)` states what the design requires. While the defect exists
 * the assertion fails, and `it.failing` turns that into a pass; once the
 * defect is fixed the test starts failing, which is the signal to drop
 * `.failing` and keep it as a regression test.
 *
 * Run with REVIEW_SHOW=1 to see the raw assertion failures instead.
 */
import { GATE_ACTION_ID } from '@backstage-community/plugin-scaffolder-approvals-common';
import {
  hashGrantToken,
  isNotRequester,
  parseGrant,
} from '@backstage-community/plugin-scaffolder-approvals-node';
import { resolvePackagePath } from '@backstage/backend-plugin-api';
import {
  mockCredentials,
  mockErrorHandler,
  mockServices,
  TestDatabases,
} from '@backstage/backend-test-utils';
import { type Entity, stringifyEntityRef } from '@backstage/catalog-model';
import type { CatalogService } from '@backstage/plugin-catalog-node';
import { AuthorizeResult } from '@backstage/plugin-permission-common';
import type { ScaffolderService } from '@backstage/plugin-scaffolder-node';
import express from 'express';
import type { Knex } from 'knex';
import request from 'supertest';
import { ApprovalStore } from '../database';
import { ApprovalNotifier } from '../service/ApprovalNotifier';
import { ApprovalService } from '../service/ApprovalService';
import { ApprovalSweeps } from '../service/ApprovalSweeps';
import { createRouter } from '../service/router';

jest.setTimeout(120_000);

const SHOW = Boolean(process.env.REVIEW_SHOW);
const spec = SHOW ? it : it.failing;

const migrationsDir = resolvePackagePath(
  '@backstage-community/plugin-scaffolder-approvals-backend',
  'migrations',
);

const GROUP = 'group:default/devx-team';
const TEMPLATE_REF = 'template:default/gated';
const VALUES = { repository: 'backstage', justification: 'review probe' };

const TEMPLATE: Entity = {
  apiVersion: 'scaffolder.backstage.io/v1beta3',
  kind: 'Template',
  metadata: { name: 'gated', namespace: 'default' },
  spec: {
    type: 'service',
    steps: [
      {
        id: 'gate',
        action: GATE_ACTION_ID,
        input: {
          approvers: [GROUP],
          timeout: { hours: 1 },
          values: '${{ parameters }}',
        },
      },
      { id: 'grant', action: 'debug:log' },
    ],
  },
} as Entity;

function who(ref: string) {
  return {
    credentials: mockCredentials.user(ref),
    info: { userEntityRef: ref, ownershipEntityRefs: [ref, GROUP] },
  };
}
const REQUESTER = who('user:default/requester');
const ALICE = who('user:default/alice');
const BOB = who('user:default/bob');
const PEOPLE = [REQUESTER, ALICE, BOB];

describe('REVIEW backend spec tests', () => {
  const databases = TestDatabases.create();

  describe.each(databases.eachSupportedId())('%s', databaseId => {
    let knex: Knex;
    let store: ApprovalStore;
    let clock: Date;
    let scaffold: jest.Mock;
    let getTask: jest.Mock;
    let observed: Array<{ hook: string; status: string }>;

    function build(options: { grantTtl?: { hours: number } } = {}) {
      const userInfo = {
        getUserInfo: jest.fn(async (credentials: unknown) => {
          const match = PEOPLE.find(p => p.credentials === credentials);
          if (match) {
            return match.info;
          }
          const ref = (credentials as any)?.principal?.userEntityRef;
          return { userEntityRef: ref, ownershipEntityRefs: [ref, GROUP] };
        }),
      };
      const catalog = {
        // Resolves any spelling of the ref, as the real catalog does.
        getEntityByRef: jest.fn(async (ref: string) =>
          stringifyEntityRef({ kind: 'template', ...parse(ref) }) ===
          TEMPLATE_REF
            ? TEMPLATE
            : undefined,
        ),
      } as unknown as CatalogService;
      const service = new ApprovalService({
        store,
        catalog,
        scaffolder: { scaffold, getTask } as unknown as ScaffolderService,
        auth: mockServices.auth(),
        userInfo,
        logger: mockServices.logger.mock(),
        grantTtl: options.grantTtl ?? { hours: 1 },
        observer: {
          onSubmitted: async r => {
            observed.push({ hook: 'submitted', status: r.status });
          },
          onDecided: async r => {
            observed.push({ hook: 'decided', status: r.status });
          },
        },
        now: () => clock,
      });
      const sweeps = new ApprovalSweeps({
        store,
        service,
        scaffolder: { scaffold, getTask } as unknown as ScaffolderService,
        auth: mockServices.auth(),
        logger: mockServices.logger.mock(),
        retention: { days: 180 },
        now: () => clock,
      });
      return { service, sweeps, userInfo };
    }

    function parse(ref: string) {
      const [kindAndNs, name] = ref.toLocaleLowerCase('en-US').split('/');
      const ns = kindAndNs.includes(':') ? kindAndNs.split(':')[1] : kindAndNs;
      return { namespace: ns, name };
    }

    beforeEach(async () => {
      knex = await databases.init(databaseId);
      await knex.migrate.latest({ directory: migrationsDir });
      clock = new Date('2026-09-17T10:00:00.000Z');
      store = new ApprovalStore({ db: knex, now: () => clock });
      scaffold = jest.fn().mockResolvedValue({ taskId: 'task-1' });
      getTask = jest.fn();
      observed = [];
    });

    afterEach(async () => {
      await knex.destroy();
    });

    async function submitAndApprove(service: ApprovalService) {
      const { id } = await service.submit({
        templateRef: TEMPLATE_REF,
        values: VALUES,
        credentials: REQUESTER.credentials,
      });
      await service.decide({
        requestId: id,
        decision: 'approve',
        credentials: ALICE.credentials,
      });
      return id;
    }

    spec(
      'Q9: a launch that failed once is retried while the grant is valid',
      async () => {
        const { service, sweeps } = build();
        scaffold.mockRejectedValueOnce(
          new Error('scaffolder briefly unreachable'),
        );
        const id = await submitAndApprove(service);
        expect((await store.getRequest(id))?.status).toBe('approved');

        // The scaffolder is back. Two sweep ticks, well inside the 1h grant.
        clock = new Date(clock.getTime() + 2 * 60_000);
        await sweeps.reconcile();
        clock = new Date(clock.getTime() + 2 * 60_000);
        await sweeps.reconcile();

        expect(scaffold).toHaveBeenCalledTimes(2);
        expect((await store.getRequest(id))?.status).toBe('running');
      },
    );

    it('Q9 (as built): that request instead ends in `failed` once the grant lapses, with no second launch', async () => {
      const { service, sweeps } = build();
      scaffold.mockRejectedValueOnce(
        new Error('scaffolder briefly unreachable'),
      );
      const id = await submitAndApprove(service);
      for (let minutes = 2; minutes <= 62; minutes += 2) {
        clock = new Date(clock.getTime() + 2 * 60_000);
        await sweeps.reconcile();
      }
      expect(scaffold).toHaveBeenCalledTimes(1);
      expect((await store.getRequest(id))?.status).toBe('failed');
    });

    spec(
      '§6: two overlapping launches mint one grant and start one task',
      async () => {
        const { service } = build();
        scaffold.mockImplementation(
          async () =>
            new Promise(r =>
              setTimeout(() => r({ taskId: `t-${Math.random()}` }), 50),
            ),
        );
        const { id } = await service.submit({
          templateRef: TEMPLATE_REF,
          values: VALUES,
          credentials: REQUESTER.credentials,
        });
        // What `decide` does inline, racing a reconcile tick that picked the
        // just-approved request up.
        expect(await store.transition(id, 'pending', 'approved')).toBe(true);
        await Promise.all([service.launch(id), service.launch(id)]);

        expect((await store.listGrants(id)).length).toBe(1);
        expect(scaffold).toHaveBeenCalledTimes(1);
      },
    );

    spec(
      'events: the `decided` hook sees the status the request moved to',
      async () => {
        const { service } = build();
        const { id } = await service.submit({
          templateRef: TEMPLATE_REF,
          values: VALUES,
          credentials: REQUESTER.credentials,
        });
        await service.decide({
          requestId: id,
          decision: 'deny',
          credentials: ALICE.credentials,
        });
        expect(observed).toContainEqual({
          hook: 'decided',
          status: 'rejected',
        });
      },
    );

    spec(
      'lifecycle: a request past its timeout can no longer be approved, even before the sweep runs',
      async () => {
        const { service } = build();
        const { id } = await service.submit({
          templateRef: TEMPLATE_REF,
          values: VALUES,
          credentials: REQUESTER.credentials,
        });
        clock = new Date(clock.getTime() + 61 * 60_000); // timeout was 1h
        const decided = service.decide({
          requestId: id,
          decision: 'approve',
          credentials: ALICE.credentials,
        });
        await expect(decided).rejects.toThrow();
        expect(scaffold).not.toHaveBeenCalled();
      },
    );

    // MySQL's default collation compares case-insensitively, so it collapses
    // there by accident; SQLite and Postgres compare bytes.
    const caseSensitive = databaseId.startsWith('MYSQL') ? it : spec;
    caseSensitive(
      'Q13: the same request submitted with a differently spelled template ref collapses',
      async () => {
        const { service } = build();
        const first = await service.submit({
          templateRef: TEMPLATE_REF,
          values: VALUES,
          credentials: REQUESTER.credentials,
        });
        const second = await service.submit({
          templateRef: 'Template:Default/Gated',
          values: VALUES,
          credentials: REQUESTER.credentials,
        });
        expect(second).toEqual({ id: first.id, collapsed: true });
      },
    );

    spec(
      'Q4: the sweep reaches a finished task even when 50 older tasks are still running',
      async () => {
        const { sweeps } = build();
        const insert = async (n: number, taskId: string) => {
          const created = new Date(clock.getTime() - (100 - n) * 60_000);
          await knex('approval_requests').insert({
            id: `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`,
            template_ref: TEMPLATE_REF,
            values_json: '{}',
            values_hash: 'a'.repeat(64),
            requester_ref: REQUESTER.info.userEntityRef,
            status: 'running',
            policy_snapshot: JSON.stringify({
              approvers: [GROUP],
              quorum: 1,
              selfApprove: false,
            }),
            task_id: taskId,
            created_at: created,
            updated_at: created,
          });
        };
        for (let n = 1; n <= 50; n++) {
          await insert(n, `slow-${n}`);
        }
        await insert(51, 'done');
        getTask.mockImplementation(async ({ taskId }: { taskId: string }) => ({
          status: taskId === 'done' ? 'completed' : 'processing',
        }));

        for (let tick = 0; tick < 5; tick++) {
          await sweeps.reconcile();
        }
        const last = await store.getRequest(
          '00000000-0000-4000-8000-000000000051',
        );
        expect(last?.status).toBe('completed');
      },
    );

    spec(
      '§6 retention: the window counts from decided_at, not from the last update',
      async () => {
        const { sweeps } = build();
        const decided = new Date(clock.getTime() - 200 * 24 * 3_600_000);
        await knex('approval_requests').insert({
          id: '00000000-0000-4000-8000-000000000200',
          template_ref: TEMPLATE_REF,
          values_json: JSON.stringify(VALUES),
          values_hash: 'a'.repeat(64),
          requester_ref: REQUESTER.info.userEntityRef,
          status: 'completed',
          policy_snapshot: JSON.stringify({
            approvers: [GROUP],
            quorum: 1,
            selfApprove: false,
          }),
          created_at: decided,
          decided_at: decided,
          // A long-running task that finished recently.
          updated_at: new Date(clock.getTime() - 24 * 3_600_000),
        });
        await sweeps.redactOld();
        const row = await store.getRequest(
          '00000000-0000-4000-8000-000000000200',
        );
        expect(row?.values).toBeNull();
      },
    );

    // Passes where the engine keeps sub-second precision; MySQL `DATETIME`
    // (no fsp) rounds to the second, so ties decide "oldest first" at random.
    const onMysql = databaseId.startsWith('MYSQL') ? spec : it;
    onMysql(
      'timestamps keep sub-second precision, so "oldest decision first" holds',
      async () => {
        const { service } = build();
        const { id } = await service.submit({
          templateRef: TEMPLATE_REF,
          values: VALUES,
          credentials: REQUESTER.credentials,
        });
        clock = new Date('2026-09-17T10:00:00.750Z');
        await store.recordDecision({
          requestId: id,
          approverRef: BOB.info.userEntityRef,
          decision: 'approve',
        });
        clock = new Date('2026-09-17T10:00:00.900Z');
        await store.recordDecision({
          requestId: id,
          approverRef: ALICE.info.userEntityRef,
          decision: 'approve',
        });
        const decisions = await store.listDecisions(id);
        expect(decisions.map(d => d.createdAt)).toEqual([
          '2026-09-17T10:00:00.750Z',
          '2026-09-17T10:00:00.900Z',
        ]);
      },
    );

    describe('router', () => {
      let app: express.Express;
      beforeEach(async () => {
        const { service, userInfo } = build();
        app = express()
          .use(
            await createRouter({
              service,
              store,
              httpAuth: mockServices.httpAuth({
                pluginId: 'scaffolder-approvals',
                defaultCredentials: mockCredentials.none(),
              }),
              userInfo,
              permissions: {
                authorize: jest.fn(async (rs: unknown[]) =>
                  rs.map(() => ({ result: AuthorizeResult.ALLOW })),
                ),
                authorizeConditional: jest.fn(async (rs: unknown[]) =>
                  rs.map(() => ({ result: AuthorizeResult.ALLOW })),
                ),
              } as any,
              logger: mockServices.logger.mock(),
            }),
          )
          .use(mockErrorHandler());
      });

      // Passes on SQLite; the native `uuid` column makes Postgres throw.
      const onPostgres = databaseId.startsWith('POSTGRES') ? spec : it;

      onPostgres(
        'a malformed request id is a 404, not a server error',
        async () => {
          const res = await request(app)
            .get('/requests/not-a-uuid')
            .set(
              'authorization',
              mockCredentials.user.header(ALICE.info.userEntityRef),
            );
          expect(res.status).toBe(404);
        },
      );

      onPostgres(
        'a malformed id on /decision is a 404, not a server error',
        async () => {
          const res = await request(app)
            .post('/requests/not-a-uuid/decision')
            .set(
              'authorization',
              mockCredentials.user.header(ALICE.info.userEntityRef),
            )
            .send({ decision: 'approve' });
          expect(res.status).toBe(404);
        },
      );

      onPostgres(
        'a forged grant with a malformed id is refused with 403, not a server error',
        async () => {
          const res = await request(app)
            .post('/grants/consume')
            .set('authorization', mockCredentials.service.header())
            .send({
              grant: 'not-a-uuid.token',
              valuesHash: 'a'.repeat(64),
              taskId: 't',
            });
          expect(res.status).toBe(403);
        },
      );

      spec(
        'only the scaffolder may redeem a grant, not any service principal',
        async () => {
          const { service } = build();
          const id = await submitAndApprove(service);
          const grant = scaffold.mock.calls[0][0].secrets
            .APPROVAL_GRANT as string;
          const request0 = await store.getRequest(id);
          const res = await request(app)
            .post('/grants/consume')
            .set(
              'authorization',
              mockCredentials.service.header({
                onBehalfOf: mockCredentials.service('external:some-ci-job'),
                targetPluginId: 'scaffolder-approvals',
              }),
            )
            .send({
              grant,
              valuesHash: request0!.valuesHash,
              taskId: 'not-the-scaffolder',
            });
          expect(res.status).toBe(403);
          expect(parseGrant(grant).requestId).toBe(id);
          expect(hashGrantToken(parseGrant(grant).token)).toHaveLength(64);
        },
      );
    });
  });
});

describe('REVIEW notifier and rules spec tests', () => {
  function notifier() {
    const signals = { publish: jest.fn() };
    const events = { publish: jest.fn(), subscribe: jest.fn() };
    const notifications = { send: jest.fn() };
    const n = new ApprovalNotifier({
      logger: mockServices.logger.mock(),
      appBaseUrl: 'http://localhost:3000',
      signals: signals as any,
      events: events as any,
      notifications: notifications as any,
    });
    return { n, signals, events };
  }
  const request = {
    id: '00000000-0000-4000-8000-000000000001',
    templateRef: TEMPLATE_REF,
    values: VALUES,
    valuesHash: 'a'.repeat(64),
    requesterRef: 'user:default/requester',
    status: 'pending' as const,
    summary: 'Admin on backstage',
    policySnapshot: { approvers: [GROUP], quorum: 1, selfApprove: false },
    createdAt: '2026-09-17T10:00:00.000Z',
    updatedAt: '2026-09-17T10:00:00.000Z',
  };

  spec(
    'P3: approvers named by group get a live update when a request arrives',
    async () => {
      const { n, signals } = notifier();
      await n.onSubmitted(request);
      expect(signals.publish).toHaveBeenCalled();
    },
  );

  spec('P3: a `launched` event exists for external subscribers', async () => {
    const { n } = notifier();
    expect(typeof (n as any).onLaunched).toBe('function');
  });

  spec(
    'IS_NOT_REQUESTER: its list filter describes requests the caller did NOT submit',
    () => {
      const criteria = isNotRequester.toQuery({
        userRef: 'user:default/alice',
      });
      expect(criteria).toEqual({
        not: { key: 'requesterRef', values: ['user:default/alice'] },
      });
    },
  );
});
```

</details>

### <a id="a3"></a>A3 — `findGateStep` spec tests · 4 of 4 violations

<details>
<summary><code>node-proofs.review.test.ts</code></summary>

```ts
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

/**
 * REVIEW EVIDENCE — spec tests for `findGateStep`, the one definition of a
 * usable gate. `it.failing` passes while the defect exists; drop `.failing`
 * once it is fixed. Run with REVIEW_SHOW=1 to see the raw failures.
 */
import { GATE_ACTION_ID } from '@backstage-community/plugin-scaffolder-approvals-common';
import type { Entity } from '@backstage/catalog-model';
import { findGateStep } from '../gateStep';

const spec = process.env.REVIEW_SHOW ? it : it.failing;

const gate = (extra: Record<string, unknown> = {}) => ({
  id: 'gate',
  action: GATE_ACTION_ID,
  input: {
    approvers: ['group:default/devx-team'],
    values: '${{ parameters }}',
  },
  ...extra,
});
const grant = (extra: Record<string, unknown> = {}) => ({
  id: 'grant',
  action: 'github:repo:collaborator:add',
  ...extra,
});
const template = (steps: unknown[]): Entity =>
  ({
    apiVersion: 'scaffolder.backstage.io/v1beta3',
    kind: 'Template',
    metadata: { name: 't' },
    spec: { type: 'service', steps },
  } as Entity);

describe('REVIEW findGateStep spec tests (S1)', () => {
  it('control: a plain first-step gate is usable', () => {
    expect(findGateStep(template([gate(), grant()])).step).toBeDefined();
  });

  spec('rejects a gate with `if:` — the runner skips a falsy step', () => {
    expect(() =>
      findGateStep(template([gate({ if: '${{ parameters.gate }}' }), grant()])),
    ).toThrow();
  });

  spec('rejects a gate with `each:` — an empty list runs it zero times', () => {
    expect(() =>
      findGateStep(
        template([gate({ each: '${{ parameters.items }}' }), grant()]),
      ),
    ).toThrow();
  });

  spec('rejects later steps that run after a failure (`always()`)', () => {
    expect(() =>
      findGateStep(template([gate(), grant({ if: '${{ always() }}' })])),
    ).toThrow();
  });

  spec('rejects later steps that run after a failure (`failure()`)', () => {
    expect(() =>
      findGateStep(template([gate(), grant({ if: '${{ failure() }}' })])),
    ).toThrow();
  });
});
```

</details>

### <a id="a4"></a>A4 — Processor spec tests · 8 of 8 violations

<details>
<summary><code>processor-proofs.review.test.ts</code></summary>

```ts
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

/**
 * REVIEW EVIDENCE — spec tests for the catalog processor's warnings, the
 * only place a broken gate can be caught before someone runs it.
 * `it.failing` passes while the defect exists. REVIEW_SHOW=1 shows failures.
 */
import { GATE_ACTION_ID } from '@backstage-community/plugin-scaffolder-approvals-common';
import { mockServices } from '@backstage/backend-test-utils';
import type { Entity } from '@backstage/catalog-model';
import { ApprovalsGateProcessor } from '../ApprovalsGateProcessor';

const spec = process.env.REVIEW_SHOW ? it : it.failing;

const gate = (
  input: Record<string, unknown> = {},
  extra: Record<string, unknown> = {},
) => ({
  id: 'gate',
  action: GATE_ACTION_ID,
  input: {
    approvers: ['group:default/devx-team'],
    values: '${{ parameters }}',
    ...input,
  },
  ...extra,
});
const grant = (extra: Record<string, unknown> = {}) => ({
  id: 'grant',
  action: 'debug:log',
  ...extra,
});
const template = (steps: unknown[]): Entity =>
  ({
    apiVersion: 'scaffolder.backstage.io/v1beta3',
    kind: 'Template',
    metadata: { name: 't', namespace: 'default' },
    spec: { type: 'service', steps },
  } as Entity);

describe('REVIEW processor spec tests', () => {
  async function warningsFor(entity: Entity, cycles = 1) {
    const logger = mockServices.logger.mock();
    const processor = new ApprovalsGateProcessor(logger);
    for (let i = 0; i < cycles; i++) {
      await processor.preProcessEntity(
        entity,
        {} as any,
        () => {},
        {} as any,
        {} as any,
      );
    }
    return (logger.warn as jest.Mock).mock.calls.map(c => String(c[0]));
  }

  it('control: a clean gate produces no warning', async () => {
    expect(await warningsFor(template([gate(), grant()]))).toEqual([]);
  });

  spec('warns about `if:` on the gate (S1)', async () => {
    expect(
      await warningsFor(
        template([gate({}, { if: '${{ parameters.x }}' }), grant()]),
      ),
    ).not.toEqual([]);
  });

  spec('warns about `each:` on the gate (S1)', async () => {
    expect(
      await warningsFor(
        template([gate({}, { each: '${{ parameters.x }}' }), grant()]),
      ),
    ).not.toEqual([]);
  });

  spec('warns about a later `always()` step (S1)', async () => {
    expect(
      await warningsFor(template([gate(), grant({ if: '${{ always() }}' })])),
    ).not.toEqual([]);
  });

  spec(
    'warns about an unusable policy (`quorum: 0`) at ingestion, as gatePolicy.ts promises',
    async () => {
      expect(
        await warningsFor(template([gate({ quorum: 0 }), grant()])),
      ).not.toEqual([]);
    },
  );

  spec('warns about a component: approver at ingestion', async () => {
    expect(
      await warningsFor(
        template([gate({ approvers: ['component:default/x'] }), grant()]),
      ),
    ).not.toEqual([]);
  });

  spec(
    'warns when `values` is not `${{ parameters }}` (a subset refuses every run)',
    async () => {
      expect(
        await warningsFor(
          template([
            gate({ values: { repository: '${{ parameters.repository }}' } }),
            grant(),
          ]),
        ),
      ).not.toEqual([]);
    },
  );

  spec(
    'warns about `${{ user.* }}` in a gated template (empty for a service-principal run)',
    async () => {
      expect(
        await warningsFor(
          template([
            gate(),
            grant({ input: { username: '${{ user.entity.metadata.name }}' } }),
          ]),
        ),
      ).not.toEqual([]);
    },
  );

  spec(
    'does not repeat the same warning on every processing cycle',
    async () => {
      const warnings = await warningsFor(template([grant(), gate()]), 3);
      expect(warnings).toHaveLength(1);
    },
  );
});
```

</details>

### <a id="a5"></a>A5 — Runner harness (run from `workspaces/scaffolder-approvals`)

<details>
<summary><code>gate-bypass-repro.cjs</code></summary>

```js
// Run from workspaces/scaffolder-approvals:  node gate-bypass-repro.cjs
// Drives the real scaffolder runner with a gate that throws, as approval:gate
// does when a task carries no grant, and records which later steps still ran.
const path = require('node:path');
const os = require('node:os');
const nm = p => path.join(process.cwd(), 'node_modules', p);
const { NunjucksWorkflowRunner } = require(nm(
  '@backstage/plugin-scaffolder-backend/dist/scaffolder/tasks/NunjucksWorkflowRunner.cjs.js',
));
const { ScmIntegrations } = require(nm('@backstage/integration'));
const { ConfigReader } = require(nm('@backstage/config'));

const noop = () => {};
const logger = {
  info: noop,
  warn: noop,
  error: noop,
  debug: noop,
  child: () => logger,
};
const metrics = {
  createCounter: () => ({ add: noop }),
  createHistogram: () => ({ record: noop }),
};
const ran = [];
const actions = {
  'approval:gate': {
    id: 'approval:gate',
    handler: async () => {
      throw new Error('This template requires approval');
    },
  },
  'test:grant': {
    id: 'test:grant',
    handler: async ctx => {
      ran.push(ctx.input.msg);
    },
  },
};

async function run(label, steps) {
  ran.length = 0;
  const runner = new NunjucksWorkflowRunner({
    actionRegistry: { get: async id => actions[id] },
    integrations: ScmIntegrations.fromConfig(new ConfigReader({})),
    workingDirectory: os.tmpdir(),
    logger,
    metrics,
  });
  const task = {
    spec: {
      apiVersion: 'scaffolder.backstage.io/v1beta3',
      steps,
      parameters: { repository: 'acme/x', skipGate: false, items: [] },
      output: {},
      templateInfo: { entityRef: 'template:default/gated' },
      user: {},
    },
    secrets: {}, // a direct POST /v2/tasks carries no APPROVAL_GRANT
    cancelSignal: new AbortController().signal,
    isDryRun: false,
    getWorkspaceName: async () => `repro-${label.replace(/\W/g, '')}`,
    emitLog: async () => {},
    getInitiatorCredentials: async () => ({
      $$type: '@backstage/BackstageCredentials',
      principal: { type: 'user', userEntityRef: 'user:default/mallory' },
    }),
  };
  let outcome = 'completed';
  try {
    await runner.execute(task);
  } catch (e) {
    outcome = `failed (${e.message})`;
  }
  console.log(
    `${label.padEnd(
      24,
    )} task ${outcome}; ran without approval: ${JSON.stringify(ran)}`,
  );
}

(async () => {
  const gate = {
    id: 'gate',
    name: 'Await approval',
    action: 'approval:gate',
    input: { values: '${{ parameters }}' },
  };
  const grant = extra => ({
    id: 'grant',
    name: 'Grant',
    action: 'test:grant',
    input: { msg: 'grant' },
    ...extra,
  });
  await run('baseline', [gate, grant()]);
  await run('later if: always()', [gate, grant({ if: '${{ always() }}' })]);
  await run('later if: failure()', [gate, grant({ if: '${{ failure() }}' })]);
  await run('gate if: parameter', [
    { ...gate, if: '${{ parameters.skipGate }}' },
    grant(),
  ]);
  await run('gate each: empty list', [
    { ...gate, each: '${{ parameters.items }}' },
    grant(),
  ]);
})();
```

</details>

Output:

```text
baseline                 task failed (This template requires approval); ran without approval: []
later if: always()       task failed (This template requires approval); ran without approval: ["grant"]
later if: failure()      task failed (This template requires approval); ran without approval: ["grant"]
gate if: parameter       task completed; ran without approval: ["grant"]
gate each: empty list    task completed; ran without approval: ["grant"]
```

### <a id="a6"></a>A6 — Live dev-backend probe

To reproduce:

1. Start the backend: `packages/backend` with `--config ../../app-config.yaml --config app-config.review.yaml`. The overlay adds two probe templates and a separate database directory.
2. Run the probe script. It runs `scripts/verify-gate.sh`, then makes direct calls to each probe template.

<details>
<summary><code>gated-always.yaml</code></summary>

```yaml
apiVersion: scaffolder.backstage.io/v1beta3
kind: Template
metadata:
  name: review-gated-always
  title: Review probe (always)
spec:
  type: service
  owner: group:default/devx-team
  parameters:
    - title: Probe
      required: [repository, justification]
      properties:
        repository: { type: string }
        justification: { type: string, minLength: 10 }
        skipGate: { type: boolean }
  steps:
    - id: gate
      name: Await approval
      action: approval:gate

      input:
        approvers: [group:default/devx-team]
        quorum: 2
        selfApprove: false
        summary: 'Admin on ${{ parameters.repository }}'
        values: ${{ parameters }}
    - id: grant
      name: Grant the access
      action: debug:log
      if: ${{ always() }}
      input:
        message: 'REVIEW-SIDE-EFFECT-always ran for ${{ parameters.repository }}'
```

</details>

<details>
<summary><code>probe.out</code></summary>

```text
== implementer's scripts/verify-gate.sh
Waiting for http://localhost:7007 ...

1. The gated annotation is derived, not authored
  PASS  gated = true, derived from the approval:gate step

2. Values are validated before anything is stored
  PASS  incomplete values rejected with 400

3. A valid request is stored as pending, with the policy snapshotted
  PASS  pending, summary rendered, policy snapshotted

4. THE ONE THAT MATTERS: the scaffolder cannot be used to skip the gate
  PASS  task failed
  PASS  it failed at the gate, with the message a person should see
  PASS  every later step was skipped — nothing executed

The gate holds.

== probe always
annotation gated=true
approvals submit HTTP 201
direct task 48d0eb6d-535a-4f8c-ad93-f82a18837aca status=failed
 Starting up task with 2 steps
processing Beginning step Await approval
failed Error: This template requires approval before it can run. Submit it from the approvals page instead of running it directly; it will start on its own once the request has been approved.
processing Beginning step Grant the access
 info: {
 info: REVIEW-SIDE-EFFECT-always ran for acme/api
completed Finished step Grant the access
 Run completed with status: failed

== probe if
annotation gated=true
approvals submit HTTP 201
direct task b1bf070a-9e49-49b4-b742-0946f2f0c729 status=completed
 Starting up task with 2 steps
processing Beginning step Await approval
skipped Skipping step gate because its if condition was false
processing Beginning step Grant the access
 info: {
 info: REVIEW-SIDE-EFFECT-if ran for acme/api
completed Finished step Grant the access
 Run completed with status: completed
```

</details>

The notifications database afterwards held nine rows, one per request per member of `devx-team`:

```text
user:default/alice     | Approval requested | scaffolder-approvals:<id>:requested | http://localhost:3000/scaffolder-approvals/requests/<id>
user:default/bob       | Approval requested | …
user:default/requester | Approval requested | …   (the guest was the requester, so this is correct)
```

### <a id="a7"></a>A7 — Mutation audit script

<details>
<summary><code>mutate.cjs</code></summary>

```js
// Mutation audit: apply one targeted mutation at a time to a tracked source
// file, run that package's tests, record whether any test failed (mutant
// "killed") or all passed (mutant "survived"), and restore the file byte for
// byte. Restoration is verified by hash after every mutant and at exit.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');

const WS = 'D:/Ferin/Code/community-plugins/workspaces/scaffolder-approvals';
const CLI = `${WS}/node_modules/@backstage/cli/bin/backstage-cli`;
const OUT = path.join(__dirname, 'logs', 'mutants');
fs.mkdirSync(OUT, { recursive: true });

const P = {
  common: 'plugins/scaffolder-approvals-common',
  node: 'plugins/scaffolder-approvals-node',
  backend: 'plugins/scaffolder-approvals-backend',
  gate: 'plugins/scaffolder-backend-module-approvals',
  catalog: 'plugins/catalog-backend-module-approvals',
  frontend: 'plugins/scaffolder-approvals',
};

// [id, package, file (relative to package), find, replace, tests (optional), what it breaks]
const MUTANTS = [
  [
    'M01',
    'backend',
    'src/database/ApprovalStore.ts',
    "        token_hash: input.tokenHash,\n        values_hash: input.valuesHash,\n      })\n      .whereNull('consumed_at')",
    "        token_hash: input.tokenHash,\n      })\n      .whereNull('consumed_at')",
    null,
    'consumeGrant: drop the values_hash guard (Q10 tamper check)',
  ],
  [
    'M02',
    'backend',
    'src/database/ApprovalStore.ts',
    "      })\n      .whereNull('consumed_at')\n      .where('expires_at', '>', now)\n      .update({",
    "      })\n      .where('expires_at', '>', now)\n      .update({",
    null,
    'consumeGrant: drop the single-use guard (replay)',
  ],
  [
    'M03',
    'backend',
    'src/database/ApprovalStore.ts',
    "      .whereNull('consumed_at')\n      .where('expires_at', '>', now)\n      .update({",
    "      .whereNull('consumed_at')\n      .update({",
    null,
    'consumeGrant: drop the TTL guard (Q7)',
  ],
  [
    'M04',
    'backend',
    'src/database/ApprovalStore.ts',
    '      .where({\n        request_id: input.requestId,\n        token_hash: input.tokenHash,',
    '      .where({\n        token_hash: input.tokenHash,',
    null,
    'consumeGrant: drop the request_id guard',
  ],
  [
    'M05',
    'backend',
    'src/database/ApprovalStore.ts',
    '        consumed_by_task_id: input.taskId,\n      });\n\n    return affected === 1;',
    '        consumed_by_task_id: input.taskId,\n      });\n\n    return affected >= 0;',
    null,
    'consumeGrant: report success regardless of the update',
  ],
  [
    'M06',
    'backend',
    'src/database/ApprovalStore.ts',
    '      .where({ id, status: from })\n      .update(patch);',
    '      .where({ id })\n      .update(patch);',
    null,
    'transition: drop compare-and-set on status',
  ],
  [
    'M07',
    'backend',
    'src/service/router.ts',
    "await httpAuth.credentials(req, { allow: ['service'] });",
    "await httpAuth.credentials(req, { allow: ['service', 'user'] });",
    null,
    '/grants/consume: accept user principals',
  ],
  [
    'M08',
    'common',
    'src/eligibility.ts',
    '    !request.policySnapshot.selfApprove &&',
    '    false &&',
    null,
    'eligibility: drop the selfApprove guard (four-eyes)',
  ],
  [
    'M09',
    'backend',
    'src/service/ApprovalService.ts',
    "    if (decision === 'deny') {",
    "    if (decision === 'deny' && false) {",
    null,
    'decide: first deny no longer rejects',
  ],
  [
    'M10',
    'common',
    'src/types.ts',
    'satisfied: !denied && approvers.size >= policy.quorum,',
    "satisfied: !denied && decisions.filter(d => d.decision === 'approve').length >= policy.quorum,",
    null,
    'quorum: count decisions, not distinct principals',
  ],
  [
    'M11',
    'gate',
    'src/createApprovalGateAction.ts',
    '      if (!grant) {\n        throw new Error(NO_GRANT_MESSAGE);\n      }',
    '      if (!grant && false) {\n        throw new Error(NO_GRANT_MESSAGE);\n      }',
    null,
    'gate: do not stop early without a grant',
  ],
  [
    'M12',
    'gate',
    'src/createApprovalGateAction.ts',
    'const valuesHash = computeValuesHash(ctx.input.values as JsonObject);',
    'const valuesHash = computeValuesHash({} as JsonObject);',
    null,
    'gate: hash something other than the running values',
  ],
  [
    'M13',
    'gate',
    'src/createApprovalGateAction.ts',
    '      if (!response.ok) {',
    '      if (false) {',
    null,
    'gate: ignore a refusal from the backend',
  ],
  [
    'M14',
    'backend',
    'src/database/ApprovalStore.ts',
    '    if (computeValuesHash(input.values) !== input.valuesHash) {',
    '    if (false) {',
    null,
    'store: accept values and a hash that disagree',
  ],
  [
    'M15',
    'backend',
    'src/service/ApprovalService.ts',
    '    if (await this.store.hasLiveGrant(requestId)) {',
    '    if (false) {',
    null,
    'launch: mint a second live grant (double run)',
  ],
  [
    'M16',
    'node',
    'src/gateStep.ts',
    '  if (index !== 0) {',
    '  if (false) {',
    null,
    'findGateStep: accept a gate that is not first',
  ],
  [
    'M17',
    'catalog',
    'src/ApprovalsGateProcessor.ts',
    '      delete annotations[GATED_ANNOTATION];',
    '      // (mutant) keep the hand-written annotation',
    null,
    'processor: never strip a hand-written annotation',
  ],
  [
    'M18',
    'backend',
    'src/database/ApprovalStore.ts',
    "      .whereIn('status', TERMINAL_APPROVAL_REQUEST_STATUSES as string[])\n      .whereNull('redacted_at')",
    "      .whereNull('redacted_at')",
    null,
    'retention: redact requests that are still in flight',
  ],
  [
    'M19',
    'common',
    'src/canonicalJson.ts',
    '      .sort()\n      .reduce<string[]>',
    '      .reduce<string[]>',
    null,
    'canonicalJson: stop sorting keys',
  ],
  [
    'M20',
    'node',
    'src/grantToken.ts',
    '  return sha256Hex(token);',
    '  return token;',
    null,
    'hashGrantToken: store the raw token',
  ],
  [
    'M21',
    'backend',
    'src/service/ApprovalService.ts',
    '    if (request.requesterRef !== callerRef) {',
    '    if (false) {',
    null,
    'cancel: let anyone withdraw',
  ],
  [
    'M22',
    'backend',
    'src/service/router.ts',
    '    await authorizeOn(approvalRequestDecidePermission, id, req);',
    '    // (mutant) no decide permission check',
    null,
    '/decision: skip the permission framework (Q19)',
  ],
  [
    'M23',
    'backend',
    'src/service/ApprovalService.ts',
    '    validateValues(template, values);',
    '    // (mutant) validateValues(template, values);',
    null,
    'submit: skip value validation (Q3)',
  ],
  [
    'M24',
    'common',
    'src/eligibility.ts',
    '  if (!isApprover(request.policySnapshot, caller)) {',
    '  if (false) {',
    null,
    'eligibility: anyone may vote',
  ],
  [
    'M25',
    'common',
    'src/eligibility.ts',
    '    decisions.some(decision => safeNormalise(decision.approverRef) === self)',
    '    false',
    null,
    'eligibility: forget who already voted',
  ],
  [
    'M26',
    'backend',
    'src/database/ApprovalStore.ts',
    '      if (approverRows.length) {',
    '      if (false) {',
    null,
    'store: do not index approvers (inbox)',
  ],
  [
    'M27',
    'backend',
    'src/service/router.ts',
    '        approverRefs = caller.ownershipEntityRefs;',
    '        approverRefs = undefined;',
    null,
    'GET /requests?role=approver: ignore the role',
  ],
  [
    'M28',
    'backend',
    'src/service/ApprovalSweeps.ts',
    '        if (consumed?.consumed_by_task_id) {',
    '        if (false) {',
    null,
    'sweep: do not recover a lost task id',
  ],
  [
    'M29',
    'node',
    'src/gateStep.ts',
    '  return stepsOf(entity).some(step => step?.action === GATE_ACTION_ID);',
    '  return false;',
    null,
    'isGated: nothing is gated',
  ],
  [
    'M30',
    'backend',
    'src/service/router.ts',
    '    if (decision.result === AuthorizeResult.CONDITIONAL) {',
    '    if (false) {',
    null,
    'GET /requests: silently ignore a conditional read policy',
  ],
  [
    'M31',
    'backend',
    'src/service/ApprovalService.ts',
    'expiresAt: new Date(this.now().getTime() + this.grantTtlMs),',
    'expiresAt: new Date(this.now().getTime() + 100 * this.grantTtlMs),',
    null,
    'launch: ignore the configured grant TTL',
  ],
  [
    'M32',
    'backend',
    'src/database/rowMapping.ts',
    "      ? `${value.replace(' ', 'T')}Z`",
    "      ? value.replace(' ', 'T')",
    null,
    'rowMapping: read naive datetimes as local time',
  ],
  [
    'M33',
    'backend',
    'src/service/ApprovalNotifier.ts',
    '      exclude: [request.requesterRef],',
    '',
    null,
    'notifier: notify the requester about their own request',
  ],
  [
    'M34',
    'backend',
    'src/service/ApprovalSweeps.ts',
    "  cancelled: 'failed',",
    "  cancelled: 'completed',",
    null,
    'sweep: a cancelled task counts as completed',
  ],
  [
    'M35',
    'backend',
    'src/service/ApprovalService.ts',
    '    if (!recorded.recorded) {',
    '    if (false) {',
    null,
    'decide: treat a lost double-vote race as a new vote',
  ],
  [
    'M36',
    'backend',
    'src/database/ApprovalStore.ts',
    "        .where(builder =>\n          builder.whereNull('expires_at').orWhere('expires_at', '>', now),\n        )",
    '',
    null,
    'collapse: fold into a request that already timed out',
  ],
  [
    'M37',
    'node',
    'src/permissions.ts',
    '    return caller !== requester;',
    '    return true;',
    null,
    'IS_NOT_REQUESTER: always true',
  ],
  [
    'M38',
    'node',
    'src/permissions.ts',
    "  toQuery: ({ userRef }) => ({\n    key: 'requesterRef',\n    values: normaliseAll([userRef]),\n  }),",
    "  toQuery: () => ({ key: 'requesterRef', values: [] }),",
    null,
    'IS_NOT_REQUESTER: any list filter at all',
  ],
  [
    'M39',
    'frontend',
    'src/components/RequestDetail/RequestDetail.tsx',
    '              {eligibility.allowed ? (',
    '              {true ? (',
    ['src/components/RequestDetail/RequestDetail.test.tsx'],
    'UI: always offer the decide buttons',
  ],
  [
    'M40',
    'backend',
    'src/service/ApprovalService.ts',
    '    if (request.values === null) {',
    '    if (false) {',
    null,
    'launch: launch a redacted request',
  ],
];

function sha(buf) {
  return crypto.createHash('sha256').update(buf).digest('hex');
}

const originals = new Map();
function restoreAll() {
  for (const [file, content] of originals) {
    fs.writeFileSync(file, content);
  }
}
process.on('SIGINT', () => {
  restoreAll();
  process.exit(130);
});

if (process.argv.includes('--dry')) {
  let bad = 0;
  for (const [id, pkg, rel, find] of MUTANTS) {
    const text = fs
      .readFileSync(`${WS}/${P[pkg]}/${rel}`, 'utf8')
      .replace(/\r\n/g, '\n');
    const n = text.split(find).length - 1;
    if (n !== 1) {
      bad++;
      console.log(`${id} anchor found ${n} times`);
    }
  }
  console.log(`${MUTANTS.length} mutants, ${bad} bad anchors`);
  process.exit(bad ? 1 : 0);
}

const only = process.argv.slice(2);
const results = [];
for (const [id, pkg, rel, find, replace, tests, what] of MUTANTS) {
  if (only.length && !only.includes(id)) continue;
  const dir = `${WS}/${P[pkg]}`;
  const file = `${dir}/${rel}`;
  const original = fs.readFileSync(file);
  originals.set(file, original);
  const text = original.toString('utf8');
  // Work on LF-normalised text but write back with the file's own line endings.
  const crlf = text.includes('\r\n');
  const lf = text.replace(/\r\n/g, '\n');
  const count = lf.split(find).length - 1;
  if (count !== 1) {
    results.push({
      id,
      pkg,
      what,
      outcome: `SKIPPED (anchor found ${count} times)`,
    });
    console.log(`${id} SKIPPED anchor x${count}`);
    continue;
  }
  let mutated = lf.replace(find, replace);
  if (crlf) mutated = mutated.replace(/\n/g, '\r\n');
  fs.writeFileSync(file, mutated);
  const started = Date.now();
  let run;
  try {
    run = spawnSync(
      process.execPath,
      [
        CLI,
        'package',
        'test',
        '--watchAll=false',
        // Test paths go first: an array option would swallow them otherwise.
        ...(tests ?? []),
        // Only the implementer's suite decides a mutant's fate.
        '--testPathIgnorePatterns=__review__',
      ],
      {
        cwd: dir,
        env: { ...process.env, CI: 'true', BACKSTAGE_TEST_DISABLE_DOCKER: '1' },
        encoding: 'utf8',
        maxBuffer: 256 * 1024 * 1024,
      },
    );
  } finally {
    fs.writeFileSync(file, original);
  }
  if (sha(fs.readFileSync(file)) !== sha(original)) {
    throw new Error(`restore failed for ${file}`);
  }
  const output = `${run.stdout}\n${run.stderr}`;
  fs.writeFileSync(path.join(OUT, `${id}.log`), output);
  const summary = (output.match(/^Tests:.*$/m) || ['Tests: ?'])[0];
  const failing = [
    ...new Set((output.match(/● .+ › .+/g) || []).map(s => s.trim())),
  ].slice(0, 4);
  const outcome = run.status === 0 ? 'SURVIVED' : 'killed';
  results.push({
    id,
    pkg,
    what,
    outcome,
    summary,
    failing,
    seconds: Math.round((Date.now() - started) / 1000),
  });
  console.log(
    `${id} ${outcome} ${summary} (${Math.round(
      (Date.now() - started) / 1000,
    )}s) ${what}`,
  );
}
restoreAll();
fs.writeFileSync(
  path.join(OUT, 'results.json'),
  JSON.stringify(results, null, 2),
);
console.log('DONE');
```

</details>

### Appendix B — Environment notes

- **Postgres 18.4** came from `embedded-postgres@18.4.0-beta.17`.
  - `initdb` crashed with `0xC0000005` because System32 has an old `vcruntime140.dll` (14.13) and no `vcruntime140_1.dll`; the only copy of that DLL on `PATH` belongs to MiKTeX (14.42).
  - Copying a matched 14.42 runtime next to the binaries fixed it.
  - Started with `max_connections=1000`, as CI does.
- **MySQL 8.4.9** came from `mysql-memory-server@1.16.0`.
  - Strict mode, `utf8mb4_0900_ai_ci`, time zone `SYSTEM` (America/Halifax).
  - A dedicated user was created, because the Backstage connection-string parser requires a password.
- **Durability:** `fsync`, `synchronous_commit` and `innodb_flush_log_at_trx_commit` were relaxed to approximate CI's tmpfs containers. With them on, `TestDatabases` teardown overran the 60-second hook limit.
- **Clean-up:** all review files lived in the session scratchpad or under untracked `src/__review__/` folders, which were deleted afterwards. The working tree was left as it was found, apart from this file.
