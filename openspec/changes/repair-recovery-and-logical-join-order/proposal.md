## Why

Five related failures currently prevent recovery and startup from being dependable as one product flow. Refresh was disabled after a failed join; that repair exists on `a6021495` but has not received final Owner acceptance. A later retry can reuse an Artico peer whose one `close` event was missed while no room was desired. Same-domain identity refresh can expose the expected newest-wins cancellation as `Domain join superseded`. A newly joined page can persist a historical member's join notice because current SESSION frames contain no remote logical join time and Session substitutes receiver observation order. Finally, a content page whose initial URL contains `#fragment` can fail before UI mount because the complete href is incorrectly treated as cross-context tab-routing identity.

The Owner requires these five outcomes to be repaired and accepted together rather than publishing or testing partial heads independently.

## What Changes

- Retain the `repair-refresh-recovery-availability` contract and source exact `a6021495` as the combined baseline.
- Make fresh Artico room demand state-driven: an already disconnected peer is replaced through one shared restart before pending joins wait for readiness.
- Classify same-domain attempt supersession as internal cancellation so stale work settles without user error/success feedback or newer-state overwrite.
- Add required strict `joinedAt` to v3 `SessionMessage`; bind it to one logical `presenceId` across reconnect and supported host replacement, and use it instead of receiver discovery order for join-notice eligibility.
- Move both Chat and World physical namespaces from v2 to v3 in one clean cut. World payload remains unchanged, but discovery cannot advertise peers whose Chat protocol is incompatible.
- Exclude URL fragments from the canonical content-page routing identity while retaining exact tab binding and real-navigation stale-response rejection; direct-hash startup and hash-only navigation keep one mounted control and logical presence.
- Deliver one cumulative immutable source exact, one fresh Reviewer/QA gate, and one Owner five-scenario acceptance. Partial-head evidence does not transfer.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `peer-wire-protocol`: Define the v3 SESSION join-time fact and clean v1/v2/v3 namespace isolation.
- `webrtc-runtime`: Define disconnected-peer reactivation, internal supersession cancellation, logical join-order classification, fragment-insensitive page routing/bootstrap, and the combined verification/release boundary.
- `world-room-presence`: Move the singleton discovery room to the same v3 protocol generation while preserving its exact payload and ownership.

## Impact

- Public SESSION type/schema/golden fixtures and protocol-generation room constants.
- Runtime Session/Connection mappings, observer classification, and deterministic network tests.
- Artico provider implementation and focused lifecycle tests.
- Application ChatRoom cancellation handling and multi-page identity/recovery tests.
- Content/background/Offscreen RPC target routing and fragment-navigation startup tests.
- OpenSpec deltas for the three existing capabilities.
- No ChatMessage/history/SESSION_END/World payload change, database migration, MessageStore change, ChatRoom method expansion, Toast renderer change, alternate bootstrap UI, unbounded retry policy, or release-version edit.
