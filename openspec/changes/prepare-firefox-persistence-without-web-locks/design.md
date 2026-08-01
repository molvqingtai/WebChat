## Context

Content initialization prepares browser-sync configuration, origin-local configuration, and the per-origin message database before Runtime activation. The preparation lifecycle owns generation fencing, version checks, reset writes, and retry from persisted truth. Browser composition supplies the one coordination strategy used by the local-configuration and message-database stages.

## Goals / Non-Goals

**Goals:**

- Keep one persistence-preparation lifecycle and one version authority for each storage family.
- Avoid the Firefox content-script Web Locks Promise boundary.
- Use Chrome cross-context arbitration through Web Locks.
- Give a blocked IndexedDB deletion one bounded terminal that reaches the initialization recovery surface.

**Non-Goals:**

- Adding a background lock service, alternate persistence owner, alternate format, browser-specific schema, or public API.
- Changing current storage identities, version numbers, reset eligibility, clear/delete scope, or successful initialization behavior.
- Adding a persistence-preparation panel, dialog, notification, success Toast, or close-tabs instruction.

## Decisions

### 1. Browser composition owns the coordinator choice

The content entry selects one `PreparationLockCoordinator` from the WXT browser target. Firefox supplies direct acquisition, which returns an immediate release function and never reads `navigator.locks`. Chrome supplies the Web Locks coordinator. Storage implementations consume the injected coordinator and do not choose a browser or maintain parallel coordination state.

### 2. Firefox converges through current versioned operations

Direct Firefox preparation uses the generation owner, abort fencing, checkpoints, version reads, idempotent completion writes, and canonical storage boundaries. Concurrent tabs may execute the same current-version decision, but no tab introduces another version, identity, schema, or durable lock state. The settled storage version and current canonical data remain authoritative.

### 3. Blocked IndexedDB deletion has a five-second terminal

The first `blocked` event for canonical message-database deletion starts one five-second timer. Success or error clears that timer. If the request remains blocked at the deadline, the current preparation rejects with `Message store deletion blocked`; it does not report readiness or start a competing delete operation.

### 4. Initialization feedback owns recovery

A preparation rejection terminates only the current initialization attempt. The initialization owner marks the application unavailable and publishes the normalized generic `WebChat unavailable` error Toast. Actions-menu Refresh starts a later current attempt. Persistence preparation adds no separate retry state or dedicated user-facing copy.

### 5. Verification binds source and production behavior

Deterministic controls cover browser coordinator selection, no Firefox Web Locks call, Chrome Web Locks arbitration, concurrent direct convergence, generation fencing, and blocked deletion before, at, and after the deadline. Production Firefox verification covers current initialization and concurrent tabs; blocked-timeout browser evidence remains distinct from deterministic coverage and is never inferred from it.

## Risks / Trade-offs

- [Firefox tabs prepare concurrently] -> Keep operations versioned, idempotent, generation-fenced, and restricted to the canonical current storage identities.
- [A live IndexedDB connection blocks deletion] -> Fail the current attempt after five seconds and expose the retryable initialization error instead of hanging.
- [A late browser event follows the bounded terminal] -> It cannot turn the failed attempt into application readiness; only a later current initialization attempt may publish ready state.
- [Browser selection drifts] -> Bind composition and regression coverage to WXT's production browser target and real Firefox/Chrome builds.
