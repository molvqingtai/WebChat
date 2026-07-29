## Context

The inherited baseline is source exact `a602149522c7038f29e13307bb925a48ed3848d7`, whose parent docs exact `740373298711002548cbe6eecb3c63dcb045db74` already restores Refresh after terminal join failure. Current authority exact `3a0a7d1fa11b1f69ce73f93a55f05e8e88cc48b1` on `fix/cross-browser-action-lifecycle` / Draft PR #76 preserves the non-doc source bytes of `cd1f054301abb383100b89fdea5bcb633ac79332`. Its focused/full automated evidence is exact-local and remains useful history, but the Owner has deferred partial manual acceptance and requires one final candidate containing all six repairs. The Owner removed the successful manual-Refresh `Ready to chat` Toast while explicitly retaining visible `Connecting` for every active Refresh/recovery; request-local loading, Refresh control motion, and genuine failure feedback remain.

Five additional causes are already isolated:

1. `ArticoRoomTransport` restarts only when `close` fires while `desiredRooms` is non-empty. If timeout-driven leaves empty the set before `close`, a later `join()` can attach to the retained `disconnected` peer and wait forever for an event that already occurred.
2. `Connection.startAttempt` correctly fences an old same-domain generation, but reports `Domain join superseded` through the ordinary operation-failure path. Application effects convert it into `Room.OnErrorEvent`, and generic Toast displays an internal cancellation as a user failure.
3. Current strict SESSION is `{type,sessionId,presenceId,user}`. A previously unseen remote generation receives receiver-local `clock.now()`, while join eligibility depends on `baselinePeerIds`. If both discovery and SESSION for pre-existing A arrive after B commits, B misclassifies A as a later live join.
4. The content injector puts complete `document.location.href` into comctx tab metadata. The background `TabsProviderAdapter` uses that value in `tabs.query({url})`, and the Offscreen relay later requires complete URL equality. A fragment is an in-document position rather than page-routing identity; treating it as a target key can lose or reject the initial Runtime response. Because content bootstrap waits for `initClient()` before mounting the Shadow UI, the control then never appears.
5. `ClientLease.attach()` wraps `registerPage()` and `attachPage()` in a nominal 15-second poll, but `poll()` checks its deadline only after one attempt rejects. A control-plane request that never resolves or rejects therefore owns no terminal deadline. Recovery has already published `connecting`, so background/Offscreen host replacement, Port/response loss, or lost response correlation can leave both readiness and the stable loading Toast permanent. Concurrent watchdog checks may also reach recovery before one owner is established, and a response that arrives after timeout/detach must not mutate or release a newer lease generation.

Adding a required SESSION field is incompatible with released v2 strict parsers. Keeping a shared World v2 room while moving only Chat would advertise incompatible peers as available. The product therefore needs one clean Chat+World namespace generation boundary.

## Goals / Non-Goals

**Goals:**

- Keep failed-join Refresh available and single-flight through the existing request lifecycle, while disabling and rotating the Refresh control for every current connection loading owner.
- Guarantee that fresh room demand can create one replacement for an already disconnected Artico peer.
- Keep newest-wins attempt fencing while making expected supersession non-user-visible and state-safe.
- Restore the first-version rule that only a remote logical join later than the local logical join can create a remote join notice.
- Keep one logical generation's `presenceId` and `joinedAt` stable through physical recovery.
- Isolate v3 Chat and World peers cleanly from v1/v2 without compatibility code.
- Make content-page RPC targeting fragment-insensitive without weakening exact-tab or real-navigation stale-response safety.
- Keep direct-hash startup, hash-only navigation, and hash changes during initial handshake on one mounted control and logical presence.
- Bound each ClientLease register/attach RPC and the complete startup/recovery generation, single-flight overlapping recovery signals, and reject late lifecycle/request work.
- Show owner-scoped `Connecting` throughout every current Refresh/recovery, including healthy retained-Runtime reattachment, while ensuring it dismisses on current ready or becomes unavailable within the bounded recovery budget and never becomes `Ready to chat`.
- End a successful manual Refresh by dismissing only its request loading Toast rather than publishing `Ready to chat`; retain genuine error feedback.
- Accept only one cumulative final exact.

**Non-Goals:**

