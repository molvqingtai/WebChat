## Why

WebChat's committed Chrome Runtime gate currently executes `node e2e/chrome-runtime.ts` as a custom one-shot runner. It already controls a real production MV3 build, but it reimplements test lifecycle, timeout, reporting, attachment, and cleanup behavior, while real Firefox MV2 verification remains outside the same canonical test environment. That split makes every later repair pay a separate browser-environment setup cost and allows Chrome-only evidence to arrive before the Firefox-specific extension path is exercised.

The test environment must become the first accepted dependency for all pending WebChat work. One Playwright Test orchestration surface can provide exact-bound reporting and fixture lifecycle without pretending that Playwright Firefox can install or validate the production Firefox MV2 extension. Chrome must remain a real production MV3 extension, and Firefox must remain a real production MV2 extension driven by Selenium and geckodriver.

## What Changes

- **BREAKING test workflow:** Replace the custom `node e2e/chrome-runtime.ts` canonical entrypoint with `@playwright/test` as the sole E2E runner and reporter.
- Add two mandatory, explicitly named runner projects: `chrome-mv3` and `firefox-mv2`.
- Launch the production unpacked Chrome MV3 artifact through a Playwright worker-scoped persistent-context fixture using Playwright-provisioned Chromium, while retaining manifest-derived identity, Service Worker, Offscreen, authenticated relay, Runtime diagnostic, timeout, and cleanup assertions.
- Launch the production Firefox MV2 package through a worker-scoped Selenium WebDriver fixture with an explicitly provisioned geckodriver and an isolated Firefox profile. Playwright Test orchestrates and reports this project but does not substitute its Firefox browser engine for the extension gate.
- Make one canonical full command build/select both exact production artifacts and run both required projects into one report. Project-filtered commands remain diagnostic only and cannot certify the full gate.
- Produce exact-bound JSON/report attachments for build identity, browser and driver identity, platform-specific Runtime observations, failures, and zero-residual cleanup.
- Keep every browser operation and the whole suite bounded. A timeout, fixture failure, skipped required project, or cleanup failure is a failed gate rather than a silent pass or indefinite wait.
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
- No production application source, manifest permissions, WXT product configuration, peer protocol, Runtime behavior, storage, database, UI, release metadata, or user data changes.

## Non-Goals

- No Chrome MV2 proxy for Firefox MV2 and no Playwright Firefox result represented as Firefox extension evidence.
- No branded Chrome or Edge release-candidate smoke replacement; those remain separate when required.
- No `pnpm dev`, manual browser session, host user profile, agent-browser session, or hand-installed extension as canonical evidence.
- No repair of the pending product defects or versioned-data cleanup inside this infrastructure candidate.
- No transfer of prior candidate, Review, QA, browser, CI, or cleanup verdicts to the new environment or to the later cumulative product exact.

## Acceptance Criteria

- A clean exact produces the production Chrome MV3 artifact and production Firefox MV2 package, then one Playwright Test invocation reports terminal results for both mandatory projects.
- Chrome runs through a Playwright persistent context with the production MV3 artifact and retains the current manifest-derived content-context, Service Worker, Offscreen, authenticated relay/source-boundary, Runtime-error, deadline, and cleanup controls.
- Firefox runs through Selenium and geckodriver with the production MV2 package, an isolated test-owned profile, one persistent Background Page, content injection, and bounded lifecycle controls. Chrome MV2 and Playwright Firefox are rejected as substitutes.
- Each project attaches exact/tree/artifact/browser/driver/topology/result evidence. A full gate fails if either required project is missing, skipped, timed out, or unable to prove cleanup.
- Every test-owned browser, driver, profile, temporary package, process, port, and listener is closed or removed in fixture teardown, including timeout and early-root-exit paths, with no unrelated Owner process touched.
- The infrastructure implementation exact is a clean sole child of this docs authority, changes only test/tooling/workflow surfaces, and receives fresh independent Reviewer and QA acceptance before any paused WebChat implementation resumes.
