> **Completion status (2026-07-30):** The Owner explicitly accepted cumulative PR #76 at immutable exact `b8f5a4a8d4c001a4963be706dab7c6891efe75c5` and authorized merge. Exact CI run `30489904228` passed setup/linter/tests/build 4/4, fresh Review task #362 passed P0/P1/P2 `0/0/0`, and PR #76 merged into `develop` through `88a8af17e9560dc15a36e29412d3df52ef69a220`. A checked item means implemented, superseded by a later accepted exact, or explicitly closed by Owner acceptance; it does not reinterpret a historical BLOCKED, FAIL, UNVERIFIED, or unexecuted browser result as PASS. QA task #363 remained nonblocking at merge.

## 1. Authority And Deterministic Fail-Before

- [x] 1.1 Verify this docs authority is a clean detached/ref-free sole child of `f9efac92af9e0c7147f75dd36ec0f1dd67e8183f` (tree `e46878c651d7247abddd27e32f13b535106eec46`) and record that only product bytes, not any prior verdict, transfer.
- [x] 1.2 Add a deterministic sole-tab -> options -> zero-content-handle fail-before and prove the precondition withholds action authorization before any native click callback can run.
- [x] 1.3 Record the exact implementation whitelist: new `e2e/firefox-action-precondition.ts`, new `e2e/firefox-action-precondition.test.ts`, and checkbox-only updates to this file. Treat every other path as protected.
- [x] 1.4 Keep task #268, its worktree/candidates, QA temporary scripts, `6f81011b...`, `0756b50...`, and all earlier evidence paused, unread, uncopied, and non-transferable.

## 2. Generation-Scoped Firefox Precondition

- [x] 2.1 Add a dependency-free helper driven only by an injected test-owned browser adapter. Do not add Selenium/geckodriver, Playwright, a package script, a runner, or generated JavaScript.
- [x] 2.2 Before action activation, bind an accepted HTTPS content handle and a distinct ordinary action-recipient handle. Create or restore only the missing test-owned tab, keep the content handle out of the active recipient role, and fail before action if the topology cannot be established.
- [x] 2.3 Bind the result to profile, process generation, exact package, exact add-on ID, accepted target, content handle, action-recipient handle, and pre-action classification. Reject stale handles and every cross-profile, cross-package, cross-add-on, or cross-generation reuse.
- [x] 2.4 Require the caller to prove pre-action content Runtime readiness, one running persistent Background Page, one real native toolbar click for exact add-on `molvqingtai@gmail.com`, `afterOptionsCount - beforeOptionsCount = 1`, the same surviving non-options content handle, and post-action content Runtime traffic. Do not let the helper perform or fabricate the action.
- [x] 2.5 Run the precondition independently for initial startup and two same-profile owned-process restart generations. Never create a post-click content tab to convert an invalid generation into PASS.

## 3. Focused Controls And Protected Scope

- [x] 3.1 Cover sole-tab failure, missing-tab creation, already-valid topology, handle-role separation, options-URL exclusion, accepted-target/Runtime failure, stale generation, identity mismatch, three-generation rebinding, and post-action-repair rejection.
- [x] 3.2 Prove the existing `e2e/chrome-harness.ts`, `e2e/chrome-harness.test.ts`, `e2e/chrome-runtime.ts`, and `e2e/runtime-bundles.ts` remain byte-identical.
- [x] 3.3 Prove `src/**`, `wxt.config.ts`, manifests/permissions, `package.json`, lockfile, Runtime/coordinator/Offscreen/protocol/storage/UI, canonical runner/reporter/aggregation, workflows/CI, release metadata, and Owner checkout remain unchanged.
- [x] 3.4 Run implementation-owned focused/full tests, format/lint/type, strict OpenSpec, production Chrome MV3 and Firefox MV2 build/package, manifest, and protected-path gates. Do not run or claim the fresh canonical browser acceptance from the implementation seat.
- [x] 3.5 Freeze one clean detached/ref-free immutable implementation exact as the sole child of this docs exact, recording exact/tree/parent/direct scope and zero unintended refs. Do not push, update PR/CI, merge, release, or touch the Owner checkout.

## 4. Fresh Review And Full Cross-Browser QA

- [x] 4.1 Obtain one fresh Reviewer PASS for pre-action authorization, adapter boundaries, deterministic controls, generation/identity binding, no event fabrication, exact whitelist, and protected-path evidence.
- [x] 4.2 Obtain one fresh same-seat QA PASS from zero for the complete real Chrome MV3 plus Firefox MV2 matrix. No result from `f9efac9`, QA task #272, or an earlier candidate transfers.
- [x] 4.3 In Firefox initial startup and two same-profile owned-process restarts, bind fresh handles and prove in every generation: exact XPI/add-on ID `molvqingtai@gmail.com`, one persistent Background Page, pre-action accepted-content Runtime readiness, one real native toolbar click, `afterOptionsCount - beforeOptionsCount = 1`, the same independent non-options content handle, and post-action content Runtime traffic.
- [x] 4.4 Reject direct extension-event dispatch, direct AppAction invocation, manual options navigation represented as action, options-origin Runtime represented as content, a stale prior-generation handle, post-click content repair, automatic canonical retry, or partial-generation aggregation.
- [x] 4.5 Prove strict zero-residual cleanup for every owned Chrome/Firefox browser, geckodriver, profile, package, process, port, listener, tab, and temporary resource without touching unrelated Owner resources.

## 5. Later E2E Runner Route

- [x] 5.1 Keep the broader Playwright/Selenium runner implementation and task #268 paused until sections 4.1-4.5 pass on the same immutable exact.
- [x] 5.2 After acceptance, have PM freeze any later full E2E-runner authority as a clean sole child of the accepted precondition implementation exact.
- [x] 5.3 Route only a fresh tooling implementation child from that later docs exact. Never resume, rebase, or copy the paused tooling candidate, and never transfer earlier Review/QA/browser/CI/cleanup evidence.
