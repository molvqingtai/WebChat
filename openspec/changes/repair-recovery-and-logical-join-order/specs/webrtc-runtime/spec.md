## ADDED Requirements

### Requirement: Artico room demand repairs a retained disconnected peer

The private Artico RoomTransport provider SHALL maintain this invariant: while desired room demand is non-empty, it owns either one non-terminal peer generation or exactly one restart capable of creating it. When `join(roomId)` changes demand from empty to non-empty and the retained peer is already `disconnected`, the provider SHALL enter the same generation-owned restart used by close recovery before that join waits for physical readiness. It SHALL NOT depend on receiving a future duplicate `close` event for a state transition that already occurred.

Concurrent Chat and World demand, repeated joins, a close-driven restart, and a delayed restart timer SHALL converge on one replacement owner. Every peer callback and timer SHALL be generation-fenced so an old peer cannot join current rooms, reject or settle current work, or replace a newer peer. `leave()` SHALL remove only its room's demand; `dispose()` SHALL cancel owned restart work and settle pending joins once. The host-lifetime peer id SHALL remain stable across replacement peers. This repair SHALL add no unbounded retry loop, connecting watchdog, page-owned peer, or public ChatRoom method.

#### Scenario: Fresh demand replaces an already disconnected peer

- **GIVEN** desired rooms are empty and the retained Artico peer is already `disconnected` after its one close edge was observed while no room was desired
- **WHEN** a later Chat or World `join(roomId)` adds fresh demand
- **THEN** the provider SHALL create or await exactly one current replacement before the join waits for readiness and SHALL not wait for another close event from the old peer

#### Scenario: Concurrent room demand shares one restart

- **GIVEN** a disconnected retained peer and no desired room
- **WHEN** Chat and World joins arrive concurrently or repeatedly while replacement is pending
- **THEN** all current demand SHALL share one restart owner, one replacement peer generation, and the current room joins without duplicate peers or timers

#### Scenario: Stale callbacks cannot affect replacement

- **GIVEN** one peer generation has been superseded by a replacement
- **WHEN** the old peer emits delayed open, error, or close, or its delayed restart timer fires
- **THEN** that stale work SHALL not join a room, settle current pending work, schedule another current replacement, or alter the new peer generation

#### Scenario: Leave and dispose settle owned recovery

- **WHEN** a room leaves or the provider is disposed while restart or readiness work is pending
- **THEN** only the matching desired demand SHALL be removed, dispose SHALL cancel all owned restart work, and every affected pending join SHALL settle exactly once without an automatic unbounded loop

### Requirement: Same-domain supersession is internal cancellation

Connection SHALL preserve newest-wins generation fencing for overlapping same-domain join, identity refresh, host recovery, and manual Refresh attempts. Replacing an older attempt SHALL produce one machine-classified internal cancellation rather than an ordinary message-only error. Cancellation SHALL settle the old caller and its cleanup, but SHALL emit no `Room.OnErrorEvent`, generic error Toast, success result, committed join, or stale identity/presence. The cancelled attempt SHALL not clear or overwrite a newer request, snapshot, user/site input, button pending state, or feedback owner.

Only the winning attempt SHALL own the real operation success or failure and current identity convergence for every attached same-domain page. `user.id` and the logical generation time SHALL remain immutable binding facts, while the winning same-id `name`/`avatar` refresh SHALL replace the current user projection across those pages without a logical join, leave, or notice; an equal projection SHALL be idempotent. Initial join and recovery state SHALL return from cancelled work without remaining stuck in loading. Every genuine provider, protocol, persistence, Runtime, and join failure SHALL continue through its existing error/Toast path. Cancellation SHALL NOT be recognized by comparing `error.message`, translated text, or Toast copy, and SHALL not introduce a second operation/pending/error owner.

#### Scenario: Superseded identity refresh is silent and settled

- **GIVEN** two same-domain pages trigger overlapping identity refresh attempts and the newer generation supersedes the older
- **WHEN** the old operation settles its cancellation
- **THEN** it SHALL release only its own pending state, emit no error Toast or false success, retain no stale identity input, and leave the newer attempt as the sole current owner

#### Scenario: Manual recovery and host recovery retain the winner

- **GIVEN** avatar refresh overlaps manual Refresh or Runtime host recovery
- **WHEN** completion and failure callbacks arrive in any order
- **THEN** only the newest current attempt SHALL commit identity, presence, snapshot, and terminal feedback; every stale callback SHALL be unable to clear or overwrite it

#### Scenario: Genuine failure remains visible

- **GIVEN** the current winning attempt fails for a real provider, protocol, persistence, Runtime, or join reason rather than supersession
- **WHEN** the operation settles
- **THEN** the existing request-local error path and generic Toast SHALL remain observable, and the application SHALL return to its defined retryable state

### Requirement: Content RPC routing ignores only URL fragment

Content-script eligibility, Runtime domain identity, trusted tab binding, document-generation identity, and cross-context RPC target equivalence SHALL treat `URL.hash` as an in-document position rather than document identity. The Runtime domain SHALL remain `document.location.origin`. Background and Offscreen routing SHALL preserve the exact trusted tab id supplied by extension sender context, validate it against the background-owned Tabs API registry, and compare one canonical document-navigation identity containing scheme, host, port, path, and query while excluding only fragment. Payload-supplied tab identity SHALL not become trusted.

A direct page URL containing a fragment SHALL complete coordinator/Runtime attachment and mount the existing Shadow UI exactly once. Changing only hash after mount or during the initial handshake SHALL retain the same trusted tab binding, document generation, logical lease, Runtime domain, logical presence, and UI mount; it SHALL produce no join/leave or remount. Reload or a real same-domain eligible navigation that changes the document, path, or query SHALL replace document generation and rebind the same trusted tab without replacing logical presence, but a response owned by the prior document SHALL not settle the new one. Navigation outside eligibility or to another Runtime domain SHALL release the old domain binding. Recycled tab id, wrong tab, untrusted sender, wrong namespace/direction, missing target, and stale provider response SHALL remain denied.

Response routing SHALL not query or broadcast to every same-origin tab, route by origin alone, remove response correlation, add fragment-specific business logic, or add a pre-App loading/unavailable/Retry/status fallback. Tabs API inventory used only to reconstruct physical tab ownership SHALL not become a response-delivery broadcast. The existing bootstrap SHALL still mount only after valid `initClient()` settlement; this change restores that exact response route.

#### Scenario: Direct fragment URL mounts the control

- **WHEN** a supported HTTPS page opens directly at a URL such as `https://www.v2ex.com/t/1230408#reply1`
- **THEN** the content client SHALL complete its first Runtime RPC route and mount exactly one existing WebChat control without stripping or navigating away from the visible fragment

