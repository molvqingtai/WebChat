## Context

The two waits belong to separate existing recovery owners: close-driven Artico peer replacement and ClientLease page-registration retry. Each owner already provides its required triggers, single-flight behavior, fencing, cancellation, and settlement boundaries. See `proposal.md` for motivation and `specs/webrtc-runtime/spec.md` for the normative cadence.

## Goals / Non-Goals

**Goals:**

- Change only the literal wait owned by each existing recovery path.
- Keep existing timer coverage aligned with the two resulting cadences.

**Non-Goals:**

- No recovery, lifecycle, ownership, or control-flow changes.
- No shared timing abstraction, new test case, dependency, or public surface.

## Decisions

### Keep the waits at their existing owners

Change the close-restart literal in the Artico transport owner to `5_000` and the default registration-retry literal in ClientLease to `1_000`. These values remain separate because they govern unrelated lifecycle transitions. A shared constant would create coupling without removing behavior or concepts.

Alternative considered: introduce named or shared configuration. Rejected because the requested values are fixed, each currently has one owner, and new structure would exceed the authorized numeric-only change.

### Synchronize only existing timer expectations

Mechanically update existing elapsed-time expectations whose value directly includes either changed wait. Do not add test cases or restructure timer setup. Existing tests already exercise the affected paths; this change only updates their expected cadence.

Alternative considered: add dedicated cadence suites. Rejected because that would expand test structure beyond the authorized change.

### Preserve every surrounding boundary

Do not change the immediate fresh-demand repair path, timer triggers, per-request deadline, total recovery budget, watchdog cadence, generation fencing, readiness behavior, or terminal settlement. The two literals must remain inputs to the existing control flow rather than new recovery policy.

## Risks / Trade-offs

- **Derived timer expectations can retain the prior elapsed total** -> Inspect and update only existing expectations directly composed from either changed wait.
- **A shared constant could falsely imply one policy** -> Keep the values local to their independent owners.
