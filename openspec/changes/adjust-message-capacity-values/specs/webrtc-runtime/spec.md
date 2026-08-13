## ADDED Requirements

### Requirement: History has no cumulative session count or byte limit

One History synchronization SHALL NOT stop, truncate, reject, or fail because it reaches 10,000 messages or 8MiB of cumulative session content. The corresponding constants, options, counters, truncation, and failure branches SHALL be absent and SHALL NOT be replaced by another cumulative message, byte, object, or page guard.

History SHALL retain its fixed 180-day requester and provider snapshots, continuous bounded pages, at most 100 messages per Push, and the shared `256KiB` final-wire boundary. It SHALL continue until its fixed data is exhausted and `done`, or terminate on current-source disconnection or replacement, cancellation, invalid input, supplier or insertion failure, another existing error, or the existing 10-second no-progress deadline. Each accepted progress page SHALL retain the current timeout re-arming behavior; no History phase, peer message, retry, resume, or progress structure SHALL change.

The per-source decode queue SHALL remain at most 8 frames and `256KiB` total wire data. The per-domain volatile inbound un-ACK buffer SHALL remain at most 512 records and `8MiB`, with atomic History-page admission. These remain instantaneous queue/delivery bounds and SHALL NOT be interpreted or reused as a complete History-session limit.

#### Scenario: A large fixed snapshot continues past the removed totals

- **GIVEN** one valid current History synchronization has more than 10,000 eligible messages or more than 8MiB of cumulative content inside its fixed 180-day snapshot
- **WHEN** bounded Pull and Push pages continue making valid progress
- **THEN** History SHALL continue until the fixed difference is exhausted and `done`, without truncating, rejecting, or failing solely because either removed cumulative value was crossed

#### Scenario: Existing terminal conditions still end History

- **GIVEN** a History synchronization has no cumulative count or byte cap
- **WHEN** its data is exhausted and `done`, its source disconnects or is replaced, it is canceled, invalid input or an existing supplier/insertion error occurs, or its 10-second no-progress owner expires
- **THEN** the existing current-attempt termination and cleanup SHALL run without retry, resume, a new phase, or a replacement aggregate guard

#### Scenario: Progress retains the no-progress deadline

- **GIVEN** one current History attempt remains valid
- **WHEN** an accepted page makes progress before the 10-second no-progress deadline
- **THEN** the current attempt SHALL retain its existing progress-based timeout re-arming, and a stale timer SHALL have no authority over newer progress or another attempt

#### Scenario: Queue and inbound buffer limits remain independent

- **WHEN** a final wire frame enters decode admission or a History Push enters volatile delivery admission
- **THEN** the per-source decode queue SHALL remain 8 frames/`256KiB`, the per-domain inbound buffer SHALL remain 512 records/`8MiB`, and an overflow SHALL retain its existing source-local or atomic-page behavior without becoming a History-session cumulative limit