#### Scenario: Mounted hashchange preserves one client

- **GIVEN** the WebChat control is mounted and joined
- **WHEN** only `location.hash` changes
- **THEN** the same trusted tab binding, document generation, logical lease, domain, UI mount, and logical presence SHALL remain, with zero reconnect, join, leave, or lifecycle notice

#### Scenario: In-flight hashchange preserves the first handshake

- **GIVEN** content bootstrap has started but the first coordinator or Runtime response has not settled
- **WHEN** the page changes from one fragment to another
- **THEN** the trusted response SHALL still route to that same live document, `initClient()` SHALL settle once, and exactly one control SHALL mount

#### Scenario: Real navigation keeps stale-response protection

- **GIVEN** a provider response is correlated to one tab and canonical document-navigation identity
- **WHEN** that tab is recycled or genuinely navigates to a different scheme, host, port, path, or query before the response arrives
- **THEN** the old response SHALL be rejected and SHALL not settle the replacement page, while another same-origin tab receives nothing

### Requirement: Background Tabs API owns physical tab lifetime

The background coordinator SHALL own one current host-to-tabs registry for physical browser-tab lifetime. One Runtime host MAY own multiple eligible tabs, and each live `tabId` SHALL occur at most once in the current host registry. Content-to-background comctx metadata MAY carry tab routing facts, but the background SHALL accept them only when extension-provided sender context and the current Tabs API state validate the exact tab and document binding. Page-supplied tab identity, an old host generation, an old document, or a recycled tab id SHALL not become current authority.

Physical `tabId`, internal document generation, and logical `sessionId`/`presenceId`/`joinedAt` SHALL remain separate identities. Tab id SHALL route and own the physical browser tab; document generation SHALL fence reload and real-navigation responses; logical identity SHALL own membership and notice time. Tab id SHALL not replace logical session identity, and a random page id SHALL not replace browser tab ownership. Multiple tabs in the same Runtime domain SHALL remain distinct physical owners of the same shared domain connection and logical presence rather than creating one logical generation per tab.

Only a trusted browser tab-removal fact, navigation outside content eligibility, or navigation to another Runtime domain SHALL release the old domain tab binding. Inactive, hidden, frozen, discarded, ping-missing, heartbeat-missing, or Port-disconnected state SHALL not release physical tab ownership, start last-tab grace, delete membership, or publish SESSION_END. Connectivity loss MAY only start or join the current bounded ClientLease recovery.

Hash-only navigation SHALL retain the current tab, document generation, page attachment, and logical presence. Reload or same-domain eligible document navigation SHALL replace document generation and idempotently reattach the same tab and logical presence. After supported background or Runtime host replacement, the coordinator SHALL reconstruct one registry from still-existing eligible tabs and trusted reattachments, without a false logical join/leave, duplicate lease, origin-wide response route, or parallel Runtime lifecycle owner.

#### Scenario: Inactive or disconnected page remains present

- **GIVEN** an eligible tab is registered to the current host and owns a logical presence
- **WHEN** the tab becomes inactive, hidden, frozen, or discarded, or its page ping, heartbeat, or Port disappears
- **THEN** the background SHALL retain the tab owner and logical presence, MAY enter bounded connectivity recovery, and SHALL emit no domain release, SESSION_END, leave notice, or replacement logical join

#### Scenario: Trusted close releases exactly once

- **GIVEN** one host owns one or more eligible tabs and one tab owns a current domain binding
- **WHEN** the Tabs API reports that exact tab removed
- **THEN** only that physical tab owner SHALL be removed exactly once, and the existing domain last-tab/grace/final-release rules SHALL run only if no other tab still owns that domain

#### Scenario: Same-domain tabs share logical membership

- **GIVEN** one host owns two eligible tabs in the same Runtime domain
- **WHEN** both attach and either non-last tab closes
- **THEN** the registry SHALL retain two distinct physical tab owners before close and one after close, while Runtime retains one shared logical presence and emits no extra join, leave, SESSION_END, or lifecycle notice

#### Scenario: Navigation changes the owned domain boundary

- **GIVEN** an eligible tab owns a binding for Runtime domain A
- **WHEN** it navigates outside eligibility or to eligible Runtime domain B
- **THEN** the A binding SHALL release exactly once; an eligible B document MAY establish its own binding, and unchanged tab id SHALL not carry A's logical presence into B

#### Scenario: Same-domain document replacement preserves logical presence

- **GIVEN** an eligible tab owns a current logical presence for one Runtime domain
- **WHEN** that tab reloads or performs a same-domain eligible document navigation
- **THEN** a new document generation SHALL rebind to the same tab and logical presence, every old-document response SHALL be inert, and no join, leave, SESSION_END, duplicate lease, or lifecycle notice SHALL result

#### Scenario: Host replacement reconstructs multiple tabs

- **GIVEN** one host owns multiple current eligible tabs and the background or Runtime host is replaced
- **WHEN** the coordinator inventories browser tabs and receives trusted current reattachments
- **THEN** the replacement host SHALL reconstruct each still-existing eligible tab exactly once, resurrect no absent or ineligible tab, and preserve logical presence without duplicate rooms, leases, joins, leaves, or notices

#### Scenario: Untrusted or reused tab identity is rejected

- **GIVEN** comctx metadata names a tab that conflicts with sender context or current Tabs API state, or an old host/document message uses a tab id after its prior binding ended
- **WHEN** the background handles that message
- **THEN** it SHALL reject the binding or response without mutating current ownership, connectivity, logical membership, feedback, or another tab

### Requirement: ClientLease recovery and connecting feedback are bounded

Each ClientLease lifecycle SHALL own at most one current startup or recovery generation. Repeated watchdog failure, generation/host-id/page-attachment mismatch, and overlapping recovery calls SHALL share that generation rather than issue parallel attach sequences or reset its budget. The existing 15,000ms startup/recovery timeout SHALL be one overall generation deadline. Every `registerPage()` and `attachPage()` attempt SHALL have a hard deadline no greater than 5,000ms and no greater than the generation's remaining budget. Expiry SHALL cancel that request's local ownership and reject the attempt; bounded retry MAY continue only inside the original overall deadline.

A fresh `init()` or page-context `detach()` SHALL abort the prior connectivity lifecycle and retire its requests. Page detach alone SHALL not remove the background-owned physical tab binding or logical presence. A response or rejection from an expired, aborted, detached, or superseded request SHALL be ignored and SHALL NOT publish HostPhase, replace a snapshot, start a watchdog, settle a newer recovery, release the current tab owner, or unregister the winning logical lease. Host replacement, Port loss, missing response, and a provider that remains pending forever SHALL therefore settle the current connectivity generation as `ready` after one valid current attachment or `unavailable` when its original budget is exhausted, while physical leave remains owned by the Tabs API requirement. No path SHALL leave HostPhase permanently `connecting`.

