## Why

WebChat currently supports only Trystero and composes it directly in the shared Runtime host. That clean-cut was useful while validating Trystero, but it removed the provider interchangeability already present behind the private `RoomTransportExtern` boundary.

The product now requires both Artico and Trystero to remain supported, with Artico selected by default. The delivered WebChat candidate intentionally uses the published registry package `@rtco/client@0.3.6` and delegates directly to its native `Room.send(payload, target)` behavior. The separately repaired Artico candidate was useful for build verification, but WebChat does not pre-implement that unpublished ready-only/attempt-all behavior or wait for a new Artico release before this delivery.

## What Changes

- Restore the Artico adapter under its own provider directory while retaining the current Trystero adapter and its provider-local peer-connect error silence. Inside each provider directory, use the contextual names `RoomTransport.ts` and `RoomTransport.test.ts` rather than repeating the provider name.
- Add one build-time provider selection constant under `src/constants/`, default it to `artico`, and keep the sole concrete selection/composition helper inside Runtime. Each host instance creates exactly one selected transport; there is no simultaneous dual connection, runtime hot switch, automatic fallback, user setting, or environment selector.
- Require both adapters to satisfy the same root provider-neutral identity, lifecycle, target-shape, event, and disposal contract while delegating send behavior directly to the selected provider. WebChat adds no peer enumeration, readiness cache, queue, retry, or later replay. Published Artico 0.3.6 may invoke a pending selected Call and may stop after the first thrown Call error; Trystero retains its native active-peer behavior.
- Restore Artico's per-room owner, explicit `wss://web-chat.io` signaling composition, scoped recovery, and provider-local lifecycle while keeping every Artico type out of Domain, protocol, UI, persistence, and comctx contracts.
- Use registry `@rtco/client@0.3.6` in the delivery candidate; no branch, moving ref, personal fork dependency, workspace package, or local path may enter `develop`. Exactly three Artico tests that require unpublished ready-only/attempt-all behavior remain explicitly skipped. A later switch to a repaired official version requires new Owner authorization, direct package verification, and re-enabling those tests.
- Update both English and Chinese README provider attribution: Artico is the default WebRTC room transport; Trystero remains a supported alternative using its default Nostr strategy.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `webrtc-runtime`: Restore two interchangeable Runtime-private room transports, select Artico by default, preserve native provider send behavior without application queues or readiness emulation, and retain provider-specific lifecycle/error behavior behind one shared contract.

## Impact

- Affected implementation: provider constants, Runtime provider composition, restored Artico adapter/tests, retained Trystero adapter/tests, host composition, package manifest, and lockfile.
- Affected documentation: `README.md`, `README_zh.md`, `AGENTS.md`, and active architecture/provider assertions that currently claim Trystero is the sole provider.
- Affected tests: both adapters must run the root shared contract; provider selection/default/single-instantiation, provider-specific lifecycle/error, dependency provenance, structure, and current-documentation controls are required.
- Unchanged: application/Domain APIs, peer protocol, message schemas, persistence, local projection, History identity and settlement, Room IDs, browser permissions, UI, user settings, automatic provider fallback, release, and deployment.
