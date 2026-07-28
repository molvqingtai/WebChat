## 1. Baseline And Scope

- [ ] 1.1 Freeze `develop@ad874b18404c62bfc10556e21460949cb782142d`, the current Refresh availability/Domain gates, focused tests, and protected Runtime/extern/protocol/persistence identities before source edits.
- [ ] 1.2 Create a clean detached sole child of the OpenSpec authority exact; keep the Owner checkout and its untracked `.pnpm-store/` untouched.
- [ ] 1.3 Limit direct production scope to the application ChatRoom Domain and actions-menu Refresh view; add only focused tests required to prove the changed contract.

## 2. Domain Recovery Admission

- [ ] 2.1 Add one derived ChatRoom Domain Refresh-availability Query from configured user identity, initial-join loading, and the existing recovery request; do not add eligibility State or gate on joined/readiness/panel state.
- [ ] 2.2 Make `ReconnectCommand` guard on that Query, create exactly one existing request identity, and atomically fence another initial join or recovery.
- [ ] 2.3 Preserve the joined path's existing `leaveRoom()` then `joinRoom(retainedInput)` behavior and logical-presence boundaries.
- [ ] 2.4 Add the unjoined retry path: construct current user/site input, set join status loading, call `joinRoom()` directly without `leaveRoom()`, and keep the same request/Toast lifecycle.
- [ ] 2.5 On retry success, reuse normal join completion for retained input, message reload, finished status, and one self-join fact, then dismiss only the matching loading Toast without a success descriptor; on failure, reuse join failure, normalize the same request error, retain its error Toast, and return to retryable initial status.

## 3. Refresh View

- [ ] 3.1 Bind button disabled state to the Domain availability Query instead of a joined-based React helper, while retaining the existing request-pending spinner.
- [ ] 3.2 Provide accurate accessible labels for missing identity, initial join in flight, unjoined retry, active recovery, and joined reconnect without adding visible status regions or visual restyling.
- [ ] 3.3 Preserve panel open/closed state, direct dispatch, original actions-menu structure, direct `AppMain -> <Toaster>`, and absence of bootstrap/fixed readiness fallback UI.

## 4. Focused Verification

- [ ] 4.1 Add Domain tests for missing identity, automatic initial-join single-flight, terminal failed-join eligibility, direct retry without leave, successful joined-state completion, failed retry re-eligibility, and Runtime-unavailable independence.
- [ ] 4.2 Preserve and extend joined reconnect, duplicate request, success dismissal without `Ready to chat`, request-local error Toast settlement, stale callback, closed-panel, and unrelated Toast regression coverage.
- [ ] 4.3 Add view tests proving the shared Domain eligibility Query controls disabled state, joined is not an availability prerequisite, panel state is not consulted, labels are accurate, and the current pending icon remains stable.
- [ ] 4.4 Run focused tests, canonical full tests, format/lint/type checks, OpenSpec strict validation, and applicable Chrome/Firefox production build gates on the same source exact; no earlier exact evidence transfers.
- [ ] 4.5 Prove `ChatRoomExtern` remains exactly eight methods and Runtime, protocol, persistence, WorldRoom, dependencies, workflow, WXT, Toaster structure, and public APIs remain unchanged.

## 5. Review And Release

- [ ] 5.1 Freeze one clean immutable source exact with exact/tree/parent/patch identity, direct and cumulative scope, zero unintended refs, and exact-bound evidence.
- [ ] 5.2 Obtain fresh independent Reviewer PASS for recovery semantics, single-flight admission, success/failure state transitions, stale fencing, regression sensitivity, and protected boundaries.
- [ ] 5.3 Synchronize the accepted exact without touching `.pnpm-store/`; Owner locally verifies that Refresh is clickable after a real failed join, retry starts immediately, pending prevents duplicate clicks, and a successful retry joins chat without a `Ready to chat` Toast.
- [ ] 5.4 After all required checks and Owner acceptance pass, publish only to `develop` by verified normal fast-forward and stop on remote drift; do not modify `master`, `v2.0.0`, or release metadata in this change.
