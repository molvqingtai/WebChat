## Context

QA task #287 bound immutable exact `1b1f6cc61d7de9adc75bca0cc1b3768d90555e04`. Its automated and production-package gates passed, and Firefox 152 MV2 completed initial startup plus two same-profile owned-process restarts. Chrome 150 loaded exact extension ID `fignfifoniblkonapihmkfakmlgkbkcf` and exposed its Service Worker, but the QA control observed no mounted content Runtime on `https://example.com/` within 30 seconds. The action precondition correctly withheld the native click.

The Chrome control started the accepted URL in the browser command line together with `--load-extension`, then found the existing page and attached CDP listeners. It captured later `Runtime.exceptionThrown` events but not execution-context creation, console calls, target/frame lifecycle, or a terminal DOM timeline. Product `src/app/content/index.tsx` waits for `initClient()` before creating the WXT shadow UI and logs `Shared runtime unavailable` before returning on failure. Consequently, `mounted=false` plus an empty late exception list is compatible with at least three causes:

1. the content script never received a page-bound isolated execution context;
2. the content script ran, but `initClient()` failed and returned before mount;
3. initialization did not report that failure, but WXT shadow mounting did not create the expected root.

Static evidence cannot choose among them. The exact manifest covers `https://*/*` at `document_idle`, the accepted URL is not excluded, and the product/manifest/established Chrome E2E bytes are unchanged from the parent. The repository's existing `e2e/chrome-runtime.ts` demonstrates the useful lifecycle shape: start at `about:blank`, establish target discovery and auto-attach, then call `Target.createTarget` for the accepted page. It is evidence for the diagnostic design, not an implementation file that this change may modify.

The first diagnostic implementation exact `bfdbfa3665a060443175ad54dd7eefb320199e79` received fresh Review and entered QA task #298. Its automated/static/OpenSpec/build/package/manifest gates passed. The only Chrome run then stopped before accepted-target creation: a pre-helper adapter waited for an arbitrary extension Service Worker, derived an `extensionId` from that worker's URL, and supplied that ID to a helper whose exact-worker predicate trusted the same ID. The evaluated manifest disagreed with the packaged WebChat manifest, so the helper correctly emitted `extension-setup-failed` and the action count stayed zero.

Read-only task #299 located the earliest discrepancy in worker discovery authority. The package chain is internally consistent: the MV3 manifest declares `background.service_worker = background.js`, the package contains `background.js`, and it contains no `service_worker.js`. QA did not retain the worker-evaluated manifest, canonical digest, or field-level diff. The evidence therefore supports a discovery/selection control gap only; it does not support a WebChat package defect or any semantic Runtime-manifest normalization.

Round 18 source exact `3ae2b81ebaf31dfd368affabdd387fe204929420` incorporated the package-first authority and received fresh source Review PASS. Fresh QA task #309 passed all automated/static/OpenSpec/build/package/manifest/integrity gates, then its only Chrome canonical stopped before `READY`. Its temporary `chrome-canonical.mjs` hardcoded branded Google Chrome 150. The 30-second worker window classified only the foreign Google Network Speech worker; no WebChat target/session appeared, so the helper correctly emitted `extension-setup-failed`, null authorization, and zero native actions. QA did not refresh, repair, retry, or start Firefox.

Read-only task #310 found the control boundary: repository canonical `e2e/chrome-runtime.ts` and CI require the caller to supply side-load-capable Chrome for Testing or Chromium, but the temporary adapter bypassed that requirement. The exact package remains internally consistent, CDP discovery was ready before the foreign worker appeared, and no evidence supports a helper-timing or helper-source repair. The missing exact worker under branded Chrome is therefore a QA setup/precondition blocker, not a product, package, activation, observation, or helper verdict under a supported executable.

## Goals / Non-Goals

**Goals:**

- Remove the Chrome accepted-page startup race from the verification control.
- Make the packaged manifest, rather than a caller-provided or first-observed worker ID, the root of exact-worker authority.
- Preserve enough bounded worker-manifest evidence to diagnose any future strict mismatch without inventing normalization.
- Preserve enough ordered, target-bound evidence to distinguish injection, shared-Runtime initialization, WXT mount, and clean mounted outcomes.
- Withhold the irreversible native toolbar action until a clean mounted content control exists.
- Make the classification deterministic and fail closed under missing, foreign, late, contradictory, or oversized evidence.
- Make canonical Chrome executable authority explicit and auditable before any browser lifecycle: accept only caller-injected Chrome for Testing or Chromium and reject branded Chrome/Edge or any discovery/default/fallback path.
- Keep executable validation outside the helper and distinguish harness precondition failure from the helper's seven product-lifecycle outcomes.
- Keep the implementation to one new adapter-driven helper and one focused test with no dependency or existing-runner change.
- Require fresh exact-bound Review and a complete fresh cross-browser QA matrix.

