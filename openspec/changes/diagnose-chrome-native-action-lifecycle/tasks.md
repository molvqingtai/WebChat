## 1. Authority And Evidence Reset

- [x] 1.1 Bind this superseding docs authority to immutable parent `8b6d1fb36986df45bd9435ba170b5675273180ff` (tree `53aad8946bce7c60bfa5076ed010ae239bbe1643`) and verify a clean detached/ref-free starting worktree. Blocked `bfdbfa3665a060443175ad54dd7eefb320199e79` is neither parent nor transferable evidence.
- [x] 1.2 Record QA task #298 as a worker-discovery verification-control blocker, not a product/package-defect verdict. QA #287, QA #298, all intermediate candidates, and their Firefox, Chrome, static, action, Runtime, cleanup, Reviewer, and QA results do not transfer.
- [x] 1.3 Record task #299's read-only causal result: the pre-helper adapter accepted an arbitrary extension worker and derived the same ID later trusted by the helper, so package authority was circular.
- [x] 1.4 Record the proven package facts: MV3 declares `background.service_worker = background.js`, the artifact contains `background.js` and no `service_worker.js`, and no retained worker manifest/diff evidence authorizes semantic normalization or a product/package repair.
- [x] 1.5 Freeze the direct implementation whitelist: new `e2e/chrome-native-action-lifecycle.ts`, new `e2e/chrome-native-action-lifecycle.test.ts`, and checkbox-only updates to this file. Treat every other path as protected.

## 2. Deterministic Lifecycle Diagnostic

- [ ] 2.1 Add a dependency-free helper driven by an injected test-owned adapter. Do not add an executable dependency, package script, existing-runner edit, reporter, aggregator, or general cleanup owner.
- [ ] 2.2 Require `about:blank` startup; establish target discovery, flattened auto-attach, per-session Runtime/Log/Page observation, and the event sink before accepted-target creation.
- [ ] 2.3 Parse the packaged manifest first and require MV3 plus a non-empty `background.service_worker`. Do not accept a caller-supplied extension ID or a first/global-only worker shortcut.
- [ ] 2.4 Use key-order-only canonical JSON and one non-resetting maximum 30-second pre-target discovery deadline. Classify every current worker before deciding uniqueness; derive the extension ID only from one URL-host/Runtime-ID, exact-entry, canonical-manifest match.
- [ ] 2.5 Record bounded privacy-safe per-worker order/time, target URL/session, Runtime ID, allowlisted manifest projection, packaged/Runtime SHA-256 canonical digests, and capped sorted JSON Pointer diff evidence. A diff-overflow marker remains non-equal by digest; fail on total worker-record overflow or unresolved classification.
- [ ] 2.6 Treat zero exact candidates at the deadline or more than one at a decision fence as `extension-setup-failed`. Keep classified foreign workers as evidence only; never let them supply identity or replace the exact binding.
- [ ] 2.7 Bind the exact worker target/session/ID/entry/manifest tuple immutably. Classify later workers only within the remaining current budget; reject unresolved, exact duplicate/replacement, or tuple change while allowing a fully classified unrelated worker to remain evidence only.
- [ ] 2.8 Issue exactly one `Target.createTarget({ url: 'https://example.com/' })`; bind its target/session/main frame; reject startup accepted pages, second targets, replacement, `Page.navigate`, reload, refresh, retry, and repair.
- [ ] 2.9 Use one non-resetting maximum 30-second accepted-target lifecycle budget and one exact binding across navigation, isolated context, logs, DOM, terminal outcome, and action authorization.
- [ ] 2.10 Record a bounded ordered timeline for worker discovery/continuity, target/frame lifecycle, page-bound execution contexts, normalized console/exception events, structural DOM samples, and an unconditional final state. Capture no arbitrary DOM, manifest raw values outside the safe projection, cookies, storage, credentials, or user data.
- [ ] 2.11 Emit exactly one fail-closed outcome: `extension-setup-failed`, `target-lifecycle-failed`, `content-context-absent`, `shared-runtime-unavailable`, `content-mount-absent`, `unexpected-content-failure`, or `mounted`.
- [ ] 2.12 Return action authorization only for clean `mounted` with the same worker and page binding; never click, dispatch an action event, call the product command, open options, or repair a failed lifecycle from the helper.

