## Why

Firefox content scripts cannot safely assimilate the Promise returned by the Web Locks API. Persistence preparation therefore avoids Web Locks in Firefox, converges on the canonical current storage state, and produces a bounded, user-recoverable result when IndexedDB deletion remains blocked.

## What Changes

- Select persistence-preparation coordination at browser composition: Firefox runs the versioned preparation operation directly, while Chrome uses Web Locks arbitration.
- Use the versioned message and configuration writes as the only persistence truth. Firefox has no second lock owner, background mutex, alternate storage path, or alternate format.
- Bound an IndexedDB version-reset deletion that reports `blocked`: if it does not settle within five seconds, the current initialization attempt fails instead of waiting forever.
- Route that terminal failure through the initialization state and generic error Toast so actions-menu Refresh can start a new current attempt.
- Preserve the current storage identities, versions, reset semantics, public ports, browser permissions, Runtime behavior, and user data boundaries.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `webrtc-runtime`: Define browser-specific persistence-preparation coordination and the bounded blocked-deletion terminal.

## Impact

- Affected behavior: content initialization that prepares local configuration and the IndexedDB message database in Firefox and Chrome.
- Affected implementation: persistence coordinator composition, versioned storage preparation, and IndexedDB deletion settlement.
- Affected verification: Firefox direct preparation, Chrome Web Locks preparation, concurrent convergence, blocked deletion, Retry, and browser-bound production initialization.
- Outside this change: stored schemas and identities, reset eligibility, protocol, message semantics, public APIs, dependencies, permissions, Runtime topology, and unrelated browser behavior.