- No unbounded provider retry loop, presentation-owned connecting watchdog, background-worker wake redesign, or global Runtime restart.
- No suppression of real Artico, Runtime, join, persistence, or protocol errors.
- No ChatMessage, history, reaction, SESSION_END, World payload, codec algorithm, limits, or MessageStore/database change.
- No `ChatRoomExtern` method/type expansion, new presenter, Toast geometry, panel-state, alternate bootstrap/status UI, Ready/status result, or browser-specific business branch.
- No fragment-specific room, page lease, user-visible navigation state, remount, reconnect, join/leave, or protocol field.
- No v2 decoder, optional `joinedAt`, dual schema, dual publication, room bridge, local-data migration, package/app version, tag, or release-metadata change.
- No claim of globally trusted total order under arbitrary cross-device clock skew.

## Decisions

### 1. One cumulative route inherits the Refresh repair

`a6021495` is the sole source baseline. Its derived Refresh availability, unjoined direct retry, joined leave/join composition, request identity, button pending state, generic Toast correlation, stale fences, and protected presentation/public boundaries remain authoritative.

The old Owner task for a602 alone stays deferred. Implementation MAY use focused commits for reviewability, but no intermediate head may receive final Review, QA, Owner acceptance, checkout synchronization, or publication authority. Only one cumulative exact containing all six outcomes enters gates.

The a602 Refresh request identity, availability, immediate operation dispatch, button spin, 300ms minimum visible loading dwell, error feedback, and stale-request fences remain authoritative with two Owner-directed refinements. First, the accepted request SHALL publish its existing `Connecting` loading entry while active; success SHALL dismiss only that request's generic loading entry after the accepted dwell and SHALL NOT publish `Ready to chat` or any other success descriptor. Failure SHALL still update the matching entry to the genuine request-local error. Runtime recovery SHALL likewise publish its existing readiness `Connecting` entry while active, and current ready continues to dismiss only `webchat-runtime-readiness`. Neither path may use global dismissal, suppress active Connecting because the retained Runtime is healthy, or affect unrelated Toasts.

Second, Refresh control motion SHALL derive from current Chat connection loading ownership rather than from the click event alone. The current owner-scoped Toast loading entry and the existing mounted Refresh control are two projections of the same state: for every interval in which that entry is `loading`, the button SHALL be disabled and its icon SHALL rotate continuously. This includes direct/automatic connection or join, recovery, manual Refresh, the accepted manual minimum dwell, and a panel mount or re-render during an already active Chat connection. It SHALL NOT create or mount a pre-App control while Runtime bootstrap is unresolved. Current success SHALL dismiss the loading entry and end control loading in the same owner-scoped transition; genuine failure SHALL replace it with the error and end control loading without hiding the error. The icon SHALL then stop and ordinary availability SHALL be recomputed: a failed join with otherwise valid configuration enables retry, while an unrelated static eligibility failure MAY still keep the button disabled without rotation. A stale or superseded owner cannot stop the animation, enable the button, or clear feedback owned by a newer operation.

### 2. Artico liveness is a state invariant, not a one-shot close edge

The provider adapter SHALL maintain this invariant:

> Whenever desired room demand is non-empty, the adapter owns either one non-terminal peer generation or exactly one restart capable of creating it.

On the transition from no desired room to fresh demand, `join(roomId)` SHALL inspect the current Artico signaling state. If the retained peer is `disconnected`, it SHALL enter the same single restart owner used by `close` recovery before the join waits for readiness. Concurrent Chat and World joins, a pending delayed restart, and repeated joins SHALL fan into that owner rather than create multiple peers or timers.

Every peer callback and delayed restart SHALL be generation-fenced. A stale peer's `open`, `error`, or `close`, and a stale timer, cannot join rooms, reject current work, or replace a newer peer. `leave()` and `dispose()` SHALL remove only their owned room demand; dispose SHALL cancel restart work and settle pending joins exactly once. The host-lifetime peer id remains stable across replacement peers.

This repair does not restart a merely `connecting` or `connected` peer on every join and does not add a provider watchdog. Runtime retains the bounded physical-room timeout and late-completion fences.

### 3. Supersession is a typed internal cancellation

Connection's newest-wins generation and abort of provisional Session/World state remain correct. Supersession SHALL use a machine-readable internal cancellation outcome rather than an ordinary user failure or message-string comparison.

The superseded operation SHALL settle its own caller and pending cleanup, but SHALL NOT:

- emit `Room.OnErrorEvent` or a generic error Toast;
- report success or retain its stale user/site input;
- complete join state, publish presence, or clear a newer request;
- overwrite the winning Runtime snapshot or identity.

The winning attempt alone owns the real success/failure result and convergence for every attached same-domain page. Application join/recovery status and button/request cleanup SHALL not remain loading after cancellation. Real provider, protocol, persistence, and join errors continue through existing error paths unchanged.

