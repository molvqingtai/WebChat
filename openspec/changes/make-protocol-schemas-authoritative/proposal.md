## Why

`src/protocol` currently declares TypeScript message structures separately from their schemas and completes validation through post-parse predicates and caller-side property checks. That creates several competing sources of truth and lets the same protocol value receive different validation depending on its path.

## What Changes

- Define every public protocol data structure through one exported schema and derive its TypeScript type from that schema.
- Permit protocol validation only through declarative Valibot primitives and combinators. Callback-based checks, custom schemas, transforms, dynamic contextual predicates, and every equivalent piece of executable JavaScript validation are forbidden even inside a schema pipeline. A rule that declarative schemas cannot express is not validated and has no fallback.
- Parse protocol values at exactly two boundaries: accepting a decoded peer message and loading a message from local persistence. A failed parse is discarded before application or projection and produces no Toast.
- Remove protocol revalidation from local production, send, persistence write, History supply, and intermediate Runtime paths while preserving non-protocol ownership and lifecycle decisions.
- **BREAKING (protocol source API)**: Remove handwritten protocol interfaces/unions and standalone parse/check/boolean validator exports. Public types become schema-derived aliases; rename `HistoryMessagesRequest`/`HistoryMessagesRequestSchema` to `HistoryMessagesPull`/`HistoryMessagesPullSchema` and `HistoryMessagesResponse`/`HistoryMessagesResponseSchema` to `HistoryMessagesPush`/`HistoryMessagesPushSchema`, with no old-name alias.
- Keep the current v4 room namespaces, wire fields and literals, canonical payload bytes, codec representation limits, dependencies, storage format, and visible product behavior unchanged. The public symbol rename changes no encoded value.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `peer-wire-protocol`: Make schemas the only protocol data and validation authority and derive every exported protocol data type from them.
- `webrtc-runtime`: Limit protocol parsing to peer receive and local persistence load, with silent discard and no Toast on failure.

## Impact

- Affected protocol modules: `src/protocol/{Session,ChatRoom,WorldRoom}.ts` and the public `src/protocol/index.ts` exports.
- Affected consumers: inbound Wire parsing, local `MessageStore` reads, and duplicate protocol checks in Session, History, send, producer, and persistence-write paths.
- Affected tests: protocol schema/type authority, declarative-only residue, receive/load rejection, absence of unsupported validation, Push/Pull naming, unchanged v4 bytes, and silent failure coverage.
- No new dependency, wire generation, compatibility path, data migration, permission, UI, or extension control-plane change.
