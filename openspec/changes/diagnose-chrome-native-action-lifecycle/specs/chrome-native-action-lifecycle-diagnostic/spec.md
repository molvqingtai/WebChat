## ADDED Requirements

### Requirement: Canonical Chrome executable authority is explicit and fail closed

Before any persistent browser profile, CDP connection, worker discovery budget, lifecycle helper invocation, accepted target, or native action, the real test-owned Chrome adapter SHALL receive exactly one caller-injected absolute executable path. It SHALL NOT hardcode a branded application path, discover a browser, search `PATH` or application directories, use a default or fallback, select another executable after failure, or reuse an Owner browser.

The adapter SHALL use one finite, non-resetting, maximum 10-second executable-precondition budget. Within that budget it SHALL resolve the requested path with `realpath`, require a regular file with execute access, compute SHA-256 identities for the requested path string, canonical path string, and executable bytes, and run exactly one bounded `--version` probe against the canonical executable. Probe output SHALL be capped at 512 bytes.

The adapter SHALL accept only an exact `Google Chrome for Testing <version>` or `Chromium <version>` identity with a non-empty version. It SHALL reject branded `Google Chrome`, `Microsoft Edge`, every other derivative or unknown label, ambiguous or oversized output, a relative/missing/non-executable path, a symlink whose canonical target is rejected, non-zero probe exit, timeout, or any mismatch between the probed canonical path and the executable used for launch.

Accepted evidence SHALL contain only the allowlisted product family, parsed version, requested-path SHA-256, canonical-path SHA-256, executable-byte SHA-256, bounded version-output SHA-256, and a derived privacy-safe executable identity token. Raw absolute paths SHALL remain transient adapter inputs and SHALL NOT enter the report, helper timeline, authorization, or chat evidence. The adapter SHALL pass only the privacy-safe token through the helper's existing browser-executable context field.

Any missing, unsupported, ambiguous, changed, or unresolved executable identity SHALL produce a distinct `chrome-executable-precondition-failed` harness result. That result SHALL prove the bounded probe was cleaned and no persistent profile, CDP connection, helper timeline, worker discovery, accepted target, or native action began. It SHALL NOT be translated to `extension-setup-failed` or any other helper lifecycle outcome.

#### Scenario: Chrome for Testing is explicitly supplied

- **GIVEN** the caller supplies an absolute executable whose canonical file is executable and whose bounded identity is exactly `Google Chrome for Testing <version>`
- **WHEN** the executable precondition completes within its original budget
- **THEN** the adapter SHALL record the privacy-safe identity, launch exactly that canonical executable, and MAY proceed to the unchanged package-first worker fence

#### Scenario: Chromium is explicitly supplied

- **GIVEN** the caller supplies an absolute executable whose canonical file is executable and whose bounded identity is exactly `Chromium <version>`
- **WHEN** the executable precondition completes within its original budget
- **THEN** the adapter SHALL record the privacy-safe identity, launch exactly that canonical executable, and MAY proceed to the unchanged package-first worker fence

#### Scenario: Executable is missing or implicit

- **GIVEN** the caller omits the executable, supplies a relative path, or relies on a hardcode, default, discovery, `PATH` lookup, application scan, fallback, or Owner browser
- **WHEN** canonical Chrome setup begins
- **THEN** the adapter SHALL emit `chrome-executable-precondition-failed` before it creates a persistent profile or invokes the helper

#### Scenario: Branded Chrome or Edge is supplied

- **GIVEN** the executable identity is branded `Google Chrome`, `Microsoft Edge`, another derivative, or an unknown label
- **WHEN** the version identity is classified
- **THEN** the adapter SHALL reject it without starting lifecycle, worker discovery, an accepted target, or native action

#### Scenario: Alias resolves to a rejected browser

- **GIVEN** the requested path or filename appears acceptable but `realpath` resolves to a branded, non-executable, changed, or otherwise rejected binary
- **WHEN** canonical identity is evaluated
- **THEN** the canonical target SHALL control the result and the adapter SHALL fail the precondition without fallback

