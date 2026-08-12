## 1. Freeze Endpoint And Protocol Authority

- [x] 1.1 Record the current implicit `@rtco/client@0.3.6` endpoint source and freeze `wss://web-chat.io` as the sole development and production browser signaling endpoint with no fallback or environment selector.
- [x] 1.2 Verify read-only DNS and browser-trusted TLS reachability, exact pinned `SocketSignaling` readiness with matching `id`, and an independent Chromium WebSocket upgrade at the default Socket.IO path.
- [x] 1.3 Record the unchanged Socket.IO path/transport/query behavior, test-only substitution boundary, failure behavior, WebRTC/STUN configuration, recovery timing, protocol, API, persistence, permissions, and operational ownership.

## 2. Implement Explicit Signaling Composition

- [ ] 2.1 At the existing Runtime-private Artico peer-creation boundary, construct one built-in `SocketSignaling` with exact URL `wss://web-chat.io` and the owner's current physical `peerId`, then pass it explicitly to Artico.
- [ ] 2.2 Preserve matching initial and replacement peer identity, scoped owner/recovery fencing, default `/socket.io` path, WebSocket-only transport, current Engine.IO/Socket.IO behavior, and existing Artico error/close flow.
- [ ] 2.3 Add no environment variable, build-mode/test branch, endpoint list, fallback, localhost path, public configuration, dependency upgrade, custom signaling protocol, server change, or recovery-timer change.

## 3. Add Deterministic Controls

- [ ] 3.1 Add a fail-before control proving the released transport creates Artico without explicit signaling and therefore depends on the package default; make the candidate require exact URL, matching `peerId`, and explicit Artico composition through test-owned mocks only.
- [ ] 3.2 Prove initial World/Chat owners and a replacement generation each create exactly one signaling client at the owned endpoint, with replacement identity rotation and no unconfigured or alternate client.
- [ ] 3.3 Preserve existing provider behavior and prove endpoint failure remains in the current scoped error/close/recovery path without fallback or changes to room, timer, protocol, API, persistence, or STUN behavior.

## 4. Verify And Review Independently

- [ ] 4.1 Run focused Artico transport controls plus the repository's normal tests, typecheck, format/lint checks, Chrome/Firefox production builds, and strict OpenSpec/status/doctor gates on one implementation exact.
- [ ] 4.2 Confirm the implementation diff contains only explicit endpoint composition and its deterministic controls, with no recovery-timer PR content or operational infrastructure change.
- [ ] 4.3 Freeze one clean immutable source exact and obtain fresh independent review; keep its PR Draft and do not merge, deploy, release, or modify DNS, certificates, Host, containers, or production without separate authority.
