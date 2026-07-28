## 1. Authority And Evidence Reset

- [x] 1.1 Bind this docs authority to immutable parent `1b1f6cc61d7de9adc75bca0cc1b3768d90555e04` (tree `2c133bb7bf2f57c96ef6f71538103dddb28782c2`) and verify a clean detached/ref-free starting worktree.
- [x] 1.2 Record QA task #287 as a Chrome verification-control blocker, not a product-defect verdict. Its Firefox, Chrome, static, action, Runtime, cleanup, Reviewer, and QA results do not transfer.
- [x] 1.3 Record the read-only causal split: missing isolated content context, `initClient()` / shared-Runtime failure, and later WXT mount failure remain distinguishable only through a new ordered lifecycle diagnostic.
- [x] 1.4 Freeze the direct implementation whitelist: new `e2e/chrome-native-action-lifecycle.ts`, new `e2e/chrome-native-action-lifecycle.test.ts`, and checkbox-only updates to this file. Treat every other path as protected.

## 2. Deterministic Lifecycle Diagnostic

- [ ] 2.1 Add a dependency-free helper driven by an injected test-owned adapter. Do not add an executable dependency, package script, existing-runner edit, reporter, aggregator, or general cleanup owner.
- [ ] 2.2 Require `about:blank` startup; establish target discovery, flattened auto-attach, per-session Runtime/Log/Page observation, and the event sink before accepted-target creation.
- [ ] 2.3 Before target creation, bind exactly one responsive production extension Service Worker; require its URL origin and `chrome.runtime.id` to agree, and canonically deep-compare `chrome.runtime.getManifest()` with the packaged manifest.
- [ ] 2.4 Issue exactly one `Target.createTarget({ url: 'https://example.com/' })`; bind its target/session/main frame; reject startup accepted pages, second targets, replacement, `Page.navigate`, reload, refresh, retry, and repair.
- [ ] 2.5 Use one non-resetting maximum 30-second lifecycle budget and one exact binding across navigation, isolated context, logs, DOM, terminal outcome, and action authorization.
- [ ] 2.6 Record a bounded ordered timeline for worker/manifest, target/frame lifecycle, page-bound execution contexts, normalized console/exception events, structural DOM samples, and an unconditional final state. Capture no arbitrary DOM, cookies, storage, credentials, or user data.
- [ ] 2.7 Emit exactly one fail-closed outcome: `extension-setup-failed`, `target-lifecycle-failed`, `content-context-absent`, `shared-runtime-unavailable`, `content-mount-absent`, `unexpected-content-failure`, or `mounted`.
- [ ] 2.8 Return action authorization only for clean `mounted`; never click, dispatch an action event, call the product command, open options, or repair a failed lifecycle from the helper.

## 3. Focused Controls And Protected Scope

- [ ] 3.1 Cover correct observation-before-target chronology and reject an accepted startup page, late listeners, a second target request, target replacement, wrong session/frame, foreign context, deadline reset, retry, reload, and repair.
- [ ] 3.2 Cover missing/duplicate/foreign/mismatched worker or manifest, worker/options/main-world contexts, `Shared runtime unavailable`, another extension error, isolated-context-without-mount, false host-page root, event overflow, missing final evidence, and clean mount authorization.
- [ ] 3.3 Prove the helper never invokes native action and that every non-mounted branch withholds the caller's click callback before activation.
- [ ] 3.4 Prove every existing E2E file, including Chrome harness/runtime and both Firefox precondition files, remains byte-identical.
- [ ] 3.5 Prove `src/**`, WXT/manifest/permissions, dependencies/lockfile, package scripts, timeouts, Runtime/coordinator/Offscreen/protocol/storage/UI, workflows/CI, reports, release metadata, refs/remotes, and Owner checkout remain unchanged.
- [ ] 3.6 Run implementation-owned focused/full tests, format/lint/type, strict OpenSpec, production Chrome MV3 and Firefox MV2 build/package/manifest, scope, and lineage gates. Do not run or claim canonical browser QA from the implementation seat.
- [ ] 3.7 Freeze one clean detached/ref-free immutable implementation exact as the sole child of this docs exact. Do not push, update PR/CI, merge, release, or touch the Owner checkout.

## 4. Fresh Review And Full Cross-Browser QA

- [ ] 4.1 Obtain one fresh Reviewer PASS for chronology, exact worker/manifest and target/context binding, evidence bounds, terminal precedence, action withholding, deterministic controls, direct scope, and protected surfaces.
- [ ] 4.2 After Review PASS, obtain one fresh same-seat QA verdict from zero for the complete real Chrome MV3 plus Firefox MV2 matrix. Do not reuse QA task #287 or any earlier candidate evidence.
- [ ] 4.3 In Chrome, start at `about:blank`, establish observation and exact worker/manifest, create the accepted target exactly once, preserve the full timeline, and reach clean `mounted` without retry, reload, target substitution, or unexpected error.
- [ ] 4.4 After Chrome `mounted` authorization, perform exactly one real native toolbar action, prove `afterOptionsCount - beforeOptionsCount = 1` plus pre/post-action content Runtime on the same accepted target, and reject event dispatch, direct product invocation, manual options navigation, or post-click repair.
- [ ] 4.5 In Firefox, rerun initial startup plus two same-profile owned-process restarts and satisfy every existing exact add-on, Background Page, physical identity, one native click, options `+1`, pre/post Runtime, unexpected-error, and no-repair requirement in every generation.
- [ ] 4.6 Prove zero residual owned Chrome/Firefox browsers, drivers, profiles, packages, processes, ports, sessions, listeners, tabs, and temporary resources without touching unrelated Owner resources.

## 5. Follow-Up Routing

- [ ] 5.1 If the diagnostic ends `content-context-absent`, route a separate injection/browser-lifecycle authority; do not edit product under this change.
- [ ] 5.2 If it ends `shared-runtime-unavailable`, route a separate ClientLease/Coordinator/Offscreen authority from the exact evidence; do not broaden this helper.
- [ ] 5.3 If it ends `content-mount-absent` or `unexpected-content-failure`, route a separate content-bootstrap/WXT authority grounded in the bound context/log/DOM timeline.
- [ ] 5.4 Only after full same-exact Review and QA PASS may PM resume the later full E2E-runner or cumulative product route. No paused candidate or evidence set transfers.
