## ADDED Requirements

### Requirement: Connection-triggered History targets only its source

Accepting one new physical source incarnation SHALL start exactly one outgoing History inventory synchronization with a fresh `syncId`, and that requester SHALL target only the same triggering `sourcePeerId`. Requester State SHALL contain no `expectedProviders` or settled-provider routing array. Every outgoing inventory chunk SHALL derive its exact singleton target directly from the attempt's `sourcePeerId`; another current Session SHALL neither enter that target nor restart the attempt.

Repeating SESSION, attaching a page, accepting another source, or terminating History SHALL not start another synchronization for the original incarnation. Source replacement SHALL retire the old binding and both directional History working and terminal states, then start the replacement connection's one independent source-targeted synchronization without running it concurrently with unsettled old source work. Reconnect of the same logical generation SHALL not become a new observer join. If the triggering source is no longer current before an inventory chunk is physically sent, the requester SHALL follow the existing source-local finish or cancellation path without substituting another peer, broadcasting, retrying, or replaying later.

#### Scenario: Session binding starts one same-source History exchange

- **WHEN** a source Session is accepted for a new physical incarnation
- **THEN** that source incarnation SHALL start exactly one outgoing requester targeted only to its own `sourcePeerId`
- **AND** repetition SHALL start no second synchronization, while a true replacement SHALL start one fresh source-targeted synchronization only after prior physical settlement

#### Scenario: A later peer does not restart an established pair

- **GIVEN** A and B have accepted each other's Sessions and completed or terminalized their one-shot directional History exchanges
- **WHEN** C joins and its Session is accepted by A and B
- **THEN** A and B SHALL each start only their C-targeted requester, C SHALL independently start one requester for each accepted A and B source, and no new A-to-B or B-to-A requester SHALL start

#### Scenario: Batched new Sessions retain singleton targets

- **GIVEN** one local Runtime commits new Sessions for B and C in one domain transition
- **WHEN** History requester State and inventory sends are created
- **THEN** it SHALL create one distinct requester for B whose chunk sends derive target `[B]` directly from its source identity and one distinct requester for C whose chunk sends derive target `[C]`
- **AND** neither requester SHALL store an `expectedProviders` or settled-provider routing array or use `[B, C]`, another current peer, an omitted broadcast, or a fallback target

#### Scenario: Trigger source departure does not broaden the request

- **GIVEN** a source-targeted requester has not physically sent its next inventory chunk
- **WHEN** its triggering source is no longer a current Wire peer
- **THEN** the requester SHALL follow the existing source-local finish or cancellation path with zero fallback peer, room broadcast, retry, delayed replay, or new synchronization

### Requirement: History pages are chunks of one logical exchange

Each directional History synchronization SHALL consist of one logical Pull followed by one logical Push. A requester SHALL freeze one eligible 30-day inventory snapshot and stream its IDs as continuous Pull chunks carrying the same `syncId`, continuous public `page` index, and final `done: true`. The provider SHALL wait for the complete Pull before computing the exact difference once from its own fixed eligible snapshot, then stream that result as continuous Push chunks carrying the same `syncId`, continuous public `page` index, and final `done: true`.

A generic internal Wire `requestId` MAY correlate one local chunk-send settlement for queue or cancellation progression, but it SHALL NOT become a peer-visible History request, per-chunk response, remote acknowledgement, or alternating Pull/Push round trip. This chunking SHALL add no durable or cross-connection progress, cursor, retry, outbox, acknowledgement, or delivery-status State. The public History schema and `page` field SHALL remain unchanged.

#### Scenario: Two peers synchronize symmetrically

- **GIVEN** A and B accept each other's current Sessions
- **WHEN** their one-shot History synchronization begins
- **THEN** A SHALL send one requester inventory only to B and B SHALL independently send one requester inventory only to A, using different local `syncId` values
- **AND** each provider SHALL send its missing-record Push only to the corresponding requester

#### Scenario: Only the requester owner may advance a Push lane

- **GIVEN** a requester owned by source A and its exact `syncId`
- **WHEN** another current source B presents a declaratively valid Push with that `syncId`
- **THEN** the frame SHALL create or read no response lane, apply no record, publish no feedback, and perform no loading or terminal mutation
- **AND** the same page from source A SHALL remain eligible to apply and complete normally

#### Scenario: Pages retain one logical request identity

- **GIVEN** one Pull inventory or Push difference exceeds one bounded wire frame
- **WHEN** it is split across continuous pages
- **THEN** all chunks in that direction SHALL retain one logical `syncId`, the provider SHALL wait for Pull `done: true` before its one Push begins, and Push SHALL not alternate with Pull
- **AND** per-chunk internal send settlement SHALL provide only local queue or cancellation progression with zero peer ACK, per-chunk History request, retry, or remote-processing inference

#### Scenario: Exact-difference behavior remains unchanged

- **WHEN** a singleton-target requester and provider exchange proceeds, completes, times out, receives valid late pages, encounters invalid ordering, or is replaced or released
- **THEN** the existing 30-day fixed snapshots, continuous paging, fixed 10-second timeout, complete attempt identity, terminal one-shot binding, supplier, admission and Delivery bounds, response targeting, loading ownership, late-page boundary, and message-identity convergence SHALL remain unchanged
- **AND** no public protocol, schema, namespace, persistence, UI, Text projection, transport, ACK, retry, outbox, or delivery-status behavior SHALL change
