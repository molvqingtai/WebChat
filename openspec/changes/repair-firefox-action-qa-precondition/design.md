## Context

The frozen product bytes at BLOCKED exact `f9efac92af9e0c7147f75dd36ec0f1dd67e8183f` select `browser.browserAction.onClicked` for Firefox MV2. Fresh QA observed the exact add-on ID, one running persistent Background Page, one native toolbar click, and one options-page result. The browser started with one tab, however, and `browser.runtime.openOptionsPage()` reused that tab. The action proof therefore consumed the only handle that the harness expected to navigate to an accepted HTTPS target for content Runtime verification.

The run stopped before Firefox generations two and three because canonical retries are forbidden. It establishes neither a product regression nor a transferable partial PASS. It establishes one deterministic harness defect: action verification performed an irreversible native click before ensuring that an independent content control would survive the options transition.

At this exact, repository-owned `e2e/**` consists of `chrome-harness.ts`, `chrome-harness.test.ts`, `chrome-runtime.ts`, and `runtime-bundles.ts`. There is no committed Firefox action harness, no Selenium/geckodriver dependency, and no authorized change to the paused broader runner migration. The repair therefore uses a small dependency-free precondition boundary that a fresh QA action harness can drive through its existing test-owned browser adapter.

## Goals / Non-Goals

**Goals:**

- Make the required content tab a precondition of native Firefox action activation.
- Keep the bound content tab independent from the options destination and usable for real Runtime traffic after the action.
- Rebind real browser handles for every owned-process generation while retaining the same profile and exact XPI.
- Produce deterministic fail-before coverage for the sole-tab topology.
- Keep the repository change limited to two new E2E support files with no dependency or runner changes.
- Preserve exact-bound, no-retry, fresh-review, full-cross-browser acceptance.

**Non-Goals:**

- Change any product action, Runtime, browser manifest, permission, UI, or data behavior.
- Implement or partially resume the full Playwright Test plus Selenium runner authority.
- Add browser libraries, scripts, CI, reporters, aggregation, or general cleanup infrastructure.
- Make the helper click the toolbar action, dispatch extension events, or invoke product commands.
- Import a prior Coder worktree or QA temporary script into the repository.

## Decisions

### 1. The product exact is frozen; only the QA precondition changes

The native Firefox result proves that the repaired product listener can open the options page. The missing content control arose from the harness-owned tab topology. The new implementation may not edit `src/**`, `wxt.config.ts`, generated manifest semantics, package metadata, or any product-facing surface.

The direct implementation whitelist is:

- new `e2e/firefox-action-precondition.ts`
- new `e2e/firefox-action-precondition.test.ts`
- checkbox-only progress updates in this change's `tasks.md`

All pre-existing `e2e/**` files remain byte-identical. If the implementation requires another source, configuration, dependency, script, report, workflow, or product path, it is authority-blocked and must stop for a new decision.

### 2. A generation must have two distinct browser roles before activation

The helper receives a test-owned browser adapter rather than depending on Selenium or geckodriver directly. For the current Firefox process generation it inventories ordinary browser handles, classifies extension options URLs separately, and establishes two distinct roles before returning success:

- a bound content handle navigated to an accepted manifest-covered HTTPS target and capable of the required content Runtime control
- a different ordinary action-recipient handle that may be reused or replaced when Firefox opens the options page

When the browser starts with one ordinary tab, the helper creates or restores only the missing tab needed to establish those roles. It keeps the content handle out of the active recipient role before the toolbar click. It returns the binding needed for the caller to verify that the same content handle remains non-options and usable after the action.

The helper does not create a content tab after action activation to repair a failed topology. If it cannot establish distinct roles, confirm the accepted content target, or retain a valid generation binding, it fails before the caller is permitted to click.

Alternative rejected: click first and create a new content tab afterward. That would repeat the blocked run and erase evidence that the original action consumed the sole control.

Alternative rejected: use the options page for Runtime traffic. Extension-origin options traffic does not prove content injection, page-to-Runtime routing, or the accepted HTTPS content boundary.

### 3. Bindings are exact and generation-scoped

Each binding records the owned profile identity, current process generation, exact package identity, exact add-on ID, accepted target identity, content handle, action-recipient handle, and pre-action tab classification. The caller must reject a binding when any of those facts differs from the active generation.

Firefox restart creates a new process and new WebDriver handles. The helper runs again after the same profile and exact package are restored; it never treats a handle from the previous process as valid. Initial startup plus two restarts therefore produce three separate bindings while retaining one recorded profile identity and one exact XPI/add-on identity.

The precondition may open or navigate only test-owned ordinary tabs. It cannot change profile identity, replace the exact package, reinstall a different add-on, or use a fresh profile to escape a failed restart.

