## Context

QA task #287 bound immutable exact `1b1f6cc61d7de9adc75bca0cc1b3768d90555e04`. Its automated and production-package gates passed, and Firefox 152 MV2 completed initial startup plus two same-profile owned-process restarts. Chrome 150 loaded exact extension ID `fignfifoniblkonapihmkfakmlgkbkcf` and exposed its Service Worker, but the QA control observed no mounted content Runtime on `https://example.com/` within 30 seconds. The action precondition correctly withheld the native click.

The Chrome control started the accepted URL in the browser command line together with `--load-extension`, then found the existing page and attached CDP listeners. It captured later `Runtime.exceptionThrown` events but not execution-context creation, console calls, target/frame lifecycle, or a terminal DOM timeline. Product `src/app/content/index.tsx` waits for `initClient()` before creating the WXT shadow UI and logs `Shared runtime unavailable` before returning on failure. Consequently, `mounted=false` plus an empty late exception list is compatible with at least three causes:

1. the content script never received a page-bound isolated execution context;
2. the content script ran, but `initClient()` failed and returned before mount;
3. initialization did not report that failure, but WXT shadow mounting did not create the expected root.

Static evidence cannot choose among them. The exact manifest covers `https://*/*` at `document_idle`, the accepted URL is not excluded, and the product/manifest/established Chrome E2E bytes are unchanged from the parent. The repository's existing `e2e/chrome-runtime.ts` demonstrates the useful lifecycle shape: start at `about:blank`, establish target discovery and auto-attach, then call `Target.createTarget` for the accepted page. It is evidence for the diagnostic design, not an implementation file that this change may modify.

## Goals / Non-Goals

**Goals:**

- Remove the Chrome accepted-page startup race from the verification control.
- Preserve enough ordered, target-bound evidence to distinguish injection, shared-Runtime initialization, WXT mount, and clean mounted outcomes.
- Withhold the irreversible native toolbar action until a clean mounted content control exists.
- Make the classification deterministic and fail closed under missing, foreign, late, contradictory, or oversized evidence.
- Keep the implementation to one new adapter-driven helper and one focused test with no dependency or existing-runner change.
- Require fresh exact-bound Review and a complete fresh cross-browser QA matrix.

**Non-Goals:**

- Repair or change any product, manifest, WXT, Runtime, action, timeout, or browser behavior.
- Generalize the diagnostic into the canonical cross-browser runner, a CDP library, reporter, or cleanup framework.
- Modify or extract code from the existing Chrome Runtime harness.
- Let the implementation seat run the canonical browser matrix.
- Carry forward any partial PASS from QA task #287.

## Decisions

### 1. The blocked source exact is frozen and receives a docs-only child

This authority is created directly from `1b1f6cc61d7de9adc75bca0cc1b3768d90555e04`. That parent contributes repository bytes only. Its fresh Reviewer PASS, Firefox PASS, automated gates, Chrome failure, and cleanup evidence remain exact-local history and do not satisfy any later gate.

The direct implementation whitelist is:

- new `e2e/chrome-native-action-lifecycle.ts`
- new `e2e/chrome-native-action-lifecycle.test.ts`
- checkbox-only updates in this change's `tasks.md`

Every existing tracked path is protected, including all current `e2e/**`, both Firefox precondition files, `src/**`, WXT/manifest/configuration, dependencies and lockfile, package scripts, workflows/CI, reports, release metadata, and the Owner checkout. A need to edit an existing helper or add a third implementation file is an authority stop.

Alternative rejected: patch QA task #287's temporary script and treat the result as a rerun. The first terminal result is immutable, the script is not a repository authority, and the missing evidence must be specified before another canonical run.

Alternative rejected: modify `e2e/chrome-runtime.ts` because it already uses the desired startup order. That file owns a broader production Runtime suite; coupling native-action diagnosis to it would expand the blast radius and alter a protected accepted harness.

### 2. Observation is established before the only accepted target is created

The caller starts an owned Chrome/Chromium process with the exact unpacked production package, an isolated test profile, and `about:blank` as the only startup page. It must not pass any accepted HTTPS URL on the command line.

After the CDP endpoint is available, the adapter registers its event sink before enabling target discovery and flattened auto-attach. Every attached relevant session enables Runtime and Log observation; page sessions additionally enable Page navigation and lifecycle observation. The diagnostic confirms those capabilities are ready before authorizing accepted-target creation.