**Non-Goals:**

- Repair or change any product, manifest, WXT, Runtime, action, timeout, or browser behavior.
- Generalize the diagnostic into the canonical cross-browser runner, a CDP library, reporter, or cleanup framework.
- Modify or extract code from the existing Chrome Runtime harness.
- Let the implementation seat run the canonical browser matrix.
- Modify the Round 18 helper or focused-test bytes, add a third tracked adapter, or encode executable discovery/validation inside the helper.
- Treat branded Chrome/Edge, a path-derived product guess, or successful process launch as canonical side-load evidence.
- Treat `service_worker.js` as a WebChat path, change product/package generation, or allow manifest defaults/aliases/path rewrites without fresh evidence and new authority.
- Carry forward any partial PASS from QA task #287, QA task #298, QA task #309, or any blocked implementation.

## Decisions

### 1. The package-first docs exact receives a superseding docs-only child

This authority is created directly from package-first docs exact `74d0c67eaf24f68bf731c8c9205cea7aa6c6792c`. That parent contributes repository bytes only. Round 18 implementation `3ae2b81ebaf31dfd368affabdd387fe204929420`, QA task #309, blocked `bfdbfa3665a060443175ad54dd7eefb320199e79`, and every intermediate candidate are neither parents nor evidence sources for later acceptance. QA tasks #287, #298, and #309 and all prior Review/static/browser results remain exact-local history and satisfy no later gate.

The direct implementation whitelist is:

- new `e2e/chrome-native-action-lifecycle.ts`
- new `e2e/chrome-native-action-lifecycle.test.ts`
- checkbox-only updates in this change's `tasks.md`

The two added files must be byte-identical to Round 18 source: helper SHA-256 `6763e476722dd7b7675820b753806ea5908e13560eeef328a15d6ce4c27ff160` and focused-test SHA-256 `9f4a27172bf0f60446dd5f1c5776d14df95dc4c295e1c49c0e9d019eb7f2baa5`. This is a source constraint, not transfer of its Reviewer or QA verdicts.

Every existing tracked path is protected, including all current `e2e/**`, both Firefox precondition files, `src/**`, WXT/manifest/configuration, dependencies and lockfile, package scripts, workflows/CI, reports, release metadata, and the Owner checkout. The real adapter is a test-owned, SHA-256-frozen QA artifact outside tracked repository scope. A need to change either recorded source digest, edit an existing helper, or add a third tracked implementation file is an authority stop.

Alternative rejected: patch QA task #298's temporary adapter and rerun `bfdbfa3`. The first terminal result is immutable, the adapter is not repository authority, the helper interface itself must not accept circular ID authority, and the missing manifest evidence must be specified before another canonical run.

Alternative rejected: amend or parent a repair on `bfdbfa3`. It is immutable QA-BLOCKED and contains an interface whose worker identity root is insufficient. The next implementation must be a fresh sole child of this superseding docs exact.

Alternative rejected: modify `e2e/chrome-runtime.ts` because it already uses the desired startup order. That file owns a broader production Runtime suite; coupling native-action diagnosis to it would expand the blast radius and alter a protected accepted harness.

Alternative rejected: rerun QA task #309 with a different browser. Its first canonical result is immutable. A supported executable requires a new adapter artifact, new source exact, fresh Review, and fresh QA from zero.

### 2. Executable authority is explicit and precedes every Chrome lifecycle

The real test-owned adapter accepts exactly one executable path injected by its caller. The value must be absolute. The adapter has no branded application hardcode, executable default, `PATH` lookup, application-directory scan, browser discovery, fallback, or reuse of an Owner browser. Raw paths are transient launch inputs, not report fields.

Before it creates a persistent profile, starts a CDP browser, begins either 30-second helper budget, or invokes the helper, the adapter uses one non-resetting maximum 10-second executable-precondition budget to:

