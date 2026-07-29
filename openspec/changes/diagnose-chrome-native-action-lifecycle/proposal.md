## Why

Fresh QA on immutable exact `1b1f6cc61d7de9adc75bca0cc1b3768d90555e04` passed the focused, full, static, OpenSpec, build, package, and manifest gates and completed all three required Firefox MV2 generations. The same run stopped on the first Chrome 150 browser failure: the exact MV3 extension ID and Service Worker appeared, but `https://example.com/` did not expose a mounted content Runtime within 30 seconds, so action authorization withheld the toolbar click and the click count remained zero.

That observation does not identify a product defect. The QA control launched Chrome with the accepted URL and unpacked extension at the same time, then attached to the already-created page and listened only for later exceptions. It did not preserve the lifecycle ordering or execution-context, console, and final-DOM evidence needed to distinguish content-script non-injection from `initClient()` failure or later WXT mounting failure. Static inspection confirms that the exact manifest covers `https://example.com/` at `document_idle`, and the existing repository Chrome Runtime harness already avoids the startup ambiguity by instrumenting an `about:blank` browser before creating the accepted target.

The current Firefox precondition authority protects every existing E2E and runner path. A new narrow authority is therefore required before repository-owned Chrome lifecycle diagnostic support can be added. The diagnostic must expose the missing cause without changing product behavior, extending timeouts, or treating the prior Firefox PASS as transferable evidence.

That first authority produced blocked implementation exact `bfdbfa3665a060443175ad54dd7eefb320199e79`. Fresh QA task #298 passed its automated, static, OpenSpec, build, package, and manifest gates, then stopped before accepted-target creation. The pre-helper adapter selected an arbitrary observed extension Service Worker, derived an extension ID from that worker's URL, and passed the ID into a helper that used the same ID to decide whether the worker was exact. The worker-evaluated manifest then correctly disagreed with the packaged WebChat manifest, so the helper emitted `extension-setup-failed` and performed zero native actions.

Read-only diagnosis proved a worker discovery and selection-authority gap, not a product or package mismatch. The packaged MV3 manifest declares `background.service_worker = background.js`; the package contains `background.js` and no `service_worker.js`. QA did not retain the evaluated manifest or a structured field diff, so this authority must preserve that evidence and must not invent a Chrome manifest-normalization allowlist.

Round 18 then froze implementation exact `3ae2b81ebaf31dfd368affabdd387fe204929420`. Fresh source Review passed, and fresh QA task #309 passed every automated, static, OpenSpec, build, package, manifest, and integrity gate. Its sole Chrome canonical stopped before `READY`: the temporary adapter hardcoded branded Google Chrome 150, observed only the foreign Google Network Speech worker, never observed a WebChat target/session within the original 30-second worker budget, and correctly received `extension-setup-failed`, null authorization, and zero native actions. Firefox was not started.

Read-only task #310 found no package, manifest, helper-timing, or helper-source defect. The repository canonical and CI require an explicitly supplied side-load-capable Chrome for Testing or Chromium executable, while task #309's temporary adapter bypassed that precondition by hardcoding branded Chrome. The next authority must therefore fail closed on executable identity before any profile, CDP, worker, lifecycle, or action work; task #309 is immutable and is not rerun.

## What Changes

- Add one dependency-free, adapter-driven Chrome native-action lifecycle diagnostic helper at `e2e/chrome-native-action-lifecycle.ts` and focused deterministic coverage at `e2e/chrome-native-action-lifecycle.test.ts`.
- Require the real test-owned adapter to receive an explicit absolute executable path from its caller, validate and record a side-load-capable Chrome for Testing or Chromium identity, and reject branded Chrome, branded Edge, discovery, defaults, and fallback before invoking the lifecycle helper.
- Preserve a bounded privacy-safe executable identity containing the accepted product family and version plus digests for the requested path, canonical path, executable bytes, and bounded version output. Raw absolute paths are transient and do not enter reports or helper evidence.
- Emit a distinct `chrome-executable-precondition-failed` harness result when executable identity is missing, unsupported, ambiguous, changed, or unresolved. That result occurs before browser/profile/CDP/helper startup and cannot be represented as one of the helper's seven product-lifecycle outcomes.
- Require the browser to start on `about:blank`; register CDP target discovery, auto-attach, Runtime execution-context, console, exception, Page navigation/lifecycle, and bounded DOM observation before creating any accepted content target.
- Validate the packaged manifest first, observe and classify extension workers under one bounded pre-target deadline, and derive the extension ID only from the unique worker whose URL entry, Runtime ID, and worker-evaluated manifest match that package under the frozen canonical relation.
- Preserve bounded privacy-safe evidence for every observed worker, including appearance order/time, target URL, Runtime ID, safe manifest projection, canonical digest, and a structured JSON-path diff from the packaged manifest. Foreign workers remain evidence only; zero or multiple exact candidates fail closed.
- Bind the exact worker target/session/ID/entry/manifest without replacement before issuing exactly one planned `Target.createTarget({ url: 'https://example.com/' })` call.
- Record one ordered timeline for worker discovery and continuity, target and main-frame navigation, the page-bound extension isolated context, normalized console/exception evidence, and final extension-shadow DOM state.
- Produce mutually exclusive, fail-closed outcomes for extension/worker setup failure, target lifecycle failure, missing isolated content context, `Shared runtime unavailable`, isolated-context-without-mount, unexpected content failure, or a clean mounted content control.
- Authorize the existing fresh-QA native toolbar action only after the clean mounted outcome. The helper does not click, dispatch an action event, invoke the product action command, navigate to options, or repair a failed lifecycle.
- Keep all existing E2E files, product source, WXT/manifest/permission surfaces, timeouts, dependencies, scripts, CI, reports, Firefox support, and release/Owner-checkout paths protected.

