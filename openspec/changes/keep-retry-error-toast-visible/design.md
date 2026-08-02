## Context

`Initialization.ts` owns one current attempt generation and publishes generic feedback through `ToastDomain`. An attempt starts with the stable `webchat-initialization` loading descriptor. AppStatus remains the sole owner of `connecting | unavailable | ready`, and the actions-menu Refresh starts the next attempt.

## Goals / Non-Goals

**Goals:**

- Make current initialization failure one atomic loading-to-error replacement.
- Keep the normalized error visible for the generic Toast's default lifetime or until ordinary user dismissal/replacement.
- Preserve success cancellation and generation fencing.

**Non-Goals:**

- Adding another Toast identity, timer, renderer, presenter, state owner, error component, Retry control, or browser branch.
- Changing initialization stage order, deadlines, error copy, shell composition, Toast styling, or Runtime/storage behavior.
- Retaining errors from superseded, aborted, or unmounted attempts.

## Decisions

### 1. The stable descriptor identity represents the current attempt

Initial execution and every Retry publish `Preparing WebChat` with ID `webchat-initialization`. The current terminal result settles that same identity. A successful attempt cancels its matching loading descriptor. A failed attempt publishes `WebChat unavailable` as an error descriptor with the same ID.

### 2. Failure replacement performs no preceding cancel

The failure command batch marks AppStatus unavailable and publishes the same-ID error. It does not cancel that ID first. This makes the error the direct successor of loading and prevents asynchronous dismissal work for the same identity from deleting the newly published terminal.

### 3. Existing generation ownership remains authoritative

Only the active, non-aborted generation may publish success or error. Starting Retry aborts the prior attempt and publishes loading for the new generation. Delayed work from the prior generation cannot cancel, replace, or otherwise settle the current descriptor.

### 4. Generic Toast behavior remains the presentation boundary

The error retains the existing copy, dismissibility, default lifetime, replacement behavior, and panel-owned Toaster. Initialization owns only operation settlement; it adds no timer, DOM observation, Toast acknowledgement, or presentation state.

### 5. Verification exercises the real feedback boundary

Controls cover an initial failure, failure after Retry, repeated current failures, success after Retry, abort/unmount, stale generations, and unrelated Toast identities. Browser-rendered coverage proves the same-ID error remains after the framework's deferred publish cycle.

## Risks / Trade-offs

- [The same ID is reused across attempts] -> Attempt generation fencing decides which operation may settle it.
- [The Toast library schedules descriptor work asynchronously] -> Failure publishes one successor descriptor and creates no preceding cancel for that ID.
- [A later Retry replaces the current error with loading] -> That is the new user-requested attempt and retains the same single feedback identity.
