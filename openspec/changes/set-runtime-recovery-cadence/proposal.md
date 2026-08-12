## Why

Transport and control-plane recovery need deliberate fixed waits so repeated work does not begin too quickly while the preceding peer or Runtime-host transition is settling. The outer close-driven Artico replacement wait is increased from five to ten seconds without altering recovery ownership, triggers, deadlines, budgets, or user-facing behavior; the separate ClientLease retry wait remains unchanged.

## What Changes

- Set the close-driven Artico peer replacement wait to exactly 10,000ms instead of 5,000ms.
- Retain the default ClientLease wait between failed current `registerPage()` attempts at exactly 1,000ms.
- Preserve immediate disconnected-peer repair on fresh room demand, Socket.IO internal reconnect, AppButton/manual reconnect, ClientLease and Coordinator 5-second health checks, the Background heartbeat timeout, presence/grace/release timing, the existing ClientLease per-request deadline and overall recovery budget, every other cadence, and all current ownership, fencing, settlement, and feedback behavior.
- Implement only the Artico numeric substitution and mechanically synchronize existing Artico timer expectations made stale by it; add no logic, structure, abstraction, or new test case.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `webrtc-runtime`: Set the close-driven Artico replacement wait to ten seconds while retaining the separate ClientLease registration-retry wait and every surrounding recovery boundary.

## Impact

- Affected implementation: only the existing Artico close-restart timer.
- Affected tests: only existing Artico timer expectations that directly encode the changed value.
- Unchanged: Socket.IO internal reconnect, AppButton/manual reconnect, recovery triggers and ownership, immediate disconnected-peer repair, peer identity, desired-room handling, ClientLease registration retry, request deadlines and total budget, ClientLease and Coordinator health checks, Background heartbeat timeout, presence/grace/release timing, readiness/feedback, protocol, persistence, identity, wire behavior, dependencies, permissions, public APIs, and browser-specific behavior.
