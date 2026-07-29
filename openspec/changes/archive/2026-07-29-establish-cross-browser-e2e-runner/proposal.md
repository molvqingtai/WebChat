## Why

WebChat's committed Chrome Runtime gate currently executes `node e2e/chrome-runtime.ts` as a custom one-shot runner. It already controls a real production MV3 build, but it reimplements test lifecycle, timeout, reporting, attachment, and cleanup behavior, while real Firefox MV2 verification remains outside the same canonical test environment. That split makes every later repair pay a separate browser-environment setup cost and allows Chrome-only evidence to arrive before the Firefox-specific extension path is exercised.

The test environment must become the first accepted dependency for all pending WebChat work. One Playwright Test orchestration surface can provide exact-bound reporting and fixture lifecycle without pretending that Playwright Firefox can install or validate the production Firefox MV2 extension. Chrome must remain a real production MV3 extension, and Firefox must remain a real production MV2 extension driven by Selenium and geckodriver.

The Owner has now added a blocking lifecycle regression from the previous version: after the Chrome MV3 background Service Worker and Offscreen Runtime became inactive and later reactivated, an already-open page remained permanently unable to connect. The first runner implementation exercised only direct Offscreen destruction while requiring the Service Worker to stay alive, so target reappearance could pass without proving recovery of the original page. The canonical environment must now prove true background/host inactivity, ordinary wake, automatic same-page reattachment, real post-recovery traffic, bounded repetition, and unique terminal ownership.

## What Changes

- **BREAKING test workflow:** Replace the custom `node e2e/chrome-runtime.ts` canonical entrypoint with `@playwright/test` as the sole E2E runner and reporter.
- Add two mandatory, explicitly named runner projects: `chrome-mv3` and `firefox-mv2`.
- Launch the production unpacked Chrome MV3 artifact through a Playwright worker-scoped persistent-context fixture using Playwright-provisioned Chromium, while retaining manifest-derived identity, Service Worker, Offscreen, authenticated relay, Runtime diagnostic, timeout, and cleanup assertions.
- Launch the production Firefox MV2 package through a worker-scoped Selenium WebDriver fixture with an explicitly provisioned geckodriver and an isolated Firefox profile. Playwright Test orchestrates and reports this project but does not substitute its Firefox browser engine for the extension gate.
- Make one canonical full command build/select both exact production artifacts and run both required projects into one report. Project-filtered commands remain diagnostic only and cannot certify the full gate.
- Produce exact-bound JSON/report attachments for build identity, browser and driver identity, platform-specific Runtime observations, failures, and zero-residual cleanup.
- Keep every browser operation and the whole suite bounded. A timeout, fixture failure, skipped required project, or cleanup failure is a failed gate rather than a silent pass or indefinite wait.
- Add real Chrome MV3 lifecycle controls using bounded `Target.closeTarget` for Offscreen-only loss and bounded `ServiceWorker.stopWorker` plus Offscreen destruction for cold Service Worker-plus-Offscreen loss. Keep the original target page and document open without reload, navigation, new-tab substitution, extension reload, manual Refresh, or manual reconnect; allow only the page's ordinary ClientLease/watchdog demand to wake the extension.
- Record old Service Worker, Offscreen, host, lifecycle-generation, page-lease, attachment, and connection identities. Require each Chrome recovery generation to settle within one non-resetting 15-second budget, prove every superseded identity disappears, restore ready/attachment/online-session projection on the original page, complete both page-to-Runtime response and Runtime-to-page callback/event traffic exactly once, and finish with one Service Worker, one Offscreen Document, one host, one page lease/attachment, no stale listener/connection, and no duplicate delivery.
- Repeat the cold Chrome lifecycle on the same page so a first recovery cannot conceal accumulating host, lease, listener, connection, or delivery state.
- Preserve Firefox MV2 platform truth: its persistent Background Page lifecycle uses an owned Firefox process restart with the same profile and exact package plus an explicitly restored target. It must repeat the restart, prove Runtime traffic and one Background Page, and must not be represented as Chrome-style same-document Service Worker dormancy.
- Make all ownership enumeration/probing and cleanup asynchronous and cancelable under one shared absolute budget, with no synchronous `ps`, per-phase reset, or later zero-residual result erasing an earlier timeout/unknown-ownership failure. Require two independent Firefox process/profile/identity instances to remain simultaneous where the scenario represents independent users; sequential same-profile generations cannot substitute. Make CI evidence upload include hidden result paths or an equivalent verified staging path and fail closed when the merged report, run manifest, or either platform attachment is absent.
- After this environment receives fresh Review and real Chrome MV3 plus Firefox MV2 QA acceptance, use its accepted exact as the base for one cumulative implementation batch covering all already confirmed pending WebChat requirements and defects. Independent implementation boundaries may proceed in parallel, but they converge into one fresh cumulative exact and one unified Review/QA route.

