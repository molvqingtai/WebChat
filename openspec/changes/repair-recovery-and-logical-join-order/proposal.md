## Why

Seven related failures currently prevent recovery and startup from being dependable as one product flow. Refresh was disabled after a failed join; that repair exists on `a6021495` but has not received final Owner acceptance, and its successful request currently publishes an unnecessary `Ready to chat` Toast. A later retry can reuse an Artico peer whose one `close` event was missed while no room was desired. Same-domain identity refresh can expose the expected newest-wins cancellation as `Domain join superseded`. A newly joined page can persist a historical member's join notice because current SESSION frames contain no remote logical join time and Session substitutes receiver observation order. A content page whose initial URL contains `#fragment` can fail before UI mount because the complete href is incorrectly treated as cross-context tab-routing identity. ClientLease can remain in `connecting` forever because its outer recovery deadline is checked only after an RPC rejects; a pending `registerPage()` or `attachPage()` is not interrupted. Finally, page ping or Port connectivity loss can be mistaken for the last tab leaving even though an inactive, frozen, discarded, or recovering tab still exists; physical tab lifetime and logical presence therefore lack an authoritative Tabs API owner.

Owner smoke on source exact `cd1f054301abb383100b89fdea5bcb633ac79332` reconfirmed two missing outcomes and corrected the prior feedback wording: every current Refresh or recovery SHALL show `Connecting` while it is active. Success dismisses only that operation's entry and SHALL NOT publish `Ready to chat`; genuine failure remains visible. If A logically joined before B, delayed discovery and SESSION delivery cannot make B acquire an `A joined` notice. Authority exact `3a0a7d1fa11b1f69ce73f93a55f05e8e88cc48b1` preserves those source bytes and freezes the corrected contract.

The Owner further requires the existing mounted Refresh control to project the same current Chat connection loading owner. For the entire period that the current owner's Toast feedback entry is `loading`, including direct/automatic connection or join, recovery, and manual Refresh, the button is disabled and its refresh icon rotates. Success dismissal or genuine-error replacement ends Toast loading and control loading at the same owner-scoped transition. An old completion cannot stop a newer owner's animation. This does not mount a control before the existing Runtime bootstrap boundary.

The fragment-insensitive routing repair remains mandatory in this cumulative change. Its OpenSpec contract was frozen before the E2E-priority pause, but current source still does not implement it; a candidate that fixes only the latest smoke regressions is incomplete.

The Owner also requires the background to own a one-host-to-many-tabs registry from trusted extension sender context and the browser Tabs API. `tabId` is physical tab identity, document generation fences page instances, and `sessionId`/`presenceId`/`joinedAt` remain logical membership identity; none replaces another. Ping and Port observations may drive bounded connectivity recovery but never decide tab leave, membership deletion, or SESSION_END. Closing a tab, leaving eligibility, or changing Runtime domain releases the old binding; inactivity, discard, hash changes, reload, and same-domain eligible navigation do not create a false logical leave.

The Owner requires these seven outcomes to be repaired and accepted together rather than publishing or testing partial heads independently.

## What Changes

- Retain the `repair-refresh-recovery-availability` contract and source exact `a6021495` as inherited history, while binding resumed source work to current authority exact `cd01035768b05d9708bd6781f016e8b9742086e6` and a new docs child on the existing `fix/cross-browser-action-lifecycle` / Draft PR #76 route. The invalid `9beec650...` line and its evidence are not implementation inputs.
- Publish the existing owner-scoped `Connecting` feedback when each current manual Refresh or Runtime recovery starts. While that current feedback entry is `loading`, drive the existing mounted Refresh button to disabled with a rotating icon for manual and direct/automatic Chat connection/join flows. On success, dismiss only that operation's loading entry after any already accepted minimum dwell and end control loading in the same transition; do not publish `Ready to chat`. Genuine failure replaces the same entry and ends control loading without hiding the error. Stale settlement cannot alter a newer operation's entry or control state.
- Make fresh Artico room demand state-driven: an already disconnected peer is replaced through one shared restart before pending joins wait for readiness.
- Classify same-domain attempt supersession as internal cancellation so stale work settles without user error/success feedback or newer-state overwrite.
- Keep one logical presence's `user.id` and `joinedAt` immutable while treating `name` and `avatar` as its refreshable user projection; converge the winning projection across same-domain pages without a new logical join, leave, or notice.
- Add required strict `joinedAt` to v3 `SessionMessage`; bind it to one logical `presenceId` across reconnect and supported host replacement, and use it instead of receiver discovery order for join-notice eligibility.
- Move both Chat and World physical namespaces from v2 to v3 in one clean cut. World payload remains unchanged, but discovery cannot advertise peers whose Chat protocol is incompatible.
- Exclude URL fragments from the canonical content-page routing identity while retaining exact tab binding and real-navigation stale-response rejection; direct-hash startup and hash-only navigation keep one mounted control and logical presence.
- Bound every ClientLease register/attach attempt and the whole recovery generation, cancel expired ownership, single-flight concurrent recovery signals, and fence late responses. A healthy retained-Runtime page refresh still shows current `Connecting` while attachment is active; every such entry dismisses on current ready or becomes unavailable within the recovery budget, without any ready/success Toast.
- Make the background Tabs API registry authoritative for physical tab ownership. One host owns multiple exact tabs; trusted sender metadata binds each current tab and document generation to its logical session. Ping/Port loss never releases membership, while tab close, loss of eligibility, or Runtime-domain change releases the old binding exactly once. Host replacement reconstructs live eligible bindings without a false logical join.
- Deliver one cumulative immutable source exact, one fresh Reviewer/QA gate, and one Owner seven-scenario acceptance. Partial-head evidence does not transfer.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `peer-wire-protocol`: Define the v3 SESSION join-time fact and clean v1/v2/v3 namespace isolation.
- `webrtc-runtime`: Define disconnected-peer reactivation, internal supersession cancellation, logical join-order classification, fragment-insensitive page routing/bootstrap, bounded ClientLease recovery/readiness feedback, Tabs API-owned physical tab lifetime, silent Refresh success, and the combined verification/release boundary.
- `world-room-presence`: Move the singleton discovery room to the same v3 protocol generation while preserving its exact payload and ownership.

## Impact

- Public SESSION type/schema/golden fixtures and protocol-generation room constants.
- Runtime Session/Connection identity binding, mutable user projection, observer classification, and deterministic network tests.
- Artico provider implementation and focused lifecycle tests.
- Application ChatRoom cancellation handling and multi-page identity/recovery tests.
- Content/background/Offscreen RPC target routing and fragment-navigation startup tests.
- ClientLease RPC deadline/cancellation, recovery ownership, readiness-feedback, and late-response tests.
- Background Tabs API inventory/events, trusted sender tab binding, document-generation fencing, host-to-tabs reconstruction, and false-leave tests.
- OpenSpec deltas for the three existing capabilities.
- No ChatMessage/history/SESSION_END wire-shape/World payload change, database migration, MessageStore change, ChatRoom method expansion, Toast renderer change, alternate bootstrap UI, unbounded retry policy, or release-version edit.
