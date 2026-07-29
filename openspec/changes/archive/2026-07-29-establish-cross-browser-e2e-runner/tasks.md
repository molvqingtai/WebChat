> **Completion status (2026-07-30):** The Owner explicitly accepted cumulative PR #76 at immutable exact `b8f5a4a8d4c001a4963be706dab7c6891efe75c5` and authorized merge. Exact CI run `30489904228` passed setup/linter/tests/build 4/4, fresh Review task #362 passed P0/P1/P2 `0/0/0`, and PR #76 merged into `develop` through `88a8af17e9560dc15a36e29412d3df52ef69a220`. A checked item means implemented, superseded by a later accepted exact, or explicitly closed by Owner acceptance; it does not reinterpret a historical BLOCKED, FAIL, UNVERIFIED, or unexecuted browser result as PASS. QA task #363 remained nonblocking at merge.

## 1. Authority And Protected Scope

- [x] 1.1 Verify this superseding docs authority is the clean sole child of exact `28dc35338a3df092148a9d4f99f02c329493c358` (tree `865ad3c1d9d6290b51d098756bec16ef6259eaf2`), record its clean/ref state, and inventory the current Chrome runner, helper tests, package scripts, CI job, production artifacts, and historical Firefox MV2 acceptance controls.
- [x] 1.2 Create one clean detached implementation sole child of this new docs exact. Do not copy or inherit files/evidence from `d2ebe655...`, `0756b50...`, the paused Round 3 worktree/candidate, round-30 source work, versioned-data cleanup, or any other product change; leave the Owner checkout and its untracked `.pnpm-store/` untouched.
- [x] 1.3 Freeze a protected-path manifest proving application source, WXT product configuration, manifests/permissions, Runtime, protocol, persistence, database/storage, UI, release metadata, and user-data behavior remain byte-identical.

## 2. Canonical Playwright Test Runner

- [x] 2.1 Add locked `@playwright/test` and the minimum locked Selenium/geckodriver TypeScript tooling required by the real Firefox fixture; update the lockfile without unrelated dependency upgrades.
- [x] 2.2 Add TypeScript Playwright configuration with exactly `chrome-mv3` and `firefox-mv2` required project identities, finite run/test/expect bounds, zero canonical retries, machine-readable and human-readable reporters, and ignored task-owned result directories.
- [x] 2.3 Replace the top-level custom Chrome entrypoint with Playwright-owned tests and fixtures. Preserve reusable bounded helpers only beneath the runner; leave no second canonical `node e2e/chrome-runtime.ts` orchestration or generated `.js`/`.mjs` E2E source.
- [x] 2.4 Add one canonical full package command that prepares/selects both production artifacts and runs both projects in one report. Add optional project-filtered diagnostic commands whose output cannot be mistaken for a full PASS.
- [x] 2.5 Add report aggregation/control coverage proving a missing, skipped, interrupted, timed-out, or failed required project makes the full gate fail.

## 3. Chrome MV3 Persistent-Context Fixture

