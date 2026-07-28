## Context

The current repository has a production Chrome MV3 gate implemented as a top-level Node-native TypeScript script. It creates a temporary Chromium profile, side-loads `.output/chrome-mv3`, speaks raw CDP, proves one Service Worker and one Offscreen Document, exercises Runtime source/relay boundaries, collects diagnostics, applies request and suite deadlines, and removes owned browser processes and the profile. It is invoked directly by `node e2e/chrome-runtime.ts` and produces one JSON payload rather than Playwright Test results.

Real Firefox MV2 has different extension semantics. Its persistent Background Page, temporary add-on installation, `browser.*` behavior, and process-restart recovery cannot be certified by Chromium MV2 or Playwright's ordinary Firefox page automation. Historical acceptance therefore used Selenium with geckodriver and test-owned Firefox profiles outside the committed canonical runner.

The Owner has made the environment a sequencing dependency: all pending WebChat implementation is paused until this change is accepted. After acceptance, the already confirmed requirements and defects are implemented as one cumulative batch for maximum parallelism and one unified browser matrix. Allin CMS is a separate project and is not paused or governed by this change.

## Goals / Non-Goals

**Goals:**

- Make `@playwright/test` the sole canonical E2E runner, lifecycle authority, and reporter.
- Keep Chrome and Firefox evidence tied to their real production extension formats and engines.
- Preserve all current Chrome Runtime controls while moving browser ownership into Playwright fixtures.
- Add a committed, repeatable Firefox MV2 fixture instead of relying on external manual scripts.
- Bound all browser, driver, protocol, polling, and suite lifecycles.
- Prove isolated profiles and zero residual test-owned resources on pass and failure.
- Give later cumulative product work one accepted test base and one exact-bound cross-browser gate.

**Non-Goals:**

- Reimplement product behavior, pending bug fixes, data cleanup, or release behavior.
- Make Playwright's Firefox browser or Chrome MV2 impersonate Firefox MV2.
- Change extension manifests, permissions, Runtime architecture, protocol, persistence, or UI.
- Replace release-candidate branded Chrome/Edge smoke when separately required.
- Introduce generated JavaScript E2E sources, an out-of-repository Firefox script, or a second custom runner.

## Decisions

### 1. Playwright Test owns orchestration, not both browser engines

The canonical command uses one `playwright.config.ts` and exactly two required project identities: `chrome-mv3` and `firefox-mv2`. Playwright Test owns discovery, project selection, test deadlines, fixture teardown, attachments, and reporters for both. The Firefox project executes Selenium operations inside Playwright Test tests and fixtures; it does not request a Playwright Firefox browser fixture.

This separation keeps reporting uniform without making a false equivalence between page automation and a real Firefox extension install. A result produced by a Playwright Firefox browser launch, a Chrome MV2 build, a Firefox-compatible manifest loaded into Chromium, or a hand-operated browser is diagnostic only and cannot satisfy `firefox-mv2`.

The full gate must observe terminal results from both required projects in one invocation. `--project=chrome-mv3` and `--project=firefox-mv2` remain useful for focused diagnosis, but neither filtered run can be relabeled as the cross-browser pass.

Alternative rejected: retain the Node custom runner and merely call it from a Playwright test. That would leave browser lifecycle, assertions, reporting, and cleanup split between two runners and would not deliver fixture isolation.

### 2. Chrome uses a worker-scoped persistent context and the production MV3 artifact

The Chrome fixture creates a unique temporary user-data directory and launches Playwright-provisioned Chromium through `chromium.launchPersistentContext`. It side-loads only the exact `.output/chrome-mv3` production artifact selected for the run. Canonical acceptance does not use a developer browser profile, branded Chrome/Edge, a mock extension, or a test-only manifest.

The fixture parses the selected artifact's manifest structurally and requires manifest version 3 plus its non-empty display name. It derives content isolated-context identity from that manifest value. The migrated scenarios retain the existing controls for content mount/readiness, exactly one matching Service Worker, exactly one matching Offscreen Document, authenticated PresenceStore source restrictions, accepted and rejected Offscreen relay traffic, privacy-bounded diagnostics, unexpected extension errors, and artifact-specific Runtime bundle boundaries.

The fixture also exposes a bounded, test-owned Offscreen destruction/recovery control for the stable Runtime acceptance requirement. It may use a Playwright CDP session where Playwright has no higher-level Offscreen primitive, but CDP is a helper beneath the Playwright fixture rather than a second runner. Every CDP request remains individually bounded.

Alternative rejected: use a normal non-persistent browser context. Extension side-loading and MV3 Service Worker lifetime require a persistent context.