Logical identity binding and user projection are distinct. A bound `sessionId` cannot change `user.id`, and an accepted `presenceId` cannot change its `user.id` or `joinedAt`. For that same binding, `name` and `avatar` are mutable presentation facts rather than generation identity: an accepted refresh SHALL replace the current projection and converge it to every attached same-domain page without changing membership, allocating a generation, or emitting a join/leave notice. Repeating the same projection is idempotent. A stale superseded attempt cannot restore an older projection.

### 4. SESSION carries one logical join timestamp

The v3 Chat SESSION shape is exactly:

```ts
interface SessionMessage extends ChatSession {
  type: 'session'
  presenceId: string
  joinedAt: number
}
```

`joinedAt` SHALL be a required finite safe non-negative integer allocated and persisted by Session when it creates a new local logical presence. That persisted generation fact is the only valid local source; the wire SHALL project it unchanged. Reconnect, Refresh, reattach, duplicate publication, additional physical session, and supported Runtime host replacement reuse the same `{presenceId, joinedAt}`. SESSION_END remains exactly `{type:'session-end',presenceId}`.

The first strict remote SESSION accepted from the v3 wire binds its `user.id` and `joinedAt` to that `presenceId` in the observer ledger and records the current `name`/`avatar` projection. A duplicate or replacement SESSION for the same generation with the same `user.id` and `joinedAt` SHALL accept a changed `name` or `avatar` as the current projection, while an equal projection is idempotent; neither case changes membership or notices. A missing, malformed, or unsafe `joinedAt`, or a different `user.id` or `joinedAt` for an accepted generation, is a source-local protocol violation: the complete SESSION SHALL be dropped before membership/projection/notice mutation, while prior accepted state remains unchanged. Receiver observation time, discovery time, `baselinePeerIds`, and `clock.now()` are local metadata only and SHALL NOT supply or replace the remote logical time.

For one committed local logical generation, a remote generation is eligible for an observer-local join only when:

- its accepted `joinedAt` is strictly greater than the local generation's `joinedAt`; and
- the remote user transitions from zero active logical generations to one.

A remote timestamp less than or equal to local is historical snapshot convergence even if peer discovery and SESSION both arrive after local commit. A later remote SESSION received during a still-provisional local attempt MAY be retained as attempt-owned notice eligibility, but nothing becomes observable unless that attempt commits; superseded/rolled-back attempts emit nothing. `baselinePeerIds` may still own physical catch-up/convergence bookkeeping, but it SHALL NOT determine relative logical join order.

Equal timestamps make no claim that either generation is later. The fact is sender-asserted P2P event time and is not trusted for routing, authentication, resource admission, or global clock correctness. The accepted product behavior restores prior timestamp semantics under ordinary synchronized browser clocks; a central sequencer is outside this product.

### 5. Chat and World move together to protocol generation v3

Both physical namespace inputs SHALL change from their exact v2 values to exact v3 values. Current clients join only v3 Chat and World rooms; v1 and v2 clients remain in their own generations. No current parser receives another generation's frames, and no compatibility decoder, translator, optional field, dual join, dual send, or fallback exists.

World wire remains exactly `{sessionId,user,sites}` with no `type` or `joinedAt`. Its namespace moves solely so the cross-domain discovery list cannot count an old peer that the current Chat parser cannot communicate with. Codec algorithm, limits, Chat room derivation by origin, and World singleton ownership remain unchanged.

This protocol-generation change does not choose an application release number or update package metadata.

### 6. URL fragment is excluded from canonical page-routing identity

The content page SHALL continue to qualify from the extension manifest and the existing HTTPS/exclusion rules. A URL fragment SHALL NOT participate in content-script eligibility, Runtime domain identity, page lease identity, or the trusted equivalence check used to return an RPC response to the same live document. The Runtime domain remains `document.location.origin`; changing only `location.hash` SHALL NOT create a new domain, page lease, logical presence, join, leave, or UI mount.

The background/Offscreen routing boundary SHALL retain a trusted exact tab identifier from extension-provided sender context and SHALL compare a canonical document-navigation identity that excludes only the fragment. Scheme, host, port, path, and query remain part of navigation identity. An old response from a genuinely replaced document, changed path/query navigation, recycled tab id, untrusted source, wrong namespace/direction, or missing target SHALL still be rejected. The repair SHALL NOT route by origin alone, broadcast a response to every same-origin tab, trust a payload-supplied tab id, or remove stale-response protection.