#### Scenario: Executable identity cannot be completed

- **GIVEN** the file is missing or non-executable, the probe exits non-zero, times out, exceeds 512 bytes, is ambiguous, or the launch path differs from the probed canonical path
- **WHEN** the original precondition budget closes
- **THEN** the adapter SHALL emit `chrome-executable-precondition-failed`, clean the probe, and record zero lifecycle/action side effects

### Requirement: Package-first discovery derives one exact worker identity

Before it accepts an extension ID, the Chrome MV3 diagnostic SHALL parse the exact packaged manifest as structured JSON and require `manifest_version` equal to `3`, an object-valued `background`, and a non-empty string `background.service_worker`. The immutable candidate exact, package digest, and parsed packaged manifest SHALL be the roots of authority. A caller-supplied extension ID, the first observed extension worker, or a global one-worker inventory SHALL NOT be an identity root.

The manifest canonical relation SHALL recursively sort object keys while preserving array order, every JSON primitive, and every field exactly. It SHALL omit no field, insert no default, resolve no alias, and rewrite no path or value. The canonical manifest identity SHALL be the SHA-256 digest of its UTF-8 canonical JSON. The worker entry SHALL match only when the worker URL has scheme `chrome-extension`, no query or fragment, a non-empty evaluated `chrome.runtime.id` equal to the URL host, and a pathname exactly equal to `/${packagedManifest.background.service_worker}`. No other Runtime-manifest or entry normalization is authorized.

After the observation fence, the diagnostic SHALL use one finite, non-resetting, maximum 30-second pre-target discovery deadline. It SHALL classify every currently observed extension Service Worker before closing a decision fence. For each worker it SHALL preserve bounded privacy-safe evidence containing monotonic appearance order and relative time, target URL and target/session identity, evaluated Runtime ID, allowlisted `manifest_version`/`name`/`version`/`background` projection, packaged and Runtime canonical digests, and a sorted capped JSON Pointer diff with an explicit overflow marker. Outside the allowlisted projection, differing values SHALL be represented only by JSON type, length, and digest. A per-worker diff overflow SHALL remain non-equal by canonical digest and SHALL NOT block a separate unique exact worker. Total worker-record capacity overflow or an unresolved worker at the deadline SHALL fail closed.

A worker SHALL be an exact candidate only when its URL host and evaluated Runtime ID agree, its entry exactly matches the packaged Service Worker entry, and its Runtime manifest is canonically equal to the packaged manifest. Zero exact candidates SHALL continue observation until the deadline. Zero at the deadline or more than one at any completed decision fence SHALL produce `extension-setup-failed` before accepted-target creation. A fully classified non-exact worker SHALL remain evidence only and SHALL NOT count toward exact cardinality, supply the extension ID, or replace the exact worker.

When one exact candidate exists and every current probe is resolved, the diagnostic SHALL derive the extension ID from that candidate and bind its worker target, session, Runtime ID, entry, and canonical manifest identity. That tuple SHALL remain immutable. A later worker SHALL be classified only within the remaining pre-target deadline before target creation or the remaining lifecycle deadline afterward; it SHALL receive no new budget. A later fully classified unrelated worker MAY remain evidence, but an unresolved later worker, second exact candidate, exact-worker destruction/replacement, or any bound target/session/ID/entry/manifest change SHALL fail closed without rebinding.

#### Scenario: Packaged worker declaration is invalid

- **GIVEN** the packaged manifest is not MV3, has no object-valued `background`, or has an empty or non-string `background.service_worker`
- **WHEN** package-first discovery begins
- **THEN** the outcome SHALL be `extension-setup-failed`, no worker ID SHALL be accepted, and no content target SHALL be created

#### Scenario: Foreign worker appears before the exact worker

- **GIVEN** observation first discovers a fully classified worker that does not match the packaged manifest and later discovers one exact candidate within the original pre-target deadline
- **WHEN** the worker decision fence closes with every current probe resolved
- **THEN** the foreign worker SHALL remain evidence only and the extension ID SHALL be derived from the sole exact candidate