Readiness presentation SHALL remain downstream of Runtime truth. Every current page Refresh or recovery generation SHALL publish its existing owner-scoped `Connecting` loading entry when the operation starts, including attachment to an already healthy retained Runtime, and SHALL keep that owner current while the operation is active. Current ready SHALL dismiss only that entry and SHALL publish neither `Ready to chat` nor another success descriptor. Unavailable SHALL replace the same entry no later than the original 15,000ms deadline. Detach, remount, abort, or supersession SHALL retire only the old owner's feedback, and stale settlement SHALL not dismiss or replace a newer owner's entry. Presentation SHALL NOT delay operation, extend the recovery budget, add another readiness state, or change the Toast renderer, structure, or visual style.

#### Scenario: Healthy retained Runtime refresh shows only active Connecting

- **GIVEN** the Runtime host remains healthy and ready while one content document is refreshed
- **WHEN** the new page lifecycle registers and attaches successfully
- **THEN** exactly one owner-scoped `Connecting` entry SHALL be observable while attachment is active and dismissed by current ready, exactly one current tab binding, document attachment, logical lease, and application mount SHALL result, and no `Ready to chat`, unavailable feedback, host replacement, or logical join/leave SHALL be caused by the refresh

#### Scenario: Pending register or attach cannot exceed its deadline

- **GIVEN** the current `registerPage()` or `attachPage()` attempt never resolves or rejects
- **WHEN** its 5,000ms per-RPC deadline and then the generation's original 15,000ms overall deadline elapse
- **THEN** each expired request SHALL lose settlement ownership, retry SHALL remain bounded by the original budget, and the generation SHALL settle unavailable rather than remain connecting

#### Scenario: Rejection or control-plane loss can recover within the budget

- **GIVEN** register/attach rejects, its Port or response route is lost, or the host is replaced during recovery
- **WHEN** a later current attempt attaches a valid replacement before the original overall deadline
- **THEN** the shared recovery generation SHALL settle ready once with the replacement snapshot and SHALL dismiss only its current `Connecting` entry without publishing a success descriptor

#### Scenario: Concurrent recovery signals share one owner

- **GIVEN** a watchdog failure and one or more generation, host-id, or page-attachment mismatch signals overlap
- **WHEN** recovery is already in flight for the current lifecycle
- **THEN** every signal SHALL join one recovery task, deadline, register/attach sequence owner, and feedback generation without parallel attempts or budget reset

#### Scenario: Late response cannot affect the winner

- **GIVEN** an old RPC expired, was aborted by detach/init, or belongs to a superseded recovery, and a newer current lease exists
- **WHEN** the old RPC later resolves or rejects
- **THEN** it SHALL not publish ready/unavailable, replace the snapshot, start a watchdog, clear current feedback, settle the newer task, release the winner's tab binding, or unregister its logical lease

#### Scenario: Active Connecting always reaches a terminal state

- **GIVEN** a current Refresh or recovery has published its stable owner-scoped `Connecting` entry
- **WHEN** a current attachment succeeds or the original recovery budget expires
- **THEN** the same readiness entry SHALL settle to dismissal on ready or unavailable error within that budget and SHALL never remain loading permanently

### Requirement: Refresh control projects current connection loading

The existing mounted Refresh control SHALL project one current Chat connection loading owner rather than only a local click state. The current owner's Toast feedback entry and control SHALL remain strictly aligned: whenever that entry is `loading`, including direct/automatic connection or join, Runtime recovery, manual Refresh, and any accepted minimum loading dwell, the Refresh button SHALL be disabled and its refresh icon SHALL rotate continuously. A control that mounts or re-renders while such an owner is already loading SHALL immediately project the same disabled rotating state. Repeated activation SHALL issue no concurrent Refresh while disabled. This requirement SHALL NOT mount a Refresh control before the existing `initClient()` bootstrap boundary or add alternate loading UI.

When the current owner reaches ready, genuine failure, cancellation, or another defined terminal outcome, its Toast entry SHALL leave `loading` and its control loading SHALL end in the same owner-scoped transition. Success dismisses the entry; genuine failure replaces it with the error and does not hide that error. The icon SHALL stop and ordinary Refresh eligibility SHALL be recomputed atomically. A failed connection/join with otherwise valid configuration SHALL therefore expose an enabled non-rotating retry control, while an unrelated static eligibility failure MAY keep the control disabled without rotation. Settlement from an expired, detached, aborted, or superseded owner SHALL not stop the icon, enable the button, or clear feedback while a newer owner remains loading. The control SHALL add no second loading owner, timer, connection truth, or browser-specific behavior.

#### Scenario: Toast loading and Refresh control cannot diverge

- **GIVEN** the current owner's Toast feedback entry exists in `loading`
- **WHEN** the existing Refresh control is rendered for any manual or direct/automatic Chat connection flow
- **THEN** the button SHALL be disabled and its icon SHALL rotate for the complete same interval, with no frame or owner transition that leaves loading Toast feedback beside an enabled or static Refresh control

#### Scenario: Manual Refresh owns disabled rotation until loading ends

- **GIVEN** Refresh is ordinarily available and no connection operation is active
- **WHEN** the user activates Refresh
- **THEN** the button SHALL become disabled and its icon SHALL rotate from accepted dispatch through the same owner's complete Toast loading interval, including the accepted minimum dwell, and repeated activation SHALL start no parallel Refresh

#### Scenario: Direct Chat connection projects the same control state

- **GIVEN** the existing Refresh control is mounted or becomes mounted while direct/automatic Chat connection or join is active
- **WHEN** no Refresh click created that loading owner
- **THEN** the button SHALL still be disabled and the refresh icon SHALL rotate continuously until the current direct connection owner terminates

#### Scenario: Terminal failure restores retry without hiding the error

- **GIVEN** a current connection loading owner has disabled and rotated Refresh
- **WHEN** that owner ends with a genuine failure and no newer owner exists
- **THEN** the Toast SHALL leave loading by becoming the genuine error, rotation SHALL stop in the same owner-scoped transition, ordinary availability SHALL be recomputed so a valid retry can be enabled, and the genuine error feedback SHALL remain visible

#### Scenario: Stale settlement cannot stop newer rotation

- **GIVEN** one loading owner was superseded and a newer connection loading owner is active
- **WHEN** the older owner later succeeds, fails, cancels, detaches, or reaches its minimum dwell
- **THEN** it SHALL not stop the icon, enable Refresh, clear current feedback, or otherwise alter the newer owner's disabled rotating state

### Requirement: Seven repairs share one acceptance authority

