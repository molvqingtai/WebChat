## Context

`createArticoRoomTransport()` owns one Artico peer generation for World and one for each active Chat domain. Its `startPeer()` currently calls `new Artico({ id: owner.peerId })`. In pinned `@rtco/client@0.3.6`, omitting `signaling` creates `SocketSignaling` with `https://0.artico.dev:443`, WebSocket-only Socket.IO transport, the default `/socket.io` path, and query `{ id }`.

Read-only validation on 2026-08-13 found `web-chat.io` resolving to an IPv4 address and presenting a valid browser-trusted certificate for that hostname. The exact pinned `SocketSignaling` client reached its `ready` state at `wss://web-chat.io` and the service returned the requested id. A separate Chromium WebSocket upgrade to the default Socket.IO path also opened successfully. An HTTPS root `404` is not a signaling failure because the signaling contract lives at the Socket.IO WebSocket endpoint; a polling request is likewise not authoritative because the pinned client uses WebSocket only.

## Goals / Non-Goals

**Goals:**

- Make the owned endpoint an explicit source-level invariant for every current and replacement Artico peer.
- Keep signaling identity equal to the room owner's current physical `peerId`.
- Ship one endpoint in development and production and fail visibly without fallback.
- Preserve the pinned Socket.IO signaling protocol and every existing Runtime owner.
- Keep automated tests deterministic and network-free without adding production configurability.

**Non-Goals:**

- No endpoint pool, failover, environment variable, build-mode branch, user setting, public configuration, or compatibility alias.
- No DNS, TLS certificate, reverse-proxy, Socket.IO server, container, deployment, or production modification.
- No Socket.IO path, transport, reconnection policy, Engine.IO version, query shape, authentication, or server protocol change.
- No Artico/Socket.IO dependency upgrade, custom signaling implementation, WebRTC/STUN/TURN change, peer-owner refactor, recovery-timer change, protocol/API/schema/persistence change, or new browser permission.

## Decisions

### 1. The Runtime explicitly composes the built-in signaling client

At the existing Artico peer-creation boundary, create `SocketSignaling` with the exact URL `wss://web-chat.io` and the owner's current physical `peerId`, then pass that signaling instance into the new Artico peer. The Artico peer and signaling client must expose the same id for initial creation and every generation replacement.

The endpoint remains a fixed source value at this one composition boundary. A local constant may name it, but no configuration abstraction or public injection surface is introduced.

Alternative rejected: rely on Artico's package default. It keeps production behavior controlled by an upstream implicit value and can silently return WebChat to `0.artico.dev`.

Alternative rejected: add an environment variable with the vendor default as fallback. That creates different development/production behavior and makes a missing build setting silently select the wrong service.

### 2. Development and production ship the same sole endpoint

Every actual browser build, including local development builds, uses `wss://web-chat.io`. There is no localhost signaling server, secondary endpoint, endpoint list, or build-time/runtime selection. This makes the built artifact's connection target auditable from source and prevents environment drift.

Tests may replace `@rtco/client` or the existing private provider boundary with test-owned fakes so they can inspect composition without network access. That substitution exists only in test code; production code does not inspect test mode, accept a test URL, or fall back when the fake is absent.

### 3. Preserve the pinned Socket.IO wire behavior

Use `SocketSignaling` without adding a path or transport adapter. The pinned client therefore retains its default `/socket.io` path, WebSocket-only transport, current Engine.IO/Socket.IO handshake, and query `{ id: owner.peerId }`. The URL contains no room, peer, token, or alternate path. Existing room join and signal events remain unchanged after readiness.

Normal browser TLS hostname and trust validation remains mandatory. Source code must not bypass certificate validation or downgrade to insecure HTTP/WS. DNS, certificate renewal, reverse-proxy routing, and server availability are operational prerequisites outside this source-only change.

Alternative rejected: append `/socket.io` to the configured URL or implement a raw WebSocket client. The former risks changing Socket.IO URL/path interpretation; the latter creates a new signaling protocol outside the requested endpoint substitution.

### 4. Endpoint failure is fail-closed

Connection errors and disconnects continue through the current Artico events and scoped recovery owners. Each replacement generation retries only `wss://web-chat.io` with its current peer id. It never instantiates an unconfigured Artico peer, retries `0.artico.dev`, or selects another host.

This change does not alter Socket.IO internal reconnect or the separately reviewed WebChat recovery waits. Endpoint selection and retry cadence remain independent concerns and must remain separate commits and pull requests.

## Risks / Trade-offs

- **The single endpoint is unavailable** -> Existing failure and recovery behavior remains visible; do not hide the outage by switching services.
- **The endpoint accepts a generic WebSocket upgrade but not the pinned Socket.IO protocol** -> Retain an exact `SocketSignaling` readiness probe as operational evidence; generic HTTPS status alone is insufficient.
- **A future package update changes defaults** -> Constructor controls assert the explicit URL/id composition, while dependency upgrades remain separately reviewed.
- **Tests accidentally contact production signaling** -> Use only test-owned fakes/mocks in automated suites and assert that no production environment switch exists.
- **Endpoint and timer changes become coupled** -> Base this authority independently and keep source patches, reviews, and PRs separate.

## Migration Plan

1. Freeze this docs-only authority as a sole child of `86e2787118c74120002a879721841b7a22ce4925`, independently of the recovery-timer change.
2. On one clean source child, add a deterministic fail-before proving the current composition omits explicit signaling, then implement the exact `SocketSignaling` composition and matching controls.
3. Run focused Runtime tests and the repository's normal static, build, OpenSpec, and exact-diff gates; confirm no environment, fallback, server, or timer changes entered the candidate.
4. Obtain fresh independent review of the immutable source exact. Keep the PR Draft and do not merge, deploy, release, or change DNS/certificates/Host/containers/production without separate authority.

Rollback is source-only: revert the explicit signaling composition and its tests. There is no data, protocol, schema, or server migration.
