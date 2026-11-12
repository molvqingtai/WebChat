## Context

The Content composition owns both a page-local ClientLease and page-local Runtime feedback. Browser navigation can permanently destroy that composition or preserve the same JavaScript and DOM generation in the back-forward cache. The shared Runtime and Rooms have a separate lifetime and can remain ready while a Content document is suspended.

Connection feedback is meaningful only while its Content document is active. Lease cleanup is a lifecycle operation, not evidence that the user-visible page has started a new connection attempt.

## Goals / Non-Goals

**Goals:**

- Give one Content composition owner the terminal-exit, BFCache-suspend, and BFCache-restore transitions.
- Make page feedback silent before lease cleanup changes page-local readiness.
- Restore one suspended page binding exactly once and immediately reconcile feedback from current Runtime truth.
- Keep cleanup, restoration, subscriptions, callbacks, and watchdogs generation-safe and idempotent.
- Cover the complete lifecycle-to-feedback path with deterministic regressions.

**Non-Goals:**

- Changing shared Runtime, ChatRoom, WorldRoom, transport, protocol, persistence, or retry semantics.
- Treating a detached page as ready, retaining a lease through a terminal exit, or adding a second connection owner.
- Adding a user control, status view, Toast type, durable lifecycle flag, parallel lifecycle branch, dependency, or test-only production seam.
- Coupling this lifecycle to ordinary document visibility changes that do not suspend or end the document.

## Decisions

### 1. The Content composition is the sole document-lifecycle owner

One composition-level owner coordinates page feedback, active sends, ClientLease ownership, and restoration. `beforeunload` is not an independent lease authority. Browser lifecycle signals may feed this owner, but no Domain, component, feedback adapter, or watchdog may create a second document-active truth.

### 2. Feedback becomes silent before cleanup

When a document begins terminal exit or BFCache suspension, the lifecycle owner first stops page-scoped Runtime feedback and removes only its readiness presentation. It then cancels page-owned work and releases the ClientLease exactly once. A resulting page-local host phase change cannot create or update `webchat-runtime-readiness` while the document is departing or suspended.

This ordering does not alter Runtime readiness. It only removes an inactive document's authority to present that truth.

### 3. BFCache restoration creates one current page binding

On `pageshow` with `persisted=true`, the same document generation starts exactly one current attach/init operation and reinstalls one feedback subscription. Feedback resumes against the resulting current snapshot, not the suspended local snapshot. Current `ready` dismisses the stable readiness slot without a success Toast; current `connecting` or `unavailable` may use the existing presentation rules.

Terminal exit has no restoration path. A new document receives its own normal bootstrap and cannot reuse the ended generation's callbacks, watchdog, subscription, or late results.

### 4. Repeated lifecycle signals are idempotent

Duplicate hide, show, cleanup, and late async completion signals cannot create another page lease, feedback subscription, callback set, watchdog, or UI/store owner. Repeated Back/Forward cycles alternate the same generation between one suspended owner and one active owner.

### 5. Evidence crosses the real ownership boundary

The parent control must consume the real composition lifecycle, ClientLease transition, readiness mapping, and AppFeedback owner so the exit loading and missing BFCache restoration fail before repair. Candidate controls must prove terminal silence, one suspend/restore sequence, current-ready reconciliation, repeated-cycle idempotency, and final cleanup. Local unit tests for those parts remain useful but cannot substitute for the composed regression.

## Risks / Trade-offs

- [A document resumes after the shared Runtime changed] -> Reattach from current Runtime facts and ignore every suspended-generation late result.
- [A browser emits duplicate lifecycle signals] -> Fence attach and cleanup by the current document generation and make both operations idempotent.
- [A page was genuinely connecting before suspension] -> Remove inactive presentation, then republish only if the restored current snapshot is still connecting.
- [A terminal document never receives another event] -> Complete all owned cancellation and lease release in the terminal transition without relying on restoration.

## Open Questions

None.
