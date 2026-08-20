## 1. Replace Session Publication

- [x] 1.1 Make the existing Connection peer-join handler invoke the current Session target-send path for that exact room/source.
- [x] 1.2 Remove initial omitted-target Session publication, baseline peer snapshots, and missed-peer catch-up without adding a replacement registry, timer, retry, or room-size wait.

## 2. Decouple History From Session Binding

- [x] 2.1 Make the same existing Connection peer-join handler invoke the current History requester for that exact room/source, independently of Session binding, Session acceptance, or Presence identity.
- [x] 2.2 Let an eligible page-zero Pull delivered by Wire's trusted-room/current-generation/schema-valid accepted-message path create source-owned provider work directly, and let only matching continuous pages advance under existing paging/replay/resource/terminal fences; remove Session-binding and Wire source-membership authorization plus Session-event start paths, and retain exact requester/source ownership plus the existing valid late-page boundary for Push after loading settlement.
- [x] 2.3 Preserve current target-only Pull/Push shapes, paging, fresh directional `syncId`, cutoff, timeout, supplier/admission bounds, late-page, Delivery, persistence, replacement, and terminal behavior.
- [x] 2.4 Name the existing Pull/Push ingress Commands and Effects with the exact `HistoryMessagesPull` and `HistoryMessagesPush` protocol terms without adding a wrapper Command, second ingress, or new State.

## 3. Remove Only Proven Repeated Input Guards

- [x] 3.1 Narrow accepted SESSION and TEXT/REACTION values in their sole Session Effects, then remove only the identical discriminant checks from the two internal apply Commands.
- [x] 3.2 Carry the Wire-schema-selected World value through the sole World Effect, then remove only the repeated `sites` and World-room checks from the internal presence apply Command.
- [x] 3.3 Retain Wire's post-decode trusted/generation fence; Session binding/user/HLC/ended-Presence admission; World identity; History attempt/source/page/replay/timeout/late-page/resource; local outbound schema; and peer-event router guards.

## 4. Add Pairwise Lifecycle Controls

- [x] 4.1 Prove A joining established B/C creates exactly one target-only Session and one History synchronization in each direction of A-B and A-C, with no B-C restart and no omitted-target Session send.
- [x] 4.2 Prove an eligible page-zero Pull can start before any Session binding, only matching continuous Pull pages advance, and exact-owner valid Push pages remain collectible after loading settlement while Session and History completion/failure remain independent.
- [x] 4.3 Prove an empty room emits no Session/History peer send and a later peer adds only its pairwise work without restarting established pairs.
- [x] 4.4 Add mutation-sensitive controls for the three removed internal kind/room checks and for every explicitly retained asynchronous/stateful guard.
- [x] 4.5 Retain all existing leave/reconnect/replacement, Session identity/projection, History exact-difference/paging/resource, Wire queue/admission/generation, Delivery, protocol, Text/Reaction/World, and provider controls without adding another lifecycle mechanism.
- [x] 4.6 Prove deferred peer work is canceled by exact leave/release/failure/supersession/host-loss ownership, and room recovery clears provider-only terminal bindings while retaining exact requester late-Push collection.
- [x] 4.7 Reuse one pure domain-scoped source discovery projection across reset and release so attempts, jobs, supplies, sends, feedback owners, and binding-only terminal sources all reach the existing peer cleanup path without a parallel registry.

## 5. Delivery Gates

- [x] 5.1 Pass focused Session/History/Connection/Wire/World controls, the full test suite, typecheck, format, lint, Chrome/Firefox production builds and packs, strict affected/all OpenSpec validation, status, Doctor, architecture, scope, identity, residue, and clean-worktree gates on one immutable exact.
- [x] 5.2 Push the exact source/test child, bind terminal hosted CI to that exact head, and obtain one fresh cumulative coding review with a final P0/P1/P2 verdict.
- [x] 5.3 After coding PASS, publish canonical OpenSpec/status truth without changing source/tests/dependencies and obtain any required independent docs review.
- [x] 5.4 Do not mark Ready, merge, promote to master, release, deploy, or modify production without a separate current authorization and complete live gates.