Alternative rejected: keep browser launch in `chrome-runtime.ts` and import only its result. That retains duplicate lifecycle and teardown authority.

### 3. Firefox uses Selenium, geckodriver, and the production MV2 package

The Firefox fixture creates a unique Firefox profile, starts an explicitly provisioned geckodriver service, launches a real Firefox process through Selenium WebDriver, and temporarily installs the exact production MV2 package built from `.output/firefox-mv2`. It structurally verifies manifest version 2 and the persistent background-script declaration before install. The package hash, Firefox version, geckodriver version, profile identity, and install result are attached to the run.

The fixture proves content injection on an accepted target, exactly one persistent Background Page, Runtime readiness, and no unexpected browser/extension errors. It provides bounded helpers for independent profiles, target-tab restoration, and test-owned Firefox process restart. If Firefox removes a temporary add-on on process exit, reinstalling the same exact package is explicitly recorded as harness setup; profile and target continuity are proved separately and the result never claims product auto-installation.

Selenium and geckodriver failures reject the Playwright Test project directly. They are not converted into annotations, skipped tests, or a synthetic JSON pass. Firefox screenshots, browser/driver logs, Runtime observations, and cleanup results are attached through `testInfo` so the same reporter contains both engines.

Alternative rejected: Chrome MV2. Modern Chromium does not provide a stable MV2 acceptance target and cannot validate Firefox manifest, permission, API, injection, or persistent Background Page behavior.

Alternative rejected: Playwright Firefox. It can automate ordinary Firefox pages but cannot replace the required production Firefox WebExtension installation and privileged lifecycle controls.

### 4. Production artifacts and source exact are the evidence authority

The full command starts from a clean immutable Git exact, builds or selects both production artifacts, and records commit SHA, tree, worktree cleanliness, artifact manifest/package hashes, browser/driver versions, OS, project, test topology, duration, and terminal result. Chrome content-context identity comes from the selected built manifest, not product copy in the harness. Firefox identity comes from the selected package and installed temporary add-on, not a separately prepared extension.

Playwright's machine-readable reporter is canonical. Human-readable HTML may accompany it. Each platform fixture attaches its evidence JSON, relevant screenshots/trace or driver logs, and cleanup record. A report with a missing, skipped, interrupted, or unstarted required project is not a full PASS. Failed first-run evidence remains immutable; a later diagnostic rerun is a separate run and cannot overwrite it.

Canonical release-blocking runs use zero automatic retries. This preserves the first failure and prevents a transient retry from being represented as deterministic environment acceptance. Sharding or parallel workers are allowed only when profiles, processes, ports, artifact outputs, and external test identities remain isolated and the merged report still proves both required projects exactly.

### 5. Fixtures own resources through terminal cleanup

Every browser instance uses a task-owned temporary profile. Firefox scenarios that represent independent users use independent processes and profiles; a same-profile second tab is used only when the product scenario explicitly requires one shared browser Runtime. Chrome contexts, Selenium drivers, geckodriver services, browser processes, CDP sessions, listeners, temporary packages, profiles, and allocated ports are registered with their owning fixture before use.

Teardown runs for pass, assertion failure, setup failure, timeout, signal, and browser-root early exit. It closes the high-level context/driver first, then terminates only recorded owned process handles or process groups, escalates boundedly when necessary, verifies no matching owned child remains, and removes only the exact temporary paths. It never uses global `pkill`, `killall`, an unbounded name match, a host user profile, or an unrelated Owner browser. A residual owned process/profile/port or failed removal makes the test fail even if behavioral assertions passed.

### 6. Deadlines cover the entire stack

Playwright configuration supplies finite per-test and full-run timeouts. Fixture startup/teardown, persistent-context launch, WebDriver and geckodriver startup, temporary add-on install, navigation, page readiness, polling, CDP requests, Runtime calls, screenshots/log capture, process restart, and process/profile cleanup each have explicit finite deadlines no larger than their enclosing test budget.

Timeout paths cancel or close the active helper where possible and then enter the same owned-resource teardown. No helper may leave a promise, polling loop, driver command, CDP request, child process, or listener waiting beyond the enclosing terminal. Timeouts identify the project, fixture phase, operation, and configured bound in attached evidence.

### 7. CI and local commands share one contract

Package scripts expose one canonical full command plus optional project-filtered diagnostic commands. The full command prepares the exact production Chrome and Firefox artifacts, runs Playwright Test with both mandatory projects, and writes reports to ignored task-owned output directories. Committed E2E source remains TypeScript under `e2e/**`; the migration adds no generated `.js`/`.mjs` runner and no precompiled harness artifact.