The Refresh recovery baseline with request-local success dismissal and disabled rotating control projection, disconnected-peer repair, supersession cancellation, logical join-time repair, fragment-insensitive startup, bounded ClientLease recovery, and Tabs API-owned physical tab lifetime SHALL be delivered as one cumulative immutable source exact. Every current manual Refresh or recovery SHALL show its owner-scoped `Connecting` feedback while active, and every current manual or direct/automatic Chat connection loading owner SHALL disable and rotate the existing Refresh control. A successful manual Refresh SHALL dismiss only its own loading entry after the accepted dwell and SHALL NOT publish `Ready to chat`; a genuine failure SHALL retain the matching error Toast while ending control loading. Ping/Port loss SHALL remain connectivity-only and SHALL not create physical or logical leave while the trusted tab still exists. Intermediate heads and evidence from `a6021495` or invalid `9beec650...` SHALL remain diagnostic only and SHALL not authorize final review, QA, checkout synchronization, publication, or release. The final exact SHALL receive fresh Reviewer and QA decisions on the complete combined matrix, followed by one Owner seven-scenario product acceptance.

#### Scenario: Manual Refresh success dismisses only its Connecting owner

- **GIVEN** a current manual Refresh published its request-owned `Connecting` entry and unrelated Toasts also exist
- **WHEN** that Refresh succeeds and its accepted minimum loading dwell completes
- **THEN** the application SHALL dismiss only that request ID, SHALL publish no `Ready to chat` or other success descriptor, SHALL preserve unrelated Toasts, and SHALL leave no current Refresh feedback loading

#### Scenario: Manual Refresh failure keeps the genuine error

- **GIVEN** a current manual Refresh published its request-owned `Connecting` entry
- **WHEN** the winning request fails for a genuine provider, Runtime, protocol, persistence, or join reason
- **THEN** the same request entry SHALL become the genuine error feedback, SHALL not be silently dismissed as success, and SHALL leave the request/button lifecycle retryable rather than loading forever

#### Scenario: Partial success does not authorize delivery

- **WHEN** any subset of the seven repairs has a passing implementation or prior evidence
- **THEN** no partial head SHALL be synchronized or published as the requested repair, and the remaining outcomes SHALL stay part of the same final candidate

#### Scenario: Final acceptance covers all seven outcomes

- **WHEN** the final cumulative exact passes fresh independent Reviewer and QA gates
- **THEN** the Owner SHALL verify seven scenarios before publication authority exists: failed-join manual Refresh and direct/automatic connection loading both show Connecting and disable/rotate Refresh until the same owner terminates, with successful manual retry dismissing its entry without a success Toast; disconnected-peer retry; multi-page identity update without supersession Toast; exact A-before-B notice projections; direct fragment-URL startup; retained-Runtime refresh with bounded active-to-terminal Connecting; and one host with multiple tabs where inactivity/connectivity loss preserves presence while trusted close or eligibility/domain exit releases exactly once

### Requirement: Peer wire protocol is replaced with v3 without compatibility

The peer-to-peer wire protocol SHALL use the v3 contract defined by the `peer-wire-protocol` capability. The system SHALL NOT bridge, translate, or interoperate with released v1 or v2 protocols, and v1, v2, and v3 clients SHALL be isolated by both Chat and World room namespaces so no generation parses another's traffic or advertises an incompatible peer.

#### Scenario: v1 v2 v3 isolation

- **WHEN** v1, v2, and v3 clients exchange traffic in a shared physical environment
- **THEN** they SHALL not share Chat or World room namespaces and no compatibility fallback SHALL exist

#### Scenario: Old protocol removal remains complete

- **WHEN** the release candidate is inspected
- **THEN** old protocol schemas, the JSONR interop adapter, page-side message routing, reaction toggle, history upsert, HLC-only history cursor, and v1/v2 active namespace inputs SHALL be absent

## MODIFIED Requirements

### Requirement: Background is the sole host coordinator

The extension background SHALL be the only coordinator allowed to create or rebuild the Runtime host. Creation SHALL be single-flight: concurrent page requests SHALL wait for the same ready result. While at least one eligible physical tab remains in the background-owned Tabs API registry, a missing or destroyed Runtime within the live coordinator's supported host context SHALL be recreated automatically without user action. For Chrome/Edge, the Service Worker coordinator SHALL retain the trusted host-to-tabs registry and host-phase observations outside the Offscreen host, so Offscreen destruction is recoverable; after host creation it SHALL replay idempotent attach Commands for each current eligible tab into `LifecycleDomain`. Page Port, ping, heartbeat, visibility, freeze, and discard observations SHALL remain connectivity inputs only and SHALL NOT remove tab ownership or drive domain release. `LifecycleDomain` SHALL remain the unique owner of domain leases, ref-count, grace, and release State; the coordinator SHALL NOT keep a parallel domain lease/grace map. For Firefox, the coordinator and Runtime host SHALL share the persistent Background Page; supported recovery SHALL be limited to in-context `HostOwner` replacement, while a browser process restart SHALL be recovered when Firefox recreates the Background Page and restored eligible tabs idempotently reattach. Direct `backgroundView.close()` SHALL be outside the supported recoverable lifecycle and SHALL NOT require an event page, reload watchdog, or business fallback. A page watchdog MAY supplement Chrome/Edge probing but SHALL NOT be a tab-lifetime or leave controller. The background coordinator itself MAY be suspended or restarted by the browser; after such a supported restart it SHALL inventory current eligible tabs through the Tabs API, validate trusted current reattachments, reconstruct one host-to-tabs registry and one host, and dispatch idempotent attach Commands without producing duplicate tab owners, Lifecycle leases, hosts, or physical rooms.

#### Scenario: Concurrent creation requests

- **WHEN** multiple pages detect a missing Runtime at the same time
- **THEN** exactly one host creation SHALL proceed and all pages SHALL attach to its single ready result

#### Scenario: Automatic rebuild in a supported host context

- **WHEN** Chrome/Edge destroys its Offscreen host, or Firefox replaces an in-context Runtime provider, while an eligible tab remains in the current host registry
- **THEN** the coordinator SHALL rebuild the supported host context and re-establish each affected domain's connections and the WorldRoom without user action or a new logical join

#### Scenario: Stale Offscreen document

- **WHEN** the Offscreen document still exists but the Runtime provider or its identity probe does not respond while an eligible tab remains registered
- **THEN** the background health sweep SHALL close and recreate the stale document, verify the replacement provider, and replay idempotent attach Commands for current eligible tabs into the replacement Lifecycle Domain without requiring a page watchdog or retaining a parallel lease map

#### Scenario: DOM-free MV3 health probe

- **WHEN** the Chrome/Edge background service worker probes a newly created or steady-state Offscreen Runtime
- **THEN** the injector SHALL operate without `window`, `document`, or content-page location metadata and SHALL validate the responding provider identity

