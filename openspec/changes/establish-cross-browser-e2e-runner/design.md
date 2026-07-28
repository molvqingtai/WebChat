## Context

The current repository has a production Chrome MV3 gate implemented as a top-level Node-native TypeScript script. It creates a temporary Chromium profile, side-loads `.output/chrome-mv3`, speaks raw CDP, proves one Service Worker and one Offscreen Document, exercises Runtime source/relay boundaries, collects diagnostics, applies request and suite deadlines, and removes owned browser processes and the profile. It is invoked directly by `node e2e/chrome-runtime.ts` and produces one JSON payload rather than Playwright Test results.

The first Playwright migration candidate covered only direct Offscreen destruction while the coordinator Service Worker remained alive. It therefore could observe a replacement target without proving the reported regression: after both Chrome background and Offscreen inactivity, the original open page remained permanently unable to connect. The superseding environment must distinguish Offscreen-only loss from a cold Service Worker-plus-Offscreen loss and prove automatic recovery on the unchanged page through normal product demand and real bidirectional Runtime traffic.

Real Firefox MV2 has different extension semantics. Its persistent Background Page, temporary add-on installation, `browser.*` behavior, and process-restart recovery cannot be certified by Chromium MV2 or Playwright's ordinary Firefox page automation. Historical acceptance therefore used Selenium with geckodriver and test-owned Firefox profiles outside the committed canonical runner.

The Owner has made the environment a sequencing dependency: all pending WebChat implementation is paused until this change is accepted. After acceptance, the already confirmed requirements and defects are implemented as one cumulative batch for maximum parallelism and one unified browser matrix. Allin CMS is a separate project and is not paused or governed by this change.

## Goals / Non-Goals

**Goals:**

- Make `@playwright/test` the sole canonical E2E runner, lifecycle authority, and reporter.
- Keep Chrome and Firefox evidence tied to their real production extension formats and engines.
- Preserve all current Chrome Runtime controls while moving browser ownership into Playwright fixtures.
- Prove bounded, repeated Chrome MV3 recovery after Offscreen-only loss and cold Service Worker-plus-Offscreen loss without replacing or reloading the original page.
- Add a committed, repeatable Firefox MV2 fixture instead of relying on external manual scripts.
- Preserve Firefox MV2 platform truth through repeated owned-process restart rather than claiming Chrome-style worker dormancy or same-document continuity.
- Bound all browser, driver, protocol, polling, and suite lifecycles.
- Prove concurrent independent-user profiles, cancelable ownership discovery, and zero residual test-owned resources on pass and failure.
- Give later cumulative product work one accepted test base and one exact-bound cross-browser gate.

**Non-Goals:**

- Reimplement product behavior, pending bug fixes, data cleanup, or release behavior.
- Make Playwright's Firefox browser or Chrome MV2 impersonate Firefox MV2.
- Change extension manifests, permissions, Runtime architecture, protocol, persistence, or UI.
- Replace release-candidate branded Chrome/Edge smoke when separately required.
- Introduce generated JavaScript E2E sources, an out-of-repository Firefox script, or a second custom runner.
- Directly create a Service Worker, Offscreen Document, Coordinator, or host; reload the extension or target page; navigate or replace the target; or invoke manual Refresh/reconnect as a recovery shortcut.
- Represent Firefox process restart as preservation of one DOM document or as equivalent to Chrome MV3 Service Worker dormancy.

## Decisions

### 1. Playwright Test owns orchestration, not both browser engines

The canonical command uses one `playwright.config.ts` and exactly two required project identities: `chrome-mv3` and `firefox-mv2`. Playwright Test owns discovery, project selection, test deadlines, fixture teardown, attachments, and reporters for both. The Firefox project executes Selenium operations inside Playwright Test tests and fixtures; it does not request a Playwright Firefox browser fixture.

This separation keeps reporting uniform without making a false equivalence between page automation and a real Firefox extension install. A result produced by a Playwright Firefox browser launch, a Chrome MV2 build, a Firefox-compatible manifest loaded into Chromium, or a hand-operated browser is diagnostic only and cannot satisfy `firefox-mv2`.

The full gate must observe terminal results from both required projects in one invocation. `--project=chrome-mv3` and `--project=firefox-mv2` remain useful for focused diagnosis, but neither filtered run can be relabeled as the cross-browser pass.

Alternative rejected: retain the Node custom runner and merely call it from a Playwright test. That would leave browser lifecycle, assertions, reporting, and cleanup split between two runners and would not deliver fixture isolation.

### 2. Chrome uses a worker-scoped persistent context and the production MV3 artifact

The Chrome fixture creates a unique temporary user-data directory and launches Playwright-provisioned Chromium through `chromium.launchPersistentContext`. It side-loads only the exact `.output/chrome-mv3` production artifact selected for the run. Canonical acceptance does not use a developer browser profile, branded Chrome/Edge, a mock extension, or a test-only manifest.