Before an accepted page exists, the adapter binds exactly one production-extension Service Worker. It verifies that the worker URL origin and worker-evaluated `chrome.runtime.id` are the same extension ID, binds the package digest, and compares `chrome.runtime.getManifest()` with the packaged manifest through canonical structured deep equality rather than prose or substring matching. A missing, foreign, duplicate, unresponsive, or mismatched worker/manifest ends in a pre-target setup failure and creates no accepted target.

Only after that fence may the helper request exactly one `Target.createTarget({ url: 'https://example.com/' })`. This planned first content target is not a refresh, reload, or post-click repair. The helper records its target ID and then binds only the corresponding attached session, main frame, navigation, isolated context, logs, and DOM samples. It never calls `Page.navigate`, creates a second accepted target, or substitutes a different page when the target fails.

### 3. One exact binding owns the entire lifecycle

The diagnostic binding contains at least:

- immutable candidate exact and production-package digest;
- owned profile and Chrome process generation;
- browser version and executable identity;
- extension ID, Service Worker target/session, and normalized manifest identity;
- exact accepted URL `https://example.com/`;
- accepted page target, session, main-frame, and navigation identities;
- page-bound extension isolated-context identity and origin when present;
- one monotonic event sequence and one absolute lifecycle deadline.

An isolated context counts only when it is attached to the bound page target and main frame and its origin identifies the bound extension. A worker, options, unrelated page, host-page main-world, prior target, or foreign-extension context cannot satisfy content injection.

The lifecycle has one non-resetting maximum 30-second budget beginning with the authorized `Target.createTarget` request. Target attach, navigation, context, Runtime signal, and DOM polling consume that same budget. No phase receives a fresh timeout, and increasing a product, ClientLease, or existing-runner timeout is not an allowed repair.

### 4. Evidence is complete for the bounded observation window and privacy-limited

The helper records a monotonic timeline from the pre-target observation fence through the terminal classification. It includes:

- worker and manifest verification;
- target create/attach/change/destroy events;
- main-frame navigation and Page lifecycle events;
- Runtime execution-context creation/destruction for the bound page;
- normalized console calls and exceptions with target/session/context identity;
- bounded DOM samples and an unconditional terminal sample attempt that records either the final structure or why the bound target could not be sampled.

DOM evidence is structural only: current URL, `document.readyState`, presence of body, shadow-host/shadow-root counts, an extension-shadow `#root` count, and Runtime-unavailable marker state where observable. A host-page light-DOM `#root` or an unrelated shadow root is not an extension mount. The helper does not dump page text, HTML, cookies, storage, credentials, arbitrary objects, or user data.

Console arguments and exception stacks are normalized into JSON-safe bounded strings and types. The implementation defines per-event and total-event caps. Overflow, serialization failure, missing final state, or contradictory target/context evidence is a terminal diagnostic failure, not permission to discard earlier evidence or infer success. The tool may claim completeness only for the observation window after its listener/enable fence; it must not claim recovery of process-start logs that predate CDP attachment.

### 5. Terminal classification is mutually exclusive and fail closed

The diagnostic emits one immutable terminal outcome with its evidence:

- `extension-setup-failed`: exact worker/manifest observation did not pass before target creation;
- `target-lifecycle-failed`: the sole target did not attach/navigate as bound, was replaced/destroyed, or evidence identities diverged;
- `content-context-absent`: the target completed its bounded lifecycle without a page-bound isolated context for the exact extension;
- `shared-runtime-unavailable`: the exact isolated context existed and its normalized console/exception stream contained the product's `Shared runtime unavailable` signal;
- `content-mount-absent`: the exact isolated context existed, no Runtime-unavailable or other unexpected content error occurred, but no extension-shadow `#root` appeared by the deadline;
- `unexpected-content-failure`: a page-bound extension exception, unexpected error, evidence overflow, or contradictory content state prevents a narrower safe classification;
- `mounted`: the exact isolated context appeared, no blocking Runtime/unexpected error occurred, and one extension-shadow `#root` was observed on the same target within the budget.

Outcome precedence is fail closed. A Runtime-unavailable or unexpected error cannot be erased by a later DOM observation. Missing context cannot be inferred from missing DOM alone. A host-page root, options root, worker context, or foreign target cannot produce `mounted`.

The first terminal outcome is final for that run. The helper does not refresh, reload, retry, extend the deadline, create another target, or allow later evidence to rewrite the classification.

### 6. The diagnostic gates but does not perform the native action

Only `mounted` returns action authorization. Every other outcome withholds it before any native click callback may run. The authorization is bound to the same candidate, package, profile, process generation, extension, target, session, frame, isolated context, accepted URL, and terminal evidence digest.

