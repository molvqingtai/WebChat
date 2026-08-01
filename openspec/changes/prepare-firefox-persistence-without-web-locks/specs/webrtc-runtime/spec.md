## ADDED Requirements

### Requirement: Persistence preparation uses the browser-appropriate coordinator

The content initialization composition SHALL provide one coordination strategy to origin-local configuration preparation and canonical message-database preparation. Firefox MV2 SHALL use direct preparation and SHALL NOT call, await, or require `navigator.locks`. Chrome MV3 SHALL use Web Locks arbitration for those same preparation stages.

Both strategies SHALL use the same storage identities, versions, reset eligibility, generation fencing, abort behavior, checkpoints, and versioned writes. Firefox direct preparation SHALL use no durable lock record, background mutex, alternate schema, or second persistence owner. A current successful preparation SHALL publish the same ready result on both browsers.

#### Scenario: Firefox prepares without Web Locks

- **GIVEN** the production Firefox MV2 content initialization owns current configuration and message-store preparation
- **WHEN** those preparation stages execute
- **THEN** they SHALL use the direct coordinator, SHALL perform no Web Locks request, and SHALL converge through the canonical current-version storage operations

#### Scenario: Chrome uses Web Locks arbitration

- **GIVEN** the production Chrome MV3 content initialization owns current configuration and message-store preparation
- **WHEN** those preparation stages execute
- **THEN** they SHALL acquire the namespaced Web Lock before the owned operation and release it after settlement

#### Scenario: Concurrent Firefox tabs converge on current storage

- **GIVEN** two Firefox content scripts prepare the same origin-local configuration and canonical message database concurrently
- **WHEN** both direct preparation attempts settle
- **THEN** the canonical storage SHALL expose the configured current versions and one consistent ready result without a second identity, schema, version authority, or persistent coordination state

### Requirement: Blocked message-database deletion terminates as retryable initialization failure

When deletion of the canonical IndexedDB message database for a version mismatch reports `blocked`, WebChat SHALL own one delete request and start one five-second blocked deadline. Success or error before the deadline SHALL clear that deadline and settle that request. If the request remains blocked at the deadline, the current preparation SHALL reject with `Message store deletion blocked`, SHALL NOT publish readiness, and SHALL NOT start a competing delete.

The current initialization owner SHALL surface that rejection through its unavailable state and normalized generic error Toast. Actions-menu Refresh SHALL be eligible to start a later current initialization attempt. The blocked path SHALL add no dedicated UI, notification, success feedback, close-tabs instruction, or alternate persistence path.

#### Scenario: Blocked deletion reaches a bounded terminal

- **GIVEN** canonical message-database deletion has reported `blocked` and has not settled
- **WHEN** five seconds elapse
- **THEN** the current preparation SHALL reject, initialization SHALL remain non-ready, one normalized retryable initialization error SHALL be available, and no competing deletion SHALL start

#### Scenario: Deletion settles before the blocked deadline

- **GIVEN** canonical message-database deletion reported `blocked`
- **WHEN** that same request succeeds before five seconds elapse
- **THEN** WebChat SHALL clear the blocked deadline, recreate the canonical database at the configured version, and continue the same current initialization attempt

#### Scenario: Retry owns a new initialization attempt

- **GIVEN** a blocked-deletion deadline terminated the current initialization attempt
- **WHEN** the user activates actions-menu Refresh
- **THEN** one new current attempt SHALL re-evaluate persisted storage truth, while the failed attempt SHALL not publish readiness or settle the new attempt
