## Context

See `proposal.md` for motivation and the two delta specs for normative behavior. The current v3 History path is requester-driven cursor pagination: every new peer session repeatedly requests the provider's eligible 180-day window and relies on receiver-side `insert-if-absent` to discard overlap. The replacement must preserve the existing application-owned database, page-supplier cancellation, local Delivery ACK, strict Wire boundary, and source-local resource isolation while deleting that complete cursor state machine.

The new peer contract has exactly two variants. Request pages carry the requester's fixed message-ID inventory; response pages carry only provider records absent from the complete inventory. There is no peer ACK, missing-body request, cursor, recovery record, or third protocol phase. Toast truth depends on the local insert result and attempt termination, not on peer activity.

## Goals / Non-Goals

**Goals:**

- Replace the complete History subprotocol and state machine with one exact inventory-difference design.
- Keep requester/provider 180-day snapshots fixed, bounded, ordered, and source-local.
- Process missing-record pages serially and retain atomic `insert-if-absent` as the final concurrency boundary.
- Give each incoming `syncId` one operation-owned loading identity projected to all current same-domain pages.
- Delete every obsolete type, branch, state, test, and namespace input rather than wrapping the old path.

**Non-Goals:**

- Persisting History progress, resuming across disconnects, or confirming remote receipt/processing/persistence.
- Adding Bloom filters, Merkle trees, version vectors, capability negotiation, an empty-inventory fast path, or a second History implementation.
- Changing durable record/database shape, live Chat, Session/World payload semantics, HLC/LWW, notifications, unread attention, system notices, or generic error policy.
- Adding a count, progress percentage, success message, fixed Toast duration, or minimum loading dwell.

## Decisions

### 1. v4 is a structural replacement boundary

Both Chat and World select v4 room namespaces. Non-History payloads retain their v3 bytes, while the Chat union removes `HistoryCursor`, `HistoryRequestMessage`, and `HistoryResponseMessage` and admits only `HistoryMessagesRequest` and `HistoryMessagesResponse`.

This keeps strict schema selection simple and prevents an old peer from sharing presence while silently rejecting the new History phase. A same-room compatibility decoder, capability bit, translator, or dual publish would preserve two products and is rejected by the current-only rule.

### 2. Each direction owns an independent two-phase attempt

For one source pair, each peer independently acts as requester under its own `syncId`; the reverse direction uses another `syncId`. One outgoing requester State holds the local inventory snapshot and expected response page. One incoming provider State accumulates request pages, then owns the filtered provider snapshot and response send progression.

Request and response page counters each start at zero. The provider cannot query/filter or emit a response until it accepts the final request page. An explicit empty page terminates an empty phase. Identical page replay is idempotent; changed replay, gaps, out-of-order pages, response-before-inventory, or data after `done` cancel only that directional attempt.

### 3. The two 180-day snapshots freeze at their owning boundaries

The requester freezes its cutoff and one settled snapshot of canonical Chat record IDs before sending page zero. The provider freezes its separate cutoff and one settled canonical Chat-record snapshot only after the complete remote inventory arrives. The provider converts inventory entries to a set, filters its snapshot, keeps canonical recent-first order, and derives response pages whose `users` array is exactly the distinct author set of that page.

Records arriving after either snapshot are not spliced into that snapshot. Live delivery continues normally, and a later fresh sync observes current storage. This is smaller and more deterministic than a mutable scan cursor and closes page drift without persisting a snapshot ID.

### 4. Aggregate budgets and nonempty continuation pages bound work

Public encoding retains the strict 64KiB frame ceiling and 100-message response-page ceiling. Runtime attempt admission additionally tracks at most 10,000 inventory entries, 10,000 response records, and 8MiB of canonical content per phase. Every non-final page contains at least one entry; only a phase's sole page may be the explicit empty `page: 0, done: true` representation. Entry budgets therefore also bound page counts without another configurable pagination policy.

Individual `messageIds` remain opaque strings with no NanoID regex or standalone string ceiling. Their containing frame and aggregate inventory budgets are the resource boundary. Duplicate IDs remain harmless set input but still consume entry/byte budget.

### 5. Local send settlement advances output; local processing advances input

The provider serially awaits each local Wire send settlement before issuing the next response page, but that return means only local acceptance. It never waits for, records, or infers remote receipt or persistence.

