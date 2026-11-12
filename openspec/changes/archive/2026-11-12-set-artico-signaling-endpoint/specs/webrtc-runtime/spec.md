## ADDED Requirements

### Requirement: Browser Artico peers use the single owned signaling endpoint

Every production-owned Artico peer generation in the Runtime-private room transport SHALL use one built-in `SocketSignaling` configured with the exact secure URL `wss://web-chat.io` and the exact current physical `peerId` of its World or Chat room owner. The signaling instance SHALL be passed explicitly to Artico; no production peer SHALL rely on the Artico package's implicit signaling default.

`wss://web-chat.io` SHALL be the sole signaling endpoint shipped in development and production browser builds. Production source SHALL contain no endpoint selector, endpoint list, environment or test branch, localhost alternative, compatibility alias, or fallback to `0.artico.dev` or any other signaling host. Automated tests MAY replace the dependency or existing private provider boundary with test-owned mocks or fakes, but that substitution SHALL add no production configuration or alternate runtime path.

The built-in signaling client's default `/socket.io` path, WebSocket-only transport, current Engine.IO/Socket.IO compatibility, and `id` query SHALL remain unchanged. Normal browser TLS hostname and certificate validation SHALL remain required, with no insecure downgrade or trust bypass. Endpoint failure SHALL continue through the current scoped Artico error, close, and recovery owners and SHALL NOT select another endpoint.

This endpoint selection SHALL NOT change Artico room ownership, physical peer-id generation or rotation, room identifiers, Socket.IO reconnection policy, WebChat recovery timing, WebRTC ICE/STUN configuration, peer protocol, public API, persistence, permissions, dependencies, or browser-specific behavior.

#### Scenario: A scoped peer uses the explicit endpoint and matching identity

- **GIVEN** current World or Chat room demand creates a physical peer owner with a current `peerId`
- **WHEN** the Runtime starts that owner's Artico peer generation
- **THEN** it SHALL create exactly one built-in `SocketSignaling` for `wss://web-chat.io` with that same `peerId`, pass it explicitly to Artico, and create no unconfigured or alternate signaling client

#### Scenario: A replacement generation retains endpoint and rotates identity

- **GIVEN** existing scoped recovery replaces a current Artico peer generation and allocates a new physical `peerId`
- **WHEN** the replacement peer is composed
- **THEN** its one signaling client SHALL still target `wss://web-chat.io`, SHALL use the new matching `peerId`, and SHALL retain every existing generation and room fence

#### Scenario: Development and production artifacts select one endpoint

- **GIVEN** WebChat is built or run as a development or production browser extension
- **WHEN** its Runtime creates any real Artico peer
- **THEN** the sole signaling target SHALL be `wss://web-chat.io`, independent of environment variables, build mode, user settings, or test configuration

#### Scenario: Deterministic tests do not create a production escape path

- **GIVEN** an automated test exercises Artico transport composition without live network access
- **WHEN** it substitutes a test-owned dependency mock or private-provider fake
- **THEN** the substitution SHALL remain test-only and production source SHALL still expose no configurable endpoint, alternate signaling branch, or fallback

#### Scenario: Endpoint failure never falls back

- **GIVEN** `wss://web-chat.io` rejects, disconnects, times out, or is temporarily unreachable
- **WHEN** the current Artico and WebChat recovery owners handle that failure
- **THEN** every current or replacement signaling attempt SHALL remain scoped to `wss://web-chat.io`, and no attempt SHALL target `0.artico.dev`, localhost, insecure WS/HTTP, or another host

#### Scenario: Socket.IO and WebRTC boundaries remain unchanged

- **GIVEN** the explicit signaling client connects and becomes ready
- **WHEN** it performs its Socket.IO handshake and the Artico peer joins rooms or negotiates WebRTC
- **THEN** it SHALL retain the default `/socket.io` path, WebSocket-only transport, current Engine.IO/Socket.IO behavior, and matching `id` query while room messages, recovery timing, and ICE/STUN behavior remain unchanged