The fixture parses the selected artifact's manifest structurally and requires manifest version 3 plus its non-empty display name. It derives content isolated-context identity from that manifest value. The migrated scenarios retain the existing controls for content mount/readiness, exactly one matching Service Worker, exactly one matching Offscreen Document, authenticated PresenceStore source restrictions, accepted and rejected Offscreen relay traffic, privacy-bounded diagnostics, unexpected extension errors, and artifact-specific Runtime bundle boundaries.

The fixture exposes two distinct, bounded lifecycle controls beneath Playwright ownership. The Offscreen-only branch uses `Target.closeTarget` against the recorded Offscreen target while retaining the recorded Service Worker. The cold branch uses `ServiceWorker.stopWorker` against the exact extension worker registration and destroys the recorded Offscreen target. Both controls record the original page target/document, Service Worker, Offscreen, host, lifecycle generation, page lease, attachment, and connection identities before loss.

The harness then stops controlling lifecycle creation. It does not navigate, reload, replace, or manually reconnect the page; reload the extension; press Refresh; or call Service Worker, Offscreen, Coordinator, or host creation directly. Only the original page's ordinary ClientLease/watchdog demand may wake the extension. Each recovery generation receives one absolute, non-resetting 15-second budget covering wake, target discovery, ready/attachment/online-session projection, bidirectional Runtime proof, and unique-settlement assertions.

Offscreen-only recovery must prove the old Offscreen/host generation and superseded connection disappear while the intended Service Worker/page document remain. Cold recovery must prove the old Service Worker, Offscreen, host generation, lease/attachment, and superseded connections disappear before distinct replacements settle. The unchanged page must complete one correlated page-to-Runtime request/response and one Runtime-to-page callback/event exactly once. The cold lifecycle then repeats on that same page, and final settlement requires exactly one Service Worker, one Offscreen Document, one host, one page lease, one page attachment, no stale listener or connection, and no duplicate delivery. Target recreation by itself is never PASS.

CDP remains a helper beneath the Playwright fixture rather than a second runner. Every CDP request and loss control is individually bounded within its enclosing lifecycle budget.

Alternative rejected: use a normal non-persistent browser context. Extension side-loading and MV3 Service Worker lifetime require a persistent context.

Alternative rejected: keep browser launch in `chrome-runtime.ts` and import only its result. That retains duplicate lifecycle and teardown authority.

### 3. Firefox uses Selenium, geckodriver, and the production MV2 package

The Firefox fixture creates a unique Firefox profile, starts an explicitly provisioned geckodriver service, launches a real Firefox process through Selenium WebDriver, and temporarily installs the exact production MV2 package built from `.output/firefox-mv2`. It structurally verifies manifest version 2 and the persistent background-script declaration before install. The package hash, Firefox version, geckodriver version, profile identity, and install result are attached to the run.

The fixture proves content injection on an accepted target, exactly one persistent Background Page, Runtime readiness, and no unexpected browser/extension errors. Its independent-user helper holds two distinct Firefox process/profile/extension-identity instances concurrently for the overlapping scenario; sequential generations of one profile are not a substitute. It also provides bounded target restoration and test-owned Firefox process restart using the same recorded profile and exact package. If Firefox removes a temporary add-on on process exit, reinstalling the same exact package is explicitly recorded as harness setup.

Firefox lifecycle evidence reflects its real MV2 platform boundary. The fixture explicitly restores the recorded target after each owned-process restart, proves one Background Page, Runtime readiness, state re-projection, and bidirectional Runtime traffic, repeats the restart, and cleans both independent identities strictly. Profile/package/target facts are recorded separately; the result never claims product auto-installation, automatic session restoration, one preserved DOM document, or Chrome Service Worker dormancy.

Selenium and geckodriver failures reject the Playwright Test project directly. They are not converted into annotations, skipped tests, or a synthetic JSON pass. Firefox screenshots, browser/driver logs, Runtime observations, and cleanup results are attached through `testInfo` so the same reporter contains both engines.

Alternative rejected: Chrome MV2. Modern Chromium does not provide a stable MV2 acceptance target and cannot validate Firefox manifest, permission, API, injection, or persistent Background Page behavior.

Alternative rejected: Playwright Firefox. It can automate ordinary Firefox pages but cannot replace the required production Firefox WebExtension installation and privileged lifecycle controls.

### 4. Production artifacts and source exact are the evidence authority

The full command starts from a clean immutable Git exact, builds or selects both production artifacts, and records commit SHA, tree, worktree cleanliness, artifact manifest/package hashes, browser/driver versions, OS, project, test topology, duration, and terminal result. Chrome content-context identity comes from the selected built manifest, not product copy in the harness. Firefox identity comes from the selected package and installed temporary add-on, not a separately prepared extension.