#### Scenario: Only foreign workers appear

- **GIVEN** every worker observed before the pre-target deadline is fully classified as non-exact
- **WHEN** the original deadline expires
- **THEN** the outcome SHALL be `extension-setup-failed`, no accepted target SHALL be created, and no foreign Runtime ID SHALL become authority

#### Scenario: More than one exact worker appears

- **GIVEN** two worker target/session identities both satisfy the exact package relation at a completed decision fence
- **WHEN** exact-worker cardinality is evaluated
- **THEN** the outcome SHALL be `extension-setup-failed` rather than choosing the first, newest, or caller-preferred worker

#### Scenario: Worker entry or Runtime ID disagrees

- **GIVEN** a worker manifest matches the packaged manifest but its URL entry differs from the packaged `background.service_worker`, or its evaluated Runtime ID differs from the URL host
- **WHEN** the worker is classified
- **THEN** it SHALL NOT be exact and SHALL NOT supply extension identity

#### Scenario: Manifest object key order differs

- **GIVEN** the packaged and worker-evaluated manifests contain exactly the same fields, arrays, and primitive values but their object keys are ordered differently
- **WHEN** their canonical identities are compared
- **THEN** they SHALL compare equal because object-key order is the sole authorized normalization

#### Scenario: Runtime manifest changes a semantic value

- **GIVEN** the worker-evaluated manifest adds or removes a field, changes a value or array order, inserts a default, resolves an alias, or rewrites a path
- **WHEN** canonical manifest comparison runs
- **THEN** the manifests SHALL differ, the bounded JSON-path evidence SHALL be preserved, and no guessed normalization SHALL make the worker exact

#### Scenario: Foreign manifest exceeds the diff-entry cap

- **GIVEN** a foreign worker's canonical manifest digest differs and its sorted JSON-path diff exceeds the per-worker cap while another worker is uniquely exact
- **WHEN** discovery records the foreign worker
- **THEN** it SHALL retain the capped diff plus overflow marker, keep that worker non-exact, and SHALL NOT let the foreign evidence replace or block the unique exact binding

#### Scenario: Worker inventory exceeds total evidence capacity

- **GIVEN** observed worker records exceed the fixed total worker-evidence cap before accepted-target creation
- **WHEN** the diagnostic can no longer preserve a complete discovery inventory
- **THEN** the outcome SHALL be `extension-setup-failed`, no accepted target SHALL be created, and no partial inventory SHALL authorize action

#### Scenario: Unrelated worker appears after binding

- **GIVEN** one exact worker is bound and a later worker is fully classified as non-exact
- **WHEN** worker continuity is checked
- **THEN** the later worker SHALL remain evidence only and SHALL NOT invalidate or replace the exact binding

#### Scenario: Exact worker is replaced after binding

- **GIVEN** the bound exact worker disappears, another exact candidate appears, or the bound target/session/ID/entry/manifest tuple changes
- **WHEN** continuity is checked before terminal authorization
- **THEN** the diagnostic SHALL fail closed and SHALL NOT rebind or authorize native action

### Requirement: Chrome lifecycle observation precedes the accepted content target

Only after the executable precondition passes, the Chrome MV3 native-action diagnostic SHALL start one owned isolated-profile Chrome for Testing or Chromium process at the validated canonical executable with `about:blank` as its only startup page and the exact unpacked production package. It SHALL establish target discovery, flattened auto-attach, Runtime execution-context, console, exception, Page navigation/lifecycle, and bounded DOM observation before it creates any manifest-accepted HTTPS target.

Before target creation, the diagnostic SHALL complete package-first discovery, derive the extension ID from one exact worker, bind its immutable target/session/ID/entry/manifest tuple, and establish the worker continuity observer. It SHALL then issue exactly one planned `Target.createTarget({ url: 'https://example.com/' })` request. It SHALL NOT adopt an accepted startup page, call `Page.navigate`, create a replacement accepted target, refresh, reload, retry, or repair a failed target.

