## Why

WebChat currently creates each Artico peer with only its physical peer id. That leaves the signaling endpoint implicit inside `@rtco/client`, whose pinned default is the vendor-owned `https://0.artico.dev:443`. The browser Runtime must instead select the Owner-provided signaling service explicitly so development and production cannot silently depend on or fall back to the package default.

## What Changes

- Give every production Artico peer generation one explicit built-in `SocketSignaling` configured with the exact secure endpoint `wss://web-chat.io` and the same current physical peer id owned by that room scope.
- Make `wss://web-chat.io` the sole signaling endpoint shipped by both development and production browser builds. Add no environment selector, endpoint list, fallback, compatibility path, or implicit dependency default.
- Preserve the built-in Socket.IO signaling protocol: default `/socket.io` path, WebSocket-only transport, current Engine.IO/Socket.IO compatibility, and the existing `id` query identity.
- Let endpoint failures continue through the existing Artico error, close, and recovery owners. A failure must remain visible to that flow and must never retry through `0.artico.dev` or another endpoint.
- Keep deterministic tests network-free through test-owned mocks or fakes at the existing dependency/provider boundary; do not add a production test switch or injectable endpoint API.
- Preserve WebRTC ICE/STUN configuration, per-room peer ownership, peer-id rotation, room identifiers, recovery timing, protocol, public API, persistence, permissions, and dependencies.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `webrtc-runtime`: Bind every browser Artico peer generation to the single owned signaling endpoint without changing signaling protocol or Runtime behavior.

## Impact

- Affected implementation: the Runtime-private Artico transport composition where each scoped physical peer is created.
- Affected tests: deterministic constructor/composition controls that prove exact URL, matching peer identity, replacement behavior, and absence of fallback.
- Operational precondition: `web-chat.io` must continue to resolve and present a browser-trusted TLS certificate, and its Socket.IO service must accept the pinned client's default WebSocket handshake. This source change does not own DNS, certificates, hosting, containers, or deployment.
- Unchanged: peer wire messages and schemas, Socket.IO path/transport/query semantics, room and identity lifecycle, recovery cadence, WebRTC/STUN configuration, public interfaces, persistence, browser manifests, and release/deployment topology.
