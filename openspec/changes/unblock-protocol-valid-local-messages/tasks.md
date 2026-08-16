## 1. Freeze Product And Contract Authority

- [x] 1.1 Freeze `develop@83719009ab88e909ec8e4bb7d14b70cb693e31ea` as the sole baseline and exclude v2.5.0 comparison, backport, and source ancestry.
- [x] 1.2 Trace the current blocking chain from serialized application send through Runtime allocation, transport acceptance, local insertion, returned identity, local projection, and draft clearing.
- [x] 1.3 Define complete protocol validation as the local text-display commit point; preserve pre-acceptance draft/error behavior and post-acceptance error observability without display rollback or queuing, and prohibit Error-content/type classification from controlling display.
- [x] 1.4 Preserve the exact public/protocol/persistence/provider contracts, reaction behavior, and no-retry/no-outbox/no-status boundary while synchronizing overlapping active authority text.
- [x] 1.5 Obtain one fresh Inspector review of the immutable docs exact, including canonical scenario identity, active-authority consistency, baseline identity, and strict OpenSpec validation.

## 2. Add Fail-Before Boundary Controls

- [x] 2.1 Add application send controls that hold and reject transport after protocol acceptance and prove the accepted text projects and clears its draft before settlement while a later accepted text does not wait.
- [x] 2.2 Add adapter/Runtime controls using distinct post-validation failure sources/messages that independently hold and reject local insertion, prove transport and persistence are both attempted when the other fails, preserve each original Error through the existing scoped owner, and fail any mutation that special-cases one Error to control display.
- [x] 2.3 Preserve mutation-sensitive protocol-invalid controls proving zero local projection, zero wire, zero persistence, draft retention, and only `Invalid message.`; retain exact allocated identity, delayed-watch, same-id collision, and same-content cross-tab evidence.
- [x] 2.4 Pin unchanged reaction settlement, direct provider `room.send(payload, to)` delegation, remote-live `onMessage`, History, recovery, and absence of outbound queue/retry/status/fallback behavior.

## 3. Implement Protocol-Accepted Local Projection

- [x] 3.1 Split private text protocol acceptance from later Runtime settlement at the existing single full `ChatMessageSchema` boundary, returning the exact allocated `TextMessage` without adding a public method, field, result DTO, parser, validation branch, or Error-content/type classifier.
- [x] 3.2 Start text transport and `MessageStore.insert` as independent post-acceptance work whose failures keep their existing scoped Error owners, do not cancel the other attempt, and cannot re-reject or mutate the accepted local result.
- [x] 3.3 Make application text projection and draft clearing consume the protocol-accepted returned identity without waiting for later work; remove downstream settlement from the queue that admits later text commands.
- [x] 3.4 Keep pre-acceptance preparation/schema failure, reaction behavior, local/remote projection ownership, persistence conflict rules, and every public/protocol/provider boundary unchanged; add no compatibility or fallback path.

## 4. Verify And Deliver

- [x] 4.1 Run focused mutation controls plus the full Vitest suite, TypeScript, Oxfmt/Oxlint, Chrome/Firefox production builds, Archify, strict focused/all OpenSpec validation, status, doctor, scope, and residue checks on one clean candidate.
- [ ] 4.2 Use the built latest-develop candidate in an isolated real-browser multi-peer run with continuous Toast/DOM observation; record send-to-first-DOM timing through multiple post-validation failure windows and do not treat a terminal screenshot alone as negative evidence.
- [ ] 4.3 Publish one immutable source exact with exact tree/sole-parent/local-remote-PR identity and terminal hosted CI, then obtain one fresh cumulative Inspector source review.
- [x] 4.4 Keep every pull request Draft and do not mark Ready, merge, deploy, release, publish, or modify the Owner's Default Chrome without later explicit authority.
