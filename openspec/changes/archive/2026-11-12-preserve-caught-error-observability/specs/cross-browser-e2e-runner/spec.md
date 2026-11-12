## ADDED Requirements

### Requirement: E2E cleanup failures remain ordered evidence

Every synchronous or asynchronous browser context, CDP, WebDriver, driver-service, process, listener, port, profile, package, and temporary-path cleanup failure SHALL retain its original message, resource identity, cleanup phase, and absolute-deadline context in the exact run's cleanup evidence. Cleanup SHALL continue attempting contractually independent remaining owned resources within the same existing shared budget.

An earlier setup, product, assertion, timeout, or interruption failure SHALL remain the primary terminal result; later cleanup failures SHALL be attached as ordered secondary evidence and SHALL NOT replace or erase it. If behavioral work otherwise passed, any cleanup failure SHALL make the project fail. A later zero-residual observation SHALL NOT erase an earlier cleanup failure.

The harness SHALL NOT use an empty/comment-only catch or no-op rejection handler to close or dispose a resource. Invalid input validation, including Firefox target URL validation, SHALL fail explicitly without catch-based no-op control flow.

#### Scenario: Behavior passes but asynchronous close fails

- **GIVEN** all product assertions passed
- **WHEN** an asynchronous browser or CDP close rejects during teardown
- **THEN** the project SHALL fail cleanup with the original message, resource, phase, and deadline evidence while continuing independent bounded teardown

#### Scenario: Primary failure is followed by cleanup failures

- **GIVEN** setup, product behavior, assertion, timeout, or interruption already failed
- **WHEN** one or more synchronous or asynchronous cleanup operations also fail
- **THEN** the first primary result SHALL remain unchanged and every cleanup failure SHALL be attached afterward in observed order

#### Scenario: Later cleanup cannot erase earlier failure

- **GIVEN** one cleanup operation failed or timed out
- **WHEN** later escalation or verification reaches zero residual resources
- **THEN** the earlier cleanup failure SHALL remain terminal evidence and the project SHALL NOT pass

#### Scenario: Invalid Firefox URL fails explicitly

- **WHEN** the Firefox E2E precondition receives an invalid target URL
- **THEN** validation SHALL report its explicit invalid-input failure without an empty catch and SHALL NOT continue with that input