#### Scenario: Establish observation before navigation

- **GIVEN** the owned browser starts with the exact package and only `about:blank`
- **WHEN** the diagnostic prepares Chrome content verification
- **THEN** all required CDP event observation SHALL be ready, the exact worker and manifest SHALL be bound, and only then SHALL one accepted target be created

#### Scenario: Accepted URL is present at process startup

- **GIVEN** the browser command line already contains `https://example.com/`
- **WHEN** the diagnostic evaluates its lifecycle precondition
- **THEN** it SHALL reject the run rather than attach late and represent that existing page as the planned target

#### Scenario: Exact extension setup is unavailable

- **GIVEN** packaged-manifest validation, worker evidence, or unique exact selection is unavailable or contradictory before target creation
- **WHEN** pre-target verification runs
- **THEN** the outcome SHALL be `extension-setup-failed`, no accepted target SHALL be created, and native action authorization SHALL remain withheld

### Requirement: One exact binding owns all content lifecycle evidence

The diagnostic SHALL bind the candidate exact, production-package digest, packaged worker entry and canonical manifest digest, owned profile and process generation, allowlisted browser product family/version and privacy-safe executable identity, derived extension ID, Service Worker target/session/entry/Runtime-manifest digest, completed worker decision fence, exact accepted URL, page target/session/main frame, and one absolute lifecycle deadline. All later worker, context, log, navigation, DOM, and action-authorization evidence SHALL refer to that same binding.

An extension isolated context SHALL count only when its target, session, main frame, and extension origin match the binding. A worker, options page, host main world, foreign extension, unrelated page, destroyed target, replacement target, or prior process context SHALL NOT satisfy content injection.

The accepted-target lifecycle SHALL use one non-resetting maximum 30-second budget beginning with the sole `Target.createTarget` request. Attach, navigation, isolated-context, Runtime signal, and DOM phases SHALL consume that same budget.

The pre-target worker deadline and accepted-target lifecycle deadline SHALL each be single absolute budgets. Worker arrival SHALL NOT reset discovery time, and later lifecycle phases SHALL NOT borrow a new worker-discovery budget or extend the target budget.

#### Scenario: Page-bound extension context appears

- **GIVEN** the exact accepted target has attached and navigated
- **WHEN** Runtime reports an isolated execution context
- **THEN** the diagnostic SHALL accept it only if it belongs to the bound target, session, main frame, and exact extension origin

#### Scenario: Foreign context appears first

- **GIVEN** a worker, options, unrelated-page, main-world, or foreign-extension context is observable
- **WHEN** the content injection condition is evaluated
- **THEN** that context SHALL remain evidence only and SHALL NOT satisfy or replace the required page-bound isolated context

#### Scenario: A later phase requests a new budget

- **GIVEN** the target has already consumed part of its 30-second lifecycle budget
- **WHEN** navigation, context, or DOM observation begins
- **THEN** it SHALL use only the remaining original budget and SHALL NOT reset or extend the deadline

### Requirement: The diagnostic preserves a bounded ordered evidence timeline

The diagnostic SHALL record a monotonic event timeline from the completed pre-target observation fence through one terminal outcome. The timeline SHALL include worker/manifest verification, target lifecycle, main-frame navigation, page lifecycle, execution-context creation/destruction, normalized console calls and exceptions, bounded structural DOM samples, and an unconditional terminal DOM-sample attempt that records either the final structure or why the bound target could not be sampled.

Worker evidence SHALL include every observed candidate's bounded discovery/probe/manifest/diff record and every post-bind continuity event. It SHALL preserve the first mismatch rather than retaining only a final equality boolean. Raw manifest values outside `manifest_version`, `name`, `version`, and `background` SHALL NOT be captured; their diff entries SHALL contain only JSON path, type, length, and digest.

