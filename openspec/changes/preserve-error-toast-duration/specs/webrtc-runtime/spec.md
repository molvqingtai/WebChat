## ADDED Requirements

### Requirement: Error Toasts retain the generic default presentation lifetime

Every generic Toast descriptor currently presented as an error SHALL keep the existing generic Toast default duration. WebChat SHALL NOT assign an error-specific duration, make errors indefinite, add another timer, or create a second error-lifecycle owner.

While the same generic Toast surface remains mounted, application, Domain, Runtime readiness, bootstrap, panel, request-settlement, and presentation state transitions SHALL NOT actively dismiss a current error descriptor. A stable Toast ID identifies a presentation slot but SHALL NOT authorize a ready or success reaction to dismiss an error that replaced the slot's earlier loading entry. An ID-scoped business `DismissCommand` MAY settle only the matching current loading entry owned by that success/ready lifecycle, after any existing minimum dwell and request/generation fence.

A mounted error MAY end only when the user uses an existing supported manual dismissal, the generic default duration expires, or a later explicit generic Toast descriptor replaces the same ID. A bare dismiss command or implicit state such as `ready` SHALL NOT count as a successor descriptor. Explicit replacement SHALL start the successor descriptor's ordinary presentation lifecycle.

Actual teardown of the direct generic Toaster because the panel closes or its page/extension context ends MAY remove visible feedback without issuing a business dismiss. A terminal error removed with that surface SHALL NOT replay on a later mount. Ordinary readiness, bootstrap, request, or panel-state changes while the same surface remains mounted SHALL NOT impersonate teardown.

Failure SHALL still update the matching request/readiness loading entry to its normalized error. Request settlement MAY independently clear pending/button state but SHALL NOT clear that error presentation. Successful retry/reconnect and genuine ready transitions SHALL retain their existing matching-loading dismissal and no-success-Toast behavior. Delayed cleanup from an older request SHALL NOT dismiss a newer loading or error descriptor that uses the same stable ID. All cleanup SHALL remain ID-scoped and preserve unrelated Toasts.

The existing direct generic Toaster, visual configuration, accessibility behavior, user dismissal affordance, retry/reconnect controls, panel state, and Runtime/network truth SHALL remain unchanged. Preventing immediate active dismissal SHALL make the error available for its ordinary announcement and visible default lifetime, but the Toast SHALL NOT become a durable status store, a retry trigger, or a replacement for any separately specified unavailable/Retry surface. Toast dismissal, expiry, replacement, or teardown SHALL NOT change operation outcome or start another retry.

Deterministic evidence SHALL cover the real Remesh-to-Sonner boundary. The parent FAIL-before SHALL prove that a reconnect/manual connection terminal error with underlying readiness still `ready` and a mounted surface emits `loading -> error -> dismiss`, removes the error from the Sonner store immediately, and leaves the surface and an unrelated Toast intact. The candidate SHALL prove the same input emits no business dismiss after the error, retains the error in the immediate mounted-store window, and later permits generic default-duration expiry. Controls SHALL cover matching-loading success/ready dismissal, explicit same-ID replacement, user dismissal, actual surface teardown without terminal replay, stale request/generation fencing, and unrelated Toast isolation.

#### Scenario: Failed reconnect error survives the same ready settlement

- **GIVEN** a manual retry/reconnect owns the stable connection Toast ID, its loading entry is mounted, and underlying Runtime readiness remains `ready`
- **WHEN** the operation terminates with an error and request settlement returns aggregate feedback state from connecting to ready
- **THEN** WebChat SHALL update the loading entry to the normalized error, SHALL NOT actively dismiss that error, SHALL clear request/button pending state independently, and SHALL leave the error in the mounted Toast store for its ordinary lifetime

#### Scenario: Ready and success dismiss only current loading

- **GIVEN** a genuine ready or successful request transition owns cleanup for a matching stable Toast ID
- **WHEN** the current descriptor for that ID is still loading
- **THEN** WebChat MAY dismiss that loading entry after its existing dwell and fencing, SHALL publish no success Toast, and SHALL preserve unrelated entries

#### Scenario: Ready cannot dismiss an error occupying the same ID

- **GIVEN** an error descriptor has replaced the earlier loading entry at a stable ID
- **WHEN** readiness becomes or remains ready, request state clears, bootstrap settles, or panel state changes while the same Toaster remains mounted
- **THEN** no business `DismissCommand` SHALL remove that error and the default duration SHALL remain authoritative

#### Scenario: Explicit successor may replace an error

- **GIVEN** a current error remains visible at a stable Toast ID
- **WHEN** a later generic Toast descriptor explicitly publishes new content and type to the same ID
- **THEN** the later descriptor MAY replace the error and SHALL begin its own ordinary presentation lifecycle; an implicit ready state or bare dismiss SHALL NOT qualify as that successor

#### Scenario: User dismissal and default expiry remain available

- **GIVEN** an error is mounted and no explicit successor arrives
- **WHEN** the user uses an existing manual dismissal or the generic default duration expires
- **THEN** the error MAY close without creating a success descriptor, retry, Runtime transition, or second lifecycle fact

#### Scenario: Actual surface teardown does not require terminal replay

- **GIVEN** a terminal error is present on the direct generic Toaster
- **WHEN** the panel closes or the owning page/extension context ends and physically unmounts that surface
- **THEN** the visible error MAY disappear without a business dismiss, unrelated operation truth SHALL remain unchanged, and a later mount SHALL NOT replay the terminated request's error

#### Scenario: Error lifetime remains accessible and recovery-independent

- **GIVEN** a connection error is presented and an existing recovery or unavailable control has its own accessible state
- **WHEN** the error remains, is dismissed, expires, is replaced, or loses its surface
- **THEN** the generic Toaster SHALL retain its established error announcement/visual behavior, the control SHALL retain its own eligibility and operation semantics, and neither surface SHALL become the other's state authority

#### Scenario: Error cleanup remains isolated

- **GIVEN** unrelated Toast feedback exists while a connection loading entry becomes an error
- **WHEN** request, readiness, duration, user dismissal, replacement, or surface teardown settles feedback
- **THEN** no unscoped/global dismissal SHALL occur, stale cleanup SHALL affect no newer descriptor, and unrelated Toasts SHALL remain unchanged
