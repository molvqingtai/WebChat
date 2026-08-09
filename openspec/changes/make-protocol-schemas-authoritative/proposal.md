## Why

`src/protocol` currently declares TypeScript message structures separately from their schemas and completes validation through post-parse predicates and caller-side property checks. That creates several competing sources of truth and lets the same protocol value receive different validation depending on its path.

The current Chat protocol also carries a best-effort `SessionEndMessage` even though Artico already reports physical peer departure. Because a sleeping, disconnected, or terminated sender cannot guarantee that message, keeping both signals creates two leave authorities without making presence more reliable.

## What Changes

- Define every public protocol data structure through one exported schema and derive its TypeScript type from that schema.
- Permit protocol validation only through declarative Valibot primitives and combinators. Callback-based checks, custom schemas, transforms, dynamic contextual predicates, and every equivalent piece of executable JavaScript validation are forbidden even inside a schema pipeline. A rule that declarative schemas cannot express is not validated and has no fallback.
- Parse protocol values at exactly two boundaries: accepting a decoded peer message and loading a message from local persistence. A failed parse is discarded before application or projection and produces no Toast.
- Remove protocol revalidation from local production, send, persistence write, History supply, and intermediate Runtime paths while preserving non-protocol ownership and lifecycle decisions.
- **BREAKING (protocol source API)**: Remove handwritten protocol interfaces/unions and standalone parse/check/boolean validator exports. Public types become schema-derived aliases; rename `HistoryMessagesRequest`/`HistoryMessagesRequestSchema` to `HistoryMessagesPull`/`HistoryMessagesPullSchema` and `HistoryMessagesResponse`/`HistoryMessagesResponseSchema` to `HistoryMessagesPush`/`HistoryMessagesPushSchema`, with no old-name alias.
- **BREAKING (peer protocol generation)**: Delete `SessionEndMessage`, its schema, public export, and Chat union member. `session-end` becomes an unknown Chat type. Advance both Chat and World to isolated v5 room namespaces; current clients neither join nor interpret v1-v4 traffic, and no compatibility path exists.
- Make Artico `PeerLeave` the only remote leave authority. The last physical source loss for a bound `presenceId` starts one five-second observer grace during which that presence remains online. Recovery of the same `presenceId` cancels the pending leave without a leave/join event; expiry removes the presence and emits one leave only when the user has no other active or grace-preserved presence.
- Delete final-end persistence, send, retry, receive, settlement, cleanup, and release gates. Local release still follows the existing domain lifecycle grace and local cleanup, but physical Chat/World departure never waits for a protocol end message.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `peer-wire-protocol`: Make schemas the only protocol data and validation authority, derive every exported protocol data type from them, remove the Chat end variant, and define the v5 clean generation.
- `webrtc-runtime`: Limit protocol parsing to peer receive and local persistence load, with silent discard and no Toast on failure; replace final-end lifecycle ownership with PeerLeave-owned observer grace.

## Impact

- Affected protocol modules: `src/protocol/{Session,ChatRoom,WorldRoom}.ts`, the public `src/protocol/index.ts` exports, and Chat/World room namespace inputs.
- Affected consumers: inbound Wire parsing, local `MessageStore` reads, duplicate protocol checks, Session physical-leave classification, Connection release, and obsolete final-end storage/send/retry paths.
- Affected tests: protocol schema/type authority, declarative-only residue, receive/load rejection, absence of unsupported validation, Push/Pull naming, v5 isolation, strict `session-end` rejection, PeerLeave grace, same-presence recovery, multi-presence expiry, and silent parse-failure coverage.
- No new dependency, origin-database migration, permission, UI copy, or extension control-plane contract is introduced.
