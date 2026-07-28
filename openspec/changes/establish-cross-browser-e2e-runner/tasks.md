## 1. Authority And Protected Scope

- [ ] 1.1 Use docs authority exact `c35250f4a6d6a5f13ab3f93a530e31e0ec498809` as the sole parent, record its tree and clean/ref state, and inventory the current Chrome runner, helper tests, package scripts, CI job, production artifacts, and historical Firefox MV2 acceptance controls.
- [ ] 1.2 Create one clean detached implementation sole child. Do not copy the paused round-30 source work, versioned-data cleanup, or any other product change into this candidate; leave the Owner checkout and its untracked `.pnpm-store/` untouched.
- [ ] 1.3 Freeze a protected-path manifest proving application source, WXT product configuration, manifests/permissions, Runtime, protocol, persistence, database/storage, UI, release metadata, and user-data behavior remain byte-identical.

## 2. Canonical Playwright Test Runner

- [ ] 2.1 Add locked `@playwright/test` and the minimum locked Selenium/geckodriver TypeScript tooling required by the real Firefox fixture; update the lockfile without unrelated dependency upgrades.
- [ ] 2.2 Add TypeScript Playwright configuration with exactly `chrome-mv3` and `firefox-mv2` required project identities, finite run/test/expect bounds, zero canonical retries, machine-readable and human-readable reporters, and ignored task-owned result directories.
- [ ] 2.3 Replace the top-level custom Chrome entrypoint with Playwright-owned tests and fixtures. Preserve reusable bounded helpers only beneath the runner; leave no second canonical `node e2e/chrome-runtime.ts` orchestration or generated `.js`/`.mjs` E2E source.
- [ ] 2.4 Add one canonical full package command that prepares/selects both production artifacts and runs both projects in one report. Add optional project-filtered diagnostic commands whose output cannot be mistaken for a full PASS.
- [ ] 2.5 Add report aggregation/control coverage proving a missing, skipped, interrupted, timed-out, or failed required project makes the full gate fail.

## 3. Chrome MV3 Persistent-Context Fixture

- [ ] 3.1 Create a worker-scoped Playwright persistent-context fixture with a unique temporary profile and the exact `.output/chrome-mv3` production directory side-loaded into Playwright-provisioned Chromium.
- [ ] 3.2 Structurally validate manifest version/name, derive content isolated-context identity from the selected artifact, and prove one matching Service Worker, one Offscreen Document, content mount/readiness, and artifact/runtime identity.
- [ ] 3.3 Port every current Chrome Runtime control without weakening: PresenceStore source rejection/durable invariance, accepted relay apply/callback delivery, exact rejected-relay controls and privacy-safe diagnostics, unexpected extension-error rejection, Runtime bundle boundary checks, and manifest-derived identity failure.
- [ ] 3.4 Move all CDP use beneath the Playwright fixture, keep every request bounded, and add a bounded direct-Offscreen-destruction scenario proving coordinator rebuild, one replacement host, readiness/attachment restoration, and no duplicate lease/host.
- [ ] 3.5 Attach Chrome artifact/source identity, browser version, target/context topology, Runtime observations, trace/screenshots on failure, assertion results, and cleanup evidence through Playwright Test.

## 4. Firefox MV2 Selenium Fixture

- [ ] 4.1 Provision explicit Firefox and geckodriver identities for local/CI canonical runs. Create a worker-scoped Selenium fixture with unique test-owned profile, driver service, process ownership, and the exact production package built from `.output/firefox-mv2`.
- [ ] 4.2 Structurally validate manifest version/background declaration, temporarily install the exact package, navigate an accepted target, and prove content injection, Runtime readiness, exactly one persistent Background Page, and no unexpected browser/extension error.
- [ ] 4.3 Provide independent-process/profile helpers for independent users and retain same-profile multi-tab only for scenarios that require one shared browser Runtime.
- [ ] 4.4 Add the bounded owned-process restart control using the same profile and restored target. If the temporary add-on must be reinstalled, record it as same-exact harness setup and separately prove profile/tab continuity, one Background Page, Runtime rejoin, readiness, and state re-projection.
- [ ] 4.5 Attach Firefox source/package identity, Firefox/geckodriver versions, topology, install/restart facts, screenshots, driver/browser/Runtime logs, assertion results, and cleanup evidence through `testInfo`; never emit a synthetic JSON PASS after Selenium failure.

## 5. Deadlines, Isolation, And Cleanup

