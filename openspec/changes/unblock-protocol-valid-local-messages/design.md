## Context

See `proposal.md` for the product motivation. On the frozen baseline, `Room.SendTextEffect` waits for `ChatRoom.sendMessage`; the adapter performs Runtime allocation, awaits `RuntimeServer.sendChatMessage`, awaits `MessageStore.insert`, and only then returns the message that drives local projection and draft clearing. The effect serializes requests with `concatMap`, so one unresolved transport operation also delays later local sends.

The Runtime already owns the only full locally authored `ChatMessageSchema` parse and routes genuine send errors through the current page's existing error boundary. The public `ChatRoom` port already returns the exact allocated message and exposes `onError`; no public surface or new presentation state is needed.

## Goals / Non-Goals

**Goals:**

- Make successful full-protocol validation the commit point for current-page text projection and draft clearing.
- Keep transport and local persistence after that commit independently attempted and explicitly observed.
- Prevent one delivery or persistence operation from holding later protocol-valid local text projections.
- Preserve exact allocated identity, current ordering rules, one validation boundary, and existing error ownership.

**Non-Goals:**

- Offline sending, delivery guarantees, retransmission, an outbound queue/outbox, ACKs, delivery status, or recovery replay.
- Hiding, special-casing, or suppressing any genuine failure.
- Restoring a `readyPeers` set, filtering provider recipients, changing direct `room.send(payload, to)` delegation, or changing Artico.
- Changing reaction projection, remote-message acceptance, History, protocol limits/values, persistence schema/version, or the eight-method `ChatRoom` extern.
- Supporting or comparing v2.5.0.

## Decisions

### 1. Separate protocol acceptance from delivery settlement

Runtime allocation remains responsible for `id`, `hlc`, and `userId`. The complete allocated text message then passes the existing single `ChatMessageSchema` boundary. Successful parsing produces one private acceptance result carrying the exact allocated `TextMessage`; it does not claim that transport or persistence completed.

The page adapter must not add a second parse or infer acceptance from the text command alone. Constructing a provisional page-owned message was rejected because it would duplicate Runtime identity/HLC ownership and could display a value different from the one sent or persisted. Waiting for provider readiness was rejected because provider state is precisely the fallible work that must not gate local display.

Acceptance is determined only by successful full-protocol parsing. No post-validation error's message, name, type, code, constructor, subsystem, or operation participates in that decision. This keeps the rule general across current and future Runtime failures instead of embedding a known provider string as control flow.

A preparation failure before a complete protocol-valid message exists still rejects the send and preserves the draft. A schema failure remains `Invalid message.`, produces no local projection, transport, or persistence, and exposes no raw validation issue.

### 2. Commit current-page projection at protocol acceptance

After acceptance, `sendMessage` returns the exact allocated text message to the application without awaiting transport or `MessageStore.insert`. The application derives its local text record from that returned identity, publishes the existing local-send event, and clears the accepted draft.

Only preparation and protocol acceptance may remain in the per-send awaited path. Transport and persistence settlement are not part of the serialization token that admits the next text command. Consequently, a pending or failed prior side effect cannot make later accepted messages wait and appear as a recovery-time batch.

The returned message remains the sole local projection source. Store-watch replay, `onMessage`, visible-list diffing, body/mention matching, or a new callback must not create a second local projection path.

### 3. Fan out transport and persistence as independent owned work

Once validation succeeds, both transport and local `MessageStore.insert` are started. Neither waits for the other, and failure of one does not cancel or suppress the other. Their completion is not allowed to change the already committed local projection or draft state.

Transport failure remains owned by the Runtime send/error route. Persistence failure is observed by the page adapter and reaches its existing `onError` application route. Each owner preserves the original `Error` and current scoped presentation behavior; an already returned local send must not create an unhandled rejection or a second caller rejection when later work fails. Error content does not control display, retry, or settlement.

Running post-acceptance work independently was chosen over reordering to persistence-first or retaining transport-first. Either sequential order still allows the first failure or delay to prevent the second attempt and invites the same coupling to return.

### 4. Preserve loss semantics without adding status

The existing `ChatRoom` command and return types remain exact. No result DTO, status field, provisional flag, local-only marker, retry handle, or hidden channel is added. A locally visible message may be absent remotely after transport failure and may be absent after reload or from another local page after persistence failure. The existing error feedback is the only failure indication in this change.

Reactions retain their current acceptance, projection, and failure behavior. This change concerns the text-message path that creates a new visible message and exhibits recovery-time pile-up.

### 5. Verification must control each boundary independently

Mutation-sensitive controls must hold transport pending, reject transport, hold persistence pending, reject persistence, and fail schema validation independently. They must prove that a protocol-valid text is projected and its draft cleared before later settlement; both post-validation attempts start even when the other fails; later accepted texts project without waiting; late failures retain their original message through the existing error route; and protocol-invalid input produces zero projection, wire, and persistence.

Existing causal identity, same-id collision, store-watch, provider direct-delegation, reaction, remote live/history, error-observability, and no-outbox controls remain authoritative. Real built-extension acceptance records send-to-first-DOM timing across post-validation error windows with more than one failure source; a terminal screenshot alone is not negative evidence.

## Risks / Trade-offs

- [A locally visible message is not delivered] -> Preserve the exact transport error and explicitly retain no delivery guarantee or automatic retry.
- [A locally visible message disappears after reload] -> Preserve the persistence error and document that current-page projection is independent of durability.
- [Detached side-effect promises become unhandled] -> Give both post-acceptance operations explicit terminal observers using existing error ownership.
- [Store invalidation projects the local message again] -> Keep returned identity as the local-send source and retain the existing exclusion of local sends/store replay from `onMessage`; cover delayed watch and same-id controls.
- [Later sends reorder protocol identity] -> Keep allocation/HLC ownership in the Runtime and test acceptance order while removing only downstream settlement from the queue.
- [The repair silently suppresses a provider defect] -> Keep direct provider delegation and unchanged Error routing; local visibility and failure observability are independent.

## Migration Plan

1. Publish this docs-only sole child of `develop@83719009ab88e909ec8e4bb7d14b70cb693e31ea` and obtain a fresh exact-bound Inspector review.
2. From the reviewed authority, add fail-before controls for pending/rejected transport, pending/rejected persistence, later-send independence, and protocol-invalid zero-side-effect behavior.
3. Implement the smallest private acceptance/side-effect split without changing public, protocol, provider, or persistence shapes.
4. Run focused/full tests, TypeScript, formatting/lint, dual production builds, strict OpenSpec/status/doctor, exact hosted CI, and one fresh cumulative source review. Keep the PR Draft until later authorization.

Rollback is source-only: restore the prior transport-first awaited path and its tests. No persistence migration, protocol rollback, or compatibility layer exists.
