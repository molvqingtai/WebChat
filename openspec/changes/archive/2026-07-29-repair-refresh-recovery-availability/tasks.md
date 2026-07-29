> **Completion status (2026-07-30):** The Owner explicitly accepted cumulative PR #76 at immutable exact `b8f5a4a8d4c001a4963be706dab7c6891efe75c5` and authorized merge. Exact CI run `30489904228` passed setup/linter/tests/build 4/4, fresh Review task #362 passed P0/P1/P2 `0/0/0`, and PR #76 merged into `develop` through `88a8af17e9560dc15a36e29412d3df52ef69a220`. A checked item means implemented, superseded by a later accepted exact, or explicitly closed by Owner acceptance; it does not reinterpret a historical BLOCKED, FAIL, UNVERIFIED, or unexecuted browser result as PASS. QA task #363 remained nonblocking at merge. Its later post-merge report recorded the Chrome MV3 unreachable-endpoint failure path as PASS, the Chrome success path as UNVERIFIED, and Firefox MV2 as UNVERIFIED; report SHA-256 `f840338225a53d16f863775721bd2e4ef7fcd7059dedc5e2126ac997dd995136` and log SHA-256 `c3fc31fcbb3a8950126aefde559e82e7c13ca345af62cdd4a1a48df293bcb95b`.

## 1. Baseline And Scope

- [x] 1.1 Freeze `develop@ad874b18404c62bfc10556e21460949cb782142d`, the current Refresh availability/Domain gates, focused tests, and protected Runtime/extern/protocol/persistence identities before source edits.
- [x] 1.2 Create a clean detached sole child of the OpenSpec authority exact; keep the Owner checkout and its untracked `.pnpm-store/` untouched.
- [x] 1.3 Limit direct production scope to the application ChatRoom Domain and actions-menu Refresh view; add only focused tests required to prove the changed contract.

## 2. Domain Recovery Admission

- [x] 2.1 Add one derived ChatRoom Domain Refresh-availability Query from configured user identity, initial-join loading, and the existing recovery request; do not add eligibility State or gate on joined/readiness/panel state.
- [x] 2.2 Make `ReconnectCommand` guard on that Query, create exactly one existing request identity, and atomically fence another initial join or recovery.
- [x] 2.3 Preserve the joined path's existing `leaveRoom()` then `joinRoom(retainedInput)` behavior and logical-presence boundaries.
- [x] 2.4 Add the unjoined retry path: construct current user/site input, set join status loading, call `joinRoom()` directly without `leaveRoom()`, and keep the same request/Toast lifecycle.
- [x] 2.5 On retry success, reuse normal join completion for retained input, message reload, finished status, and one self-join fact, then dismiss only the matching loading Toast without a success descriptor; on failure, reuse join failure, normalize the same request error, retain its error Toast, and return to retryable initial status.

## 3. Refresh View

- [x] 3.1 Bind button disabled state to the Domain availability Query instead of a joined-based React helper, while retaining the existing request-pending spinner.
- [x] 3.2 Provide accurate accessible labels for missing identity, initial join in flight, unjoined retry, active recovery, and joined reconnect without adding visible status regions or visual restyling.
- [x] 3.3 Preserve panel open/closed state, direct dispatch, original actions-menu structure, direct `AppMain -> <Toaster>`, and absence of bootstrap/fixed readiness fallback UI.

## 4. Focused Verification

- [x] 4.1 Add Domain tests for missing identity, automatic initial-join single-flight, terminal failed-join eligibility, direct retry without leave, successful joined-state completion, failed retry re-eligibility, and Runtime-unavailable independence.
- [x] 4.2 Preserve and extend joined reconnect, duplicate request, success dismissal without `Ready to chat`, request-local error Toast settlement, stale callback, closed-panel, and unrelated Toast regression coverage.
- [x] 4.3 Add view tests proving the shared Domain eligibility Query controls disabled state, joined is not an availability prerequisite, panel state is not consulted, labels are accurate, and the current pending icon remains stable.
- [x] 4.4 Run focused tests, canonical full tests, format/lint/type checks, OpenSpec strict validation, and applicable Chrome/Firefox production build gates on the same source exact; no earlier exact evidence transfers.
- [x] 4.5 Prove `ChatRoomExtern` remains exactly eight methods and Runtime, protocol, persistence, WorldRoom, dependencies, workflow, WXT, Toaster structure, and public APIs remain unchanged.

## 5. Review And Release

- [x] 5.1 Freeze one clean immutable source exact with exact/tree/parent/patch identity, direct and cumulative scope, zero unintended refs, and exact-bound evidence.
- [x] 5.2 Obtain fresh independent Reviewer PASS for recovery semantics, single-flight admission, success/failure state transitions, stale fencing, regression sensitivity, and protected boundaries.
- [x] 5.3 Synchronize the accepted exact without touching `.pnpm-store/`; Owner locally verifies that Refresh is clickable after a real failed join, retry starts immediately, pending prevents duplicate clicks, and a successful retry joins chat without a `Ready to chat` Toast.
- [x] 5.4 After all required checks and Owner acceptance pass, publish only to `develop` by verified normal fast-forward and stop on remote drift; do not modify `master`, `v2.0.0`, or release metadata in this change.