- [ ] 5.1 Give persistent-context launch, driver/service startup, add-on install, navigation, readiness/polling, CDP/WebDriver/Runtime calls, screenshot/log collection, process restart, teardown, process escalation, port release, and profile/package removal explicit deadlines within the enclosing Playwright budget.
- [ ] 5.2 Register every context, driver, service, process/group, CDP session, listener, temporary package/profile, and port to its exact fixture before use; teardown the same ownership set after pass, setup failure, assertion failure, timeout, signal, and early browser-root exit.
- [ ] 5.3 Terminate only exact owned handles/groups/profile-matching children with bounded TERM/KILL escalation where supported. Forbid global name-based cleanup and prove an unrelated sentinel/browser is untouched.
- [ ] 5.4 Add deterministic fixture controls for setup rejection, command timeout, suite timeout, root-exited/residual-child cleanup, removal failure, and port/listener residue. Cleanup failure must override behavioral success.
- [ ] 5.5 Verify every real project run finishes with zero owned browser/driver processes, profiles, temporary packages, listeners, and ports; attach the inventory before PASS.

## 6. Exact-Bound Evidence And CI

- [ ] 6.1 Emit a run manifest containing commit/tree/cleanliness, artifact paths and hashes, parsed manifest identities, browser/driver/OS identities, project/test/topology/duration/status, and cleanup outcome. Distinguish PASS, assertion failure, setup blocker, timeout, interruption, nonexecution, and cleanup failure.
- [ ] 6.2 Preserve first-run failure artifacts and make any rerun a separate diagnostic run. Configure canonical acceptance with no automatic retry and no evidence transfer across exacts/artifacts/projects.
- [ ] 6.3 Update the applicable CI job to explicitly provision Playwright Chromium, real Firefox, and geckodriver, invoke the same full command with a finite job timeout, and upload the merged report plus platform attachments without downgrading Firefox absence to Chrome-only success.
- [ ] 6.4 Preserve independent `linter`, unit `tests`, and build responsibilities, existing Runtime bundle checks, workflow triggers outside the necessary E2E route, and no CI commit/push behavior.

## 7. Implementation Verification And Acceptance

- [ ] 7.1 Add focused deterministic tests for runner aggregation, manifest validation, evidence binding, deadline helpers, process/profile/port ownership, teardown escalation, missing-project rejection, and protected unrelated resources.
- [ ] 7.2 Run the implementation-owned focused/full test, format/lint/type, strict OpenSpec, production Chrome MV3/Firefox MV2 build/package, bundle, and canonical two-project environment gates on one clean exact. Record commands and outputs without interpreting an unexecuted gate as PASS.
- [ ] 7.3 Freeze one clean immutable tooling exact with sole parent equal to this docs authority, exact/tree/parent/patch identity, direct/cumulative scope, zero unintended refs, protected-path proof, and exact-bound artifacts; do not push, merge, or resume feature work from an unfrozen worktree.
- [ ] 7.4 Obtain fresh independent Reviewer PASS for runner topology, real-platform truth, assertion parity, deadlines, report fidelity, protected scope, and resource ownership. Prior Review evidence does not transfer.
- [ ] 7.5 Obtain fresh independent QA PASS by running the exact production `chrome-mv3` and `firefox-mv2` projects, including platform lifecycle controls and zero-residual verification. Playwright Firefox, Chrome MV2, project-local runs, or manual smoke cannot substitute.
- [ ] 7.6 Only after 7.4 and 7.5 pass, designate the tooling exact as the accepted base. Publication, PR update, merge, release, and branded release-candidate browser smoke remain separately authorized.

## 8. Cumulative Post-Environment Routing

- [ ] 8.1 Keep all pending WebChat product implementation paused until task 7.6. This pause applies only to WebChat and must never be reported as an Allin CMS blocker.
- [ ] 8.2 After acceptance, have Planner inventory every already confirmed pending WebChat requirement and defect, including the paused round-30 repairs and versioned-data cleanup, and split only mutually independent implementation boundaries for parallel execution from the accepted tooling exact.
- [ ] 8.3 Converge all approved boundaries into one immutable cumulative WebChat source exact. Do not issue separate per-defect acceptance heads or transfer evidence from pre-environment candidates.
- [ ] 8.4 Route one fresh cumulative Reviewer verdict and one full real Chrome MV3 plus Firefox MV2 QA matrix on that exact. Any missing integration, finding, nonexecution, timeout, or cleanup failure blocks the entire cumulative exact.