The applicable CI job explicitly provisions the Playwright Chromium browser, real Firefox, and geckodriver, then invokes the same canonical full gate. It retains a finite job timeout and uploads the merged Playwright report and platform attachments on failure and success as configured. CI does not silently downgrade Firefox absence, unsupported privileges, install failure, or cleanup failure into a Chrome-only pass.

Existing `linter`, `tests`, and `build` responsibilities remain distinct. The environment change may update the build/E2E job and dependencies but does not move unit tests, formatter/linter, or TypeScript ownership into Playwright Test.

### 8. Environment acceptance precedes one cumulative product batch

The docs authority is a sole child of `c35250f4a6d6a5f13ab3f93a530e31e0ec498809`. Its implementation is one clean sole child and contains only test/tooling/workflow changes. The current round-30 source work and versioned-data cleanup are not copied into that candidate.

Fresh Reviewer validation must cover runner topology, exact artifact binding, platform truth, assertion preservation, deadline behavior, evidence fidelity, and resource ownership. Fresh QA must independently run the real production Chrome MV3 and Firefox MV2 projects and prove zero residual state. Only both PASS results make the infrastructure exact eligible as the new base.

After acceptance, Planner may decompose all confirmed pending WebChat requirements and defects into independent parallel implementation boundaries. Every boundary starts from the accepted tooling exact or a controlled descendant and converges into one immutable cumulative product exact. That exact receives one fresh cumulative Reviewer verdict and one full Chrome MV3 plus Firefox MV2 QA matrix. Per-defect old heads and old evidence do not transfer. Publication, merge, and release remain separately authorized.

## Risks / Trade-offs

- [Firefox provisioning differs across developer and CI hosts] -> Provision and record explicit Firefox/geckodriver identities; fail clearly rather than fall back to Playwright Firefox or Chrome MV2.
- [Playwright fixture wraps the old custom runner instead of replacing it] -> Make persistent context, Selenium driver, assertions, attachments, and cleanup fixture-owned; remove the old top-level entry after parity is proved.
- [A full run passes Chrome while Firefox never started] -> Require both fixed project identities and terminal, non-skipped results in the canonical report.
- [Browser root exits before child cleanup] -> Track profile/process ownership independently from the root and terminate matching owned children before removing the profile.
- [A global cleanup harms an Owner browser] -> Permit only exact fixture-owned handles, process groups, profile paths, and ports; forbid global name-based termination.
- [Automatic retries conceal an unstable environment] -> Use zero retries for canonical acceptance and preserve any later rerun as separate evidence.
- [Cross-project parallelism creates shared artifact or signaling races] -> Build artifacts before the run and isolate all mutable fixture state; serialize only the scenario resources that cannot be safely partitioned.
- [Tooling work absorbs pending product changes] -> Enforce a docs-only authority, one tooling-only implementation child, protected production path scan, and fresh exact-specific review.

## Migration Plan

1. Freeze the docs authority from `c35250f4...` and record the current custom Chrome runner behavior and Firefox acceptance requirements.
2. Add locked Playwright Test and Selenium tooling, configuration, report ignores, and canonical scripts.
3. Move Chrome browser creation, CDP access, assertions, evidence, and cleanup under Playwright persistent-context fixtures and prove parity with the current gate.
4. Add the Selenium/geckodriver Firefox MV2 fixture, temporary production-package installation, persistent Background Page assertions, process-restart helper, evidence, and cleanup.
5. Add fixture-level failure controls for startup timeout, command timeout, skipped/missing project detection, root-early-exit cleanup, residual process/profile failure, and unrelated-process protection.
6. Update CI provisioning and run one full exact-bound two-project gate with merged reports.
7. Freeze one immutable tooling exact and route fresh Reviewer plus independent real-browser QA. Stop on either finding.
8. After acceptance, rebase or mechanically carry the confirmed pending WebChat work onto the accepted tooling exact, implement independent boundaries in parallel, and converge once for cumulative Review/QA.

Rollback is tooling-only: revert the runner/config/dependency/workflow candidate. It changes no extension data, production manifest, Runtime, protocol, storage, or UI. A rollback also removes its eligibility as the base for later work; it cannot leave product tasks claiming the removed environment's evidence.

## Open Questions

None. The Owner confirmed Playwright Test orchestration, real Chrome MV3, real Firefox MV2 through Selenium/geckodriver, rejection of Chrome MV2 substitution, environment-first sequencing, and one cumulative post-environment WebChat implementation/test batch.
