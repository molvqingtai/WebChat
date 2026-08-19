## 1. Replace Session Publication

- [ ] 1.1 Make the existing Connection peer-join handler invoke the current Session target-send path for that exact room/source.
- [ ] 1.2 Remove initial omitted-target Session publication, baseline peer snapshots, and missed-peer catch-up without adding a replacement registry, timer, retry, or room-size wait.

## 2. Decouple History From Session Binding

- [ ] 2.1 Make the same existing Connection peer-join handler invoke the current History requester for that exact room/source, independently of Session binding, Session acceptance, or Presence identity.
- [ ] 2.2 Let every Pull delivered by Wire's trusted-room/current-generation/schema-valid accepted-message path create source-owned provider work directly; remove Session-binding and Wire source-membership authorization plus Session-event start paths, and retain exact requester/source ownership plus the existing valid late-page boundary for Push.
- [ ] 2.3 Preserve current target-only Pull/Push shapes, paging, fresh directional `syncId`, cutoff, timeout, supplier/admission bounds, late-page, Delivery, persistence, replacement, and terminal behavior.

## 3. Add Pairwise Lifecycle Controls

- [ ] 3.1 Prove A joining established B/C creates exactly one target-only Session and one History synchronization in each direction of A-B and A-C, with no B-C restart and no omitted-target Session send.
- [ ] 3.2 Prove History can start and admit valid current-source inventory before any Session binding, while Session and History completion/failure remain independent.
- [ ] 3.3 Prove an empty room emits no Session/History peer send and a later peer adds only its pairwise work without restarting established pairs.
- [ ] 3.4 Retain all existing leave/reconnect/replacement, Session identity/projection, History exact-difference/paging/resource, Wire queue/admission/generation, Delivery, protocol, Text/Reaction/World, and provider controls without adding another lifecycle mechanism.

## 4. Delivery Gates

- [ ] 4.1 Pass focused Session/History/Connection/Wire controls, the full test suite, typecheck, format, lint, Chrome/Firefox production builds and packs, strict affected/all OpenSpec validation, status, Doctor, architecture, scope, identity, residue, and clean-worktree gates on one immutable exact.
- [ ] 4.2 Push the exact source/test child, bind terminal hosted CI to that exact head, and obtain one fresh cumulative coding review with a final P0/P1/P2 verdict.
- [ ] 4.3 After coding PASS, publish canonical OpenSpec/status truth without changing source/tests/dependencies and obtain any required independent docs review.
- [ ] 4.4 Do not mark Ready, merge, promote to master, release, deploy, or modify production without a separate current authorization and complete live gates.
