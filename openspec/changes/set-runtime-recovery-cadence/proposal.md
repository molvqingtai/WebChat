## Why

Transport and control-plane recovery need deliberate fixed waits so repeated work does not begin too quickly while the preceding peer or room transition is settling. The close-driven Artico replacement wait and the Domain/World failed-recovery retry wait are increased from five to ten seconds without altering recovery ownership, triggers, deadlines, budgets, or user-facing behavior; the separate ClientLease retry wait remains unchanged.

## What Changes

- Set the close-driven Artico peer replacement wait to exactly 10,000ms instead of 5,000ms.
- Set the Connection Domain/World automatic recovery retry wait to exactly 10,000ms instead of 5,000ms.
- Retain the default ClientLease wait between failed current `registerPage()` attempts at exactly 1,000ms.
- Preserve immediate disconnected-peer repair on fresh room demand, Socket.IO internal reconnect, AppButton/manual reconnect, ClientLease and Coordinator 5-second health checks, the Background heartbeat timeout, presence/grace/release timing, the existing ClientLease per-request deadline and overall recovery budget, every other cadence, and all current ownership, fencing, settlement, and feedback behavior.
- Implement only the two network-retry numeric substitutions and mechanically synchronize existing timer expectations made stale by them; add no logic, structure, abstraction, or new test case.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `webrtc-runtime`: Set close-driven Artico replacement and Connection Domain/World failed-recovery retry to ten seconds while retaining the separate ClientLease registration-retry wait and every surrounding boundary.

## Impact

- Affected implementation: only the existing Artico close-restart timer and Connection Domain/World recovery-retry interval.
- Affected tests: only existing Artico and Connection timer expectations that directly encode either changed value.
- Unchanged: Socket.IO internal reconnect, AppButton/manual reconnect, recovery triggers and ownership, immediate disconnected-peer repair, peer identity, desired-room handling, ClientLease registration retry, request deadlines and total budget, ClientLease and Coordinator health checks, Background heartbeat timeout, presence/grace/release timing, readiness/feedback, protocol, persistence, identity, wire behavior, dependencies, permissions, public APIs, and browser-specific behavior.