- [x] 3.1 Create a worker-scoped Playwright persistent-context fixture with a unique temporary profile and the exact `.output/chrome-mv3` production directory side-loaded into Playwright-provisioned Chromium.
- [x] 3.2 Structurally validate manifest version/name, derive content isolated-context identity from the selected artifact, and prove one matching Service Worker, one Offscreen Document, content mount/readiness, and artifact/runtime identity.
- [x] 3.3 Port every current Chrome Runtime control without weakening: PresenceStore source rejection/durable invariance, accepted relay apply/callback delivery, exact rejected-relay controls and privacy-safe diagnostics, unexpected extension-error rejection, Runtime bundle boundary checks, and manifest-derived identity failure.
- [x] 3.4 Record the original page target/document plus Service Worker target/version, Offscreen target, host, lifecycle generation, page lease/attachment, listener, and connection identities. Add a bounded Offscreen-only loss using `Target.closeTarget` and assert the Service Worker/page document remain while every superseded identity disappears.
- [x] 3.5 Add a cold loss using bounded `ServiceWorker.stopWorker` for the exact recorded extension worker plus bounded Offscreen destruction. Forbid direct lifecycle creation, extension/page reload, navigation/new-tab substitution, manual Refresh, and manual reconnect; wake only from ordinary same-page ClientLease/watchdog demand.
- [x] 3.6 Give each recovery generation one non-resetting 15-second absolute budget. On the unchanged page prove ready/attachment/online-session projection, one correlated page-to-Runtime response, one Runtime-to-page callback/event, and exactly-once delivery; target recreation alone cannot pass.
- [x] 3.7 Repeat the cold lifecycle on the same page. Before teardown prove exactly one Service Worker, one Offscreen Document, one host, one page lease/attachment, no stale listener/connection or duplicate delivery; then prove zero residual cleanup.
- [x] 3.8 Attach Chrome artifact/source identity, browser version, before/after target/host/generation/lease/connection topology, recovery-budget timeline, Runtime observations, trace/screenshots on failure, assertion results, and cleanup evidence through Playwright Test.

## 4. Firefox MV2 Selenium Fixture

- [x] 4.1 Provision explicit Firefox and geckodriver identities for local/CI canonical runs. Create a worker-scoped Selenium fixture with unique test-owned profile, driver service, process ownership, and the exact production package built from `.output/firefox-mv2`.
- [x] 4.2 Structurally validate manifest version/background declaration, temporarily install the exact package, navigate an accepted target, and prove content injection, Runtime readiness, exactly one persistent Background Page, and no unexpected browser/extension error.
- [x] 4.3 Provide an independent-user helper that holds two distinct owned Firefox process/profile/extension-identity instances concurrently for overlapping assertions. Sequential generations of one profile cannot substitute; retain same-profile multi-tab only for scenarios that require one shared browser Runtime.
- [x] 4.4 Add repeated bounded owned-process restart using the same recorded profile and exact package plus explicit target restoration. If the temporary add-on must be reinstalled, record it as same-exact harness setup; separately prove profile/package/target facts and do not claim same-DOM continuity, automatic restoration, or Chrome-style worker dormancy.
- [x] 4.5 After each restart prove exactly one Background Page, Runtime rejoin, page readiness/state re-projection, and page-to-Runtime plus Runtime-to-page traffic while preserving the concurrent independent-identity control.
- [x] 4.6 Attach Firefox source/package identity, Firefox/geckodriver versions, concurrent topology, repeated install/restart/target-restoration facts, screenshots, driver/browser/Runtime logs, assertion results, and cleanup evidence through `testInfo`; never emit a synthetic JSON PASS after Selenium failure.

## 5. Deadlines, Isolation, And Cleanup

- [x] 5.1 Give persistent-context launch, driver/service startup, add-on install, navigation, readiness/polling, CDP/WebDriver/Runtime calls, screenshot/log collection, process restart, teardown, process escalation, port release, and profile/package removal explicit deadlines within the enclosing Playwright budget; use the one shared 15-second absolute budget for every phase of a Chrome recovery generation.
- [x] 5.2 Register every context, driver, service, process/group, CDP session, listener, temporary package/profile, and port to its exact fixture before use; teardown the same ownership set after pass, setup failure, assertion failure, timeout, signal, and early browser-root exit.
- [x] 5.3 Make host enumeration, ownership probes, termination, port/listener inspection, and removal asynchronous and cancelable. Forbid synchronous `ps`, global name-based cleanup, and per-phase timeout resets; prove an unrelated sentinel/browser is untouched.
- [x] 5.4 Use one shared absolute cleanup deadline across close, enumeration, probe, escalation, verification, and removal. Add deterministic controls for setup rejection, command/suite timeout, root-exited residual child, unknown ownership, removal failure, and port/listener residue.
- [x] 5.5 Verify every real project run finishes with zero owned browser/driver processes, profiles, temporary packages, listeners, and ports; attach the inventory before PASS, but retain any earlier timeout/unknown-ownership/cancellation failure as terminal even if the final inventory is zero.