1. resolve the requested path with `realpath`;
2. require a regular file with execute access;
3. compute SHA-256 identities for the requested path string, canonical path string, and executable bytes;
4. run exactly one bounded `--version` probe against the canonical path; and
5. require an exact product label of `Google Chrome for Testing <version>` or `Chromium <version>` with a non-empty version.

`Google Chrome`, `Microsoft Edge`, any other derivative or unknown label, relative/missing/non-executable input, a symlink whose canonical target is rejected, non-zero probe exit, timeout, output beyond 512 bytes, ambiguous output, or a probe/launch canonical-path mismatch ends `chrome-executable-precondition-failed`. The adapter cleans the probe and proves that no persistent profile, CDP connection, worker discovery, accepted target, helper timeline, or native action started. It does not translate this result to `extension-setup-failed` or another helper outcome.

An accepted record contains only the allowlisted product family, parsed version, requested-path digest, canonical-path digest, executable-byte digest, bounded version-output digest, and a derived privacy-safe executable identity token. The raw absolute path remains in adapter memory only long enough to launch exactly that canonical executable. The helper receives the privacy-safe identity token in its existing browser-executable context field and remains byte-identical.

Passing this executable precondition proves only that the browser family is supported for canonical side-loading. The unchanged package-first worker fence must still observe and bind the exact packaged worker. If a fresh run with an accepted executable still reaches the worker deadline without that worker, the result is new activation/observation evidence for a separate authority; the adapter does not retry, select another executable, or reinterpret task #309.

### 3. Package-first worker discovery and observation precede the accepted target

After the executable precondition passes, the caller starts one owned Chrome for Testing or Chromium process at the validated canonical path with the exact unpacked production package, an isolated test profile, and `about:blank` as the only startup page. It must not pass any accepted HTTPS URL on the command line.

After the CDP endpoint is available, the adapter registers its event sink before enabling target discovery and flattened auto-attach. Every attached relevant session enables Runtime and Log observation; page sessions additionally enable Page navigation and lifecycle observation. The diagnostic confirms those capabilities are ready before authorizing accepted-target creation.

Before any worker can become exact, the helper parses the packaged manifest as structured JSON and requires `manifest_version === 3`, an object-valued `background`, and a non-empty string `background.service_worker`. The helper receives the immutable candidate exact, package digest, and parsed packaged manifest; it does not receive or trust an expected extension ID from the caller.

Manifest canonicalization is deliberately narrow. The canonical serializer recursively sorts object keys, preserves array order and every JSON primitive exactly, omits no field, inserts no default, resolves no alias, and rewrites no path or value. Its identity is the SHA-256 digest of the UTF-8 canonical JSON. The only accepted worker-entry relation is an exact `chrome-extension://<runtimeId>/<packaged background.service_worker>` URL with no query or fragment. A difference beyond object-key order is a mismatch. New browser-generated normalization may be authorized only after a fresh run preserves the exact structured difference and PM freezes a new rule.

The helper then owns one finite, non-resetting, maximum 30-second pre-target discovery deadline. It classifies every observed extension Service Worker only after the observation fence and records, under fixed per-worker and total caps:

- monotonic appearance order and relative time;
- worker target URL and attached target/session identity;
- evaluated `chrome.runtime.id`;
- allowlisted `manifest_version`, `name`, `version`, and `background` projection;
- packaged and Runtime canonical SHA-256 digests;
- a sorted, capped JSON Pointer diff plus an explicit diff-overflow flag. Raw values are retained only for the allowlisted projection; other differing values are represented by JSON type, length, and digest.

An exact candidate must simultaneously have a `chrome-extension:` worker URL, a non-empty evaluated Runtime ID equal to the URL host, the exact packaged worker-entry path, and a Runtime manifest canonically equal to the packaged manifest. A decision fence cannot close while a currently observed worker probe is unresolved. Zero exact candidates continues observation until the single deadline; zero at the deadline, more than one at any decision fence, total worker-record capacity overflow, or an unclassifiable candidate ends `extension-setup-failed` before target creation. A capped diff may record overflow for a manifest already proven non-equal by its canonical digest; that worker remains non-exact evidence and does not block a separate unique exact worker.

