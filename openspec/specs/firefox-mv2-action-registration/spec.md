# firefox-mv2-action-registration Specification

## Purpose

TBD - created by archiving change repair-firefox-mv2-action-registration. Update Purpose after archive.

## Requirements

### Requirement: Each production background uses its declared action API

The production background SHALL select its extension action event from the existing build platform identity. Chrome MV3 SHALL use `browser.action.onClicked`; Firefox MV2 SHALL use `browser.browserAction.onClicked`. The implementation SHALL NOT select whichever namespace happens to exist at runtime, fall back across platforms, or use optional chaining to suppress an absent selected API.

The selected namespace and `onClicked.addListener` SHALL be required. If either is absent, background setup and exact-bound acceptance SHALL fail with bounded, privacy-safe platform/phase evidence instead of continuing as if toolbar action registration succeeded.

#### Scenario: Register the Chrome MV3 action

- **GIVEN** a production Chrome MV3 build where `browser.action` exists and `browser.browserAction` is not the declared action API
- **WHEN** one background generation initializes action registration
- **THEN** it SHALL register through `browser.action.onClicked` exactly once and SHALL NOT read or register `browser.browserAction`

#### Scenario: Register the Firefox MV2 browser action

- **GIVEN** a production Firefox MV2 build where `browser.browserAction` exists and `browser.action` is undefined
- **WHEN** one persistent Background Page generation initializes action registration
- **THEN** it SHALL register through `browser.browserAction.onClicked` exactly once without throwing or reading `browser.action.onClicked`

#### Scenario: The selected API is absent

- **WHEN** the production platform branch cannot access its selected action namespace or `onClicked.addListener`
- **THEN** deterministic coverage and exact-bound acceptance SHALL fail explicitly and SHALL NOT treat the missing listener as a warning, expected browser noise, or successful no-op

### Requirement: One action click invokes the existing command exactly once

Each background generation SHALL own exactly one current action-click listener. One accepted toolbar action click SHALL invoke the existing `AppAction.openOptionsPage()` command exactly once. The repair SHALL NOT add another options-page path, popup, tab fallback, retry, debounce, or alternate command.

A terminated Firefox process/Background Page generation SHALL leave no current listener. Its replacement generation SHALL register one new listener, and clicks SHALL NOT accumulate duplicate invocation across initial startup or repeated restart.

#### Scenario: Open the options page from one click

- **GIVEN** the current background generation has registered its platform-correct action listener
- **WHEN** the browser delivers one toolbar action click
- **THEN** the listener SHALL invoke the existing `AppAction.openOptionsPage()` exactly once and produce one options-page result

#### Scenario: Restart the Firefox Background Page generation

- **GIVEN** the initial Firefox generation registered one listener and then its owned process terminated
- **WHEN** the same-profile, same-exact-XPI process restarts and explicitly restores the recorded target
- **THEN** exactly one replacement Background Page SHALL register exactly one current `browser.browserAction` listener, with no old listener or duplicate options-page delivery

### Requirement: The repair preserves manifests, Runtime, and unrelated product behavior

The source repair SHALL preserve the existing WXT manifest declarations and permissions: Chrome MV3 retains its `action` surface and Firefox MV2 retains the generated `browser_action` surface. It SHALL preserve the AppAction contract and options-page behavior, coordinator/provider setup, restore ordering and semantics, Chrome Offscreen relay boundary, Firefox persistent Background Page Runtime, protocol, storage/database, content UI, dependencies, and release metadata.

The implementation MAY add one source-local registration helper only to make platform selection and listener behavior directly testable. It SHALL NOT introduce a generic browser API facade or change unrelated notification, tab, window, action, or Runtime APIs.

#### Scenario: Review the direct repair scope

- **WHEN** the product repair exact is compared with this docs authority
- **THEN** changed production code SHALL be limited to the background action-registration boundary, with only focused tests/support added, while manifests, WXT configuration, dependencies, Runtime, protocol, persistence, UI, and release paths remain byte-identical

#### Scenario: Runtime remains a protected control

- **WHEN** Chrome or Firefox starts after the action repair
- **THEN** its existing coordinator/Runtime readiness and traffic SHALL remain functional, but Runtime success SHALL NOT substitute for proving action registration and one-click delivery

### Requirement: Acceptance binds to a fresh product exact before tooling resumes

This docs authority SHALL be a clean sole child of `ab5278eea3134d3fb4a0755119b2419ccbd03e16`. The product repair SHALL be a clean sole child of this docs exact, contain no E2E runner/fixture/reporter/CI change, and receive one fresh Reviewer PASS plus one fresh cross-browser QA PASS bound to the immutable repair exact.

The same fresh QA seat SHALL first launch the exact production Chrome MV3 artifact in an owned profile and prove exactly one Service Worker, no action-registration or other unexpected extension error, one real toolbar action activation, and exactly one options-page result. It SHALL install the exact production Firefox MV2 package in a separate owned profile and prove initial startup plus at least two owned-process restart generations. Every Firefox generation SHALL have exactly one persistent Background Page, no action-registration or other unexpected extension error, and preserved Runtime readiness/traffic. At least one Firefox generation SHALL perform a real toolbar action activation and observe exactly one options-page result. Cleanup SHALL leave zero owned processes, profiles, packages, ports, listeners, and temporary resources on both platforms without touching unrelated Owner resources.

The paused tooling worktree/candidate, `6f81011b...`, `0756b50...`, and all prior Review, QA, canonical, CI, browser, or cleanup evidence SHALL remain diagnostic only. After repair acceptance, a new superseding E2E docs authority SHALL be the clean sole child of the accepted repair exact; only a fresh tooling sole child of that later docs exact MAY resume the runner route.

#### Scenario: The production repair has not passed fresh gates

- **WHEN** the repair exact lacks fresh Reviewer PASS or the same-seat real Chrome action plus Firefox initial/repeated-restart/action/Runtime/cleanup QA PASS
- **THEN** the E2E tooling route SHALL remain paused and no inherited, dirty, prior-exact, Runtime-only, or warning-suppressed result SHALL release it

#### Scenario: Resume tooling after product acceptance

- **GIVEN** the immutable product repair exact has passed both fresh gates
- **WHEN** PM and Planner resume the runner route
- **THEN** PM SHALL first freeze a new E2E docs authority as that repair exact's sole child, and Planner SHALL route a fresh tooling sole child without copying the paused candidate or its evidence