## 3. Focused Controls And Protected Scope

- [ ] 3.1 Cover invalid packaged MV3/background entry, foreign-first/exact-late, only-foreign, duplicate exact, unresolved candidate, entry mismatch, Runtime-ID mismatch, canonical manifest mismatch, accepted object-key reorder, and rejected array/value/field/default/alias/path differences.
- [ ] 3.2 Cover a fully classified unrelated worker after binding, exact duplicate/replacement, and every bound worker target/session/ID/entry/manifest continuity change.
- [ ] 3.3 Cover correct observation-before-target chronology and reject an accepted startup page, late listeners, a second target request, target replacement, wrong session/frame, foreign context, deadline reset, retry, reload, and repair.
- [ ] 3.4 Cover bounded diff-overflow evidence, total worker/event overflow, worker/options/main-world contexts, `Shared runtime unavailable`, another extension error, isolated-context-without-mount, false host-page root, missing final evidence, and clean mount authorization.
- [ ] 3.5 Prove the helper never invokes native action and that every non-mounted or invalidated-binding branch withholds the caller's click callback before activation.
- [ ] 3.6 Prove every existing E2E file, including Chrome harness/runtime and both Firefox precondition files, remains byte-identical.
- [ ] 3.7 Prove `src/**`, WXT/manifest/permissions, dependencies/lockfile, package scripts, timeouts, Runtime/coordinator/Offscreen/protocol/storage/UI, workflows/CI, reports, release metadata, refs/remotes, and Owner checkout remain unchanged.
- [ ] 3.8 Run implementation-owned focused/full tests, format/lint/type, strict OpenSpec, production Chrome MV3 and Firefox MV2 build/package/manifest, scope, and lineage gates. Do not run or claim canonical browser QA from the implementation seat.
- [ ] 3.9 Freeze one clean detached/ref-free immutable implementation exact as the sole child of this docs exact. Do not push, update PR/CI, merge, release, or touch the Owner checkout.

## 4. Fresh Review And Full Cross-Browser QA

- [ ] 4.1 Obtain one fresh Reviewer PASS for package-first identity authority, strict canonical relation, worker evidence/cardinality/continuity, chronology, target/context binding, terminal precedence, action withholding, deterministic controls, direct scope, and protected surfaces.
- [ ] 4.2 After Review PASS, obtain one fresh same-seat QA verdict from zero for the complete real Chrome MV3 plus Firefox MV2 matrix. Do not reuse QA task #287, QA task #298, or any earlier candidate evidence.
- [ ] 4.3 In Chrome, start at `about:blank`, establish observation, preserve every worker record/diff, derive one exact worker/manifest binding, create the accepted target exactly once, preserve the full timeline, and reach clean `mounted` without retry, reload, target substitution, or unexpected error.
- [ ] 4.4 After Chrome `mounted` authorization, perform exactly one real native toolbar action, prove `afterOptionsCount - beforeOptionsCount = 1` plus pre/post-action content Runtime on the same accepted target, and reject event dispatch, direct product invocation, manual options navigation, or post-click repair.
- [ ] 4.5 In Firefox, rerun initial startup plus two same-profile owned-process restarts and satisfy every existing exact add-on, Background Page, physical identity, one native click, options `+1`, pre/post Runtime, unexpected-error, and no-repair requirement in every generation.
- [ ] 4.6 Prove zero residual owned Chrome/Firefox browsers, drivers, profiles, packages, processes, ports, sessions, listeners, tabs, and temporary resources without touching unrelated Owner resources.

## 5. Follow-Up Routing

- [ ] 5.1 If the diagnostic ends `content-context-absent`, route a separate injection/browser-lifecycle authority; do not edit product under this change.
- [ ] 5.2 If it ends `shared-runtime-unavailable`, route a separate ClientLease/Coordinator/Offscreen authority from the exact evidence; do not broaden this helper.
- [ ] 5.3 If it ends `content-mount-absent` or `unexpected-content-failure`, route a separate content-bootstrap/WXT authority grounded in the bound context/log/DOM timeline.
- [ ] 5.4 Only after full same-exact Review and QA PASS may PM resume the later full E2E-runner or cumulative product route. No paused candidate or evidence set transfers.