DOM samples SHALL be limited to the bound URL, document readiness, body presence, shadow host/root counts, extension-shadow `#root` count, and Runtime-unavailable marker state where observable. The diagnostic SHALL NOT capture arbitrary HTML/text, cookies, storage, credentials, or user data. Console and exception values SHALL be normalized and bounded. Missing final evidence, serialization failure, event overflow, or contradictory identities SHALL fail closed rather than be truncated or ignored into PASS.

The diagnostic MAY claim complete observation only after its explicit listener/session-enable fence. It SHALL NOT claim that it recovered process-start events that preceded CDP attachment.

#### Scenario: Event capacity is exceeded

- **GIVEN** console, exception, context, target, or DOM events exceed the configured evidence bound
- **WHEN** the diagnostic reaches its terminal decision
- **THEN** it SHALL emit `unexpected-content-failure` and withhold action rather than discard earlier events and infer success

#### Scenario: Host page exposes its own root

- **GIVEN** the light DOM or an unrelated shadow tree contains an element with ID `root`
- **WHEN** mount evidence is evaluated
- **THEN** that element SHALL NOT count as the extension-shadow `#root` and SHALL NOT authorize action

#### Scenario: Failure occurs before final DOM sampling

- **GIVEN** target, context, console, or exception evidence makes the run terminal
- **WHEN** the diagnostic closes its evidence window
- **THEN** it SHALL attempt one bounded final structural sample when the bound target remains addressable and SHALL record why no sample was possible otherwise

### Requirement: Terminal Chrome lifecycle outcomes are mutually exclusive and fail closed

After executable precondition PASS and helper invocation, the diagnostic helper SHALL emit exactly one terminal outcome:

- `extension-setup-failed` for packaged-manifest validation, bounded discovery, evidence capacity, unique exact-worker selection, canonical relation, or bound-worker continuity failure;
- `target-lifecycle-failed` for sole-target creation, attach, navigation, destruction, replacement, or binding failure;
- `content-context-absent` when no exact page-bound isolated context appears within the lifecycle;
- `shared-runtime-unavailable` when the exact isolated context exists and reports the product's `Shared runtime unavailable` signal;
- `content-mount-absent` when the exact isolated context exists, no Runtime-unavailable or other blocking content error exists, and no extension-shadow `#root` appears;
- `unexpected-content-failure` for another page-bound extension error, evidence overflow, missing terminal evidence, or contradictory state;
- `mounted` only when the exact isolated context and extension-shadow `#root` appear on the bound target with no blocking Runtime or unexpected error.

Runtime-unavailable and unexpected-error evidence SHALL take precedence over later DOM success. The first terminal outcome SHALL remain immutable; later evidence, refresh, reload, retry, target creation, or navigation repair SHALL NOT rewrite it.

#### Scenario: Content context never appears

- **GIVEN** the exact worker and target lifecycle were observed
- **WHEN** the original lifecycle budget expires without a page-bound isolated extension context
- **THEN** the outcome SHALL be `content-context-absent` and the evidence SHALL route follow-up to injection or browser lifecycle investigation

#### Scenario: Shared Runtime initialization fails

- **GIVEN** the exact page-bound isolated context exists
- **WHEN** its normalized console or exception evidence contains `Shared runtime unavailable`
- **THEN** the outcome SHALL be `shared-runtime-unavailable`, action SHALL remain unauthorized, and later root evidence SHALL NOT erase that result

#### Scenario: WXT root does not mount

- **GIVEN** the exact page-bound isolated context exists and no Runtime-unavailable or unexpected content error occurred
- **WHEN** no extension-shadow `#root` appears by the original deadline
- **THEN** the outcome SHALL be `content-mount-absent` and follow-up SHALL route to content bootstrap or WXT mount investigation

#### Scenario: Content lifecycle mounts cleanly

- **GIVEN** the exact page-bound isolated context exists and the timeline contains no blocking error
- **WHEN** one extension-shadow `#root` appears on the same bound target within the original budget
- **THEN** the outcome SHALL be `mounted` and MAY produce one exact-bound native-action authorization

### Requirement: Diagnostic support gates but never fabricates the native action