Foreign workers may appear before or after the exact worker. Once fully classified as non-exact they remain bounded evidence only: they do not count toward exact cardinality, supply an ID, or replace the binding. When one exact candidate exists and all current probes are resolved, the helper derives the extension ID from that candidate and binds its target, session, ID, entry, and manifest digest. A later worker probe uses only the remaining pre-target budget before target creation or the remaining lifecycle budget afterward; it receives no new deadline. An unresolved later worker, a second exact candidate, destruction/replacement of the exact worker, or any bound ID/entry/manifest change is a continuity failure; the helper never rebinds.

Only after that fence may the helper request exactly one `Target.createTarget({ url: 'https://example.com/' })`. This planned first content target is not a refresh, reload, or post-click repair. The helper records its target ID and then binds only the corresponding attached session, main frame, navigation, isolated context, logs, and DOM samples. It never calls `Page.navigate`, creates a second accepted target, or substitutes a different page when the target fails.

### 4. One exact binding owns the entire lifecycle

The diagnostic binding contains at least:

- immutable candidate exact and production-package digest;
- owned profile and Chrome process generation;
- allowlisted browser product family/version and the privacy-safe executable identity record bound by the precondition;
- packaged worker entry and packaged manifest canonical digest;
- derived extension ID, Service Worker target/session, evaluated entry, and Runtime manifest canonical digest;
- completed pre-target worker evidence fence and its absolute deadline;
- exact accepted URL `https://example.com/`;
- accepted page target, session, main-frame, and navigation identities;
- page-bound extension isolated-context identity and origin when present;
- one monotonic event sequence and one absolute lifecycle deadline.

An isolated context counts only when it is attached to the bound page target and main frame and its origin identifies the bound extension. A worker, options, unrelated page, host-page main-world, prior target, or foreign-extension context cannot satisfy content injection.

The bound worker target/session/ID/entry/manifest tuple remains immutable through lifecycle classification and authorization. A classified unrelated worker may be added to the timeline, but it cannot alter that tuple. A second exact candidate, disappearance followed by a new exact target/session, or a changed evaluated identity fails closed rather than being treated as worker wake-up or continuity.

The lifecycle has one non-resetting maximum 30-second budget beginning with the authorized `Target.createTarget` request. Target attach, navigation, context, Runtime signal, and DOM polling consume that same budget. No phase receives a fresh timeout, and increasing a product, ClientLease, or existing-runner timeout is not an allowed repair.

### 5. Evidence is complete for the bounded observation window and privacy-limited

The helper records a monotonic timeline from the pre-target observation fence through the terminal classification. It includes:

- every bounded worker appearance, probe result, manifest projection/digest/diff, exact-candidate decision, and bound-worker continuity event;
- target create/attach/change/destroy events;
- main-frame navigation and Page lifecycle events;
- Runtime execution-context creation/destruction for the bound page;
- normalized console calls and exceptions with target/session/context identity;
- bounded DOM samples and an unconditional terminal sample attempt that records either the final structure or why the bound target could not be sampled.

DOM evidence is structural only: current URL, `document.readyState`, presence of body, shadow-host/shadow-root counts, an extension-shadow `#root` count, and Runtime-unavailable marker state where observable. A host-page light-DOM `#root` or an unrelated shadow root is not an extension mount. The helper does not dump page text, HTML, cookies, storage, credentials, arbitrary objects, or user data.

Console arguments and exception stacks are normalized into JSON-safe bounded strings and types. The implementation defines per-event and total-event caps. Overflow, serialization failure, missing final state, or contradictory target/context evidence is a terminal diagnostic failure, not permission to discard earlier evidence or infer success. The tool may claim completeness only for the observation window after its listener/enable fence; it must not claim recovery of process-start logs that predate CDP attachment.

Worker evidence is extension metadata only. It excludes storage, permissions-derived runtime data, cookies, credentials, user data, arbitrary evaluated objects, and manifest raw values outside the allowlisted projection. A JSON-path diff that exceeds its cap records a diff-overflow marker and remains non-equal by canonical digest; it is never truncated into canonical equality. Overflow of the total worker-record capacity still fails setup because the inventory is no longer complete.

### 6. Terminal classification is mutually exclusive and fail closed

The diagnostic emits one immutable terminal outcome with its evidence:

