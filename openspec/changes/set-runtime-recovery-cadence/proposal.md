## Why

Transport and control-plane recovery need deliberate fixed waits so repeated work does not begin too quickly while the preceding peer or Runtime-host transition is settling. The waits must change without altering recovery ownership, triggers, deadlines, budgets, or user-facing behavior.

## What Changes

- Set the close-driven Artico peer replacement wait to exactly 5,000ms.
- Set the default ClientLease wait between failed current `registerPage()` attempts to exactly 1,000ms.
- Preserve immediate disconnected-peer repair on fresh room demand, the existing ClientLease per-request deadline and overall recovery budget, every other cadence, and all current ownership, fencing, settlement, and feedback behavior.
- Implement only the two numeric substitutions and mechanically synchronize existing timer expectations made stale by them; add no logic, structure, abstraction, or new test case.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `webrtc-runtime`: Fix the close-driven Artico replacement wait and ClientLease registration-retry wait while preserving every surrounding recovery boundary.

## Impact

- Affected implementation: the existing Artico close-restart timer and ClientLease default registration-retry interval.
- Affected tests: only existing timer expectations that directly encode either changed value.
- Unchanged: recovery triggers and ownership, immediate disconnected-peer repair, peer identity, desired-room handling, ClientLease request deadlines and total budget, watchdog cadence, readiness/feedback, protocol, persistence, dependencies, permissions, public APIs, and browser-specific behavior.
