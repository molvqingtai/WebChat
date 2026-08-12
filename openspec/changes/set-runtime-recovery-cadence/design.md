## Context

The recovery waits belong to separate existing owners: close-driven Artico peer replacement, Connection's Domain/World recovery retry, and ClientLease page-registration retry. The current product decision increases the two waits that initiate signaling or room-join recovery from `5_000` to `10_000` milliseconds; ClientLease remains at `1_000` milliseconds. Each owner already provides its required triggers, single-flight behavior, fencing, cancellation, and settlement boundaries. See `proposal.md` for motivation and `specs/webrtc-runtime/spec.md` for the normative cadence.

## Goals / Non-Goals

**Goals:**

- Change only the close-driven Artico replacement and Connection Domain/World recovery literals from `5_000` to `10_000`.
- Keep existing Artico and Connection timer coverage aligned with the resulting cadence.
- Retain the separate ClientLease retry wait at `1_000` and every non-network-retry cadence unchanged.

**Non-Goals:**

- No recovery, lifecycle, ownership, or control-flow changes.
- No Socket.IO reconnect configuration, backoff, jitter, reconnect-owner consolidation, shared timing abstraction, new test case, dependency, or public surface.

## Decisions

### Keep the waits at their existing owners

Change the close-restart literal in the Artico transport owner and the Domain/World recovery-retry literal in Connection to `10_000`; retain the default registration-retry literal in ClientLease at `1_000`. These values remain local because the two network paths have independent owners and ClientLease governs a separate control-plane lifecycle. A shared constant would create coupling without removing behavior or concepts.

Alternative considered: introduce named or shared configuration. Rejected because the requested values are fixed, each currently has one owner, and new structure would exceed the authorized numeric-only change.

### Synchronize only existing network-retry timer expectations

Mechanically update existing elapsed-time expectations whose value directly includes either changed network-retry wait. Existing close-recovery, Domain recovery, and World recovery controls must prove that no replacement or retry begins before `10_000ms` and exactly one begins when the boundary is reached. Do not add test cases or restructure timer setup. Existing tests already exercise immediate fresh-demand repair, stale callback fencing, cancellation, disposal, single replacement, failed initial joins, and failed active-room recovery; this change only aligns those controls with the new cadence. ClientLease expectations remain unchanged.

Alternative considered: add dedicated cadence suites. Rejected because that would expand test structure beyond the authorized change.

### Preserve every surrounding boundary

Do not change the immediate fresh-demand repair path, timer triggers, AppButton/manual reconnect behavior, Socket.IO's internal reconnect behavior, ClientLease or Coordinator health checks, Background heartbeat timeout, presence/grace/release timing, per-request deadline, total recovery budget, generation fencing, readiness behavior, or terminal settlement. The two changed literals remain inputs to existing control flow rather than a new recovery policy.

## Risks / Trade-offs

- **Derived timer expectations can retain the prior elapsed total** -> Inspect and update only existing expectations directly composed from the Artico close-restart or Connection Domain/World recovery wait.
- **A shared constant could falsely imply one policy** -> Keep the values local to their independent owners.