The helper SHALL return native-action authorization only for `mounted`. That authorization SHALL bind the candidate, package, packaged manifest digest/entry, exact worker target/session/ID/entry/Runtime-manifest digest, profile, process generation, accepted target/session/frame/context, URL, deadline, and terminal evidence digest. All other outcomes or any invalidated worker binding SHALL withhold authorization before a click callback can execute.

The helper SHALL NOT click browser chrome, dispatch `chrome.action.onClicked`, invoke `AppAction.openOptionsPage()`, manually open or navigate to options, create a post-failure content target, or represent extension-origin options Runtime as the content control.

Fresh QA MAY perform one real native toolbar action only after authorization. It SHALL retain the same accepted target for post-action Runtime control and SHALL prove `afterOptionsCount - beforeOptionsCount = 1` without refresh, reload, target substitution, or post-click content repair.

#### Scenario: Diagnostic branch is not mounted

- **GIVEN** the terminal outcome is any value other than `mounted`
- **WHEN** the caller requests native-action authorization
- **THEN** authorization SHALL be denied and no toolbar click callback SHALL run

#### Scenario: Clean diagnostic authorizes one action

- **GIVEN** the terminal outcome is `mounted` and all binding identities remain current
- **WHEN** fresh QA requests authorization
- **THEN** it MAY perform exactly one real native toolbar action and SHALL verify `afterOptionsCount - beforeOptionsCount = 1` plus post-action Runtime on the same content target

#### Scenario: A failed lifecycle is repaired after the deadline

- **GIVEN** the diagnostic already emitted a non-mounted terminal outcome
- **WHEN** a caller reloads, retries, creates another target, or later observes a root
- **THEN** that activity SHALL NOT change the outcome or authorize the failed run

### Requirement: The repository change remains a two-file support boundary

The implementation SHALL add only `e2e/chrome-native-action-lifecycle.ts` and `e2e/chrome-native-action-lifecycle.test.ts`, plus checkbox-only progress updates in this change's `tasks.md`. The helper file SHALL have SHA-256 `6763e476722dd7b7675820b753806ea5908e13560eeef328a15d6ce4c27ff160`, and the focused test SHALL have SHA-256 `9f4a27172bf0f60446dd5f1c5776d14df95dc4c295e1c49c0e9d019eb7f2baa5`. The helper SHALL remain dependency-free and driven through an injected test-owned adapter.

The real adapter that performs executable precondition and CDP orchestration SHALL remain a test-owned QA artifact outside tracked repository scope. Its source SHALL be frozen by SHA-256 before Review and canonical QA. It MAY replace the task #309 branded executable hardcode only with explicit input, executable validation, privacy-safe identity evidence, and the controls in this specification. It SHALL NOT change helper/package/product/lifecycle semantics or add a third tracked implementation file.

All existing E2E and Firefox support files, product source, WXT configuration, generated manifest/permissions, dependencies/lockfile, package scripts, existing timeouts, Runtime/coordinator/Offscreen/protocol/storage/UI, workflows/CI, reports, release metadata, and Owner checkout SHALL remain unchanged.

#### Scenario: Review direct implementation scope

- **WHEN** the implementation exact is compared with this docs authority
- **THEN** its direct changes SHALL be limited to the two digest-identical diagnostic files and checkbox-only task progress, with every protected path byte-identical and the real adapter preserved only as a separately hashed test artifact

#### Scenario: Existing harness reuse requires an edit

- **WHEN** implementation would require modifying `chrome-harness.ts`, `chrome-runtime.ts`, another existing E2E file, a dependency, script, configuration, timeout, workflow, or product path
- **THEN** work SHALL stop as authority-blocked rather than expanding the diagnostic

### Requirement: Acceptance uses fresh exact-bound cross-browser evidence