- `extension-setup-failed`: packaged-manifest validation, bounded worker discovery, unique exact-candidate selection, canonical manifest relation, or bound-worker continuity did not pass;
- `target-lifecycle-failed`: the sole target did not attach/navigate as bound, was replaced/destroyed, or evidence identities diverged;
- `content-context-absent`: the target completed its bounded lifecycle without a page-bound isolated context for the exact extension;
- `shared-runtime-unavailable`: the exact isolated context existed and its normalized console/exception stream contained the product's `Shared runtime unavailable` signal;
- `content-mount-absent`: the exact isolated context existed, no Runtime-unavailable or other unexpected content error occurred, but no extension-shadow `#root` appeared by the deadline;
- `unexpected-content-failure`: a page-bound extension exception, unexpected error, evidence overflow, or contradictory content state prevents a narrower safe classification;
- `mounted`: the exact isolated context appeared, no blocking Runtime/unexpected error occurred, and one extension-shadow `#root` was observed on the same target within the budget.

Outcome precedence is fail closed. A Runtime-unavailable or unexpected error cannot be erased by a later DOM observation. Missing context cannot be inferred from missing DOM alone. A host-page root, options root, worker context, or foreign target cannot produce `mounted`.

The first terminal outcome is final for that run. The helper does not refresh, reload, retry, extend the deadline, create another target, or allow later evidence to rewrite the classification.

### 7. The diagnostic gates but does not perform the native action

Only `mounted` returns action authorization. Every other outcome withholds it before any native click callback may run. The authorization is bound to the same candidate, package, packaged manifest digest/entry, worker target/session/ID/Runtime-manifest digest, profile, process generation, page target/session/frame/context, accepted URL, and terminal evidence digest.

The helper never clicks the toolbar, dispatches `chrome.action.onClicked`, invokes `AppAction.openOptionsPage()`, or navigates to options. Fresh QA owns one real native toolbar action only after authorization, proves `afterOptionsCount - beforeOptionsCount = 1`, and performs post-action Runtime control on the same accepted target. A new target, reload, manual navigation, or content repair after failure cannot retroactively authorize the action.

### 8. Deterministic controls cover chronology, identity, and classification

Focused tests use an injected fake adapter and virtual clock. At minimum they prove:

- listeners and per-session domains are ready before the sole target creation;
- an accepted page supplied at startup is rejected rather than adopted;
- foreign-first/exact-late discovery succeeds without letting the foreign worker supply identity;
- only-foreign, duplicate-exact, unresolved-candidate, entry mismatch, Runtime-ID mismatch, and manifest mismatch fail before target creation;
- differently ordered object keys with otherwise identical JSON are accepted, while any array, value, field-presence, default, alias, or path difference is rejected;
- an unrelated worker after binding remains evidence only, while an exact duplicate/replacement or bound target/session/ID/entry/manifest change fails closed;
- a second target request, target replacement, wrong session/frame, foreign context, late evidence, and deadline reset fail closed;
- worker/options/main-world/foreign-page contexts cannot satisfy injection;
- `Shared runtime unavailable` wins over later mount evidence and routes to the Runtime branch;
- isolated context with no blocking error and no extension-shadow root routes to mount absence;
- a host-page or unrelated shadow `#root` cannot produce `mounted`;
- unexpected exception, overflow, missing final DOM, retry, reload, or repair withholds action;
- one clean target/context/root timeline produces one authorization and no action invocation from the helper.

These controls prove the support boundary but do not certify a real production package, CDP connection, native toolbar action, or cleanup. Those remain fresh QA obligations.

The frozen real-adapter controls separately prove both accepted product families and rejection of missing, relative, nonexistent, non-executable, branded Chrome, branded Edge, derivative, unknown, symlink-to-rejected, non-zero, timeout, output-overflow, ambiguous, and probe/launch-mismatch cases before helper invocation.

### 9. Acceptance restarts the full cross-browser matrix

After the implementation exact freezes, one fresh Reviewer examines only that exact's code, controls, path scope, and protected surfaces. A fresh QA seat creates a new clean detached worktree and new owned browser resources.

Chrome must receive one explicit accepted executable, freeze the real-adapter source SHA-256 and privacy-safe executable identity, pass the precondition before lifecycle, independently run the new lifecycle from `about:blank`, validate the packaged manifest, preserve every worker discovery/diff record, derive the ID from one exact worker, retain worker continuity, create the accepted target once, preserve the full diagnostic artifact, reach `mounted`, perform one real native toolbar action, prove `afterOptionsCount - beforeOptionsCount = 1` and post-action content Runtime on the same target, report no unexpected extension/browser error, and clean every owned resource.