Direct startup at `https://host/path?query#fragment`, hash-only navigation after mount, and a hash change while the initial coordinator/Runtime handshake is in flight SHALL each converge to the same page client and one mounted Shadow UI. A hash change SHALL not restart `initClient()`, remount the application, re-register a second page, or create logical lifecycle notices. A genuine document navigation MAY replace the client through the existing unload/new-content lifecycle, and no response owned by the old document may settle the new client.

The existing product rule remains: content bootstrap mounts no alternate loading/unavailable/Retry/status UI before `initClient()`. This repair restores the valid response route; it does not turn presentation into Runtime authority or add a fallback control.

### 7. ClientLease recovery is deadline-owned and single-flight

Each ClientLease lifecycle SHALL own at most one current startup or recovery generation. The existing 15,000ms startup/recovery timeout remains the overall generation budget and SHALL start once; repeated watchdog failure, generation/host-id/page-lease mismatch, and overlapping recovery calls SHALL join that same task rather than reset its budget, restart feedback, or issue parallel attach sequences. A fresh `init()` or `detach()` SHALL abort the old lifecycle and retire all of its request ownership.

Every `coordinator.registerPage()` and `server.attachPage()` attempt SHALL have a hard per-RPC deadline no greater than 5,000ms and no greater than the generation's remaining overall budget. Expiry SHALL cancel that request's local ownership and reject the attempt so the existing bounded retry policy may continue only within the original overall budget. If the transport cannot stop already-dispatched remote execution, its correlation SHALL still be retired locally. A late resolve/reject from an expired, aborted, detached, or superseded request SHALL be inert: it cannot publish ready/unavailable, replace the snapshot, start a watchdog, settle a newer generation, or detach/unregister the winner's lease.

A current valid attachment within the budget SHALL publish the accepted snapshot and settle `ready`. Exhaustion, terminal loss, or unrecovered rejection SHALL settle `unavailable` and log the current failure once. Host replacement, Port disconnect, response loss, and a forever-pending provider SHALL therefore all have terminal behavior. No recovery signal may leave HostPhase or feedback permanently connecting.

Readiness truth and presentation remain separate. Every current page Refresh or recovery generation SHALL publish the existing owner-scoped `Connecting` loading entry when the operation starts, including attachment to a healthy retained Runtime, and SHALL keep that owner current while the operation is active. Direct/automatic Chat connection and join SHALL project that same current activity to the existing Refresh control even when they are not caused by a Refresh click. For as long as the current entry remains `loading`, the control SHALL remain disabled and rotating. Current ready SHALL dismiss only that entry and end the same owner's control loading without publishing `Ready to chat` or any success descriptor. Unavailable SHALL replace the same entry, end control loading, and remain visible no later than the original 15,000ms recovery deadline. Detach, remount, abort, or supersession SHALL retire only the old owner's entry; stale settlement cannot dismiss or replace a newer generation's feedback or stop its control animation. The presentation owns no Runtime/network truth and cannot extend the recovery budget. No alternate bootstrap UI, pre-App Refresh control, or Toast visual/structure change is added.

### 8. Verification is a combined causal matrix

The final exact SHALL prove the following intersections rather than six disconnected happy paths:

- failed initial join -> Refresh eligibility -> one retry -> provider failure or success -> bounded request cleanup, with success dismissal and no `Ready to chat` Toast;
- `desiredRooms` empty/non-empty x peer ready/connecting/disconnected x concurrent Chat/World demand x restart/leave/dispose;
- old/new same-domain operations x success/failure ordering x identity input freshness x cancellation cleanup;
- A-before-B with discovery and SESSION delayed beyond B commit, later C during/after B's attempt, duplicate publication, reconnect, reload, and supported host replacement;
- current v3/v3 exchange and v1/v2/v3 physical namespace isolation while World payload bytes remain otherwise unchanged;
- direct-hash startup, mounted hashchange, and in-flight hash change, each crossed with exact-tab delivery, real-navigation replacement, and stale/forged response rejection.
- retained healthy host refresh, hung/rejected register or attach, host/Port/response loss, concurrent recovery signals, late completion, and current recovery success/failure crossed with immediate owner-scoped Connecting plus bounded HostPhase and feedback settlement.

