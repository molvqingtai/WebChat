## Context

The production background entry initializes notification and AppAction providers, installs the Runtime coordinator, starts restore, and then registers the toolbar action click through `browser.action.onClicked`. In Chrome MV3 that namespace is valid. In the production Firefox MV2 package, WXT exposes the manifest's legacy `browser_action` surface through `browser.browserAction`; `browser.action` is undefined.

Because `void restore()` has already started before registration throws, the persistent Background Page can still establish Runtime traffic. A Runtime PASS therefore cannot prove toolbar action readiness or convert the uncaught exception into expected browser noise. The failed registration is independently user-visible: the extension action cannot invoke the existing options-page command.

The superseding E2E authority `ab5278eea3134d3fb4a0755119b2419ccbd03e16` intentionally forbids production changes. Its paused tooling child cannot contain this repair. Product compatibility must be fixed and accepted on its own exact before a new E2E authority rebases the tooling route.

## Goals / Non-Goals

**Goals:**

- Bind action registration to the platform API declared by each production artifact.
- Preserve one listener and one existing options-page command per accepted click.
- Fail closed when the selected API is unexpectedly absent.
- Prove Firefox initial and repeated-restart behavior without regressing Chrome.
- Keep the repair exact, review, QA, and later tooling lineage unambiguous.

**Non-Goals:**

- Change action UI, popup/options behavior, permissions, manifest declarations, or WXT configuration.
- Add an abstraction for unrelated WebExtension APIs.
- Change coordinator ordering, Runtime restoration, Offscreen behavior, message protocol, persistence, content UI, or data.
- Edit or reuse the paused tooling candidate.

## Decisions

### 1. The Firefox error is a blocking product defect

The exception is deterministic across six observed Firefox lifecycle generations and identifies a production namespace that does not exist in MV2. It is not a harness-only probe error. Runtime traffic remains useful as a protected control, but it does not cover the missing action listener.

Alternative rejected: allowlist the exact console string because the line is inherited. Inheritance explains provenance, not acceptability; the user-facing command is still unregistered, and an allowlist would make a broken toolbar action indistinguishable from a healthy extension.

### 2. Production build identity selects the action namespace

The source uses the existing compile-time platform identity to select one namespace: `browser.action` for Chrome MV3 and `browser.browserAction` for Firefox MV2. The selected API must contain `onClicked.addListener`; absence is an explicit failure.

Selection is not an opportunistic runtime fallback. Code such as `browser.action ?? browser.browserAction` could hide an artifact/configuration mismatch and would weaken deterministic tests. Optional chaining is also rejected because it silently converts a missing listener into apparent startup success.

The implementation may introduce one small source-local helper only when it makes the two namespace branches directly testable. It must not become a generic browser facade or change the public AppAction contract.

### 3. Listener and click behavior remain singular

Each new background generation registers exactly one action listener. The listener invokes the already-provided `AppAction.openOptionsPage()` once for each accepted click. The repair adds no alternate tab creation, popup, retry, debounce, or new options-page path.

Browser restart creates a new Firefox process and Background Page, so the prior generation disappears with its listener. Repeated restart evidence must show one listener/result in the current generation rather than accumulated or duplicated delivery.

### 4. Deterministic tests and real browsers prove different facts

Focused tests supply isolated browser shapes:

- Chrome shape: `action` exists and `browserAction` does not.
- Firefox shape: `browserAction` exists and `action` does not.
- Failure shapes: the build-selected namespace or `onClicked.addListener` is absent.

The tests prove branch selection, one registration, one command per click, and fail-closed behavior. They do not substitute for a production XPI.

One fresh cross-browser QA seat first launches the exact production Chrome MV3 artifact in an owned profile and verifies one Service Worker, no action-registration/unexpected extension error, and one real toolbar action activation with one options-page result. The same seat installs the exact Firefox MV2 package into an owned profile, observes initial startup plus at least two owned-process restart generations, and verifies one Background Page, no action-registration/unexpected extension error, real action activation with one options-page result, preserved Runtime readiness/traffic, and zero residual resources on both platforms.

### 5. Product repair precedes a new E2E authority

This docs exact is a clean sole child of `ab5278eea3134d3fb4a0755119b2419ccbd03e16`. The product repair is a clean sole child of this docs exact and contains only the narrow production registration boundary and focused tests.

One fresh Reviewer and one fresh cross-browser QA seat validate the immutable repair exact. The Reviewer owns source logic, scope, manifest/config protection, and deterministic evidence. The same QA seat owns the exact production Chrome MV3 and Firefox MV2 artifacts, real action activation on both, repeated Firefox restart/Runtime evidence, and cleanup. Neither seat may import verdicts from the paused tooling candidate.

After both pass, PM freezes a new superseding E2E docs authority as the clean sole child of the accepted repair exact. Planner then creates a fresh tooling implementation task whose candidate is the clean sole child of that later docs exact. Coder #268's current worktree/candidate stays paused and is never resumed, rebased, copied, or used as evidence.

## Risks / Trade-offs

- [Runtime traffic conceals failed action registration] -> Assert the selected namespace, listener, real action result, and unexpected-error inventory separately from Runtime readiness.
- [A runtime fallback hides a mismatched artifact] -> Select from compile-time platform identity and fail when that exact namespace is absent.
- [Restart accumulates listeners or duplicate opens] -> Require one Background Page, one current-generation listener, and one options-page result per action.
- [The narrow fix grows into browser API infrastructure] -> Permit only source-local testability and protect unrelated APIs, manifests, Runtime, and UI.
- [Paused tooling evidence leaks into product acceptance] -> Treat the dirty pre-freeze candidate and every prior exact as diagnostic only; require fresh exact-bound Review and QA.
- [Tooling resumes from the wrong parent] -> Freeze a new E2E docs exact only after product acceptance, then require a fresh sole child.

## Migration Plan

1. Freeze this docs authority as the clean sole child of `ab5278e`.
2. Add deterministic fail-before coverage for Firefox MV2's missing `browser.action` and the unregistered click path.
3. Implement platform-selected action registration and focused Chrome/Firefox/missing-API/uniqueness tests without changing protected surfaces.
4. Freeze one immutable product repair exact and obtain fresh Review.
5. Run one fresh exact-bound cross-browser QA seat through real Chrome MV3 action proof and real Firefox MV2 initial plus repeated-restart action/Runtime proof, with zero residual cleanup on both.
6. After both pass, freeze a new E2E docs authority as the repair exact's sole child and route fresh tooling from that later docs exact.

Rollback is source-local: revert the registration repair and its tests. Doing so restores the Firefox defect and invalidates all later E2E/tooling eligibility; no accepted evidence may survive the rollback.

## Open Questions

None. The production error is blocking, the namespace mapping is determined by the existing Chrome MV3/Firefox MV2 artifact split, and the product-first lineage is fixed.