The same QA seat reruns Firefox MV2 initial startup plus two same-profile owned-process restarts with all existing native-action, options-delta, Runtime, identity, and cleanup requirements. The prior task #287 Firefox PASS is not reusable. The first terminal failure in either browser stops the matrix; there is no canonical retry or partial-result aggregation.

## Risks / Trade-offs

- [The new helper becomes another general Chrome runner] -> Keep explicit executable validation, build, native click, report aggregation, and global cleanup outside the helper; forbid executable discovery and whitelist only one helper and one test.
- [A hardcoded or discovered branded browser silently replaces canonical Chrome] -> Require one explicit absolute path, exact CfT/Chromium version identity, canonical-path and byte digests, and pre-lifecycle rejection with no fallback.
- [A path label disguises a branded binary] -> Resolve the canonical path and trust the bounded executable's exact version identity and byte digest, not its filename or containing directory.
- [Auto-attach still misses process-start worker logs] -> Claim completeness only after the explicit observation fence and require worker Runtime/manifest verification before the accepted target; do not infer from unavailable earlier history.
- [A Chrome component or foreign extension worker appears first] -> Classify every worker from package facts, wait within one bounded discovery deadline, and derive the ID only from the unique exact candidate.
- [Runtime manifest differs for an undocumented browser normalization] -> Preserve canonical digests and a bounded typed JSON-path diff, fail closed, and require new exact-bound authority instead of guessing an allowlist.
- [A later worker is treated as the original extension] -> Keep the first exact target/session/ID/entry/manifest tuple immutable; allow only fully classified unrelated evidence and reject duplicate/replacement exact candidates.
- [A host page happens to contain `#root`] -> Require a root inside the extension-created shadow UI on the bound target after the exact isolated context appears.
- [A later mount erases a real Runtime failure] -> Give Runtime-unavailable and unexpected-error evidence precedence over mounted authorization.
- [Event capture leaks or grows without bound] -> Normalize and cap logs, record structural DOM only, and fail closed on overflow instead of truncating into PASS.
- [The single target fails transiently] -> Preserve the terminal diagnostic and stop; retry would change the evidence and is a new run, not a repair.
- [A narrow implementation needs an existing CDP helper edit] -> Stop for new authority; do not silently expand into protected Chrome harness files.
- [Firefox PASS is treated as reusable] -> Require the next same-seat QA to rerun all three Firefox generations from zero.

## Migration Plan

1. Freeze this superseding docs-only authority as the clean sole child of `74d0c67eaf24f68bf731c8c9205cea7aa6c6792c`; do not parent or amend from `3ae2b81e` or any blocked candidate.
2. Recreate the two whitelisted source files byte-identically to their recorded Round 18 SHA-256 values; change no helper/test behavior and no existing tracked path.
3. Freeze a test-owned real-adapter artifact that removes the branded path hardcode, accepts and validates one explicit CfT/Chromium executable, records privacy-safe identity, and has deterministic executable-precondition controls.
4. Preserve all deterministic helper controls for package structure, foreign-first/exact-late discovery, only-foreign, duplicate exact, unresolved probes, entry/Runtime-ID/manifest mismatch, strict canonicalization, worker continuity, startup-page reuse, late observation, Runtime-unavailable, false root, and retry/repair.
5. Run implementation-owned focused/full static, formatting, OpenSpec, production build/package/manifest, scope, lineage, and adapter-control gates; do not run canonical browsers from the implementation seat.
6. Freeze one immutable clean sole-child implementation exact plus the real-adapter source SHA-256.
7. Route one fresh Reviewer. Only after Review PASS, route one fresh QA seat through the complete Chrome MV3 plus Firefox MV2 matrix from zero with one accepted explicit executable.
8. If a supported executable still exposes no exact worker, route a separate activation/observation authority. If later exact evidence selects a product-owned branch, freeze a separate product authority. Do not modify product code under this change.

Rollback is tooling-only: revert the two new diagnostic files and task progress and discard the test-owned real-adapter artifact. Rollback removes repository-owned Chrome lifecycle classification and invalidates evidence that depends on it; it does not change product bytes.

## Open Questions

None. The lineage, two-file byte identity, explicit CfT/Chromium precondition, branded-browser exclusion, privacy-safe executable evidence, separate harness failure, package-first authority, key-order-only manifest canonical relation, bounded worker evidence, unique exact selection, immutable worker continuity, observation order, single-target rule, terminal branches, action gate, protected surfaces, and fresh acceptance route are fixed.
