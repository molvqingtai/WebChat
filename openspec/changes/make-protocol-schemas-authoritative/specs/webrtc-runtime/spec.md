## ADDED Requirements

### Requirement: Protocol validation occurs at exactly two boundaries

The Runtime SHALL parse protocol messages at exactly two boundaries: once when accepting a decoded peer payload and once when loading a message from local persistence. Both boundaries SHALL use the complete authoritative schema exported by `src/protocol`; a local record schema MAY compose that protocol schema with local-only record fields. A parse failure at either boundary SHALL discard the value before it changes Runtime state, persistence projection, unread state, notifications, system notices, History progress, or page output. The failure SHALL produce no Toast or other user-visible feedback.

No local producer, outbound send, persistence write, History supplier, clock adoption, Session/History consumer, or intermediate Runtime path SHALL parse or manually revalidate an already typed protocol value. Non-protocol authorization, ownership, lifecycle, resource scheduling, and codec representation decisions remain outside this rule, but SHALL NOT inspect message properties to recreate protocol validation.

#### Scenario: Invalid inbound peer value is discarded once

- **WHEN** the codec decodes a peer payload but the room-selected complete schema rejects it at Wire acceptance
- **THEN** no typed message event SHALL be emitted, no downstream Domain SHALL inspect or revalidate the rejected value, and no Toast or other user-visible feedback SHALL appear

#### Scenario: Corrupted local value is discarded on load

- **WHEN** a locally stored message was manually modified and the complete local-record schema composed with the protocol schema rejects it during a read
- **THEN** that record SHALL be omitted from the loaded result and all projections, with no Toast or other user-visible feedback

#### Scenario: Outbound production does not validate protocol shape

- **WHEN** local code constructs, stores, supplies, or sends a typed protocol message
- **THEN** those paths SHALL perform no protocol schema parse, post-parse predicate, or manual field/resource validation; the receiving peer remains responsible for its own inbound parse

#### Scenario: Accepted values are not revalidated

- **WHEN** Wire emits a typed schema-accepted peer message or `MessageStore` returns a typed schema-accepted record
- **THEN** Session, History, persistence, projection, and delivery paths SHALL consume that value without another protocol validation stage