Playwright's machine-readable reporter is canonical. Human-readable HTML may accompany it. Each platform fixture attaches its evidence JSON, relevant screenshots/trace or driver logs, and cleanup record. The run manifest, merged report, Chrome attachment, and Firefox attachment are mandatory files. CI upload must include hidden result paths, for example with `include-hidden-files: true`, or first stage them through an equivalently verified path; an explicit pre-upload existence check and fail-on-no-files behavior reject any missing file. A report with a missing, skipped, interrupted, or unstarted required project is not a full PASS. Failed first-run evidence remains immutable; a later diagnostic rerun is a separate run and cannot overwrite it.

Canonical release-blocking runs use zero automatic retries. This preserves the first failure and prevents a transient retry from being represented as deterministic environment acceptance. Sharding or parallel workers are allowed only when profiles, processes, ports, artifact outputs, and external test identities remain isolated and the merged report still proves both required projects exactly.

### 5. Fixtures own resources through terminal cleanup

Every browser instance uses a task-owned temporary profile. Firefox scenarios that represent independent users use independent processes and profiles; a same-profile second tab is used only when the product scenario explicitly requires one shared browser Runtime. Chrome contexts, Selenium drivers, geckodriver services, browser processes, CDP sessions, listeners, temporary packages, profiles, and allocated ports are registered with their owning fixture before use.

Teardown runs for pass, assertion failure, setup failure, timeout, signal, and browser-root early exit. Host enumeration, ownership probing, termination, port/listener inspection, and path removal are asynchronous and cancelable; no synchronous `ps` or other host probe may block the event loop. One absolute cleanup deadline is created when cleanup begins, and every phase consumes its remaining time without resetting a per-command or per-phase budget.

The fixture closes the high-level context/driver first, then terminates only recorded owned process handles or process groups, escalates boundedly when necessary, verifies no matching owned child remains, and removes only the exact temporary paths. It never uses global `pkill`, `killall`, an unbounded name match, a host user profile, or an unrelated Owner browser. A timeout, cancellation failure, unknown ownership result, residual resource, or failed removal makes cleanup terminally fail even if a later snapshot happens to show zero residual resources; final zero cannot erase an earlier cleanup failure.

### 6. Deadlines cover the entire stack

Playwright configuration supplies finite per-test and full-run timeouts. Fixture startup/teardown, persistent-context launch, WebDriver and geckodriver startup, temporary add-on install, navigation, page readiness, polling, CDP requests, Runtime calls, screenshots/log capture, process restart, and process/profile cleanup each have explicit finite deadlines no larger than their enclosing test budget.

Each Chrome recovery generation additionally uses one non-resetting 15-second absolute recovery deadline. Wake, Service Worker/Offscreen discovery, host-generation settlement, page lease/attachment restoration, online/session projection, both Runtime traffic directions, and uniqueness checks consume that same deadline; polls or phases do not start a fresh 15 seconds.

Timeout paths cancel or close the active helper where possible and then enter the same owned-resource teardown. No helper may leave a promise, polling loop, driver command, CDP request, child process, or listener waiting beyond the enclosing terminal. Timeouts identify the project, fixture phase, operation, and configured bound in attached evidence.

### 7. CI and local commands share one contract

Package scripts expose one canonical full command plus optional project-filtered diagnostic commands. The full command prepares the exact production Chrome and Firefox artifacts, runs Playwright Test with both mandatory projects, and writes reports to ignored task-owned output directories. Committed E2E source remains TypeScript under `e2e/**`; the migration adds no generated `.js`/`.mjs` runner and no precompiled harness artifact.

The applicable CI job explicitly provisions the Playwright Chromium browser, real Firefox, and geckodriver, then invokes the same canonical full gate. It retains a finite job timeout and uploads the run manifest, merged Playwright report, Chrome attachment, and Firefox attachment on failure and success. Upload includes hidden result paths or uses an equivalent verified staging path, fails when files are absent, and cannot silently exclude an attachment. CI does not downgrade Firefox absence, unsupported privileges, install failure, cleanup failure, or evidence-upload failure into a Chrome-only pass.

Existing `linter`, `tests`, and `build` responsibilities remain distinct. The environment change may update the build/E2E job and dependencies but does not move unit tests, formatter/linter, or TypeScript ownership into Playwright Test.

### 8. Environment acceptance precedes one cumulative product batch

This superseding docs authority is a clean sole child of `28dc35338a3df092148a9d4f99f02c329493c358`. Its implementation is one clean sole child of the new docs exact and contains only test/tooling/workflow changes. No file or evidence is copied from `d2ebe655...`, `0756b50...`, the paused Round 3 worktree/candidate, current round-30 source work, or versioned-data cleanup.