## Capabilities

### New Capabilities

- `chrome-native-action-lifecycle-diagnostic`: An exact-bound, single-navigation Chrome MV3 content lifecycle diagnostic that separates extension injection, shared-Runtime initialization, WXT mounting, and clean action authorization.

### Modified Capabilities

None. Product Runtime/action behavior, the Firefox action precondition, and the broader cross-browser runner remain unchanged.

## Impact

- Exactly two new repository-owned implementation files: `e2e/chrome-native-action-lifecycle.ts` and `e2e/chrome-native-action-lifecycle.test.ts`.
- Those two files must be byte-identical to reviewed Round 18 exact `3ae2b81e`: helper SHA-256 `6763e476722dd7b7675820b753806ea5908e13560eeef328a15d6ce4c27ff160` and focused-test SHA-256 `9f4a27172bf0f60446dd5f1c5776d14df95dc4c295e1c49c0e9d019eb7f2baa5`. No helper or focused-test repair is authorized.
- The real adapter remains a test-owned QA artifact, not a third tracked repository file. Its source and identity-control evidence must be frozen by SHA-256 before the canonical run.
- The implementation child may make checkbox-only progress updates to this change's `tasks.md` in addition to those two files.
- Existing `e2e/chrome-harness.ts`, `e2e/chrome-harness.test.ts`, `e2e/chrome-runtime.ts`, `e2e/runtime-bundles.ts`, and both Firefox precondition files remain byte-identical.
- One fresh Reviewer and one fresh same-seat full Chrome MV3 plus Firefox MV2 QA run are required after implementation.
- No dependency, package script, WXT configuration, product, manifest, timeout, CI, PR, release, or Owner-checkout change.

## Non-Goals

- No claim that QA task #287 found a product defect, and no product repair before the new diagnostic identifies a product-owned branch.
- No change to `src/**`, `wxt.config.ts`, generated manifest semantics, content matches, `runAt`, `initClient()`, ClientLease, Coordinator, Offscreen, Runtime, action registration, or `AppAction.openOptionsPage()`.
- No change to the existing Chrome harness/runtime, Firefox action helper, cross-browser runner, Playwright/Selenium migration, reporter, aggregation, workflow, or cleanup framework.
- No hardcoded branded Chrome/Edge path, executable discovery, `PATH` lookup, application scan, default executable, fallback executable, or reuse of an Owner browser in canonical Chrome QA.
- No helper or focused-test byte change from the recorded Round 18 digests, and no third tracked adapter, runner, or executable-support file.
- No accepted URL as a Chrome startup argument, no second `Target.createTarget`, no `Page.navigate`, refresh, reload, retry, target substitution, or post-failure repair.
- No caller-supplied or first-observed worker ID as package authority, no global `Service Worker count === 1` shortcut, and no exact-worker rebind after the observation fence.
- No claim that `service_worker.js` belongs to WebChat, no product/package repair, and no manifest-field omission, default insertion, alias, path rewrite, or other semantic normalization without fresh recorded evidence and a new authority.
- No arbitrary DOM dump, cookie/storage capture, credential capture, or unbounded console/event logging.
- No fabricated click, direct `chrome.action.onClicked` dispatch, direct product command invocation, or manual options navigation counted as a native action.
- No transfer of QA #287 or QA #298 Firefox, Chrome, static, action, Runtime, cleanup, Reviewer, or QA verdicts to a later exact.
- No transfer or retry of QA task #309, and no claim that its missing exact worker is a product, package, activation, observation, or helper defect under a supported executable.

