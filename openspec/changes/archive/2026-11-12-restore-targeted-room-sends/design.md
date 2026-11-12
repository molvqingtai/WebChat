## Context

The authority base is current `develop@83719009ab88e909ec8e4bb7d14b70cb693e31ea`. Its adapter correctly preserves Artico's optional target and calls `room.send(payload, to)` once, but ordinary product producers deliberately omit `to`. The resulting native broadcast enumerates signaling-known Calls before all of this browser's local per-peer DataChannels have necessarily opened.

The failure was reproduced from a same-cycle Start-chatting plus Text send. The sending browser locally accepted the Text, then Artico reached one local per-peer DataChannel that was not open and synchronously threw. That observation proves a local send-side channel state only; it does not read or prove the remote browser's state.

The relevant v1.9.7 source exact is `b5f1b0183a80ba089ad8e51f15f40dabd8089a50`. It resolved Text/Reaction recipients from application-known peers and called the adapter once with a peer-id array. SyncUser, HistorySync, and World Sync already used an explicit single peer. Its comment documents the same Artico behavior and source locations.

Current authority is internally inconsistent. `standardize-functional-iteration` requires omitted targets for ordinary Chat, normal Session/World publication, and History requests. `absorb-transient-recovery-without-error-toasts` and canonical `Physical sends isolate per-target readiness transitions` still describe WebChat-owned per-target attempt-all. Current source instead delegates once and lets Artico's array/broadcast call throw at the first failing target. This change makes every live authority describe the new Owner-selected model.

## Goals / Non-Goals

**Goals:**

- Ensure every current product room-wide send excludes signaling-only connecting Calls without reading or classifying DataChannel state.
- Preserve exactly one provider call per logical message or publication.
- Preserve the optional provider API and its complete `undefined | string | string[] | []` meaning.
- Preserve Artico's array order and first-throw interruption, including the original Error and existing failure owner.
- Add a single one-second pause only where a successful local join directly continues into provider send.
- Make post-join delay ownership cancellable and exact without adding shared readiness or delivery state.
- Keep History, control-message, local projection, persistence, and UI semantics unchanged outside targeting and the explicit join-followup timing.

**Non-Goals:**

- No DataChannel, Call, ready/connecting/open, remote-peer, or error-text inspection.
- No `readyPeers`, ready-target cache, transport recipient discovery, per-target `map`/loop, attempt-all, provider-call retry, outbox, delivery acknowledgement, or durable queue. Preserve only the existing World release retry for a preflight failure that made zero provider calls.
- No one-second delay on each automatic/control send, no room-wide stabilization gate, and no delay on a new user-initiated Text/Reaction send.
- No change to message schemas, room namespaces, History pagination/settlement, local display, persistence order, Toast wording, or PR #135.
- No dependency, package, lockfile, compatibility, migration, deployment, or release change.

## Decisions

### 1. Provider capability stays optional while production room-wide intent becomes explicit

The low-level API remains:

```ts
send(body, target?: string | string[])
```

Its meanings remain exact:

- `undefined`: native Artico room broadcast;
- `string`: one selected peer;
- `string[]`: the selected peer subset in provider array order; and
- `[]`: no recipients.

Production call sites are a separate decision. Every currently inventoried room-wide product send resolves its logical recipients before the provider invocation. A non-empty result produces exactly one `Room.send(body, peerIds)`. An empty result performs no `Room.send` call and settles as successful no-recipient work. The optional API remains available and testable, but none of the five current production producers relies on native broadcast.

The conversion does not belong in `ArticoRoomTransport`: the adapter has no product authority to decide Sessions, History providers, or World publication membership. It continues to validate the room and delegate the already selected target exactly once.

### 2. Each producer uses its existing logical recipient owner

Recipient selection is closed by producer:

| Producer                       | Explicit target source                                                                    | Freeze point                                                                                   |
| ------------------------------ | ----------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| Initial Session publication    | The active join attempt's current Chat-room Session `sourcePeerId` values                 | After the join continuation's sleep completes, immediately before the publication send         |
| Text/Reaction                  | The committed domain's current Session `sourcePeerId` values                              | At the user send operation                                                                     |
| History inventory-request page | That request's existing `expectedProviders`, originally snapshotted from current Sessions | At History request start and retained for every page                                           |
| World full publication         | Current World room-member ids owned by the publication generation                         | After any owning join sleep completes; otherwise when the full publication revision is created |
| World publication retry        | The same explicit target array frozen by that full publication revision                   | Reuse of the existing publication request; no recomputation or per-target retry                |

Every list excludes this room's local peer id and de-duplicates while preserving first-seen order. Current Session/room-membership ownership determines which bindings are present; this repair adds no separate grace/departure classifier. These are application and current-generation membership facts already owned by Session, History, World, or Wire. They are not a cache or observation of DataChannel state.

Existing targeted sends retain their present meaning: Session/World current-state catch-up stays targeted to the relevant newly joined or reconnected source, and each History response stays targeted to its requester. No existing single-target or array-target caller is broadened or filtered by the adapter.

### 3. One target array means one provider call and one provider settlement

WebChat calls `Room.send(body, peerIds)` once. It does not call `sessions.map(...)`, loop, invoke one target at a time, catch target-local throws, or aggregate results.

The pinned Artico array implementation iterates targets synchronously. If a selected peer closes after recipient selection and its call throws, that original Error rejects the single WebChat send. Any later array targets may remain unattempted. Earlier targets may already have accepted the payload. WebChat preserves that behavior deliberately: it adds no attempt-all, provider-call retry, replay, rollback compensation, error-text classifier, or delivery status. The existing World release preflight retry remains limited to the same publication request before any provider call and reuses that revision's frozen array.

The target array removes signaling-only Calls that have not entered the relevant logical membership. It cannot make the selected set atomic. A selected peer may still close between selection and provider invocation; that real race follows the existing provider failure route.

### 4. Only direct join-followup send chains sleep

The one-second pause is a call-chain rule, not Room readiness State.

The affected chains are:

1. Domain attempt: accepted Chat plus World join -> `sleep(1000)` -> re-check the attempt -> derive current Chat recipients -> initial Session publication -> derive current World recipients -> the same attempt's World publication. The chain sleeps once before its first provider send; World does not sleep a second time.
2. World recovery or manual replacement: accepted World join -> `sleep(1000)` -> re-check the recovery/replacement -> derive current World recipients -> current full World publication.
3. A never-invoked serialized send head whose provider invocation is resumed directly by accepted join: accepted join -> `sleep(1000)` -> re-check the current head/generation -> resume that head once. When that head belongs to one of the room-wide producers, its product owner derives current logical recipients only after the sleep; an already explicit targeted head retains its recipient meaning without re-filtering.

The delay starts only after the matching join has successfully settled and its exact request/generation is still current. No affected producer snapshots, filters, de-duplicates, or self-excludes its peer ids before the sleep. At 999ms the direct continuation has made no provider call; at 1000ms it first re-checks ownership and then derives the target array from membership current at that time, so Session or World membership changes during the wait are reflected exactly as the current owner represents them. The existing operation timeout remains the absolute owner and is not extended. If leave, teardown, cancellation, Room replacement, attempt supersession, or Runtime replacement occurs during sleep, the continuation becomes inert and a late timer performs no target derivation, encode/send, state commit, failure projection, or successor mutation.

A new user Text/Reaction send, History page, peer catch-up, History response, later World registry update, release publication not directly created by join, and every other chain keep their current timing. The implementation adds no common `joinedAt` flag, readiness deadline, deferred-send queue, or per-send sleep.

### 5. The restored comment records the exact rationale

The implementation restores the v1.9.7 explanatory comment at the shared product recipient-selection boundary. Its substance remains:

```ts
/**
 * Why specify peerIds:
 * According to artico source code, room.send() without target will send to all calls (including connecting peers).
 * If a peer's DataChannel is not ready, it will throw "Connection is not established yet" error and interrupt the forEach loop.
 * Sessions only contains peers that have completed application-layer Session synchronization, which means their DataChannel is already established.
 * So we only send to peers in Sessions to avoid errors.
 *
 * @see https://github.com/matallui/artico/blob/8a4f1a185be9355f893120e9492151f1785e59fa/packages/client/src/room.ts#L114 Room.send() implementation
 * @see hhttps://github.com/matallui/artico/blob/8a4f1a185be9355f893120e9492151f1785e59fa/packages/peer/src/peer.ts#L281 Peer.send() throws error when not ready
 */
```

Only the two obsolete `UserList`/`SyncUser` lines become current `Sessions`/application-layer Session membership wording. Every other byte, including both historical Artico reference lines, remains unchanged. The comment does not authorize DataChannel inspection or claim that a selected peer cannot close later.

### 6. Active authority is synchronized instead of layered into contradiction

`standardize-functional-iteration` keeps the behavior-neutral iteration rules, one-call adapter delegation, optional target, single History request identity, response-lane independence, late valid merge, and ten-second loading-only settlement. Its omitted-target classification changes to explicit product targets, and its no-new-test restriction is superseded only for the mutation controls required by this repair.

`absorb-transient-recovery-without-error-toasts` keeps structural lifecycle ownership, revision supersession, current continuation, original Error routing, zero-call World release preflight retry, no provider-call retry/outbox, and History no-result. Its World iterator becomes one publication request with one explicit array call, not one call per target, and a provider throw settles through the current whole-send failure path without continuing later targets.

Canonical per-target attempt-all is removed. Provider parity now requires optional-target meanings, one array delegation, empty-array no-op, native first-throw interruption, room-level failure, close/error, and dispose behavior.

## Risks / Trade-offs

- **A selected logical Session closes by provider call time** -> Preserve Artico's original Error and interruption; do not add a separate departure/readiness filter or retry.
- **An empty target list is mistaken for broadcast** -> Skip the provider call and settle success; never pass `undefined` as an empty-list fallback.
- **Per-target expansion returns through a helper** -> Require one observable provider call and mutation controls that fail on `map`, loops, or continued later targets after the first throw.
- **The delay becomes global behavior** -> Keep the three join-continuation branches explicit and prove unrelated automatic and user sends retain their current timing.
- **Targets are frozen before the join pause** -> Require the sleep to settle before current membership is read; prove membership changes during the wait alter the eventual array exactly as represented by the current owner.
- **A late timer sends from an old generation** -> Re-check the exact attempt/request/generation after sleep and make stale continuation inert.
- **World retry recomputes recipients or retries individual peers** -> Freeze one array on the publication revision and reuse only that whole-send request where the existing release continuation retries after a zero-provider-call preflight failure; never retry after provider invocation.
- **History targeting changes response collection** -> Use the existing `expectedProviders` snapshot only as the request-page target array; retain response correlation, late merge, loading, and no-result behavior unchanged.
- **Authority still claims attempt-all or omitted broadcasts** -> Synchronize every live non-archive occurrence and enforce a residue scan before publication.

## Migration Plan

1. Publish this docs-only authority as one sole child of current `develop@83719009ab88e909ec8e4bb7d14b70cb693e31ea`, including synchronized active authority, and obtain fresh exact-bound Inspector review.
2. From the reviewed exact, add fail-before focused controls for all five omitted-target producers, the array first-throw behavior, empty recipients, exact direct-join timing, and stale continuation cancellation.
3. Implement explicit target resolution at each named product owner, restore the comment, and add only the three call-site-local join sleeps without a shared gate or queue.
4. Run focused/full tests, TypeScript, Oxfmt/Oxlint, dual production builds, strict focused/full OpenSpec/status/doctor, scope/residue, exact identity, and hosted CI.
5. Obtain one fresh cumulative Inspector source review. Keep the new pull request and PR #135 Draft; do not mark Ready, merge, deploy, release, or publish without later explicit authority.

Rollback is source-only: revert explicit product target resolution and the three call-site-local sleeps. No protocol, data, storage, compatibility, package, migration, deployment, or release rollback exists.
