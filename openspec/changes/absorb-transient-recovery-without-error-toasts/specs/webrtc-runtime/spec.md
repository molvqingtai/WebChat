## ADDED Requirements

### Requirement: Transient recovery scenarios surface no user-visible error

WebChat SHALL absorb every recoverable transient scenario through its recovery flow so that no user-visible error toast, error message, or failure state appears. The covered recoverable scenarios are: page refresh or reopen, an extension update or manual background restart for which the active generation retains a valid recovery path, reconnect generation takeover including signaling peer-ID occupation, and room teardown or final-release races.

A send, reaction, or connection attempt issued inside a transient window SHALL be carried by recovery — held until its prerequisite exists or completed through recovery — and SHALL eventually succeed without user-visible error. WebChat SHALL NOT reject such an operation into a user-visible failure solely because a transient recovery prerequisite is absent.

WebChat SHALL NOT introduce user-facing retry UI, status surfaces, settings, or loading feedback for these scenarios.

#### Scenario: Page refresh surfaces no error

- **GIVEN** an established room session
- **WHEN** the user refreshes or reopens the page and a send or reaction occurs during reconnection
- **THEN** the operation SHALL complete through recovery without any error toast or failure state

#### Scenario: Extension update or background restart surfaces no error

- **GIVEN** an established room session
- **WHEN** the extension updates or the background worker is manually restarted and the active generation has a valid recovery path that re-establishes the connection
- **THEN** the recovery SHALL complete silently and no error toast SHALL appear

#### Scenario: Reconnect generation takeover surfaces no error

- **GIVEN** a reconnect where the previous signaling session has not yet released the peer ID
- **WHEN** the new generation connects
- **THEN** the occupation SHALL resolve automatically and no `id-taken` or other error SHALL be shown to the user

#### Scenario: Room teardown race surfaces no error

- **GIVEN** a room whose presence is finalizing or otherwise tearing down
- **WHEN** a send or reaction races the teardown window
- **THEN** recovery SHALL carry the operation to success or completion without any error toast, and no presence final-release rejection SHALL be shown

### Requirement: Unrecoverable failures show the original error text

When a failure is genuinely unrecoverable, including a browser-native failure that proves the owning generation has no code-owned recovery path or WebRTC being truly unable to connect, WebChat SHALL present exactly one error toast carrying the underlying error's original text verbatim. The failed recovery owner SHALL stop its futile retry/watchdog cycle, and a later loading update from that owner SHALL NOT replace the terminal error. WebChat SHALL NOT normalize, rewrite, map, or otherwise alter the error copy, and SHALL NOT suppress the toast for a genuine failure.

#### Scenario: Genuine connection failure shows the raw error

- **GIVEN** a connection attempt that genuinely cannot be established
- **WHEN** the failure settles as unrecoverable
- **THEN** one error toast SHALL present the underlying error's original text unchanged

#### Scenario: Invalidated content Runtime endpoint shows the native error

- **GIVEN** an old content generation whose extension Runtime endpoint has been invalidated
- **WHEN** its `runtime.sendMessage` rejects with `Extension context invalidated.`
- **THEN** that generation SHALL stop retrying, one error toast SHALL show `Extension context invalidated.` unchanged, and no later loading update from that generation SHALL replace the error

#### Scenario: Unknown failure is not terminalized without evidence

- **GIVEN** a Runtime failure whose recovery path has not settled as recoverable or unrecoverable
- **WHEN** the recovery owner classifies the failure
- **THEN** WebChat SHALL NOT treat the failure as terminal solely because its text or native type is unknown
