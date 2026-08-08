## Why

`src/protocol` currently declares TypeScript message structures separately from their schemas and completes validation through post-parse predicates and caller-side property checks. That creates several competing sources of truth and lets the same protocol value receive different validation depending on its path.

## What Changes

- Define every public protocol data structure through one exported schema and derive its TypeScript type from that schema.
- Make the complete schema pipeline the only place that may validate protocol shape, resources, cross-field relationships, time, origin, uniqueness, or references. A rule the installed schema system cannot express is not validated; it must not fall back to a handwritten predicate.
- Parse protocol values at exactly two boundaries: accepting a decoded peer message and loading a message from local persistence. A failed parse is discarded before application or projection and produces no Toast.
- Remove protocol revalidation from local production, send, persistence write, History supply, and intermediate Runtime paths while preserving non-protocol ownership and lifecycle decisions.
- **BREAKING (protocol source API)**: Remove handwritten protocol interfaces/unions and standalone parse/check/boolean validator exports. Public types become schema-derived aliases, while public wire structures remain unchanged.
- Keep the current v4 room namespaces, wire fields, canonical payload bytes, codec representation, limits, dependencies, storage format, and visible product behavior unchanged for values accepted by the authoritative schemas.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `peer-wire-protocol`: Make schemas the only protocol data and validation authority and derive every exported protocol data type from them.
- `webrtc-runtime`: Limit protocol parsing to peer receive and local persistence load, with silent discard and no Toast on failure.

## Impact

- Affected protocol modules: `src/protocol/{Session,ChatRoom,WorldRoom}.ts` and the public `src/protocol/index.ts` exports.
- Affected consumers: inbound Wire parsing, local `MessageStore` reads, and duplicate protocol checks in Session, History, send, producer, and persistence-write paths.
- Affected tests: protocol schema/type authority, receive/load rejection, duplicate-validator residue, unchanged v4 bytes, and silent failure coverage.
- No new dependency, wire generation, compatibility path, data migration, permission, UI, or extension control-plane change.
