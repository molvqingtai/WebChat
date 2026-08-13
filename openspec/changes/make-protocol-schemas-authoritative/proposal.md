## Why

`src/protocol` currently declares TypeScript message structures separately from their schemas and completes validation through post-parse predicates and caller-side property checks. That creates several competing sources of truth and lets the same protocol value receive different validation depending on its path.

The current Chat protocol also carries a best-effort `SessionEndMessage` even though Artico already reports physical peer departure. Because a sleeping, disconnected, or terminated sender cannot guarantee that message, keeping both signals creates two leave authorities without making presence more reliable.

## What Changes

- Define every public protocol data structure through one exported schema and derive its TypeScript type from that schema.
- Permit protocol validation only through declarative Valibot primitives and combinators. Callback-based checks, custom schemas, transforms, dynamic contextual predicates, and every equivalent piece of executable JavaScript validation are forbidden even inside a schema pipeline. A rule that declarative schemas cannot express is not validated and has no fallback.
- Validate protocol values at exactly three Runtime boundaries: accept a decoded peer payload through the static Chat or World schema selected from trusted room context; parse a locally authored `ChatMessage` once through `ChatMessageSchema` before both peer encoding/send and local persistence; and load a local message through a declarative record schema that composes `ChatMessageSchema`. A failed receive/load parse is discarded before application or projection and produces no Toast; a failed local-`ChatMessage` parse performs neither side effect and shows only `Invalid message.` to the sending user.
- Remove protocol parsing and revalidation from local `ChatMessage` allocation and production before its boundary, Footer, SESSION, History Pull/Push, World publication, persistence and codec after the boundary, and intermediate Runtime paths while preserving non-protocol ownership and lifecycle decisions. Footer retains only the separate local user Text capacity preflight `getTextByteSize(JSON.stringify({ body, mentions }))` before command dispatch.
- **BREAKING (protocol source API)**: Remove handwritten protocol interfaces/unions and standalone parse/check/boolean validator exports. Public types become schema-derived aliases; rename `HistoryMessagesRequest`/`HistoryMessagesRequestSchema` to `HistoryMessagesPull`/`HistoryMessagesPullSchema` and `HistoryMessagesResponse`/`HistoryMessagesResponseSchema` to `HistoryMessagesPush`/`HistoryMessagesPushSchema`, with no old-name alias.
- **BREAKING (peer protocol generation)**: Delete `SessionEndMessage`, its schema, public export, and Chat union member. `session-end` becomes an unknown Chat type. Advance both Chat and World to isolated v5 room namespaces; current clients neither join nor interpret v1-v4 traffic, and no compatibility path exists.
- Make Artico `PeerLeave` the only remote leave authority. The last physical source loss for a bound `presenceId` starts one five-second observer grace during which that presence remains online. Recovery of the same `presenceId` cancels the pending leave without a leave/join event; expiry removes the presence and emits one leave only when the user has no other active or grace-preserved presence.
- Delete final-end persistence, send, retry, receive, settlement, cleanup, and release gates. Local release still follows the existing domain lifecycle grace and local cleanup, but physical Chat/World departure never waits for a protocol end message.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `peer-wire-protocol`: Make schemas the only protocol data and validation authority, derive every exported protocol data type from them, remove the Chat end variant, and define the v5 clean generation.
- `webrtc-runtime`: Limit protocol validation to peer receive, one locally authored `ChatMessage` boundary using `ChatMessageSchema`, and local persistence load composing `ChatMessageSchema`; replace final-end lifecycle ownership with PeerLeave-owned observer grace.

## Impact

- Affected protocol modules: `src/protocol/{Session,ChatRoom,WorldRoom}.ts`, the public `src/protocol/index.ts` exports, and Chat/World room namespace inputs.
- Affected consumers: inbound Wire parsing, locally authored `ChatMessage` delivery before persistence/encoding, local `MessageStore` reads, duplicate protocol checks, Session physical-leave classification, Connection release, and obsolete final-end storage/send/retry paths.
- Affected tests: protocol schema/type authority, declarative-only residue, peer-receive/local-`ChatMessage`/local-load rejection, absence of unsupported validation, Push/Pull naming, v5 isolation, strict `session-end` rejection, PeerLeave grace, same-presence recovery, multi-presence expiry, and silent parse-failure coverage.
- No new dependency, origin-database migration, permission, or extension control-plane contract is introduced. User-visible validation copy is limited to `Message size cannot exceed 192KiB.` at the Footer capacity gate and `Invalid message.` at the later local-send Schema gate.
