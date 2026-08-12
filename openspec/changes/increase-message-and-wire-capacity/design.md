## Context

The current protocol uses one direct Artico data-channel string whose representation is exactly `Base64(deflate(UTF8(JSON)))`; there is no additional application envelope or fragment reassembly layer. Current limits are 48KiB for one message-like value, 64KiB for the final Base64 frame, and 256KiB for decompressed JSON. The 48KiB constant is also used as a declarative body string-length ceiling, so it does not currently prove the size of a complete canonical message.

The active schema-authority contract intentionally removed callback-backed semantic validation and whole-value checks from Valibot schemas. The new capacity contract does not reopen arbitrary semantic validation. Static declarative schemas remain the sole authority for fields, types, discriminants, keys, and declaratively expressible field/array limits. Two pure resource guards now measure the UTF-8 byte size of canonical complete objects because those limits govern allocation and transport rather than payload meaning.

History currently creates fixed 180-day requester/provider snapshots, pages them through the same codec, and retains cumulative 10,000-entry/8MiB accounting. Supplier queries already have AbortSignal ownership and physical settlement, and each direction already terminates on completion, lifecycle loss, error, or a 10-second attempt timer. The new contract removes only the cumulative inventory/response ceilings and makes that timer a no-progress deadline refreshed by valid forward progress.

The Footer currently compresses an image, converts it to Base64 immediately, stores the Base64 value in a `Map` under a NanoID, inserts `![Image](hash:<id>)`, and expands the placeholder before send. The draft is not persisted. An editor-owned Blob URL is therefore sufficient temporary identity, but it must be owned and revoked explicitly because a Blob URL is page-local and revocable.

## Goals / Non-Goals

**Goals:**

- Make the layered limits explicit in their actual units and enforce each limit at its owning boundary.
- Allow one complete canonical `ChatMessage` up to 192KiB UTF-8 and make the same message replayable in one History Push frame.
- Bound one final frame to 256KiB and its decompressed JSON to 1MiB without introducing fragmentation.
- Bound one complete canonical `ChatUser` to 8KiB UTF-8 while keeping the avatar compression target at 5KiB.
- Remove History cumulative session caps without leaving immortal or unbounded owned work.
- Remove editor hash/content-map indirection while keeping data URLs as the only sent and persistent image representation.
- Make one current-only protocol cut and preserve the Owner's no-new-test policy.

**Non-Goals:**

- Increasing the 500-code-unit visible-text rule, changing it to grapheme counting, guaranteeing a fixed image count, or changing compression quality policy.
- Adding application fragmentation/reassembly, streaming attachments, upload storage, thumbnails, rich-text editing, or an image preview UI.
- Changing message/user shapes, History variants, peer ACK/retry/resume, source concurrency, delivery buffering, databases, dependencies, signaling, or user-visible History feedback.
- Preserving interoperability with peers built against the older capacity values or reading old `hash:` drafts.

## Decisions

### 1. Each layer has one explicit unit and owner

| Layer                            |                                Contract | Owner                                                                           |
| -------------------------------- | --------------------------------------: | ------------------------------------------------------------------------------- |
| Visible text                     | 500 JavaScript string/UTF-16 code units | textarea/UI                                                                     |
| Image compression                |                  30KiB target per image | editor image compression                                                        |
| Complete canonical `ChatMessage` |                            192KiB UTF-8 | pure protocol resource guard at local production and peer/local-load acceptance |
| Final encoded frame              |                                  256KiB | `NativeWireCodec` preflight/decode                                              |
| Decompressed JSON                |                                    1MiB | streaming codec decode before UTF-8/JSON materialization                        |
| Avatar compression               |                             5KiB target | profile/avatar production                                                       |
| Complete canonical `ChatUser`    |                              8KiB UTF-8 | pure protocol resource guard at local production and peer/local-load acceptance |
| History Push count               |                    at most 100 messages | declarative schema and History pager                                            |
| History Pull/Push frame          |              256KiB final encoded frame | common codec preflight                                                          |
| Per-source decode queue          |  8 frames / 256KiB aggregate wire bytes | `WireDomain` operational admission                                              |
| Per-domain inbound un-ACK buffer |      512 records / 8MiB canonical bytes | `DeliveryDomain` operational admission                                          |

KiB means 1024 bytes. Canonical object bytes mean `TextEncoder` length of the exact `JSON.stringify` representation used for that complete object. A target is best-effort compression output, not a hard guarantee. A 30KiB image commonly expands to about 40KiB as a data URL, so a 192KiB message usually holds four images plus ordinary fields, but no fixed count is promised.