Every repaired path needs a deterministic fail-before that fails for the documented parent cause and a pass-after on the same final candidate. Protocol tests SHALL cover exact keys, missing/unknown/invalid `joinedAt`, generation binding, canonical bytes, and namespace residue. Provider tests SHALL prove exactly one replacement peer and stale callback/timer isolation. ClientLease tests SHALL use deterministic time and controllable pending RPCs to prove per-call and overall deadlines, cancellation, single-flight, late-response fencing, immediate Connecting even for healthy retained-host refresh, and bounded terminal feedback. Application tests SHALL include explicit parent fail-first controls: successful Refresh currently publishes `Ready to chat` instead of ID-scoped dismissal; both-late discovery plus historical SESSION currently persists a pre-join peer notice; direct connection Toast loading does not project the required disabled rotating Refresh control; and a direct fragment URL does not mount the application. Candidate controls SHALL prove Toast loading and Refresh control loading never diverge, manual and direct/automatic loading share the current control state, success dismisses only its owner without a success descriptor, genuine error ends control loading while remaining visible, stale completion cannot end newer animation, exact A-before-B notice projections are A `[A joined, B joined]` and B `[B joined]`, and the full fragment routing matrix passes. Existing a602 Refresh controls remain mandatory but their prior verdicts do not transfer.

## Risks / Trade-offs

- [Sender clocks can be skewed] -> Document `joinedAt` as sender-asserted observer-notice ordering only; do not use it as a security or transport fact. Strictly greater preserves the prior product rule, while a trusted global sequencer remains out of scope.
- [Required SESSION field breaks v2] -> Move Chat and World together to v3 and make isolation explicit; do not run mixed parsers in one room.
- [Join-driven restart could create peer churn] -> Trigger only for a terminal `disconnected` peer and converge close-driven/join-driven work through one restart owner.
- [Cancellation suppression could hide real failures] -> Use a machine-classified supersession outcome only; all other failure kinds retain current error feedback.
- [Six repairs increase candidate scope] -> Keep implementation boundaries focused, require direct and cumulative scope evidence, and gate only one final exact as explicitly requested.
- [Removing URL equality could route a response to the wrong document] -> Canonicalize only the fragment while retaining trusted tab id plus scheme/host/port/path/query equality and generation-local response correlation.
- [A deadline can reject a genuinely slow but live control plane] -> Keep the existing 15-second overall recovery budget, cap individual calls at 5 seconds to permit bounded retry, and expose unavailable rather than pretending indefinite progress.
- [A stale Connecting owner can outlive or overwrite a newer recovery] -> Bind feedback to the current request/recovery owner, retire it on every terminal or lifecycle replacement, and fence every late settlement.

## Migration Plan

1. Freeze this refinement as a clean detached sole child of current authority exact `3a0a7d1fa11b1f69ce73f93a55f05e8e88cc48b1`; keep the Owner checkout, `.pnpm-store/`, unrelated refs, PR body/state, and CI untouched. Continue the same `fix/cross-browser-action-lifecycle` / Draft PR #76 requirement route; do not create another branch/PR or restore/cherry-pick invalid `9beec650...` bytes or evidence.
2. Implement v3 protocol/Session logical time and namespace isolation first, then Artico liveness, typed supersession, canonical fragment-insensitive page routing, deadline-owned ClientLease recovery/readiness feedback, and cumulative Refresh integration on one controlled route. The current Owner-smoke gaps require fail-first coverage before their repairs.
3. Freeze one clean cumulative source exact; no evidence from a602 or partial heads transfers.
4. Obtain fresh independent Reviewer and QA verdicts on the same exact, including focused/full automation and the exact-bound production browser scope defined by the task plan.
5. Only after both pass, synchronize the Owner checkout and run one six-scenario manual acceptance: failed-join manual Refresh and direct/automatic connection loading both show Connecting and disable/rotate Refresh until the same owner terminates, with successful manual retry dismissing its entry without a success Toast; disconnected-peer retry; multi-page avatar update without supersession Toast; A-before-B exact notice order; direct startup on a fragment URL with a visible working control; and retained-Runtime page refresh with bounded active-to-terminal Connecting.
6. Publish only through a verified normal fast-forward after Owner acceptance and remote-drift checks. `master`, tags, package version, and release metadata remain untouched.

Rollback is a clean revert to the v2/a602 source exact. Because v2 and v3 rooms are isolated and no data schema changes, rollback requires no wire bridge or data migration; it simply returns the client to the v2 namespaces.

## Open Questions

None. The Owner directed PM to confirm OpenSpec before implementation; the product decisions above close the SESSION fact, Chat+World clean-cut namespace boundary, bounded ClientLease recovery/feedback behavior, required active Connecting, and silent successful Refresh result.