#### Scenario: Single Firefox replacement owner

- **WHEN** the Firefox persistent Background Page replaces its in-context Runtime
- **THEN** it SHALL dispose the old comctx provider listener, Remesh store, room transport, and Artico peer before exposing one replacement, leaving exactly one provider and physical Runtime

#### Scenario: Chrome MV3 Offscreen destruction recovery

- **WHEN** the production Chrome MV3 Offscreen document is directly destroyed while the Service Worker coordinator retains at least one eligible physical tab owner
- **THEN** the coordinator SHALL automatically recreate the Offscreen host, re-instantiate the shared Runtime, replay idempotent Lifecycle attaches for current tabs, and restore Runtime readiness and room participation without page-owned fallback, false logical join/leave, or duplicate domain lease authority

#### Scenario: Firefox MV2 process restart recovery

- **WHEN** the test-owned Firefox process is terminated and restarted with the same isolated profile and the target tab is restored, with the harness reinstalling the same exact temporary XPI only as setup if process exit removed it
- **THEN** the test SHALL observe one persistent Background Page, Runtime rejoin, page `ONLINE`, and state re-projection; profile and tab continuity SHALL be asserted separately, and the harness SHALL NOT claim product auto-reinstallation

#### Scenario: Firefox persistent-page boundary

- **WHEN** a diagnostic harness directly closes the Firefox persistent Background Page through `backgroundView.close()`
- **THEN** the result SHALL be recorded as negative evidence of the platform's non-recoverable persistent-page boundary rather than a product failure, and SHALL NOT motivate an event page, reload watchdog, or business fallback

#### Scenario: Deterministic Firefox HostOwner swap

- **WHEN** the Firefox host is disposed and replaced during lifecycle recovery
- **THEN** deterministic `HostOwner` dispose/swap tests SHALL prove that the old provider, store, rooms, and peer are fully disposed before exactly one replacement is exposed

#### Scenario: Observable steady-state host loss

- **WHEN** the coordinator detects provider loss or replacement failure after startup
- **THEN** Lifecycle-backed Runtime snapshots exposed to pages SHALL report the resulting `connecting` or `unavailable` phase instead of a hard-coded `ready` value, while the trusted tab registry and logical presence remain owned

#### Scenario: Coordinator restart

- **WHEN** the background coordinator itself is suspended or restarted by the browser
- **THEN** it SHALL inventory current eligible tabs, validate trusted current reattachments, reconstruct one host-to-tabs registry and one host, and dispatch idempotent Lifecycle attach Commands without producing duplicate tab owners, domain leases, hosts, logical joins, or physical rooms

### Requirement: Unified five-second lifecycle grace

When the last authoritative physical tab binding of a domain is removed because the trusted tab closed, lost content eligibility, or moved to another Runtime domain, `LifecycleDomain` SHALL uniquely own one unified five-second grace phase/deadline. Page ping, heartbeat, Port, visibility, freeze, discard, page-context detach, and connectivity timeout SHALL NOT start this grace while the physical tab binding remains. During grace, Connection SHALL retain that domain's ChatRoom connection, Session/History SHALL retain domain State, Delivery SHALL retain the volatile inbound un-ACK buffer, and World SHALL retain domain presence. On grace expiry, the Lifecycle domain-released Event SHALL begin a fenced final release: Session SHALL persist the retired private presence record with an unsettled final-end identity before publishing SESSION_END, retain that identity until the send settles, durably replace it with settled-cleanup ownership, and then remove that marker. Session's authoritative finalization state SHALL reject text/reaction allocation and live send from pending retirement through physical release. Connection SHALL physically leave Chat or the last World room only after marker removal succeeds. A trusted eligible tab binding for the same domain that returns within grace SHALL cancel grace through Lifecycle and read the current Runtime snapshot without a false offline/online transition. No persistent outbound outbox or delivery-status retry survives a successfully completed grace release; only the separately specified volatile inbound un-ACK buffer participates in this lifecycle.

#### Scenario: Refresh retains the tab owner without grace

- **WHEN** a user refreshes the only eligible tab of a domain and its old page context disconnects before the new document attaches
- **THEN** the background SHALL retain the same physical tab binding, Lifecycle grace SHALL not start, and the domain connection and state SHALL continue without re-join flapping, presence flicker, or message loss caused by the refresh

#### Scenario: Connectivity loss does not impersonate final release

- **GIVEN** the only eligible tab of a domain remains open
- **WHEN** its ping, heartbeat, Port, visibility, frozen, discarded, or page-context attachment state is lost
- **THEN** bounded connectivity recovery MAY run, but no domain grace, SESSION_END, observer leave, or physical room departure SHALL begin

#### Scenario: Application reconnect preserves the logical generation

- **GIVEN** the application Reconnect Effect retains the frozen `leaveRoom()` then `joinRoom(command)` composition
- **WHEN** the Runtime ChatRoom implementation executes that composition for an active domain
- **THEN** `leaveRoom()` SHALL invoke current-domain Runtime reconnect rather than final logical release, the replacement physical Chat session SHALL reuse the same `presenceId`, World SHALL remain physically joined, and local plus observer views SHALL receive snapshots without SESSION_END, logical join/leave, or another notice

#### Scenario: Durable retirement rejects

- **GIVEN** a committed active presence generation and a PresenceStore that rejects the retired record
- **WHEN** final release begins
- **THEN** the same active durable and in-memory lease, Chat/World physical membership, History state, World desired presence, and joined Runtime snapshot SHALL remain; no SESSION_END, observer leave, or physical departure SHALL occur; the pending release fence SHALL be removed so allocation and live send remain usable; and the existing Runtime error path SHALL surface a retryable request-local failure

#### Scenario: Retirement succeeds after storage recovery

- **GIVEN** a prior retirement attempt was fenced by storage rejection and the PresenceStore later recovers
- **WHEN** final release is requested again
- **THEN** the same generation SHALL persist one retired identity before exactly one SESSION_END settles, durably transition it to settled-cleanup ownership, remove that marker, and only then SHALL Connection physically leave Chat and the last World room while observers classify one leave

#### Scenario: Every non-active final-release phase fences live authority

- **GIVEN** Session has a pending release in `retiring`, `retrying`, `publishing`, `pending`, `settling`, `settlement-failed`, `cleaning`, or `cleanup-failed`, or has restored `inflightEnd`, `pendingEnd`, or `settledEnd` without an active `local` lease
- **WHEN** the current or replacement host requests text allocation, reaction allocation, or live Chat send
- **THEN** both Server preflight and the authoritative Session Command SHALL reject before HLC allocation or Wire send, no live frame SHALL be added, and successful marker cleanup SHALL retain that fence until physical domain release completes