One fresh Reviewer seat and one fresh cross-browser QA seat run in parallel on the immutable implementation exact. The Reviewer covers runner topology, exact artifact binding, platform truth, assertion preservation, deadline behavior, evidence fidelity, and resource ownership. The same QA seat owns the canonical automation invocation, real Chrome MV3 lifecycle branches, real Firefox MV2 lifecycle, exact-bound evidence, and zero-residual proof; platform work is not split into independently transferable verdicts. Only both complete PASS results make the infrastructure exact eligible as the new base.

After acceptance, Planner may decompose all confirmed pending WebChat requirements and defects into independent parallel implementation boundaries. Every boundary starts from the accepted tooling exact or a controlled descendant and converges into one immutable cumulative product exact. That exact receives one fresh cumulative Reviewer verdict and one full Chrome MV3 plus Firefox MV2 QA matrix. Per-defect old heads and old evidence do not transfer. Publication, merge, and release remain separately authorized.

## Risks / Trade-offs

- [Firefox provisioning differs across developer and CI hosts] -> Provision and record explicit Firefox/geckodriver identities; fail clearly rather than fall back to Playwright Firefox or Chrome MV2.
- [Playwright fixture wraps the old custom runner instead of replacing it] -> Make persistent context, Selenium driver, assertions, attachments, and cleanup fixture-owned; remove the old top-level entry after parity is proved.
- [A full run passes Chrome while Firefox never started] -> Require both fixed project identities and terminal, non-skipped results in the canonical report.
- [A recreated Chrome target masks a disconnected original page] -> Preserve the page target/document, allow only ordinary ClientLease/watchdog wake, require restored projection plus exactly-once traffic, repeat the cold cycle, and inspect final ownership uniqueness.
- [A Firefox restart is mislabeled as Chrome-style inactivity] -> Record owned-process/profile/package/target restoration separately and prohibit same-document or Service Worker dormancy claims.
- [Browser root exits before child cleanup] -> Track profile/process ownership independently from the root and terminate matching owned children before removing the profile.
- [Synchronous host inspection hangs cleanup or phase budgets multiply] -> Use cancelable asynchronous probes under one absolute cleanup deadline, and retain any timeout or unknown-ownership result as terminal failure.
- [A global cleanup harms an Owner browser] -> Permit only exact fixture-owned handles, process groups, profile paths, and ports; forbid global name-based termination.
- [Hidden result directories make CI upload succeed without evidence] -> Verify all four mandatory evidence files before an upload that includes hidden paths and fails on absence.
- [Automatic retries conceal an unstable environment] -> Use zero retries for canonical acceptance and preserve any later rerun as separate evidence.
- [Cross-project parallelism creates shared artifact or signaling races] -> Build artifacts before the run and isolate all mutable fixture state; serialize only the scenario resources that cannot be safely partitioned.
- [Tooling work absorbs pending product changes] -> Enforce a docs-only authority, one tooling-only implementation child, protected production path scan, and fresh exact-specific review.

## Migration Plan

1. Freeze this superseding docs authority as the clean sole child of `28dc353...`; exclude `d2ebe655...`, `0756b50...`, the paused Round 3 candidate, and all prior evidence.
2. Add locked Playwright Test and Selenium tooling, configuration, report ignores, and canonical scripts.
3. Move Chrome browser creation, CDP access, assertions, evidence, and cleanup under Playwright persistent-context fixtures; add Offscreen-only and repeated cold lifecycle recovery on the unchanged page.
4. Add the Selenium/geckodriver Firefox MV2 fixture, concurrent independent identities, temporary production-package installation, persistent Background Page assertions, repeated process-restart recovery, evidence, and cleanup.
5. Add fixture-level failure controls for startup/command timeouts, skipped/missing projects, asynchronous shared-budget cleanup, root-early-exit residuals, unknown ownership, failed removal, and unrelated-process protection.
6. Update CI provisioning, mandatory hidden-path-safe evidence verification/upload, and one full exact-bound two-project gate with merged reports.
7. Freeze one immutable tooling exact as the sole child of this docs exact and route one fresh Reviewer plus one fresh cross-browser QA seat in parallel. Stop on either finding.
8. After acceptance, rebase or mechanically carry the confirmed pending WebChat work onto the accepted tooling exact, implement independent boundaries in parallel, and converge once for cumulative Review/QA.

Rollback is tooling-only: revert the runner/config/dependency/workflow candidate. It changes no extension data, production manifest, Runtime, protocol, storage, or UI. A rollback also removes its eligibility as the base for later work; it cannot leave product tasks claiming the removed environment's evidence.

## Open Questions

None. The Owner confirmed Playwright Test orchestration, real Chrome MV3, real Firefox MV2 through Selenium/geckodriver, rejection of Chrome MV2 substitution, environment-first sequencing, and one cumulative post-environment WebChat implementation/test batch.
