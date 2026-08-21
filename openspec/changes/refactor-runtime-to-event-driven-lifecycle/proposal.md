## Why

WebChat's browser-runtime lifecycle currently emerges from several existing control paths rather than one explicit event and state model. Repairing those paths incrementally would preserve legacy orchestration as hidden authority and keep restart behavior dependent on the order in which old helpers happen to run. The replacement must instead be designed from the approved lifecycle contract and admitted as one clean cut.

## What Changes

- Replace the Runtime lifecycle with a fully event-driven model whose authoritative inputs are Page RPC, browser tab/navigation lifecycle, provider callbacks, and browser host lifecycle.
- Make the Chromium MV3 Background Service Worker the sole logical Runtime owner for Rooms, Sessions, page/domain bindings, callback ownership, recovery, action admission, and release. Keep Offscreen as a WebRTC transport proxy only.
- Keep Firefox MV2's persistent Background Page/HTML as the sole owner of both logical Runtime and `RTCPeerConnection`, with no Offscreen lifecycle branch.
- Restore fresh Background and Offscreen endpoints through exact generation-fenced callback replacement and current-state return, without replaying expired callback payloads.
- Define `onSessionsChange(callback)` as subscribe plus immediate current Sessions: the same call owns initial loading and Background-restart recovery, followed only by ordered deltas.
- Admit an action only after its exact page binding, current callback readiness, transport readiness, and target-domain readiness are current; execute each accepted invocation once without gateway replay.
- Replace the old implementation in one source transition. Add no legacy adapter, compatibility fallback, dual architecture, wrapper that delegates to the old orchestration, or patch layer around current defects.
- Derive implementation controls from the new event/state contract and restart matrix rather than treating the old implementation's internal call order as expected behavior.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `webrtc-runtime`: Defines the clean-cut event-driven Runtime ownership, restart, callback, action-admission, and release lifecycle for Chromium MV3 and Firefox MV2.

## Impact

- Affected architecture: content Runtime client, Background Runtime coordination, Chromium Offscreen transport proxy, Firefox persistent Background host, callback registration, domain readiness, and generation-fenced release.
- Affected implementation: the current Runtime lifecycle and transport orchestration are replaced rather than wrapped or incrementally patched.
- Preserved boundaries: peer wire bytes and schemas, the eight-method application-facing ChatRoom port, product-visible Chat/World behavior, origin-owned durable messages, exact source identity, browser permissions, and selected transport provider semantics.
- Excluded: a new public protocol, separate initial-load query, snapshot RPC, durable replay, gateway retry, acknowledgement protocol, outbox, queue, ledger, receipt, Page polling, additional heartbeat, compatibility mode, or simultaneous old/new Runtime operation.
