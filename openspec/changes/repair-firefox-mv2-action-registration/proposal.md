## Why

Real Firefox 153 running the exact production MV2 package reports the same uncaught background error in every observed lifecycle generation: `TypeError: can't access property "onClicked", browser.action is undefined` at `src/app/background/index.ts:38`. The failure occurs after coordinator initialization and `restore()` has started, so unrelated Runtime readiness and traffic can still pass while the extension toolbar action never registers.

The source unconditionally uses the MV3 `browser.action` namespace. WXT emits the production Firefox MV2 package with the legacy `browser_action` manifest surface, whose runtime event is `browser.browserAction`. This is an inherited production compatibility defect, not expected Firefox noise and not an E2E-harness exception. The paused tooling candidate cannot change production source and cannot waive the error, so a narrow product repair must be accepted before a replacement E2E authority and fresh tooling candidate are created.

## What Changes

- Select the action-click event from the production build's declared platform: Chrome MV3 uses `browser.action`; Firefox MV2 uses `browser.browserAction`.
- Register exactly one action-click listener per background generation and route each accepted click exactly once through the existing `AppAction.openOptionsPage()` behavior.
- Treat an absent selected action API as a real startup/acceptance failure with bounded, privacy-safe evidence; do not use optional chaining, silent no-op, or opportunistic cross-platform fallback to hide a mismatched build.
- Add focused deterministic coverage for both platform namespaces, missing selected API, listener uniqueness, and exactly-once command delivery.
- Prove the exact production Chrome MV3 artifact has one error-free action registration/activation, and prove the exact production Firefox MV2 package across initial startup and repeated owned-process restart generations with no action-registration error, one Background Page, working action activation, preserved Runtime readiness/traffic, and zero residual resources.
- Preserve Chrome MV3 action behavior and the existing manifest declarations, permissions, AppAction contract, coordinator/Offscreen/Runtime lifecycle, protocol, storage, UI, and release metadata.
- After the repair exact receives fresh Review and one same-seat real Chrome/Firefox QA PASS, freeze a new superseding E2E docs authority as its clean sole child. Only a fresh tooling implementation child of that later docs exact may resume the runner route.

## Capabilities

### New Capabilities

- `firefox-mv2-action-registration`: Platform-correct, fail-closed extension action registration for production Chrome MV3 and Firefox MV2 background generations.

### Modified Capabilities

None. The existing E2E runner authority remains immutable history and will be superseded only after this product repair is accepted.

## Impact

- Narrow production background action registration and focused deterministic tests.
- Exact-bound real Chrome MV3 and Firefox MV2 action evidence, including Firefox startup/restart generations.
- No E2E runner, fixture, reporter, CI, dependency, manifest/permission, AppAction behavior, Runtime, protocol, persistence, storage/database, content UI, or release change.

## Non-Goals

- No classification of the Firefox exception as expected, inherited-but-benign, warning-only, or non-gating.
- No silent optional listener registration or fallback to whichever namespace happens to exist at runtime.
- No new popup, toolbar UI, options-page flow, action semantics, generic browser-API abstraction, or background lifecycle redesign.
- No modification, freeze, canonical run, evidence reuse, or partial salvage of the paused tooling worktree/candidate.
- No push, PR/CI mutation, merge, release, or Owner checkout change.

## Acceptance Criteria

- A Chrome MV3 production build selects `browser.action`; a Firefox MV2 production build selects `browser.browserAction`; each registers exactly one listener per background generation.
- One toolbar action activation invokes the existing `AppAction.openOptionsPage()` command exactly once, with no duplicate listener or duplicate options-page open after restart.
- A missing selected namespace fails deterministic coverage and acceptance instead of becoming a silent no-op.
- One fresh cross-browser QA seat proves the exact Chrome MV3 artifact has one Service Worker, no action-registration or unexpected extension error, and one real action activation with one options-page result. The same seat proves the exact Firefox MV2 XPI on initial startup and at least two owned-process restart generations: one Background Page per generation, no action-registration or unexpected extension error, one real action activation with one options-page result, preserved Runtime readiness/traffic, and strict zero-residual cleanup on both platforms.
- The product repair is a clean sole child of this docs exact and changes only the authorized production registration boundary plus focused tests. Fresh Review and fresh QA evidence bind only to that immutable exact.
- `6f81011b...`, the paused Coder #268 worktree/candidate, `0756b50...`, earlier runner candidates, and all prior Review/QA/canonical evidence remain diagnostic history and do not transfer.
- After product acceptance, the next E2E docs exact is a clean sole child of the accepted repair. A fresh tooling candidate is then a clean sole child of that new docs exact; the existing paused tooling candidate never resumes.
