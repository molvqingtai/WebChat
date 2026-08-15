## ADDED Requirements

### Requirement: Runtime recovery waits are fixed and isolated

Close-driven Artico peer replacement SHALL wait exactly 10,000ms before replacing the current peer. Fresh room demand that encounters a retained disconnected peer SHALL retain its existing immediate repair path and MAY preempt the pending close-driven wait through the same single restart owner. The wait SHALL NOT change room demand, peer identity, generation fencing, callback settlement, leave, or disposal behavior. Duplicate or stale close callbacks SHALL NOT schedule an additional replacement, and leave or disposal SHALL continue to cancel pending restart work.

After a current Domain or World connection attempt fails and its existing automatic recovery owner remains eligible, Connection SHALL wait exactly 10,000ms before retrying that recovery. The wait SHALL apply equally to failed initial and active-room recovery for Chat and World. It SHALL NOT change which failures are eligible, preserve or recreate input, create a retry after cancellation/release/supersession, or alter attempt, host-generation, request, readiness, failure, or terminal-settlement authority.

After a failed current page-registration attempt, ClientLease SHALL wait exactly 1,000ms before its next eligible registration attempt. The retry wait SHALL remain inside the current single-flight recovery generation and its existing 15,000ms overall budget. The 5,000ms per-request deadline, 5,000ms watchdog cadence, retry triggers, stale-generation fencing, readiness settlement, and every other ClientLease interval SHALL remain unchanged.

These two network-retry waits SHALL NOT alter Socket.IO internal reconnect, AppButton/manual reconnect, ClientLease or Coordinator health checks, the Background heartbeat timeout, presence/grace/release timing, protocol, API, persistence, identity, or wire behavior. They SHALL introduce no backoff, jitter, reconnect-owner refactor, compatibility behavior, or unrelated timeout change.

#### Scenario: Close-driven peer replacement waits ten seconds

- **GIVEN** the current Artico peer closes and its close-driven replacement remains the active restart owner
- **WHEN** no fresh room demand preempts that wait
- **THEN** no automatic replacement SHALL exist before 10,000ms, and exactly one replacement SHALL begin when 10,000ms is reached

#### Scenario: Fresh demand retains immediate disconnected-peer repair

- **GIVEN** a close-driven replacement wait is pending for a retained disconnected peer
- **WHEN** fresh room demand requires that peer
- **THEN** the existing immediate repair path SHALL enter the same restart owner without waiting for the close-driven timer, and the delayed work SHALL NOT create a duplicate replacement

#### Scenario: Close recovery remains cancellable and generation-fenced

- **GIVEN** close-driven replacement work is pending for the current peer generation
- **WHEN** matching room demand leaves, the transport is disposed, or duplicate or stale close work arrives
- **THEN** leave or disposal SHALL cancel its owned pending restart, and duplicate or stale work SHALL NOT create an additional replacement

#### Scenario: Failed Domain and World recovery waits ten seconds

- **GIVEN** a current failed initial or active-room recovery retains an eligible Domain or World automatic retry owner
- **WHEN** that owner remains current and is not cancelled, released, or superseded
- **THEN** no retry SHALL begin before 10,000ms, and exactly one matching retry SHALL begin when 10,000ms is reached

#### Scenario: Connection retry preserves existing authority

- **GIVEN** a Domain or World recovery retry is delayed
- **WHEN** its attempt, request, domain, host generation, or lifecycle owner becomes stale or ineligible
- **THEN** the delayed work SHALL not join, retry, publish readiness, report a new failure, or settle current work

#### Scenario: Failed registration waits one second before retry

- **GIVEN** the current page-registration attempt fails and the current recovery generation retains enough budget for another attempt
- **WHEN** ClientLease continues that recovery
- **THEN** the next eligible registration attempt SHALL begin after exactly 1,000ms and SHALL NOT begin earlier

#### Scenario: Registration retry preserves existing bounds

- **GIVEN** page registration is retried within one current recovery generation
- **WHEN** attempts fail, expire, succeed, or become stale
- **THEN** the generation SHALL retain its 5,000ms per-request deadline, 15,000ms overall budget, 5,000ms watchdog cadence, single-flight ownership, stale-generation fencing, and existing terminal settlement behavior
