## 1. Protocol Resource Contract

- [ ] 1.1 Replace the public final-frame and decompressed JSON values with exactly 256KiB and 1MiB, preserving exact Base64/deflate/fatal-UTF-8/JSON representation and adding no fragmentation or alternate codec path.
- [ ] 1.2 Replace the old message-like constant with an explicit static wire `body` field ceiling of 192 × 1024 JavaScript string/UTF-16 code units; retain the static user/avatar field limits and define no complete-message or complete-user byte budget.
- [ ] 1.3 Keep the same static declarative schemas as the sole message-validation authority at exactly peer receive, outbound send, and local persistence load; keep every other existing built-in field/array limit and add no callback/custom/transform schema, general validator API, caller-side post-parse guard, cross-field rule, or fourth parse boundary.
- [ ] 1.4 Delete `MAX_CHAT_MESSAGE_BYTES`, `isChatMessageWithinBudget`, `isChatUserWithinBudget`, `utf8ByteLength`, every call site and defensive drop branch, and their mechanically stale expectations. Preserve the three unified complete-Schema parses, but add no validation to Footer, local production before the send boundary, persistence write after it, History supply, profile, allocation, join, mention, or downstream consumers.
- [ ] 1.5 Keep `MESSAGE_MAX_LENGTH = 500`, `MESSAGE_IMAGE_TARGET_SIZE = 30 * 1024`, `MAX_AVATAR_SIZE = 5 * 1024`, `MAX_HISTORY_RESPONSE_MESSAGES = 100`, the 8-frame/256KiB decode queue, and the 512-record/8MiB inbound un-ACK buffer unchanged.
- [ ] 1.6 Advance Chat and World together from v5 to v6 physical namespaces and mechanically update existing namespace expectations; retain no v5 join/publication, decoder, bridge, fallback, or negotiation path.

## 2. History Paging And Termination

- [ ] 2.1 Build every History Pull/Push page under the real 256KiB codec ceiling and retain at most 100 Push messages; trust typed records returned by the persistence-load boundary, validate the constructed page once at the unified outbound Schema boundary, shrink through the real codec, and fail the source-local attempt when one record plus required authors/envelope cannot fit.
- [ ] 2.2 Delete the 10,000-entry and 8MiB cumulative History constants, State, checks, early-terminal branches, comments, and tests/fixtures that describe them; retain no renamed cumulative budget.
- [ ] 2.3 Preserve fixed requester/provider 180-day snapshots and terminate on done/data exhaustion, source disconnect/replacement, domain release, explicit cancellation, invalid/order/gap/error, supplier/persistence/encode/send failure, or 10 seconds without valid forward progress.
- [ ] 2.4 Re-arm the 10-second deadline only on current attempt forward progress; duplicate/replayed or stale work SHALL not extend it or affect a later attempt.
- [ ] 2.5 On every terminal path discard snapshots/inventories/pages/queues/working counters, release History feedback and source/global admission, drive selected supply cancellation through its existing `AbortSignal`, and wait for actual query/projection settlement before releasing a slot or promoting a successor.
- [ ] 2.6 Preserve one synchronization per connection/direction, terminal binding, page order, atomic Delivery admission, supplier concurrency, no peer ACK/resume/retry, and the unchanged 512-record/8MiB inbound un-ACK buffer.

## 3. Editor Blob Draft Clean Cut

- [ ] 3.1 On image insertion, compress toward 30KiB, generate one session-unique id with platform `crypto.randomUUID()`, store the Blob in the current editor's `id -> Blob` map, and insert exact `![Image](blob:<id>)` Markdown into the textarea without object URLs or thumbnail/preview UI.
- [ ] 3.2 Replace the image NanoID, `hash:` placeholder parser, immediate Blob-to-Base64 conversion, and hash-to-Base64 content map with the session-only editor-owned Blob map; add no dependency, object-URL path, `hash:` compatibility path, persistence, or cross-context map.
- [ ] 3.3 At send, resolve referenced ids through the current editor map, convert their Blobs to data URLs in a temporary message candidate, update mention ranges through the existing owner, and use the unified outbound Schema boundary plus codec without a Footer parse or complete-object byte preflight.
- [ ] 3.4 Reject the whole send and preserve the draft plus still-referenced entries when any id/Blob is missing, conversion fails, or the Schema or codec rejects the candidate; allow no `blob:` token or Blob map into wire, IndexedDB, History, or persistent message data.
- [ ] 3.5 On successful send clear only the draft it started from; preserve edits made while conversion was running and every entry they still reference. Delete an entry after final-reference removal, successful send when no longer referenced, explicit clear, or unmount. Create and revoke no object URL.

## 4. Mechanical Existing-Test Synchronization

- [ ] 4.1 Mechanically update only existing protocol/codec/History/editor expectations or fixtures directly made stale by the new static constants, deleted object guards, removed cumulative budgets, or removed hash path.
- [ ] 4.2 Add no repository test case, suite, test abstraction, compatibility fixture, capacity negotiation harness, or unrelated assertion; delete obsolete expectations instead of preserving an old path.

## 5. Verification And Delivery

- [ ] 5.1 Run affected existing tests plus repository typecheck, lint, format, builds, strict OpenSpec validation, OpenSpec Doctor, residue scans, diff, and clean-worktree gates on one immutable implementation exact.
- [ ] 5.2 Externally validate both directions at 64/128/192/256KiB for Chrome-to-Chrome, Chrome-to-Firefox, and Firefox-to-Firefox on the exact implementation; record browser versions, actual final frame sizes, send/receive results, and evidence.
- [ ] 5.3 Prove an over-256KiB codec-rejected frame fails without disconnecting/recreating the room and that a subsequent valid frame still succeeds; do not add an object guard, fallback, fragmentation, or negotiation in response to failure.
- [ ] 5.4 Obtain fresh independent source review and CI for the same exact. Keep `master`, deployment, production, dependencies, endpoints, and unrelated behavior out of scope.