The requester atomically admits each response page through Delivery, then processes pages in one bounded serial queue. Each page maps `messages[].userId` through the exact `users` set, creates complete `ChatMessageRecord` values, and settles every `insert-if-absent` result before the page is locally complete. The final `done: true` page terminates only after this processing. Existing local Delivery ACK remains page-to-Runtime infrastructure and never becomes a peer History message.

### 6. Disconnect recovery is a fresh exact difference

Attempt State is volatile and keyed by current domain, source, direction, generation, `syncId`, and a unique local token. Each directional attempt retains the existing 10-second operational timeout under that complete identity. Leave, replacement, timeout, invalid input, budget rejection, supplier failure, insertion failure, or lifecycle cleanup cancels that owner, aborts queued work, and discards both snapshots. Late work must match the complete identity before it can mutate State or feedback.

A replacement session waits for any old physical supplier work to settle, generates a new `syncId`, re-reads the current local 180-day inventory, and begins again. Records that did persist are now listed; records that did not are missing and can be returned again. This yields eventual repair without an ACK protocol or cross-disconnect cursor.

### 7. Toast activation follows the first winning insert

As soon as one atomic `insert-if-absent` result settles as inserted, the page reports that exact result to the current History attempt. History marks feedback active only on the first such result, assigns one owner identity derived from the complete attempt identity, and fans the active projection to every current same-domain page. A page attaching while the attempt remains active receives the same current projection; other domains receive nothing.

Later inserted pages do not publish again. The final locally processed response page or any cancellation emits one owner-scoped dismissal to every current same-domain page. There is no timer, minimum dwell, success conversion, count, or History-specific error. The owner key prevents an older attempt from dismissing a newer History Toast or any unrelated Toast.

### 8. Existing supplier and delivery admission remain the hard local boundaries

Requester inventory and provider record snapshots reuse the application-owned cancellable query path. The selected page query carries one `supplyId` and `AbortSignal`; failover or successor promotion waits for full physical query/projection settlement. The current four-active, 32-admitted, and 8KiB metadata bounds continue to cover selection through final send release.

Delivery continues to admit each History response page as one atomic batch within the 512-record/8MiB volatile buffer. Rejection cancels the local attempt rather than partially applying a page or requesting continuation. This preserves one owner for network orchestration and one owner for canonical storage.

### 9. Regression coverage replaces rather than extends old behavior

Protocol tests must prove exact new shapes, unknown-key/old-type rejection, v4 isolation, per-frame/count/reference limits, and opaque-ID aggregate bounds. Runtime tests must prove both directional flows, snapshot timing, exact filtering, empty phases, ordering/replay rejection, serial insertion, budgets, timeout/leave/replacement cleanup, and fresh reconnect recomputation. Toast tests must cross the real insert-result and final-page/cancellation boundaries, including live and same-domain races plus same-domain fan-out.

Old cursor/full-window fixtures and tests are deleted. No test may retain an old path as a fallback or describe an intermediate migration state as product behavior.

## Risks / Trade-offs

- [The first missing body waits for the complete inventory] -> Inventory pages are much denser than message bodies and remain byte/count bounded; exact filtering avoids retransmitting structurally high overlap.
- [Provider pages can outrun remote processing without peer ACK] -> Local sends remain bounded and serial; remote gap/overflow cancels the attempt, and a later connection recomputes from persisted IDs.
- [Live or another page inserts after the requester snapshot] -> Atomic `insert-if-absent` remains the final truth; all-existing pages stay silent and do not repeat feedback.
- [Several peer syncs overlap] -> Each complete attempt identity owns its own Toast and terminal dismissal; source/generation checks make old completion inert.
- [v4 temporarily partitions current and older clients] -> Isolation is intentional for a breaking clean cut and avoids dual protocol state.
- [A final page first inserts and immediately completes] -> With no minimum dwell, activation and owner-scoped dismissal may be brief; this truthfully follows the confirmed operation lifetime.

## Migration Plan

1. Land the complete v4 protocol, Runtime replacement, application bridge, Toast lifecycle, and replacement tests in one requirement PR.
2. Delete every v3 History runtime/type/test residue in the same exact; retain no compatibility path.
3. Verify v1/v2/v3/v4 namespace isolation and unchanged non-History v3-to-v4 payload bytes.
4. If the unmerged candidate must be abandoned, revert the complete PR as one unit; the existing v3 release and unchanged local record database remain independently usable.