## Acceptance Criteria

- This superseding docs authority is a clean detached/ref-free sole child of package-first docs exact `74d0c67eaf24f68bf731c8c9205cea7aa6c6792c`. Round 18 source exact `3ae2b81ebaf31dfd368affabdd387fe204929420`, QA task #309, and every earlier candidate are neither parents nor transferable evidence. Its implementation is a clean sole child and changes only the two new diagnostic files plus checkbox-only task progress.
- The helper is dependency-free, uses an injected test-owned adapter, and remains byte-identical to the two recorded Round 18 file digests. It does not discover or validate executables, build packages, launch a general runner, own the native click, aggregate reports, or kill unrelated processes.
- Before any browser profile, CDP connection, worker budget, lifecycle helper, or action exists, the real adapter receives one caller-supplied absolute path and uses one non-resetting maximum 10-second precondition budget to resolve it, require a regular executable with execute access, hash its bytes, and run one bounded `--version` identity probe.
- The only accepted version identities are an exact `Google Chrome for Testing <version>` or `Chromium <version>` product label with a non-empty version. `Google Chrome`, `Microsoft Edge`, another derivative, an unknown or ambiguous label, a symlink resolving to a rejected binary, a changed probe/launch path, non-zero probe exit, timeout, or output overflow fails the executable precondition.
- Accepted evidence records product family, parsed version, requested-path SHA-256, canonical-path SHA-256, executable-byte SHA-256, and bounded version-output SHA-256 and proves launch used that same canonical-path identity. Reports and helper context receive only the privacy-safe identity token; they do not retain raw absolute paths.
- `chrome-executable-precondition-failed` proves no persistent browser/profile/CDP/helper/worker/accepted-target/action work began and that the bounded probe was cleaned. It cannot be mapped to `extension-setup-failed` or any other product-lifecycle outcome.
- Before worker identity is accepted, the diagnostic structurally validates a packaged MV3 manifest with a non-empty `background.service_worker`, establishes the complete observable CDP event surface, and uses one bounded non-resetting pre-target discovery deadline.
- The extension ID is derived only from one post-fence worker whose URL host equals its evaluated Runtime ID, whose URL path exactly names the packaged worker entry, and whose manifest equals the packaged manifest after key-order-only canonical JSON serialization. Object keys may reorder; arrays, values, field presence, defaults, aliases, and paths may not be changed or omitted. Zero, multiple, or unclassifiable exact candidates fail closed.
- Every observed worker contributes bounded privacy-safe order/time, URL, Runtime ID, allowlisted manifest projection, SHA-256 canonical digest, and capped JSON-path diff evidence. Foreign workers do not count as exact or replace the binding; a later exact duplicate/replacement or any bound target/session/ID/entry/manifest change fails closed.
- The diagnostic creates exactly one accepted page through `Target.createTarget`, retains that target/session/frame identity, and uses one non-resetting maximum 30-second lifecycle budget without refresh, reload, retry, or navigation repair.
- The final evidence distinguishes: no page-bound extension isolated context; isolated context plus `Shared runtime unavailable`; isolated context without that error but without the extension-shadow `#root`; unexpected content failure; and a clean mounted result. Only the clean mounted result can authorize a later native action.
- Executable-precondition controls prove accepted Chrome for Testing and Chromium identities plus rejection of missing, relative, nonexistent, non-executable, branded Chrome, branded Edge, derivative, ambiguous, symlink-to-rejected, timeout, overflow, and probe/launch-mismatch inputs before lifecycle invocation.
- Existing focused controls continue to prove foreign-first/exact-late discovery, only-foreign and duplicate-exact failure, entry/Runtime-ID/manifest mismatch, the sole allowed key-order canonicalization, bound-worker continuity, late unrelated workers, late listener installation, startup accepted-page reuse, target replacement, wrong target/frame/extension context, Runtime-unavailable evidence, false host-page `#root`, missing mount, evidence overflow, and retry/repair behavior.
- Fresh QA starts from zero with a newly frozen real-adapter SHA-256 and one accepted explicit executable identity. Chrome proves package-first exact-worker discovery and evidence, the new lifecycle sequence, a clean mounted content Runtime, one real native action, `afterOptionsCount - beforeOptionsCount = 1`, and post-action Runtime on the same bound target, plus zero residual cleanup. Firefox reruns initial startup and two same-profile owned-process restarts; no QA #287, QA #298, or QA #309 result transfers.
- If implementation needs an existing E2E edit, product/config/dependency/script/CI path, timeout change, or any third implementation file, it stops for new authority rather than expanding this change.