The helper never clicks the toolbar, dispatches `chrome.action.onClicked`, invokes `AppAction.openOptionsPage()`, or navigates to options. Fresh QA owns one real native toolbar action only after authorization, proves `afterOptionsCount - beforeOptionsCount = 1`, and performs post-action Runtime control on the same accepted target. A new target, reload, manual navigation, or content repair after failure cannot retroactively authorize the action.

### 7. Deterministic controls cover chronology, identity, and classification

Focused tests use an injected fake adapter and virtual clock. At minimum they prove:

- listeners and per-session domains are ready before the sole target creation;
- an accepted page supplied at startup is rejected rather than adopted;
- missing, duplicate, foreign, or manifest-mismatched workers fail before target creation;
- a second target request, target replacement, wrong session/frame, foreign context, late evidence, and deadline reset fail closed;
- worker/options/main-world/foreign-page contexts cannot satisfy injection;
- `Shared runtime unavailable` wins over later mount evidence and routes to the Runtime branch;
- isolated context with no blocking error and no extension-shadow root routes to mount absence;
- a host-page or unrelated shadow `#root` cannot produce `mounted`;
- unexpected exception, overflow, missing final DOM, retry, reload, or repair withholds action;
- one clean target/context/root timeline produces one authorization and no action invocation from the helper.

These controls prove the support boundary but do not certify a real production package, CDP connection, native toolbar action, or cleanup. Those remain fresh QA obligations.

### 8. Acceptance restarts the full cross-browser matrix

After the implementation exact freezes, one fresh Reviewer examines only that exact's code, controls, path scope, and protected surfaces. A fresh QA seat creates a new clean detached worktree and new owned browser resources.

Chrome must independently run the new lifecycle from `about:blank`, bind the exact worker/manifest, create the accepted target once, preserve the full diagnostic artifact, reach `mounted`, perform one real native toolbar action, prove `afterOptionsCount - beforeOptionsCount = 1` and post-action content Runtime on the same target, report no unexpected extension/browser error, and clean every owned resource.

The same QA seat reruns Firefox MV2 initial startup plus two same-profile owned-process restarts with all existing native-action, options-delta, Runtime, identity, and cleanup requirements. The prior task #287 Firefox PASS is not reusable. The first terminal failure in either browser stops the matrix; there is no canonical retry or partial-result aggregation.

## Risks / Trade-offs

- [The new helper becomes another general Chrome runner] -> Keep executable discovery, build, native click, report aggregation, and global cleanup outside the helper; whitelist only one helper and one test.
- [Auto-attach still misses process-start worker logs] -> Claim completeness only after the explicit observation fence and require worker Runtime/manifest verification before the accepted target; do not infer from unavailable earlier history.
- [A host page happens to contain `#root`] -> Require a root inside the extension-created shadow UI on the bound target after the exact isolated context appears.
- [A later mount erases a real Runtime failure] -> Give Runtime-unavailable and unexpected-error evidence precedence over mounted authorization.
- [Event capture leaks or grows without bound] -> Normalize and cap logs, record structural DOM only, and fail closed on overflow instead of truncating into PASS.
- [The single target fails transiently] -> Preserve the terminal diagnostic and stop; retry would change the evidence and is a new run, not a repair.
- [A narrow implementation needs an existing CDP helper edit] -> Stop for new authority; do not silently expand into protected Chrome harness files.
- [Firefox PASS is treated as reusable] -> Require the next same-seat QA to rerun all three Firefox generations from zero.

## Migration Plan

1. Freeze this docs-only authority as the clean sole child of `1b1f6cc61d7de9adc75bca0cc1b3768d90555e04`.
2. Add deterministic fail-before controls for startup-page reuse, late observation, foreign identities, Runtime-unavailable, false root, and retry/repair.
3. Add the dependency-free adapter-driven diagnostic in the two whitelisted files without touching any existing E2E or product path.
4. Run implementation-owned focused/full static, formatting, OpenSpec, production build/package/manifest, scope, and lineage gates; do not run canonical browsers from the implementation seat.
5. Freeze one immutable clean sole-child implementation exact.
6. Route one fresh Reviewer. Only after Review PASS, route one fresh QA seat through the complete Chrome MV3 plus Firefox MV2 matrix from zero.
7. If the new evidence selects a product-owned branch, freeze a separate product authority from the accepted diagnostic lineage. Do not modify product code under this change.

Rollback is tooling-only: revert the two new diagnostic files and task progress. Rollback removes repository-owned Chrome lifecycle classification and invalidates evidence that depends on it; it does not change product bytes.

## Open Questions

None. The lineage, two-file whitelist, observation order, single-target rule, evidence bounds, terminal branches, action gate, protected surfaces, and fresh acceptance route are fixed.
