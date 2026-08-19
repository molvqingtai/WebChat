## Why

Current `develop@0a8a6fa8b3b29a550e238da9f20542e4b6fa4416` still carries a dual-provider transport and product-level recipient filtering introduced for Artico. Five room-wide producers build explicit peer-id arrays, three direct post-join paths wait one second, and Wire contains a special resume path that recomputes room-wide targets after that wait.

Trystero is now the sole supported provider. In `trystero@0.25.3`, omitted-target actions enumerate only the room's current `activePeerMap`; a peer enters that map only after handshake activation immediately before `onPeerJoin`, and installing `onPeerJoin` replays peers that are already active. The Artico connecting-call failure that motivated the filtering and fixed delay therefore is not a current product constraint. A fixed one-second wait is only a heuristic and cannot guarantee later delivery.

The product still has genuinely targeted sends. History inventory derives its sole target directly from the source that triggered its requester without retaining a provider-routing array, History responses target the requester, and Session/World catch-up targets the peer that became active after the original publication. Those recipient identities remain application authority and must not be broadened into room broadcasts.

## What Changes

- Make Trystero the only supported room transport. Remove Artico source, tests, dependency/lock resolution, provider selector, and current product documentation or structural rules that present Artico as supported.
- Keep `src/runtime/RoomTransport.ts` and `src/runtime/RoomTransport.contract.test-utils.ts` at the Runtime root. Move the concrete implementation and its provider-specific tests to `src/runtime/transports/trystero/`. Add no transport barrel or registry; `src/runtime/host.ts` remains the sole production composition point.
- Use native omitted-target room broadcast for initial Session publication, ordinary Text/Reaction, every World full snapshot, and the existing World whole-publication retry that is allowed only after a preflight failure made zero provider calls.
- Keep History inventory chunks targeted directly to their triggering source with no `expectedProviders` routing array; keep History responses and Session/World current-state catch-up targeted to their existing peer.
- Delete every post-join `sleep(1000)`, every 999/1000ms contract, after-sleep peer-id filtering/recomputation, `targetPeerIdsOwner: 'session'`, `RoomWideSendResumeRequestedEvent`, `ResumeRoomWideSendCommand`, and only the code/tests that exist for that special path.
- Preserve generic serialized-send queueing, request/room/generation/owner fencing, cancellation, and resume behavior. Preserve Session/World membership, History provider snapshots, the complete optional-target API, protocol-valid local projection, and the existing no-ACK/no-outbox/no-provider-call-retry contract.
- Replace contrary active OpenSpec and tests with Trystero active-peer broadcast, targeted catch-up, zero-active-peer, History-targeting, provider-layout, and Artico-residue controls. Historical archived records may retain their historical names and evidence but do not define current supported behavior.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `webrtc-runtime`: Use one Trystero provider, native broadcast for room-wide product intent, explicit targets only for History and peer-specific catch-up/response, and no fixed post-join grace.

## Impact

- Runtime transport composition and layout under `src/runtime/`.
- Session, World, History, and Wire outbound-send ownership.
- Provider dependencies and lockfile.
- OpenSpec, README/current documentation, provider contract tests, Runtime mutation-sensitive tests, and structural residue scans.
- No peer protocol, persistence schema, public ChatRoom API, browser permission, deployment, release, or production-data change.