## 6. Exact-Bound Evidence And CI

- [x] 6.1 Emit a run manifest containing commit/tree/cleanliness, artifact paths and hashes, parsed manifest identities, browser/driver/OS identities, project/test/topology/duration/status, and cleanup outcome. Distinguish PASS, assertion failure, setup blocker, timeout, interruption, nonexecution, and cleanup failure.
- [x] 6.2 Preserve first-run failure artifacts and make any rerun a separate diagnostic run. Configure canonical acceptance with no automatic retry and no evidence transfer across exacts/artifacts/projects.
- [x] 6.3 Update the applicable CI job to explicitly provision Playwright Chromium, real Firefox, and geckodriver, invoke the same full command with a finite job timeout, verify the run manifest/merged report/Chrome attachment/Firefox attachment exist, and upload them on success and failure with hidden results included (or an equivalently verified staging path) and fail-on-no-files behavior.
- [x] 6.4 Preserve independent `linter`, unit `tests`, and build responsibilities, existing Runtime bundle checks, workflow triggers outside the necessary E2E route, and no CI commit/push behavior.

## 7. Implementation Verification And Acceptance

- [x] 7.1 Add focused deterministic tests for runner aggregation, manifest validation, evidence binding, non-resetting lifecycle/cleanup deadlines, asynchronous cancelable ownership probes, process/profile/port ownership, teardown escalation, earlier-failure retention, missing-project/artifact rejection, concurrent Firefox identities, and protected unrelated resources.
- [x] 7.2 Run the implementation-owned focused/full test, format/lint/type, strict OpenSpec, production Chrome MV3/Firefox MV2 build/package, bundle, and canonical two-project environment gates on one clean exact. Record commands and outputs without interpreting an unexecuted gate as PASS.
- [x] 7.3 Freeze one clean immutable tooling exact with sole parent equal to this docs authority, exact/tree/parent/patch identity, direct/cumulative scope, zero unintended refs, protected-path proof, and exact-bound artifacts; do not push, merge, or resume feature work from an unfrozen worktree.
- [x] 7.4 Route one fresh independent Reviewer seat and one fresh cross-browser QA seat in parallel on the immutable tooling exact. Reviewer covers runner topology, real-platform truth, assertion parity, deadlines, report fidelity, protected scope, and resource ownership; prior Review evidence does not transfer.
- [x] 7.5 The same fresh QA seat owns the canonical automation invocation, both real Chrome MV3 lifecycle branches including repeated cold recovery, repeated real Firefox MV2 restart, exact-bound evidence, and zero-residual verification. Playwright Firefox, Chrome MV2, split platform seats, project-local runs, manual smoke, or prior QA evidence cannot substitute.
- [x] 7.6 Only after 7.4 and 7.5 pass, designate the tooling exact as the accepted base. Publication, PR update, merge, release, and branded release-candidate browser smoke remain separately authorized.

## 8. Cumulative Post-Environment Routing

- [x] 8.1 Keep all pending WebChat product implementation paused until task 7.6. This pause applies only to WebChat and must never be reported as an Allin CMS blocker.
- [x] 8.2 After acceptance, have Planner inventory every already confirmed pending WebChat requirement and defect, including the paused round-30 repairs and versioned-data cleanup, and split only mutually independent implementation boundaries for parallel execution from the accepted tooling exact.
- [x] 8.3 Converge all approved boundaries into one immutable cumulative WebChat source exact. Do not issue separate per-defect acceptance heads or transfer evidence from pre-environment candidates.
- [x] 8.4 Route one fresh cumulative Reviewer verdict and one full real Chrome MV3 plus Firefox MV2 QA matrix on that exact. Any missing integration, finding, nonexecution, timeout, or cleanup failure blocks the entire cumulative exact.
