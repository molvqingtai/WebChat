## Why

WebChat currently supports only Trystero and composes it directly in the shared Runtime host. That clean-cut was useful while validating Trystero, but it removed the provider interchangeability already present behind the private `RoomTransportExtern` boundary.

The product now requires both Artico and Trystero to remain supported, with Artico selected by default. Artico's existing upstream PR #41 isolates failures between room Calls but still invokes pending Calls. The same PR is being completed so Artico room fan-out acts only on Calls whose DataChannel is already open. That makes its immediate best-effort send semantics compatible with the current provider-neutral Runtime contract without reintroducing application-owned peer enumeration, waits, retries, or delivery state.

## What Changes

- Restore the Artico adapter under its own provider directory while retaining the current Trystero adapter and its provider-local peer-connect error silence.
- Add one build-time provider selection constant under `src/constants/`, default it to `artico`, and keep the sole concrete selection/composition helper inside Runtime. Each host instance creates exactly one selected transport; there is no simultaneous dual connection, runtime hot switch, automatic fallback, user setting, or environment selector.
- Require both adapters to satisfy the same root provider-neutral RoomTransport contract. Omitted targets mean provider-native broadcast to peers ready at invocation; explicit targets select only ready peers; `[]` means no recipients. Pending peers are skipped without queueing or later replay.
- Restore Artico's per-room owner, explicit `wss://web-chat.io` signaling composition, scoped recovery, and provider-local lifecycle while keeping every Artico type out of Domain, protocol, UI, persistence, and comctx contracts.
- During implementation and Owner acceptance, pin `@rtco/client` to the full immutable commit of the Owner fork integration containing the completed PR #41 candidate and the retained relevant Artico fixes. Before any merge to `develop`, replace that temporary Git dependency with an official upstream `@rtco/client` release containing the required client fixes and regenerate the lockfile. A branch name, moving ref, personal fork dependency, or local path may not enter `develop`.
- Update both English and Chinese README provider attribution: Artico is the default WebRTC room transport; Trystero remains a supported alternative using its default Nostr strategy.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `webrtc-runtime`: Restore two interchangeable Runtime-private room transports, select Artico by default, preserve ready-only best-effort send semantics, and retain provider-specific lifecycle/error behavior behind one shared contract.

## Impact

- Affected implementation: provider constants, Runtime provider composition, restored Artico adapter/tests, retained Trystero adapter/tests, host composition, package manifest, and lockfile.
- Affected documentation: `README.md`, `README_zh.md`, `AGENTS.md`, and active architecture/provider assertions that currently claim Trystero is the sole provider.
- Affected tests: both adapters must run the root shared contract; provider selection/default/single-instantiation, provider-specific lifecycle/error, dependency provenance, structure, and current-documentation controls are required.
- Unchanged: application/Domain APIs, peer protocol, message schemas, persistence, local projection, History identity and settlement, Room IDs, browser permissions, UI, user settings, automatic provider fallback, release, and deployment.
