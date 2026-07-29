## 1. Authority And Fail-Before

- [x] 1.1 Use docs exact `ab5278eea3134d3fb4a0755119b2419ccbd03e16` as the sole parent, record its tree/clean/ref state, and keep Coder #268 plus its dirty pre-freeze tooling worktree/candidate paused and non-transferable.
- [x] 1.2 Add focused fail-before coverage using the Firefox MV2 browser shape (`browser.browserAction` present, `browser.action` absent) and prove current background initialization throws before registering the action click.
- [x] 1.3 Record protected paths for WXT config, generated manifest semantics, dependencies, AppAction contract, coordinator/Runtime/Offscreen/protocol/persistence/content UI, release metadata, and all E2E runner/fixture/reporter/CI surfaces.

## 2. Platform-Correct Registration

- [x] 2.1 Select `browser.action.onClicked` only for Chrome MV3 and `browser.browserAction.onClicked` only for Firefox MV2 using the existing production build platform identity.
- [x] 2.2 Require the selected namespace and `onClicked.addListener`; reject silent optional chaining, expected-error allowlisting, and opportunistic cross-platform runtime fallback.
- [x] 2.3 Register one listener per background generation and route one accepted click exactly once through the existing `AppAction.openOptionsPage()` command without adding popup/tab/retry/debounce behavior.
- [x] 2.4 Add deterministic Chrome, Firefox, missing-selected-API, listener-uniqueness, exactly-once click, and repeated-generation controls. Any source-local helper must remain specific to this registration boundary.

## 3. Scope And Implementation Gates

- [x] 3.1 Keep production changes limited to the background action-registration boundary and focused tests/support. Do not change WXT config, manifests/permissions, dependencies, AppAction behavior, Runtime/coordinator/Offscreen, protocol, storage/database, content UI, E2E tooling, CI, or release paths.
- [x] 3.2 Run the implementation-owned focused/full tests, format/lint/type, strict OpenSpec, production Chrome MV3 and Firefox MV2 build/package, manifest-structure, and protected-path gates on one clean exact. Do not interpret Runtime traffic alone as action-registration PASS.
- [x] 3.3 Freeze one clean detached/ref-free immutable product repair exact as the sole child of this docs authority, recording exact/tree/parent/direct scope/protected paths and no unintended refs. Do not push, update PR/CI, merge, release, or touch the Owner checkout.

## 4. Fresh Review And Real Cross-Browser QA

- [ ] 4.1 Obtain one fresh Reviewer PASS on the immutable repair exact for platform selection, fail-closed behavior, one-listener/one-command semantics, focused tests, Chrome preservation, protected scope, and evidence identity.
- [ ] 4.2 Obtain one fresh same-seat cross-browser QA PASS. On the exact Chrome MV3 artifact prove one Service Worker, no action-registration or unexpected extension error, one real toolbar action activation, and exactly one options-page result.
- [ ] 4.3 On the exact Firefox MV2 XPI in a separate owned profile, prove initial startup plus at least two owned-process restart generations with explicit target restoration. In every generation prove exactly one persistent Background Page, no action-registration or unexpected extension error, and preserved Runtime readiness/traffic; in at least one generation perform a real toolbar action activation and prove exactly one options-page result.
- [ ] 4.4 Prove strict zero-residual cleanup for owned Chrome, Firefox, geckodriver, profiles, exact artifacts/packages, ports, listeners, and temporary resources without touching unrelated Owner resources. Preserve first-run failure evidence and use no automatic retry as canonical replacement.
- [ ] 4.5 Treat `6f81011b...`, Coder #268's paused worktree/candidate, `0756b50...`, and every prior Review/QA/canonical/browser/CI/cleanup result as diagnostic history only.

## 5. Return To The E2E Route

- [ ] 5.1 Keep all E2E tooling implementation paused until tasks 4.1-4.4 pass on the same immutable repair exact.
- [ ] 5.2 After product acceptance, have PM freeze a new superseding `establish-cross-browser-e2e-runner` docs authority as the clean sole child of the accepted repair exact.
- [ ] 5.3 Have Planner create a fresh tooling implementation task whose clean candidate is the sole child of that later docs exact. Never resume, rebase, copy, or use evidence from the current Coder #268 worktree/candidate.
- [ ] 5.4 Route the later tooling exact through its own fresh Reviewer and same-seat cross-browser QA contract. Publication, PR/CI update, merge, release, and Owner checkout changes remain separately authorized.
