## Why

Seven related failures currently prevent recovery and startup from being dependable as one product flow. Refresh was disabled after a failed join; that repair exists on `a6021495` but has not received final Owner acceptance, and its successful request currently publishes an unnecessary `Ready to chat` Toast. A later retry can reuse an Artico peer whose one `close` event was missed while no room was desired. Same-domain identity refresh can expose the expected newest-wins cancellation as `Domain join superseded`. A newly joined page can persist a historical member's join notice because current SESSION frames contain no remote logical join time and Session substitutes receiver observation order. A content page whose initial URL contains `#fragment` can fail before UI mount because the complete href is incorrectly treated as cross-context tab-routing identity. ClientLease can remain in `connecting` forever because its outer recovery deadline is checked only after an RPC rejects; a pending `registerPage()` or `attachPage()` is not interrupted. Finally, page ping or Port connectivity loss can be mistaken for the last tab leaving even though an inactive, frozen, discarded, or recovering tab still exists; physical tab lifetime and logical presence therefore lack an authoritative Tabs API owner.

Owner smoke on source exact `cd1f054301abb383100b89fdea5bcb633ac79332` reconfirmed two missing outcomes: every current Refresh or recovery SHALL show one loading Toast while it is active, and success SHALL dismiss only that operation's entry without publishing `Ready to chat`; genuine failure remains visible. If A logically joined before B, delayed discovery and SESSION delivery cannot make B acquire an `A joined` notice. Authority exact `3a0a7d1fa11b1f69ce73f93a55f05e8e88cc48b1` preserves those source bytes and freezes that corrected contract.

The Owner further requires the existing mounted Refresh control to project the same current Chat connection loading owner. For the entire period that the current owner's Toast feedback entry is `loading`, including direct/automatic connection or join, recovery, and manual Refresh, the button is disabled and its refresh icon rotates. Success dismissal or genuine-error replacement ends Toast loading and control loading at the same owner-scoped transition. An old completion cannot stop a newer owner's animation. This does not mount a control before the existing Runtime bootstrap boundary.

The Owner clarified that passive polling or a health probe is observation rather than a connection operation. A poll that has not promoted into an actual connect, join, attachment, host rebuild, or recovery SHALL create no loading entry and SHALL neither disable nor rotate Refresh. If the poll proves that real recovery is required, feedback and control loading begin once at that promotion point, inherit the current lifecycle's remaining deadline, and settle only with that actual operation; polling cannot reset the budget or impersonate its terminal result.

QA on current Draft PR #76 source exact `2f60913259f9ce834ffdf75f63eef87c9563e644` exposed two simultaneous loading producers: the legacy `Toast.OnRoomSelfJoinRoomEffect` maps `SelfJoinRoomEvent` to an independent random-owner `LoadingCommand("Connected to the chat.")`, while Runtime `AppFeedback` owns readiness separately. The Owner's final wording decision is exact: remove that legacy effect and producer entirely, keep the fixed Runtime readiness owner as the only loading owner, and show `Connected to the chat.` for that owner. Although the copy is past tense, it remains loading feedback by explicit product decision; renaming or reusing the legacy random owner, retaining the effect behind CSS, or emitting a separate success Toast is forbidden. This refines repair 6 and does not add an eighth repair.

The fragment-insensitive routing repair remains mandatory in this cumulative change. Its OpenSpec contract and current implementation SHALL be preserved; a replacement that fixes only the latest Toast regression while dropping an earlier repair is incomplete.

The Owner also requires the background to own a one-host-to-many-tabs registry from trusted extension sender context and the browser Tabs API. `tabId` is physical tab identity, document generation fences page instances, and `sessionId`/`presenceId`/`joinedAt` remain logical membership identity; none replaces another. Ping and Port observations may drive bounded connectivity recovery but never decide tab leave, membership deletion, or SESSION_END. Closing a tab, leaving eligibility, or changing Runtime domain releases the old binding; inactivity, discard, hash changes, reload, and same-domain eligible navigation do not create a false logical leave.

The Owner requires these seven outcomes to be repaired and accepted together rather than publishing or testing partial heads independently.

## What Changes