#### Scenario: SESSION_END send rejects

- **GIVEN** durable retirement succeeded but the SESSION_END send rejects
- **WHEN** the send failure settles
- **THEN** Session SHALL durably transition that generation from in-flight to retryable pending final end, Connection SHALL retain Chat/World physical membership and publish no false local departure, and a later same-host final-release request SHALL durably transition the same marker back to in-flight before retrying the idempotent end

#### Scenario: Host replacement continues an unsettled final end

- **GIVEN** durable retirement succeeded and a first or retry SESSION_END is unsettled or explicitly rejected
- **WHEN** the Runtime host is replaced and the same user invokes join before END settlement
- **THEN** the replacement SHALL use the retained `presenceId` only to physically rebind and continue the same END transaction, SHALL expose no successful active join or live-message authority, and SHALL finish with at most one observer leave plus no persistent marker; a subsequent explicit join SHALL allocate a new generation

#### Scenario: Post-settlement cleanup rejects

- **GIVEN** SESSION_END settled and Session durably replaced the unsettled identity with private settled-cleanup ownership
- **WHEN** marker removal rejects
- **THEN** Session SHALL retain settled-cleanup ownership and Chat/World physical membership still owned by the current host, surface a request-local error, publish no second SESSION_END merely to retry cleanup in the same host, and permit physical departure only after later marker removal succeeds

#### Scenario: Host replacement assumes settled cleanup ownership

- **GIVEN** the observer ledger accepted SESSION_END and durable settled-cleanup ownership remains after a cleanup rejection
- **WHEN** the same user's replacement host invokes join
- **THEN** it SHALL only remove that marker, SHALL join neither Chat nor World, SHALL publish no SESSION or SESSION_END, SHALL expose no active session or live-message authority, and SHALL preserve the observer's exactly-once leave; only a later explicit join MAY allocate a fresh `presenceId` and one new logical join

#### Scenario: Readiness helper distinguishes mounted UI from convergence

- **WHEN** automated acceptance observes an already-mounted usable chat textarea after a refresh or restart
- **THEN** the helper SHALL accept that UI readiness immediately; a separate bounded eventual membership/presence wait MAY guard against a hang, and the five-second domain grace SHALL NOT be treated as a UI-convergence deadline

#### Scenario: Grace expiry

- **WHEN** no eligible physical tab binding for the domain returns within 5 seconds and durable retirement plus SESSION_END settlement succeed
- **THEN** the ChatRoom connection, Runtime domain state, volatile inbound un-ACK delivery buffer, and WorldRoom presence for that domain SHALL all be released or removed in the required causal order, with no persistent outbound status or same-id crash retry retained

#### Scenario: Event outside grace

- **WHEN** an inbound event targets a domain that is unregistered or past its grace period
- **THEN** the system SHALL discard the event because no persistence location exists for it

### Requirement: Runtime Chat session lifecycle

The headless Runtime SHALL bind each Chat source to a session identity and logical generation. A join SHALL send strict `session {sessionId, user, presenceId, joinedAt}` before live text, reaction, or history traffic. `joinedAt` SHALL be allocated and persisted by Session with a new local logical generation, projected unchanged to wire, and remain unchanged with its `presenceId` across physical session replacement. It SHALL NOT be synthesized from receiver observation, discovery order, `baselinePeerIds`, or `clock.now()`. A bound `sessionId` SHALL not change its `user.id`; an accepted `presenceId` SHALL not change its bound `user.id` or `joinedAt`; live event `userId` SHALL match the transport-bound session user. `name` and `avatar` SHALL remain mutable projection fields: a SESSION for the same accepted identity binding SHALL update that current projection across attached pages without changing logical membership or notices. A new physical incarnation SHALL retire the old source binding and old history sync, and SHALL trigger exactly one fresh history request for the replacement without running it concurrently with unsettled old source work. Reconnect of the same logical generation SHALL not become a new observer join.

#### Scenario: Session binding and replacement

- **WHEN** a source joins Chat, republishes a bound logical generation, sends changed `user.id` or logical time for an accepted generation, or reconnects with a new physical incarnation
- **THEN** the Runtime SHALL require the session message first, reject a `user.id` change for the same `sessionId`, reject a `user.id` or `joinedAt` change for the same accepted `presenceId`, reject live events whose `userId` does not match the bound user, retire the old source binding/sync for a new incarnation, and issue exactly one fresh history request for the replacement

#### Scenario: Same logical presence refreshes its user projection

- **GIVEN** a source and `presenceId` retain the same `user.id` and `joinedAt`
- **WHEN** a later accepted SESSION changes `name` or `avatar`, or repeats the current values
- **THEN** every attached same-domain page SHALL converge to the current projection idempotently without changing membership count, allocating a generation, emitting a chat/history event, or emitting a join/leave notice

#### Scenario: Future HLC does not advance Runtime clock

- **WHEN** the Runtime receives a wire event rejected because its HLC is more than five minutes ahead of the explicit receiver `now`
- **THEN** it SHALL reject the event, leave the central HLC clock unchanged, and continue processing later valid events

### Requirement: Session classifies logical presence across physical lifecycles

Session SHALL uniquely own local active-generation state, unsettled in-flight final-end identity, rejected retryable pending-final-end identity, observer-accepted settled-cleanup identity, and a bounded observer ledger. A private two-method `PresenceStoreExtern` SHALL persist those facts through `browser.storage.session` across supported Runtime host replacement; it SHALL NOT expand MessageStore, the origin database schema, `RuntimeServer`, `ChatRoomExtern`, or any UI/public model. Active lease, in-flight final end, retryable pending final end, and settled cleanup SHALL be four mutually exclusive strict records. Session SHALL allocate exact `{presenceId, joinedAt}` only for initial join or true return after complete final end. Refresh, reconnect, recovery, replay, duplicate SESSION, additional physical session, page reattach, supported host replacement, and replacement recovery of any final-end marker SHALL reuse the retained generation and logical time and emit snapshot convergence without a logical join/leave.