### 4. Native action and Runtime facts remain independently observable

The action caller, not the helper, performs one real WebDriver click on the exact add-on `molvqingtai@gmail.com` Firefox chrome toolbar control. Before the click it records one running persistent Background Page, the options baseline, and successful content Runtime readiness/traffic on the bound handle. After the click it proves `afterOptionsCount - beforeOptionsCount = 1`, confirms the same bound handle is still a non-options accepted page, and completes the required content Runtime control again.

One toolbar click and one options delta are necessary but cannot substitute for content Runtime proof. Likewise, Runtime success cannot substitute for the action result or persistent Background Page proof. All facts bind to the same profile, process generation, package hash, and exact add-on ID.

The harness must not directly dispatch `browserAction.onClicked`, fabricate a WebExtension event, call `AppAction.openOptionsPage()`, navigate a tab to the options URL to manufacture the delta, or count an options-origin Runtime call as content traffic.

### 5. Deterministic controls guard the irreversible boundary

Focused tests use fake adapter state. The fail-before models the observed topology: one ordinary tab is consumed by the options transition, leaving zero accepted non-options content handles. It proves that action authorization is withheld before any click callback can run.

Passing controls cover:

- creating an independent accepted content handle when Firefox begins with a sole action-recipient tab
- preserving an already valid content handle without duplicating it
- keeping content and action-recipient handles distinct
- rejecting options URLs as content controls
- rejecting missing accepted-target or Runtime readiness
- rejecting stale handles, profile/package/add-on mismatches, and prior-generation bindings
- running the same precondition independently for initial startup and two restart generations
- refusing post-action repair as a substitute for a valid pre-action binding

These controls prove the support boundary. They do not certify a production XPI, native toolbar UI, persistent Background Page, process restart, or real Runtime traffic; those remain fresh QA responsibilities.

### 6. Acceptance restarts from zero

This docs exact is a clean sole child of blocked exact `f9efac92af9e0c7147f75dd36ec0f1dd67e8183f`. It inherits those product bytes only. Its implementation must be the clean sole child of this docs exact rather than another direct child of `f9efac9`.

After implementation, one fresh Reviewer validates the helper boundary, fail-before, dependency-free adapter design, scope, and protected paths. One fresh QA seat reruns the whole real Chrome MV3 plus Firefox MV2 matrix from zero. Firefox must complete initial startup and two same-profile owned-process restarts; every generation must prove a real native action, exactly one options delta, one persistent Background Page, and pre/post-action Runtime control on an independent accepted content tab. The same seat owns cleanup and the terminal matrix verdict.

No static, Chrome, Firefox, action, Runtime, Review, QA, or cleanup fact from `f9efac9` or any earlier tooling candidate transfers. The full cross-browser runner migration remains paused until this narrow repair exact is accepted and a later authority explicitly resumes it.

## Risks / Trade-offs

- [A second tab exists but the action still consumes the content tab] -> Bind explicit content and action-recipient roles, make the recipient active, and verify the same content handle remains non-options after the click.
- [A post-click repair hides the original defect] -> Make action authorization conditional on the pre-action binding and forbid post-click tab creation from satisfying it.
- [A restart reuses stale WebDriver handles] -> Scope every binding to one process generation and rebuild it after each restart.
- [Options traffic is mislabeled as content Runtime] -> Require a manifest-accepted HTTPS URL and reject extension-origin options URLs from the content role.
- [A helper grows into a second browser runner] -> Inject the browser adapter, add no dependency or package script, and whitelist only two new support files.
- [Old partial PASS leaks into acceptance] -> Require one new immutable implementation exact and one fresh full same-seat cross-browser run with no retries or transferred evidence.

## Migration Plan

1. Freeze this docs-only authority as the clean sole child of `f9efac9`.
2. Add the deterministic sole-tab fail-before without invoking a real action.
3. Add the dependency-free precondition helper and focused controls in the two whitelisted files.
4. Run implementation-owned focused/full static and docs gates, then freeze one clean detached/ref-free sole-child exact.
5. Route one fresh Reviewer and one fresh QA seat. QA reruns real Chrome and all three real Firefox generations from zero and proves zero residual resources.
6. Only after acceptance may PM freeze a later full E2E-runner authority from the accepted exact; no paused tooling candidate resumes or contributes files/evidence.

Rollback is test-tooling-only: revert the two new precondition files and task progress. A rollback makes Firefox action QA precondition support unavailable and invalidates later evidence that depends on it, while product bytes remain unchanged.

## Open Questions

None. The blocker, allowed files, pre-action topology, generation binding, native action boundary, evidence reset, and protected surfaces are fixed.
