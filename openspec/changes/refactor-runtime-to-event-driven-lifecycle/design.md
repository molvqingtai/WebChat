## Context

The approved lifecycle distinguishes logical Runtime ownership from WebRTC transport ownership. Chromium MV3 may independently restart its Background Service Worker or Offscreen document; Firefox MV2 keeps both responsibilities in one persistent Background document. Page Sessions callbacks and Background/Offscreen provider callbacks therefore have different restart scopes. The replacement must express those facts directly as events and current state, not as a repaired sequence of legacy helper calls.

## Goals / Non-Goals

**Goals:**

- Define one event-driven state authority for logical Runtime ownership in each browser target.
- Make every restart combination explicit and generation-fenced.
- Make callback binding, current-state projection, action admission, and release linearizable at their owning boundary.
- Replace the legacy lifecycle in one clean cut and remove the superseded implementation.
- Make tests state/event-contract driven and independent of legacy internal call order.

**Non-Goals:**

- Changing peer wire bytes, schemas, provider strategy, the application-facing ChatRoom port, or product behavior.
- Adding callback payload persistence or replay, gateway replay, ACK, queue, ledger, receipt, deadline protocol, Page polling, or another heartbeat.
- Adding a separate initial-load query, snapshot RPC, or readiness acknowledgement beside `onSessionsChange`.
- Retaining an old-path fallback, dual owner, compatibility adapter, wrapper around the legacy orchestrator, or phased production coexistence.
- Treating abstract `onXXXA(callbackA)` / `onXXXXB(callbackB)` names in the lifecycle diagram as new implementation APIs.

## Decisions

### 1. Events enter one logical Runtime authority

Chromium Page RPC, Offscreen callback delivery, tab/navigation lifecycle, and host lifecycle enter the Background-owned Runtime authority. Browser delivery wakes or reuses the Service Worker; the Page does not probe or start it. Firefox delivers the same logical events to its persistent Background Page/HTML, which owns the logical Runtime and WebRTC in the same document.

Commands express intent, events record accepted facts, queries read current state, and effects perform browser, storage, comctx, or provider I/O. No effect or adapter may retain a second copy of authoritative Room, Session, binding, callback, recovery, or release state.

### 2. Chromium separates logical Runtime from transport

The Background owns Chat/World logical Rooms, Sessions, trusted page/domain bindings, Page callback ownership, provider callback projections, action admission, recovery, and release. Offscreen owns only the transport proxy and `RTCPeerConnection`; it owns no logical Rooms, Sessions, page callbacks, or domain lifecycle.

`ensureRuntime` and `ensureTransport` are in-memory single-flight transitions of their respective current endpoint generations. They are names for lifecycle responsibilities, not permission to preserve legacy orchestration behind a wrapper.

### 3. Fresh Background restores from browser facts

A fresh Background may read `storage.session` only as provisional hints. It validates current browser truth through tabs, URLs, navigation, and exact sender identity before promoting any page/domain binding. It creates a new logical Runtime shell and current generation without replaying an old action or trusting an old callback closure.

Full live-domain recovery proceeds as a non-blocking side branch. The current action waits only for its target domain. No global recovery barrier may delay unrelated Page ingress.

### 4. Fresh Offscreen replaces only transport ownership

A missing, fresh, or unhealthy Offscreen endpoint closes or invalidates the old transport proxy, creates a new transport generation, and atomically invalidates old transport Room handles. Background projects normal provider-loss semantics into its current logical Rooms and Sessions.

Offscreen-only replacement does not invalidate Page `onSessionsChange` callbacks because Background still owns those callbacks. Old transport results and late closes may affect only their exact old transport/connection generation.

### 5. Background and Offscreen callbacks restart transparently

When both endpoints are current, each existing one-to-one provider method/callback pair remains current. When either endpoint is fresh, Background re-executes each affected existing callback-registration method with a new callback. Each Offscreen method atomically replaces only its matching callback and returns the matching current transport state in the same call. Background aligns each returned state before admitting later events.

The diagram's `onXXXA(callbackA)` and `onXXXXB(callbackB)` are placeholders for existing one-to-one pairs. They add no multiplexing adapter, callback-sequencing protocol, ACK, queue, ledger, receipt, payload replay, or new API. An old callback payload may expire and must never be saved or replayed.

