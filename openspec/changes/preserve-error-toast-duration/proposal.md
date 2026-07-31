## Why

On PR #85 source exact `87e93e3a5324e721e620962fbd953e1cb54ebd1f`, a failed manual reconnect can publish the generic `Connection failed` error Toast and remove it in the same millisecond even though the Toast surface remains mounted and no successor Toast exists. Read-only task #450 proved the sequence is `loading -> error -> dismiss`: request settlement clears the reconnect request, aggregate readiness returns to `ready`, and the generic ready reaction actively dismisses the stable `webchat-runtime-readiness` ID. Sonner's default duration never gets a chance to run.

The Owner requires error Toasts to keep the existing default duration and forbids business-driven active closure. A user may still dismiss the Toast, and a later explicit Toast using the same ID may replace it. This is an independent defect already present on `develop`; the relevant feedback source files are unchanged between `develop@d7fa3d386250aee22a740ca84e3cd29dadbbc724` and PR #85, so this requirement must use its own branch and PR rather than changing the reviewed PR #85 candidate.

## What Changes

- Treat an error descriptor's current presentation kind as authoritative for its lifetime. Application, Domain, readiness, bootstrap, panel, or presentation state transitions SHALL NOT actively dismiss a currently presented error.
- Preserve the generic Toast renderer's existing default duration. Do not add a custom duration, indefinite error lifetime, new timer, or second lifecycle owner.
- Allow only the existing user dismissal, natural default-duration expiry, a later explicit same-ID descriptor replacement, or actual Toast-surface teardown to end presentation of an error.
- Keep success and ready cleanup for matching loading entries. A ready/success transition may dismiss the current request/readiness loading entry after its existing dwell, but it SHALL NOT dismiss an error that now occupies the same stable ID.
- Preserve request-local identities, stale-request fences, unrelated Toasts, no-success-Toast behavior, panel state, retry/reconnect controls, and generic Toaster accessibility/visual configuration.
- Bind the bug with a deterministic parent FAIL-before that proves `loading -> error -> dismiss` and a candidate control that proves the error remains in the mounted Sonner store during the immediate window and then follows the default duration.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `webrtc-runtime`: Narrow generic feedback cleanup so business state can actively dismiss only matching loading feedback, while error feedback keeps its default presentation-owned lifetime.

## Impact

- Affected implementation after authority approval: application feedback mapping for readiness and request-terminal cleanup, plus generic Toast presentation regressions only where needed to preserve the semantic boundary.
- Affected source tests after authority approval: the exact manual reconnect/readiness race, loading-only ready cleanup, same-ID successor replacement, default-duration expiry, user dismissal, mounted/unmounted surface behavior, stale ownership, and unrelated Toast isolation.
- Unchanged: PR #85 source and review result; Runtime/network outcome; request settlement; protocol, ports, schema, persistence, dependencies, public APIs, Toast geometry/theme/placement, panel open state, success feedback policy, and existing recovery controls.
- QA, QC, and UX are not part of this task unless the Owner later requests them explicitly. Merge still requires separate explicit Owner authorization.