- Retain the `repair-refresh-recovery-availability` contract and source exact `a6021495` as inherited history, while binding this refinement to current product authority exact `d3fd5cabc516aefafbe5956e958be27a4819c1ae`, source exact `2f60913259f9ce834ffdf75f63eef87c9563e644`, and a new docs child on the existing `fix/cross-browser-action-lifecycle` / Draft PR #76 route. The invalid `9beec650...` line and its evidence are not implementation inputs.
- Delete `Toast.OnRoomSelfJoinRoomEffect` and its `SelfJoinRoomEvent`-owned random-ID loading producer. Keep the fixed Runtime `AppFeedback` readiness owner as the sole loading owner and give it the exact visible label `Connected to the chat.` whenever a current manual Refresh or actual Runtime connect/join/reattach/host rebuild/recovery operation starts. While that owner is `loading`, drive the existing mounted Refresh button to disabled with a rotating icon for manual and direct/automatic Chat connection/join flows. Passive polling or a health probe that has not promoted into such an operation creates no feedback or control loading. On promotion, begin both once without resetting the current lifecycle deadline. On success, dismiss only that owner after any already accepted minimum dwell and end control loading in the same transition; do not publish `Ready to chat` or another success Toast. Genuine failure replaces the same owner and ends control loading without hiding the error. Polling or stale settlement cannot alter the current owner's entry or control state.
- Make fresh Artico room demand state-driven: an already disconnected peer is replaced through one shared restart before pending joins wait for readiness.
- Classify same-domain attempt supersession as internal cancellation so stale work settles without user error/success feedback or newer-state overwrite.
- Keep one logical presence's `user.id` and `joinedAt` immutable while treating `name` and `avatar` as its refreshable user projection; converge the winning projection across same-domain pages without a new logical join, leave, or notice.
- Add required strict `joinedAt` to v3 `SessionMessage`; bind it to one logical `presenceId` across reconnect and supported host replacement, and use it instead of receiver discovery order for join-notice eligibility.
- Move both Chat and World physical namespaces from v2 to v3 in one clean cut. World payload remains unchanged, but discovery cannot advertise peers whose Chat protocol is incompatible.
- Exclude URL fragments from the canonical content-page routing identity while retaining exact tab binding and real-navigation stale-response rejection; direct-hash startup and hash-only navigation keep one mounted control and logical presence.
- Bound every ClientLease register/attach attempt and the whole recovery generation, cancel expired ownership, single-flight concurrent recovery signals, and fence late responses. A healthy retained-Runtime page refresh still shows the sole `Connected to the chat.` loading owner while attachment is active, but a steady-state poll that performs no attachment or recovery shows none. Promotion from polling to actual recovery starts that owner once within the original budget; it dismisses on current ready or becomes unavailable within that budget, without any ready/success Toast.
- Make the background Tabs API registry authoritative for physical tab ownership. One host owns multiple exact tabs; trusted sender metadata binds each current tab and document generation to its logical session. Ping/Port loss never releases membership, while tab close, loss of eligibility, or Runtime-domain change releases the old binding exactly once. Host replacement reconstructs live eligible bindings without a false logical join.
- Deliver one cumulative immutable source exact, one fresh Reviewer/QA gate, and one Owner seven-scenario acceptance. Partial-head evidence does not transfer.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `peer-wire-protocol`: Define the v3 SESSION join-time fact and clean v1/v2/v3 namespace isolation.
- `webrtc-runtime`: Define disconnected-peer reactivation, internal supersession cancellation, logical join-order classification, fragment-insensitive page routing/bootstrap, bounded ClientLease recovery with one `Connected to the chat.` readiness owner, Tabs API-owned physical tab lifetime, silent Refresh success, and the combined verification/release boundary.
- `world-room-presence`: Move the singleton discovery room to the same v3 protocol generation while preserving its exact payload and ownership.

## Impact

- Public SESSION type/schema/golden fixtures and protocol-generation room constants.
- Runtime Session/Connection identity binding, mutable user projection, observer classification, and deterministic network tests.
- Artico provider implementation and focused lifecycle tests.
- Application ChatRoom cancellation handling and multi-page identity/recovery tests.
- Content/background/Offscreen RPC target routing and fragment-navigation startup tests.
- ClientLease RPC deadline/cancellation, recovery ownership, legacy self-join Toast-producer deletion, sole-readiness-owner copy/lifecycle, passive-poll versus promoted-recovery feedback, and late-response tests.
- Background Tabs API inventory/events, trusted sender tab binding, document-generation fencing, host-to-tabs reconstruction, and false-leave tests.
- OpenSpec deltas for the three existing capabilities.
- No ChatMessage/history/SESSION_END wire-shape/World payload change, database migration, MessageStore change, ChatRoom method expansion, Toast renderer change, alternate bootstrap UI, unbounded retry policy, or release-version edit.
