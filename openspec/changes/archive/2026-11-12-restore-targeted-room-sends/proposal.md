## Why

Current `develop` delegates an omitted WebChat target directly to Artico `Room.send(payload)`. Artico then iterates every signaling-known Call in that Room, including Calls whose sending browser has not yet opened its local per-peer DataChannel. `Peer.send()` throws `Connection is not established yet.` for such a Call, and the synchronous throw interrupts Artico's remaining iteration.

The reproduced user-visible case is a Text send immediately after joining, but the mechanism is not Text-specific. The current production inventory contains five omitted-target send sites: initial Session publication, ordinary Text/Reaction, History inventory-request pages, World full publication, and World publication retry. Leaving any of them as an omitted-target provider broadcast retains the same connecting-Call race.

WebChat v1.9.7 avoided that race by resolving application-known peers before the provider call and invoking `Room.send(body, peerIds)` once. The current architecture needs the same targeting model without restoring the old UserList, inspecting DataChannels, or changing the low-level optional-target API. Direct automatic publications that immediately follow this client's own Room join also need one call-site-local one-second pause so the join does not immediately race the peer connections it just discovered. Those continuations must sleep first and only then resolve current logical recipients; a pre-sleep peer snapshot would miss membership changes during the wait.

## What Changes

- Preserve `Room.send(body, target?: string | string[])` and `RoomTransport.send(..., target?: string | string[])` exactly: `undefined` remains native room broadcast, a string remains one target, an array remains the selected targets, and `[]` remains no recipients.
- Replace every current product-level omitted-target producer with one explicit non-empty peer-id array call. Resolve peer ids from that producer's current logical Session/room membership, de-duplicate in deterministic first-seen order, exclude self, and perform no provider call for an empty result.
- Freeze the complete five-site producer inventory: initial Session publication, ordinary Text/Reaction, every History inventory-request page, World full publication, and World publication retry. Existing single-target and explicit-array catch-up/response calls keep their recipient meaning.
- Restore one `Room.send(payload, peerIds)` provider call per logical send. Do not expand it into `map`, `forEach`, a loop, or per-target calls. Preserve Artico's current array-send behavior: the first target throw may interrupt later targets and the original Error follows the existing operation failure route. Never retry an already invoked provider send; retain only the existing World release preflight retry that made zero provider calls.
- Restore the v1.9.7 explanatory comment and both Artico source references byte-for-byte except for replacing obsolete `UserList`/`SyncUser` wording with current Sessions/current logical room-membership wording.
- Add exactly one `sleep(1000)` only to direct local-join follow-up chains: accepted Domain Room join before the initial Session -> World publication sequence, accepted World recovery/replacement join before its current full publication, and any never-invoked send head whose provider invocation is resumed directly by that accepted join. After the sleep and current-owner check, an affected room-wide producer derives/filters/de-duplicates/self-excludes the then-current logical peer ids and only then sends; it does not snapshot or filter targets before sleeping. An already explicit targeted head retains its recipient without re-filtering. A new user send or any other later flow receives no added delay.
- Keep each sleep local to its exact join continuation. Add no room-wide readiness flag, generation gate, shared delay queue, per-send control delay, new retry, outbox, or persisted timer. Leave, teardown, replacement, or supersession invalidates the old continuation so its late timer sends nothing.
- Synchronize the active `standardize-functional-iteration` and `absorb-transient-recovery-without-error-toasts` authority texts that still require omitted-target broadcasts or per-target attempt-all behavior.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `webrtc-runtime`: Resolve every current room-wide product send to one explicit logical-recipient array, preserve native optional-target provider semantics and first-error interruption, and delay only the direct post-join publication continuations by one second.

## Impact

- Affected Runtime producers: `Session.PublishPreparedCommand`, `Session.SendChatMessageCommand`, `History.QueueInventoryPageCommand`, `World.EnsureFullPublicationCommand`, and `World.RetryPublicationStepCommand`.
- Affected join continuations: the Domain join branch, the World recovery/replacement join branch, and a never-invoked send head resumed directly by the accepted join.
- Affected authority mirrors: the active functional-iteration targeting/History contract, the active recovery World/send-settlement contract, and the canonical provider parity/per-target-isolation requirements.
- Affected tests: focused mutation-sensitive controls for complete target resolution, empty targets, one array call, first-error interruption, the exact 999ms/1000ms join boundary, membership changes during the sleep, and stale continuation cancellation.
- Unchanged: protocol payloads and schemas, History request identity/pagination/merge/loading semantics, Session/World catch-up and History response recipients, local Chat acceptance/persistence/display, Error text/routing, dependencies and lockfile, PR #135, browser UI, and release/deployment behavior.