Chrome MV3 SHALL construct the concrete session-backed PresenceStore in the background Service Worker and expose only its existing `load`/`save` methods to the Offscreen Runtime through a dedicated comctx adapter over a point-to-point Runtime Port. Port name and comctx namespace SHALL be routing values rather than authority. Before delivering a message, Background SHALL require the transport sender's runtime id, exact Offscreen document URL, and absence of a tab; content, options, and every other extension source SHALL be disconnected without reading or writing durable state. Every provider response SHALL resolve through the exact request-to-Port binding recorded when its request arrived. If that binding has detached or been replaced, the response SHALL be dropped and SHALL NOT fall back to the current active Port. Offscreen SHALL admit a response only while that request remains pending on the same binding; uncorrelated, replayed, old-binding, wrong-namespace, wrong-direction, and broadcast responses SHALL reach no comctx callback. From request-ID response registration, each one-shot call SHALL reserve exactly one ordered transport generation. Generic response subscription SHALL NOT open a Port. The local heartbeat response subscription SHALL unregister before the actual `apply`, and that `apply` SHALL consume the oldest remaining request reservation. If the reserved generation terminates before pending insertion, the call SHALL reject before connecting or posting to a replacement and the adapter SHALL remove that operation's one-shot response entry. Port disconnect, synchronous connect/send failure, and adapter disposal SHALL reject every request and pre-send reservation owned by the terminal generation exactly once and release every adapter-owned per-operation response entry, without hanging or automatically replaying `load` or `save`; stale and late traffic SHALL traverse no terminal operation callback, and only a later new application call with a new request ID may create a replacement Port and correlation. Provider-owned long-lived callback handles SHALL retain their existing refresh/re-registration lifetime and SHALL NOT be removed by this one-shot cleanup. The dedicated adapter SHALL use Port send/disconnect as its liveness authority, satisfy comctx heartbeat preflight locally, and transmit only actual one-shot PresenceStore operations. Offscreen SHALL register no broadcast Runtime-message listener for PresenceStore, so another context cannot forge a provider response or observe one through that adapter. The Offscreen document SHALL receive the dependency through host assembly and SHALL NOT dereference an unavailable `browser.storage.session`, create memory storage, or route presence records through tabs/pages. Firefox MV2 SHALL pass the same concrete session-backed store directly from its persistent Background Page into the same shared host. Storage rejection and authenticated-Port termination SHALL reach Session's existing request-local failure fences without acknowledging, discarding, or weakening the durable transition; a later call after Service Worker recreation SHALL reconnect and use the same session-backed record.

The first accepted strict remote SESSION SHALL bind exact `user.id` and `joinedAt` to its source and `presenceId` in the observer ledger and record the current `name`/`avatar` projection. A SESSION with missing, malformed, non-finite, fractional, unsafe, or negative `joinedAt` SHALL fail closed before binding; a later SESSION for the same accepted generation SHALL accept a changed projection only when `user.id` and `joinedAt` match, while an equal projection is idempotent. A different `user.id` or `joinedAt` SHALL be rejected source-locally. Every rejected SESSION SHALL leave prior accepted binding, membership, projection, history, and notices unchanged; it SHALL create no fallback timestamp, user-visible notice, or global recovery. Projection refresh SHALL change no logical membership or notice eligibility. For one committed local generation, a remote generation SHALL be eligible for an observer-local join only when its accepted `joinedAt` is strictly greater than local `joinedAt` and that user transitions from zero active logical generations to one. Equal or earlier time SHALL be historical snapshot convergence even when both peer discovery and SESSION occur only after local commit. Peer discovery and `baselinePeerIds` MAY retain physical catch-up bookkeeping but SHALL NOT decide logical order. A later remote SESSION received during a provisional local attempt SHALL remain attempt-owned and invisible until that attempt commits; rollback or supersession SHALL emit nothing. Physical `PeerLeft` SHALL not produce a logical leave. A valid SESSION_END SHALL produce one observer-local leave only when the user transitions from one active generation to zero. On graceful final local release, Session SHALL replace the active lease with an in-flight final-end identity, send SESSION_END, durably remove that identity after settlement, and only then allow Connection to leave the Chat room. The departing local client need not persist its own leave.

The local self-join notice SHALL be generation-scoped, persist immediately after successful new-generation join without waiting for history, and consume only Runtime private join provenance. Reconnect/recovery/host replacement SHALL not create a candidate; later true return SHALL use a later stable generation event time and produce a distinct notice. All SystemNotice records SHALL remain observer-local: they SHALL never be encoded or sent on the peer wire, included in a history request/response, or replayed from another peer's history. Sender-asserted `joinedAt` SHALL be authoritative only for observer-local notice ordering after strict source binding and SHALL NOT authorize identity, routing, resource admission, or a globally trusted total order under arbitrary clock skew.

#### Scenario: Chrome Offscreen mounts with background-owned durability

- **GIVEN** a Chrome MV3 Offscreen document does not expose `browser.storage.session` while the background Service Worker does
- **WHEN** the shared Runtime host mounts and Session loads or saves a presence record
- **THEN** the Offscreen host SHALL remain available, the request SHALL use the private background PresenceStore adapter, and the exact session-backed record or persistence rejection SHALL return without a volatile fallback or page relay

#### Scenario: Unauthorized extension contexts cannot access PresenceStore

- **GIVEN** content and options contexts know the deterministic Port name and comctx namespace
- **WHEN** either context opens the named Port and sends a valid `load` or `save` injector envelope
- **THEN** Background SHALL reject the transport source before comctx dispatch, return no lifecycle record, perform no storage write, and leave the durable bytes unchanged

#### Scenario: Forged provider response cannot reach Offscreen

- **WHEN** a content, options, or other extension context broadcasts a provider-shaped response with the exact namespace and request id
- **THEN** the Offscreen PresenceStore injector SHALL receive nothing because it listens only to its background-owned point-to-point Port

#### Scenario: Service Worker recreation preserves the private route

- **WHEN** the accepted Port disconnects with a request in flight and the Service Worker provider is later recreated
- **THEN** every request owned by that Port SHALL reject through the existing request-local fence without replay, and only the next new `load`/`save` SHALL reconnect to the authenticated provider and use the retained session-storage record

#### Scenario: Old provider completion cannot cross into a replacement Port

- **GIVEN** an authenticated request arrived through one Port and that binding detached before its provider operation completed
- **WHEN** a replacement authenticated Port becomes active and the old operation later produces its response
- **THEN** Background SHALL drop the old response because its original request binding no longer exists; the replacement Port SHALL receive nothing and Session SHALL not advance from that completion

#### Scenario: Terminal send failure settles every binding-owned request

- **GIVEN** one or more Offscreen PresenceStore requests are pending on the same Port
- **WHEN** a later send on that Port throws a disconnected-Port error before the asynchronous disconnect event is observed
- **THEN** every request owned by that terminal binding SHALL reject without timeout, the operation that was already accepted SHALL not be replayed, and only a later new request may create a new Port and correlation

#### Scenario: Pre-send request cannot migrate generations

- **GIVEN** comctx generated request IDs and registered one or more one-shot response callbacks against a live generation, but their `apply` messages have not entered the pending registry
- **WHEN** that generation disconnects before those messages can be posted
- **THEN** every prepared call SHALL reject through its original generation, no replacement Port SHALL receive any original `load`/`save` bytes, and only a later application call with a new request ID may connect and settle

