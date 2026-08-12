## 1. Protocol Resource Contract

- [ ] 1.1 Replace the public final-frame and decompressed JSON values with exactly 256KiB and 1MiB, preserving exact Base64/deflate/fatal-UTF-8/JSON representation and adding no fragmentation or alternate codec path.
- [ ] 1.2 Replace the misleading message/body resource constant with an explicit 192KiB complete canonical `ChatMessage` UTF-8 budget and enforce an 8KiB complete canonical `ChatUser` UTF-8 budget through narrowly scoped pure guards.
- [ ] 1.3 Keep static declarative schemas as the structural/type authority, set the expanded wire `body` field ceiling to 192 \* 1024 JavaScript string units, and keep every other existing built-in field/array limit; add no callback/custom/transform schema, general validator API, cross-field rule, or extra parse boundary.
- [ ] 1.4 Apply each pure complete-object guard once at local user/message production and once after the existing peer/local-load structural parse before application; remove misleading string-length-as-byte behavior and duplicate downstream checks.
- [ ] 1.5 Keep `MESSAGE_MAX_LENGTH = 500`, `MESSAGE_IMAGE_TARGET_SIZE = 30 * 1024`, `MAX_AVATAR_SIZE = 5 * 1024`, `MAX_HISTORY_RESPONSE_MESSAGES = 100`, the 8-frame/256KiB decode queue, and the 512-record/8MiB inbound un-ACK buffer unchanged.
- [ ] 1.6 Advance Chat and World together from v5 to v6 physical namespaces and mechanically update existing namespace expectations; retain no v5 join/publication, decoder, bridge, fallback, or negotiation path.

## 2. History Paging And Termination

- [ ] 2.1 Build every History Pull/Push page under the real 256KiB codec ceiling, retain at most 100 Push messages, and ensure one legal 192KiB message plus required user/envelope fields can be replayed without a separate History cap.
- [ ] 2.2 Delete the 10,000-entry and 8MiB cumulative History constants, State, checks, early-terminal branches, comments, and tests/fixtures that describe them; retain no renamed cumulative budget.
- [ ] 2.3 Preserve fixed requester/provider 180-day snapshots and terminate on done/data exhaustion, source disconnect/replacement, domain release, explicit cancellation, invalid/order/gap/error, supplier/persistence/encode/send failure, or 10 seconds without valid forward progress.
- [ ] 2.4 Re-arm the 10-second deadline only on current attempt forward progress; duplicate/replayed or stale work SHALL not extend it or affect a later attempt.
- [ ] 2.5 On every terminal path discard snapshots/inventories/pages/queues/working counters, release History feedback and source/global admission, drive selected supply cancellation through its existing `AbortSignal`, and wait for actual query/projection settlement before releasing a slot or promoting a successor.
- [ ] 2.6 Preserve one synchronization per connection/direction, terminal binding, page order, atomic Delivery admission, supplier concurrency, no peer ACK/resume/retry, and the unchanged 512-record/8MiB inbound un-ACK buffer.

## 3. Editor Blob Draft Clean Cut

- [ ] 3.1 On image insertion, compress toward 30KiB, create an editor-owned object URL, and insert exact `![Image](blob:...)` Markdown into the existing textarea without adding thumbnail/preview UI.
- [ ] 3.2 Replace the image NanoID, `hash:` placeholder parser, immediate Blob-to-Base64 conversion, and hash-to-Base64 content `Map` with one lightweight owned live-Blob-URL lifecycle tracker; retain no `hash:` compatibility path.
- [ ] 3.3 At send, resolve only currently referenced editor-owned live Blob URLs, convert them to data URLs, build the temporary complete message candidate, update mention ranges through the existing owner, and preflight the 192KiB message plus 256KiB wire boundaries before transport/persistence.
- [ ] 3.4 Reject the whole send and preserve the draft plus referenced Blob URLs when any reference is invalid/unowned/revoked, conversion fails, or either byte limit fails; allow no `blob:` value into wire, IndexedDB, History, or persistent message data.
- [ ] 3.5 Revoke an object URL after its final draft reference disappears, successful send, explicit clear, or unmount; keep duplicate references alive until the last occurrence is removed and keep referenced URLs live after failed send.

## 4. Mechanical Existing-Test Synchronization

- [ ] 4.1 Mechanically update only existing protocol/codec/History/editor expectations or fixtures directly made stale by the new constants, complete-object semantics, removed cumulative budgets, or removed hash path.
- [ ] 4.2 Add no repository test case, suite, test abstraction, compatibility fixture, capacity negotiation harness, or unrelated assertion; delete obsolete expectations instead of preserving an old path.

## 5. Verification And Delivery

- [ ] 5.1 Run affected existing tests plus repository typecheck, lint, format, builds, strict OpenSpec validation, OpenSpec Doctor, residue scans, diff, and clean-worktree gates on one immutable implementation exact.
- [ ] 5.2 Externally validate both directions at 64/128/192/256KiB for Chrome-to-Chrome, Chrome-to-Firefox, and Firefox-to-Firefox on the exact implementation; record browser versions, actual final frame sizes, send/receive results, and evidence.
- [ ] 5.3 Prove an over-256KiB/preflight-rejected frame or message fails without disconnecting/recreating the room and that a subsequent valid message still succeeds; do not add fallback, fragmentation, or negotiation in response to failure.
- [ ] 5.4 Obtain fresh independent source review and CI for the same exact. Keep `master`, deployment, production, dependencies, endpoints, and unrelated behavior out of scope.