## Capabilities

### New Capabilities

- `cross-browser-e2e-runner`: Canonical Playwright Test orchestration, production Chrome MV3 and Firefox MV2 fixtures, exact-bound reporting, bounded lifecycle, isolated profiles, and zero-residual cleanup.

### Modified Capabilities

None. Existing Runtime and source-quality requirements remain authoritative; this change supplies one test environment for exercising them without changing product behavior.

## Impact

- Root development dependencies and lockfile, package scripts, Playwright Test configuration, committed `e2e/**/*.ts` fixtures/specs/helpers, ignore rules for generated reports, and the applicable CI job.
- The existing Chrome Runtime harness may be decomposed or removed after its assertions are preserved under Playwright Test.
- New Selenium/geckodriver Firefox fixture and exact-production-package provisioning.
- Exact-bound lifecycle evidence for old/new Chrome target and host generations, same-page recovery, repeated Firefox restart, shared cleanup-budget settlement, independent Firefox identities, and CI artifact presence.
- No production application source, manifest permissions, WXT product configuration, peer protocol, Runtime behavior, storage, database, UI, release metadata, or user data changes.

## Non-Goals

- No Chrome MV2 proxy for Firefox MV2 and no Playwright Firefox result represented as Firefox extension evidence.
- No branded Chrome or Edge release-candidate smoke replacement; those remain separate when required.
- No `pnpm dev`, manual browser session, host user profile, agent-browser session, or hand-installed extension as canonical evidence.
- No direct harness call to create an Offscreen Document, start a Service Worker, invoke Coordinator recovery, reload the extension, reload/replace the page, or press a product Refresh control as a substitute for normal same-page wake and automatic recovery.
- No claim that Firefox MV2 process restart preserves one DOM document or is equivalent to Chrome MV3 Service Worker dormancy; the two platform controls retain distinct evidence semantics.
- No repair of the pending product defects or versioned-data cleanup inside this infrastructure candidate.
- No transfer of prior candidate, Review, QA, browser, CI, or cleanup verdicts to the new environment or to the later cumulative product exact.

## Acceptance Criteria

- A clean exact produces the production Chrome MV3 artifact and production Firefox MV2 package, then one Playwright Test invocation reports terminal results for both mandatory projects.
- Chrome runs through a Playwright persistent context with the production MV3 artifact and retains the current manifest-derived content-context, Service Worker, Offscreen, authenticated relay/source-boundary, Runtime-error, deadline, and cleanup controls.
- Chrome separately proves bounded `Target.closeTarget` Offscreen-only loss and bounded `ServiceWorker.stopWorker` plus Offscreen loss while the original page/document stays open. Recorded old target/host/generation/lease/connection settlement, normal ClientLease/watchdog wake, distinct replacements where applicable, same-page automatic ready/attachment/online-session recovery, bidirectional exactly-once Runtime traffic, a repeated cold cycle, and one final active topology are all mandatory; target recreation alone is not a PASS.
- Firefox runs through Selenium and geckodriver with the production MV2 package, two simultaneous isolated identities when required, one persistent Background Page per identity, content injection, repeated owned-process restart, restored-target Runtime traffic, and bounded lifecycle controls. Chrome MV2 and Playwright Firefox are rejected as substitutes.
- Each project attaches exact/tree/artifact/browser/driver/topology/result evidence. A full gate fails if either required project is missing, skipped, timed out, or unable to prove cleanup.
- Every test-owned browser, driver, profile, temporary package, process, port, and listener is closed or removed within one shared absolute cleanup budget, including timeout and early-root-exit paths, with no synchronous host probe able to block the event loop and no unrelated Owner process touched.
- CI verifies and uploads the merged report, run manifest, Chrome attachment, and Firefox attachment, including hidden result paths; any missing or silently excluded file fails the gate.
- This superseding docs authority is a clean sole child of `28dc35338a3df092148a9d4f99f02c329493c358`. The infrastructure implementation is a clean sole child of this new docs exact, changes only test/tooling/workflow surfaces, and receives one fresh Reviewer and one fresh cross-browser QA seat in parallel before any paused WebChat implementation resumes. The same QA seat owns the canonical automation, real Chrome MV3, real Firefox MV2, evidence, and zero-residual verdict. `d2ebe655...`, `0756b50...`, the paused Round 3 worktree/candidate, and all prior evidence do not transfer.