The 500-code-unit UI rule and 192KiB complete-object budget solve different problems. The first keeps the literal draft short; the second bounds the send-time body after Blob references expand to data URLs, plus mentions and all other canonical fields. The declarative wire `body` ceiling becomes 192 \* 1024 JavaScript string/UTF-16 code units as a coarse field bound so several expanded data URLs are structurally representable. It is a separate unit from `MAX_CHAT_MESSAGE_BYTES`/equivalent, which names and measures the full object's UTF-8 bytes.

Alternative rejected: raise only the Footer check. A locally accepted value could still fail codec or History replay, and receiver/user guards would remain misleading.

### 2. Static schemas remain structural authority; pure byte guards own resource admission

Valibot schemas remain static and declarative. They define complete structures and enforce built-in field/array rules without callback, transform, clock, Set, map, or dynamic context. The protocol boundary additionally exposes narrowly scoped pure guards for the canonical UTF-8 size of a complete `ChatMessage` and complete `ChatUser`. These guards do not inspect relationships, rewrite values, or create a general validator API.

The guards run for locally produced user/message values before transport or persistence, for decoded peer values after the one complete room-selected schema parse and before application, and for unknown local records after their one declarative load parse and before projection. A locally produced user is guarded before joining/publishing or persisting profile state; a remote user nested in SESSION, World, mention, or History data is guarded as part of its parsed containing value. Downstream typed Runtime, History supply, delivery, and persistence paths do not independently reparse or recompute the same guard. A History Push producer preflights the complete page through the real codec, so page construction does not add per-message semantic validation.

This decision narrowly supersedes earlier active statements that no complete `ChatMessage`/`ChatUser` canonical byte size is computed anywhere. It does not supersede the schema-derived data graph, the ban on callback-backed schema semantics, the exactly two unknown-input parse boundaries, or the absence of cross-field/clock/URL/reference validation.

Alternative rejected: express UTF-8 bytes as `v.maxLength`. JavaScript string units are not UTF-8 bytes and cannot measure a complete object.

### 3. One 256KiB final frame is the physical contract

`NativeWireCodec.encode` serializes one value to UTF-8 JSON, rejects that uncompressed byte sequence above 1MiB, deflates it, Base64-encodes it, and rejects the final string above 256KiB before handing any bytes to Artico. Decode rejects a non-canonical/malformed Base64 frame or final input above 256KiB, limits streamed decompression to 1MiB before UTF-8 decode/JSON parse, and returns `unknown` for the existing schema boundary.

The application adds no fragmentation, reassembly, attachment stream, alternate envelope, or frame-size negotiation. History Pull and Push use this same limit. Push still carries at most 100 messages, and the pager shrinks a page until the real codec accepts it; a single legal 192KiB message must fit with required Push/user/envelope fields or the candidate is not conformant.

The existing per-source decode queue remains 8 frames and 256KiB aggregate wire bytes. A full-size frame may therefore occupy the complete byte queue for that source. Queue overflow or a rejected frame remains source-local and must not disconnect/recreate the room.

Alternative rejected: retain 64KiB for History. A message accepted live under the 192/256 contract could never be replayed.

### 4. History has finite data and progress boundaries, not cumulative session caps

Delete `MAX_HISTORY_SESSION_MESSAGES`, `MAX_HISTORY_SESSION_BYTES`, their State fields/checks, and descriptions of a 10,000-entry or 8MiB phase/session ceiling. Requester and provider still freeze independent 180-day snapshots. Pull pages contain continuous inventory slices accepted by the real 256KiB codec; Push pages contain at most 100 recent-first records and remain within the same codec bound.

The complete fixed snapshots may contain all eligible records and IDs. Their lifecycle remains finite and terminates on any of:

- final locally settled `done: true` for the direction;
- fixed requester/provider snapshot exhaustion, including the frozen 180-day cutoff boundary;
- source disconnect or replacement;
- domain release or Runtime lifecycle cleanup;
- explicit cancellation;
- malformed, invalid, reordered, changed replay, gap, post-done, or source-binding failure;
- supplier, persistence, encode, send, delivery-admission, or local-processing failure; or
- 10 seconds without valid forward progress.

Valid forward progress is acceptance/settlement that advances the current inventory page, provider snapshot/supply stage, response page send, response page admission, or local response processing under the complete current attempt identity. The deadline is re-armed only by such progress; duplicate/replayed work cannot keep an attempt alive. A stale timeout/token/completion cannot affect another attempt.

Every terminal path discards requester/provider inventories, snapshots, response pages, pending queues/sends, page fingerprints, working counters, and attempt-owned History feedback. It releases source/global supplier admission. If selected page supply is physically running, cancellation drives the existing `AbortSignal` through the IndexedDB query and projection/filter/sort chain, and slot release or successor promotion waits for actual settlement. Terminal source bindings remain only as already specified to prevent a second sync on the same connection; source replacement/domain release clears them. No peer ACK, resume, retry, progress persistence, or compatibility path is added.