This superseding docs authority SHALL be a clean sole child of `74d0c67eaf24f68bf731c8c9205cea7aa6c6792c`, and its implementation SHALL be a clean sole child of the superseding docs exact. Round 18 source exact `3ae2b81ebaf31dfd368affabdd387fe204929420`, blocked `bfdbfa3665a060443175ad54dd7eefb320199e79`, and every other candidate SHALL be neither parent nor transferable evidence. Only repository bytes transfer from the docs parent; the two recorded source digests constrain new bytes but transfer no verdict. No QA #287, QA #298, QA #309, intermediate static, Firefox, Chrome, action, Runtime, cleanup, Reviewer, or QA verdict transfers.

One fresh Reviewer SHALL validate the immutable implementation, both tracked file digests, frozen real-adapter source digest and executable controls, package-first identity root, canonical manifest relation, worker evidence/cardinality/continuity, deterministic chronology and branch controls, action gate, exact path scope, and protected surfaces. Only after Review PASS, one fresh QA seat SHALL rerun the complete real Chrome MV3 plus Firefox MV2 matrix from zero and own the first terminal verdict and zero-residual cleanup.

Chrome SHALL receive one explicit accepted Chrome for Testing or Chromium executable, freeze the adapter source SHA-256 and privacy-safe executable identity, pass precondition before lifecycle, use the new `about:blank` observation sequence, preserve bounded evidence for every worker, derive the extension ID only from one package-matching exact worker, retain its continuity, create the accepted target once, reach `mounted`, perform one real native action, prove `afterOptionsCount - beforeOptionsCount = 1` and pre/post-action content Runtime on the same target, preserve the full diagnostic artifact, and report no unexpected error. Firefox SHALL rerun initial startup and two same-profile owned-process restarts under all existing exact action, Runtime, identity, and cleanup requirements.

#### Scenario: Prior Firefox PASS exists

- **GIVEN** QA task #287 completed all three Firefox generations on `1b1f6cc`
- **WHEN** the new implementation exact enters QA
- **THEN** that result SHALL remain diagnostic history and the fresh QA seat SHALL rerun every Firefox generation from zero

#### Scenario: Prior Chrome worker evidence exists

- **GIVEN** QA task #298 stopped on `bfdbfa3` after selecting a non-package worker and retained no evaluated manifest diff
- **WHEN** the superseding implementation enters QA
- **THEN** the prior equality failure SHALL remain diagnostic history and fresh QA SHALL reproduce package-first discovery and the complete worker evidence from zero

#### Scenario: Prior branded-Chrome precondition blocker exists

- **GIVEN** QA task #309 used branded Chrome, observed only a foreign worker, and stopped with `extension-setup-failed`
- **WHEN** the superseding implementation enters QA
- **THEN** task #309 SHALL remain immutable history, and fresh QA SHALL begin from executable precondition with a new adapter digest and one explicitly accepted Chrome for Testing or Chromium identity

#### Scenario: Supported executable still exposes no exact worker

- **GIVEN** executable precondition passed for an explicitly accepted Chrome for Testing or Chromium identity
- **WHEN** the unchanged package-first deadline expires without the exact packaged worker
- **THEN** the helper SHALL preserve the new `extension-setup-failed` artifact without retry or fallback, and follow-up SHALL route to a separate activation/observation authority

#### Scenario: Chrome diagnostic passes but action does not

- **GIVEN** Chrome reaches `mounted`
- **WHEN** the native action, options result, post-action Runtime, unexpected-error, or cleanup control is missing or fails
- **THEN** the cross-browser matrix SHALL remain non-PASS and diagnostic mount evidence SHALL NOT substitute for action acceptance

#### Scenario: First terminal browser failure occurs

- **WHEN** either browser reaches its first terminal failure
- **THEN** QA SHALL stop without canonical retry, preserve the exact-bound artifact and cleanup result, and SHALL NOT aggregate prior or partial evidence into PASS

#### Scenario: Executable precondition fails before Chrome lifecycle

- **WHEN** the explicit executable is missing, rejected, ambiguous, changed, or unresolved
- **THEN** QA SHALL freeze `chrome-executable-precondition-failed`, prove zero lifecycle/action side effects and zero residuals, stop without selecting another browser, and SHALL NOT represent it as a product-lifecycle verdict
