## ADDED Requirements

### Requirement: Chrome lifecycle observation precedes the accepted content target

The Chrome MV3 native-action diagnostic SHALL start an owned isolated-profile browser with `about:blank` as its only startup page and the exact unpacked production package. It SHALL establish target discovery, flattened auto-attach, Runtime execution-context, console, exception, Page navigation/lifecycle, and bounded DOM observation before it creates any manifest-accepted HTTPS target.

Before target creation, the diagnostic SHALL bind exactly one responsive Service Worker for the exact extension. The worker URL origin and worker-evaluated `chrome.runtime.id` SHALL identify the same extension, and the diagnostic SHALL compare `chrome.runtime.getManifest()` with the packaged manifest through canonical structured deep equality. It SHALL then issue exactly one planned `Target.createTarget({ url: 'https://example.com/' })` request. It SHALL NOT adopt an accepted startup page, call `Page.navigate`, create a replacement accepted target, refresh, reload, retry, or repair a failed target.

#### Scenario: Establish observation before navigation

- **GIVEN** the owned browser starts with the exact package and only `about:blank`
- **WHEN** the diagnostic prepares Chrome content verification
- **THEN** all required CDP event observation SHALL be ready, the exact worker and manifest SHALL be bound, and only then SHALL one accepted target be created

#### Scenario: Accepted URL is present at process startup

- **GIVEN** the browser command line already contains `https://example.com/`
- **WHEN** the diagnostic evaluates its lifecycle precondition
- **THEN** it SHALL reject the run rather than attach late and represent that existing page as the planned target

#### Scenario: Exact extension setup is unavailable

- **GIVEN** the worker is missing, duplicated, foreign, unresponsive, or inconsistent with the packaged manifest
- **WHEN** pre-target verification runs
- **THEN** the outcome SHALL be `extension-setup-failed`, no accepted target SHALL be created, and native action authorization SHALL remain withheld

### Requirement: One exact binding owns all content lifecycle evidence

The diagnostic SHALL bind the candidate exact, production-package digest, owned profile and process generation, browser identity, extension ID, Service Worker target/session, normalized manifest identity, exact accepted URL, page target/session/main frame, and one absolute lifecycle deadline. All later context, log, navigation, DOM, and action-authorization evidence SHALL refer to that same binding.

An extension isolated context SHALL count only when its target, session, main frame, and extension origin match the binding. A worker, options page, host main world, foreign extension, unrelated page, destroyed target, replacement target, or prior process context SHALL NOT satisfy content injection.

The accepted-target lifecycle SHALL use one non-resetting maximum 30-second budget beginning with the sole `Target.createTarget` request. Attach, navigation, isolated-context, Runtime signal, and DOM phases SHALL consume that same budget.

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

The diagnostic SHALL emit exactly one terminal outcome:

- `extension-setup-failed` for exact worker/manifest failure before target creation;
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

The helper SHALL return native-action authorization only for `mounted`. That authorization SHALL bind the candidate, package, profile, process generation, extension, accepted target/session/frame/context, URL, deadline, and terminal evidence digest. All other outcomes SHALL withhold authorization before a click callback can execute.

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

The implementation SHALL add only `e2e/chrome-native-action-lifecycle.ts` and `e2e/chrome-native-action-lifecycle.test.ts`, plus checkbox-only progress updates in this change's `tasks.md`. The helper SHALL be dependency-free and driven through an injected test-owned adapter.

All existing E2E and Firefox support files, product source, WXT configuration, manifest/permissions, dependencies/lockfile, package scripts, timeouts, Runtime/coordinator/Offscreen/protocol/storage/UI, workflows/CI, reports, release metadata, and Owner checkout SHALL remain unchanged.

#### Scenario: Review direct implementation scope

- **WHEN** the implementation exact is compared with this docs authority
- **THEN** its direct changes SHALL be limited to the two new diagnostic files and checkbox-only task progress, with every protected path byte-identical

#### Scenario: Existing harness reuse requires an edit

- **WHEN** implementation would require modifying `chrome-harness.ts`, `chrome-runtime.ts`, another existing E2E file, a dependency, script, configuration, timeout, workflow, or product path
- **THEN** work SHALL stop as authority-blocked rather than expanding the diagnostic

### Requirement: Acceptance uses fresh exact-bound cross-browser evidence

This docs authority SHALL be a clean sole child of `1b1f6cc61d7de9adc75bca0cc1b3768d90555e04`, and its implementation SHALL be a clean sole child of the docs exact. Only repository bytes transfer from the blocked parent; no static, Firefox, Chrome, action, Runtime, cleanup, Reviewer, or QA verdict transfers.

One fresh Reviewer SHALL validate the immutable implementation, deterministic chronology and branch controls, action gate, exact path scope, and protected surfaces. Only after Review PASS, one fresh QA seat SHALL rerun the complete real Chrome MV3 plus Firefox MV2 matrix from zero and own the first terminal verdict and zero-residual cleanup.

Chrome SHALL use the new `about:blank` observation sequence, create the accepted target once, reach `mounted`, perform one real native action, prove `afterOptionsCount - beforeOptionsCount = 1` and pre/post-action content Runtime on the same target, preserve the full diagnostic artifact, and report no unexpected error. Firefox SHALL rerun initial startup and two same-profile owned-process restarts under all existing exact action, Runtime, identity, and cleanup requirements.

#### Scenario: Prior Firefox PASS exists

- **GIVEN** QA task #287 completed all three Firefox generations on `1b1f6cc`
- **WHEN** the new implementation exact enters QA
- **THEN** that result SHALL remain diagnostic history and the fresh QA seat SHALL rerun every Firefox generation from zero

#### Scenario: Chrome diagnostic passes but action does not

- **GIVEN** Chrome reaches `mounted`
- **WHEN** the native action, options result, post-action Runtime, unexpected-error, or cleanup control is missing or fails
- **THEN** the cross-browser matrix SHALL remain non-PASS and diagnostic mount evidence SHALL NOT substitute for action acceptance

#### Scenario: First terminal browser failure occurs

- **WHEN** either browser reaches its first terminal failure
- **THEN** QA SHALL stop without canonical retry, preserve the exact-bound artifact and cleanup result, and SHALL NOT aggregate prior or partial evidence into PASS