Alternative rejected: remove caps and keep one fixed wall-clock lifetime. Large but continuously progressing 180-day snapshots would fail arbitrarily; a no-progress deadline bounds stalled work while allowing finite data exhaustion.

### 5. Blob URLs are draft-only owned references

On image insertion, the Footer compresses the file toward 30KiB, retains the resulting Blob through an editor-owned object URL, and inserts exact Markdown `![Image](blob:...)` into the textarea. The textarea continues to show literal Markdown text; this change adds no image thumbnail or preview surface. The editor owns a lightweight set or equivalent lifecycle record of live URLs it created. It owns no hash-to-content map and assigns no image NanoID.

On send, only syntactically matched `blob:` references that are still live and owned by that editor may resolve. Every referenced Blob is read and converted to a data URL, the draft references are replaced in one temporary complete command/message candidate, mention ranges are updated by the existing composition owner, and the complete canonical `ChatMessage` and final wire frame are preflighted at 192KiB and 256KiB respectively. The actual sent, locally stored, remotely stored, and History-replayed Markdown contains data URLs only. A `blob:` URL is invalid in wire or persistent `ChatMessage` data.

An invalid, unowned, or revoked Blob URL, Blob read/conversion failure, message-budget failure, or wire-budget failure rejects the entire send and preserves the draft and every still-referenced owned URL. A successful send clears the draft and revokes its owned URLs. Explicit draft clear and component unmount revoke all owned URLs. When editing removes the last occurrence of one owned URL, that URL is revoked; duplicate occurrences keep it live until the final reference disappears. References removed from one edit cannot be used by a later stale send completion.

Delete `hash:` parsing, image-placeholder NanoID allocation, and the hash-to-Base64 `Map` in the same cut. Do not interpret or migrate an old `hash:` draft.

Alternative rejected: send the Blob URL. It is local to the creating browsing context and cannot be resolved by another peer, History, or a later persistent render.

### 6. Capacity changes are one incompatible v6 generation

The new values replace 48KiB message-like, 64KiB final-frame, and 256KiB decompressed ceilings in one delivery. Chat and World advance together from v5 to v6 physical namespaces even though their retained data fields do not change. A v5 peer must not appear reachable to a v6 peer and then reject only larger frames. There is no capacity bit, negotiation message, v5 decoder, fallback limit, dual room publication, dual read/write, translator, migration, or conditional send path.

The implementation does not add repository test cases. Existing tests and fixtures that directly encode old values or the removed hash path may receive only mechanical expectation/value updates or deletion of now-obsolete assertions. Browser interoperability is an external acceptance matrix, not a new automated repository suite.

## Risks / Trade-offs

- [A 256KiB data-channel string is not interoperable in every target pairing] -> Gate delivery on bidirectional 64/128/192/256KiB Chrome/Firefox tests and treat any failure as a contract blocker rather than adding negotiation or fallback; v6 must not ship if the current target matrix fails.
- [A highly compressible frame expands excessively] -> Stop streaming decompression at 1MiB before UTF-8/JSON materialization.
- [A complete-object check becomes another semantic validator] -> Limit it to deterministic canonical UTF-8 byte count; keep every structural and semantic rule at its existing owner.
- [History can retain a large fixed snapshot] -> Keep bounded pages, concurrency, AbortSignal cancellation, no-progress timeout, finite 180-day/data-exhaustion termination, and complete terminal release.
- [Repeated valid progress can make a large History sync long-lived] -> This is intentional while the finite frozen snapshot advances; no-progress work still terminates after 10 seconds.
- [Blob URLs leak memory or are reused after deletion] -> Track editor ownership and reference count/liveness, revoke at last-reference removal/success/clear/unmount, and fence stale send completion.
- [A failed send revokes images and destroys the draft] -> Revoke only after success or actual reference removal; preserve referenced URLs on every failure.
- [Four-image expectations become a product promise] -> Document only a typical estimate; enforce bytes, not image count.

## Migration Plan

1. Land this docs authority and obtain fresh independent review before implementation.
2. Implement the v6 namespace cut, public limits/guards, codec, History accounting removal, editor Blob lifecycle, and only mechanical existing-test updates in one requirement branch and Draft PR.
3. Run repository gates and the external browser matrix on one immutable implementation exact. Oversize rejection must remain source-local and leave the room usable.
4. Deliver as one clean current-only cut with no data or draft migration. Roll back only by reverting the complete requirement PR.