### 6. onSessionsChange owns both initial load and rebind

A normal new Page performs `runtime.onSessionsChange(callback)` once as both subscription and initial load. After Background fresh boot, each restored provisional Page receives `runtime:sessions-rebind` and re-executes the same method with a new callback. Offscreen-only restart does not enter this branch.

Background atomically replaces the exact Page callback, linearizes current full Sessions, immediately invokes the callback with that full state, waits for the existing callback call to complete, and revalidates the exact binding. Only then does it activate the callback for later ordered deltas. Failure or binding drift retires that provisional binding. Other provisional Pages rebind asynchronously and do not block the current caller. No separate initial-load query, snapshot RPC, or ACK exists.

### 7. Action admission is target-scoped and exactly once

Background validates exact sender tab, navigation, page owner, callback state, and current generation. It waits only for the current action's target-domain Chat/Session/History fence. Chromium commands Offscreen to create or reuse the target `RTCPeerConnection`; Firefox does so directly. A command returns the exact handle/readiness result and does not masquerade as an asynchronous event.

After readiness, the gateway accepts the current RPC invocation and executes the original action exactly once. It never replays an accepted invocation. If a caller times out after admission, any ambiguous result remains caller-owned and requires an explicit new user or application decision rather than automatic mutation replay.

### 8. Release is owned by exact bindings and generations

Tab close, navigation, URL change, or failed provisional callback registration freezes and removes the exact binding. If the domain has no live Page, Background creates one five-second grace token bound to the exact logical Room and connection generation. A successor admission invalidates that token. At the deadline, only a still-current token for a still-zero-page domain may release its exact old Room/connection handle. Late close work cannot close a successor connection.

### 9. Steady state remains event-driven

The Page has no periodic recovery or health polling. Page RPC and Offscreen provider events are authoritative wake entries for a suspended Chromium Background. Background's best-effort five-second reconcile may run only while that worker survives. The existing comctx five-second heartbeat means only injector `APPLY` provider readiness; it does not diagnose callback delivery, trigger reconcile, or form another Page wake loop.

### 10. The replacement is independent of legacy implementation

Implementation begins from this target owner/event/state matrix. Production code may reuse stable public types, wire schemas, transport provider capabilities, and product ports, but it must not import, call, wrap, delegate to, or preserve the legacy Runtime lifecycle or its internal sequencing as an authority.

The replacement and removal of the superseded lifecycle land in the same admitted source exact. There is no feature flag, fallback, dual-write, dual-read, shadow owner, compatibility branch, or transitional adapter. A source exact that still contains a reachable legacy lifecycle is not a candidate.

Tests assert accepted events, current state, generation fences, callback replacement, restart combinations, target-scoped readiness, exactly-once action admission, release, and stale-work rejection. They must not snapshot legacy helper order, reuse legacy fixtures as the behavioral oracle, or require the replacement to preserve incidental old call structure.

## Risks / Trade-offs

- [A clean cut has a larger atomic change] -> Freeze the event/state matrix first and require complete focused controls before removing the old path in the same candidate.
- [Two independently restartable Chromium endpoints can drift] -> Fence transport, callback, binding, Room, and grace work by exact current generations and return current state during callback replacement.
- [Global recovery can delay an otherwise ready action] -> Keep live-domain restoration non-blocking and wait only for the action's target domain.
- [Tests can accidentally encode the old implementation] -> Build fail-before and final controls from contract scenarios and externally visible state transitions, not old helper sequencing.
- [A compatibility fallback appears safer] -> Reject it because two reachable lifecycle authorities would make ownership and exactly-once behavior unverifiable.

## Validation

Validate the complete event/state and browser restart matrix, including Background fresh + Offscreen surviving, Background surviving + Offscreen fresh, both fresh, and both current. Prove Page initial load/rebind, immediate full-before-delta ordering, target-only readiness, single action execution, stale event rejection, live-domain non-blocking recovery, zero-page successor fencing, Firefox no-Offscreen behavior, Page no-polling, and absence of reachable legacy lifecycle or compatibility paths. Run strict OpenSpec and the repository's normal source, browser, and delivery gates on one immutable replacement exact before review.
