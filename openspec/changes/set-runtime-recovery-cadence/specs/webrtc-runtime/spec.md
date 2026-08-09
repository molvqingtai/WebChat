## ADDED Requirements

### Requirement: Runtime recovery waits are fixed and isolated

Close-driven Artico peer replacement SHALL wait exactly 5,000ms before replacing the current peer. Fresh room demand that encounters a retained disconnected peer SHALL retain its existing immediate repair path and MAY preempt the pending close-driven wait through the same single restart owner. The wait SHALL NOT change room demand, peer identity, generation fencing, callback settlement, leave, or disposal behavior.

After a failed current page-registration attempt, ClientLease SHALL wait exactly 1,000ms before its next eligible registration attempt. The retry wait SHALL remain inside the current single-flight recovery generation and its existing 15,000ms overall budget. The 5,000ms per-request deadline, 5,000ms watchdog cadence, retry triggers, stale-generation fencing, readiness settlement, and every other recovery interval SHALL remain unchanged.

#### Scenario: Close-driven peer replacement waits five seconds

- **GIVEN** the current Artico peer closes and its close-driven replacement remains the active restart owner
- **WHEN** no fresh room demand preempts that wait
- **THEN** replacement SHALL begin after exactly 5,000ms and SHALL NOT begin earlier

#### Scenario: Fresh demand retains immediate disconnected-peer repair

- **GIVEN** a close-driven replacement wait is pending for a retained disconnected peer
- **WHEN** fresh room demand requires that peer
- **THEN** the existing immediate repair path SHALL enter the same restart owner without waiting for the close-driven timer, and the delayed work SHALL NOT create a duplicate replacement

#### Scenario: Failed registration waits one second before retry

- **GIVEN** the current page-registration attempt fails and the current recovery generation retains enough budget for another attempt
- **WHEN** ClientLease continues that recovery
- **THEN** the next eligible registration attempt SHALL begin after exactly 1,000ms and SHALL NOT begin earlier

#### Scenario: Registration retry preserves existing bounds

- **GIVEN** page registration is retried within one current recovery generation
- **WHEN** attempts fail, expire, succeed, or become stale
- **THEN** the generation SHALL retain its 5,000ms per-request deadline, 15,000ms overall budget, 5,000ms watchdog cadence, single-flight ownership, stale-generation fencing, and existing terminal settlement behavior