#### Scenario: Terminal operations release adapter-owned response entries

- **GIVEN** one-shot `load` or `save` operations registered response callbacks before or after pending insertion on one generation
- **WHEN** connect, post, disconnect, termination, or disposal makes that generation terminal
- **THEN** every affected operation SHALL reject, every adapter-owned response entry and reservation SHALL return to baseline, stale or late responses SHALL settle nothing, no original bytes SHALL migrate to a replacement, and a later fresh request SHALL use a new correlation

#### Scenario: Dispose settles a prepared first call

- **GIVEN** a one-shot call registered its response callback while no Port was open and its `apply` has not started
- **WHEN** the Offscreen adapter is disposed
- **THEN** the call SHALL reject locally, its adapter-owned response entry SHALL be released, no Port SHALL open, and no durable PresenceStore operation SHALL be posted

#### Scenario: Firefox uses the equivalent direct store

- **WHEN** Firefox MV2 mounts the shared Runtime in its persistent Background Page
- **THEN** host assembly SHALL pass the concrete session-backed PresenceStore directly and preserve the same strict records, rejection semantics, and supported replacement behavior

#### Scenario: Six-timepoint A B C D lifecycle

- **GIVEN** independent actual Runtime Server/Session/Wire stacks use deterministic in-repo transport, A is an existing observer, B is a new local user, C is an additional physical session for B's generation, and D is B's replacement Runtime host
- **WHEN** the control executes preparation baseline, B first join, duplicate/C publication, transient B loss/D recovery, D final release, and B later return
- **THEN** B and A SHALL each persist one join for the first logical transition; duplicate/C/loss/recovery SHALL add no notice; A SHALL persist one leave on final end; and later return SHALL persist one fresh self join plus one fresh observer join

#### Scenario: Delayed discovery uses logical join order

- **GIVEN** A logically joined before B, but B discovers A and receives A's SESSION only after B commits
- **WHEN** A's accepted `joinedAt` is less than or equal to B's local `joinedAt`
- **THEN** B SHALL converge A into the current membership snapshot without persisting `A joined the chat`, while A SHALL persist B's later join once

#### Scenario: A-before-B is invariant across delivery timing

- **GIVEN** A's accepted logical generation began before B's and remains active
- **WHEN** B receives A discovery and the strict historical SESSION before B commit, split across B commit in either order, or both only after B commit
- **THEN** B SHALL converge membership with exactly `[B joined]`, A SHALL converge with exactly `[A joined, B joined]`, and no delivery order or receiver clock SHALL create an `A joined` notice for B

#### Scenario: Equal logical time is not later

- **GIVEN** B has committed its local logical generation and has no active generation for remote A
- **WHEN** B first accepts A's strict SESSION with `joinedAt` equal to B's local `joinedAt`
- **THEN** B SHALL converge A as historical snapshot state without an A join notice

#### Scenario: Missing or invalid logical time cannot create membership

- **GIVEN** a source sends a v3 SESSION with missing or invalid `joinedAt`, or mutates `joinedAt` after its generation was accepted
- **WHEN** the Runtime validates or applies that frame
- **THEN** it SHALL reject the complete SESSION source-locally, preserve every prior accepted fact, synthesize no receiver-local replacement time, persist no SystemNotice, and leave other sources operational

#### Scenario: Later zero-to-one generation creates one local notice only

- **GIVEN** B is committed and no logical generation for remote C is active
- **WHEN** B accepts C's strict SESSION with `joinedAt` greater than B's local time and C transitions from zero active generations to one
- **THEN** B SHALL persist exactly one observer-local `C joined` SystemNotice, duplicates and physical recovery SHALL add none, and that notice SHALL never enter peer wire or history exchange

#### Scenario: Provisional later join becomes visible only on commit

- **GIVEN** B's local join is provisional and later C sends a valid SESSION whose `joinedAt` is strictly greater than B's
- **WHEN** B's attempt commits, rolls back, or is superseded
- **THEN** C's join candidate SHALL become observable exactly once only on commit and SHALL produce no membership or notice from rolled-back or superseded work

#### Scenario: Physical loss remains provisional

- **WHEN** a bound peer leaves transport without a valid final generation end and later republishes the same generation from reconnect, recovery, host replacement, or rejected-final-end replacement recovery
- **THEN** Session SHALL publish snapshots only and preserve the logical observer state without a leave/join pair

#### Scenario: Duplicate and late lifecycle facts

- **WHEN** SESSION or SESSION_END is duplicated, an accepted generation changes `user.id` or `joinedAt`, or an ended generation's SESSION arrives late
- **THEN** Session SHALL apply the accepted generation/end at most once, reject mutation or resurrection of the generation, and persist no duplicate notice

### Requirement: One-shot migration without dual architecture

The change SHALL be delivered as one candidate that includes the hosts, exact eight-method ChatRoom port, state-free Runtime client, clean-cut internal comctx surface, uniquely owned Lifecycle/Connection/Session/World/History/Delivery/Wire Domain graph, private RoomTransport Extern/provider composition, message delivery, reconnect entry, current v3 peer protocol, exact typed Database extern/default adapters, internal concrete MessageStore, canonical outer-type/outer-id `MessageRecord` with `ChatMessageRecord.message` and `SystemNoticeRecord.notice`, send-first persistence, and complete removal of page-owned WebRTC, v1/v2 active protocol paths, stateful ChatRoom authority, catch-all Network ownership, and old WireExtern/provider route. Persistence and Runtime authority SHALL be complete clean-cut structural replacements rather than minimal repairs; no compatibility wrapper, alias, dual path, dead facade, hidden state channel, provider leak, or test-only accommodation may retain an obsolete owner/record/Store/outbox architecture. No intermediate release SHALL ship multiple architectures or protocol generations. Existing local message history SHALL NOT be imported, migrated, or retained by the canonical database.

#### Scenario: Single-candidate completeness

- **WHEN** the release candidate is inspected
- **THEN** it SHALL contain the full Remesh DDD + CQRS Runtime architecture and current v3 protocol, and SHALL NOT contain any active page-owned WebRTC path, v1/v2 protocol room path, stateful ChatRoom recovery authority, catch-all Network owner, old WireExtern route, or dual writable fact

#### Scenario: No data migration

- **WHEN** the extension upgrades with old unstorage message data present
- **THEN** the old data SHALL be left unread and unconverted, and no migration code, marker, or reaction conversion SHALL exist

## REMOVED Requirements

### Requirement: Peer wire protocol is replaced with v2, without compatibility

**Reason**: Required SESSION logical join time creates the Owner-authorized v3 Chat+World generation.

**Migration**: Current clients join only v3 Chat and World namespaces; v1 and v2 remain isolated without a bridge or fallback.
