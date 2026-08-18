## ADDED Requirements

### Requirement: Trystero post-SDP peer-connect failures remain provider-local and silent

For pinned Trystero 0.25.3, WebChat SHALL classify an active Room `onJoinError` detail whose `error` starts with `could not connect to peer ` only inside the first-composed `TrysteroRoomTransport` callback. A matching callback SHALL return without publishing `RoomTransport.onError`, showing a Toast, calling any console method, retaining diagnostics or peer state, rate-limiting later callbacks, or changing callback return, peer cleanup, announce, negotiation, or reconnection behavior.

This prefix is one explicit provider-local exception to the general rule that error content does not decide UI silence. WebChat SHALL NOT expose the prefix, Trystero callback detail, room ID, peer ID, or a provider-specific error code through generic RoomTransport, Domain, Toast, protocol, persistence, or public types.

Every non-matching active-Room join error SHALL continue through the existing generic error route exactly once with its original message and no adapter-side duplicate console output. Existing current-owner fencing SHALL continue to drop callbacks from inactive, leaving, failed-leave, or disposed owners.

#### Scenario: One post-SDP peer-connect attempt is completely silent

- **GIVEN** an active Trystero Room whose callback receives `could not connect to peer remote-a after exchanging SDP; ...`
- **WHEN** the first-composed adapter handles that detail
- **THEN** it SHALL return with zero generic error events, zero Toasts, zero calls to every console method, and no change to provider lifecycle behavior

#### Scenario: A later negotiation attempt is independently silent

- **GIVEN** the same or another peer causes a later matching callback after a new negotiation attempt
- **WHEN** the adapter handles the later detail
- **THEN** it SHALL again remain completely silent without consulting or updating any deduplication, rate-limit, retry, or peer-diagnostic state

#### Scenario: Password and handshake failures retain their owner

- **GIVEN** an active Trystero Room receives an incorrect-password, handshake-timeout, handshake-rejection, or handshake-failure callback detail that does not match the post-SDP prefix
- **WHEN** the adapter handles that detail
- **THEN** the existing generic error listener SHALL receive the original message exactly once and the adapter SHALL add no console output

#### Scenario: Stale callback remains inert

- **GIVEN** a callback belongs to an inactive, leaving, failed-leave, or disposed Room owner
- **WHEN** either a matching or non-matching detail arrives late
- **THEN** the existing current-owner fence SHALL drop it without a generic error, Toast, console output, or current-Room effect
