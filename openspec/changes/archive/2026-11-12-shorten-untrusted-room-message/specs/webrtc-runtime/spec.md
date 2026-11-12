## ADDED Requirements

### Requirement: Untrusted-room rejection uses a concise fixed message

When an outbound typed Runtime send names a room that is absent from the current trusted-room state, the owning pre-provider boundary SHALL reject with an Error whose message is exactly `Untrusted room message`.

The Error message SHALL NOT contain a full or partial `roomId`, origin, encoded value, suffix, fingerprint, or any other room-derived text. An existing internal diagnostic boundary MAY retain room identity only as a separately structured debug field; it SHALL NOT place that identity in the Error message, application copy, wire data, or a new UI surface. This requirement SHALL NOT create a new metadata object, error type, status owner, or logging state.

The rejection SHALL occur at the same trusted-room boundary before any provider target attempt. It SHALL use the existing operation failure and settlement path, send to no target, and add no retry, outbox, fallback, persistence success, connection transition, Runtime state, or UI behavior. All other Runtime and transport errors SHALL keep their current messages and ownership.

#### Scenario: Untrusted room rejects with the fixed message

- **GIVEN** an outbound typed send names a room absent from current trusted-room state
- **WHEN** the Runtime attempts the send
- **THEN** the operation SHALL reject before any provider target attempt with Error message `Untrusted room message`

#### Scenario: Room identity is absent from the Error message

- **GIVEN** the rejected send includes a concrete encoded `roomId`
- **WHEN** the caller observes the rejection
- **THEN** the Error message SHALL contain no full or partial room identifier, origin, suffix, fingerprint, or other room-derived text

#### Scenario: Structured diagnostics remain separate

- **GIVEN** an existing internal diagnostic boundary records room context for an untrusted-room rejection
- **WHEN** it emits that diagnostic
- **THEN** room identity MAY appear only as a separate structured debug field and SHALL NOT alter the fixed Error message or create user-facing copy

#### Scenario: Rejection effects remain unchanged

- **GIVEN** an outbound send is rejected because its room is not currently trusted
- **WHEN** the operation settles
- **THEN** no provider target SHALL receive the message, the existing failure path SHALL settle the operation, and no retry, fallback, persistence success, connection transition, Runtime state, or UI effect SHALL be added
