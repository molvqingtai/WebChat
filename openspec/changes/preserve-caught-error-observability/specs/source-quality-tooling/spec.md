## ADDED Requirements

### Requirement: Catch and rejection ownership is explicit and reviewable

Executable product, unit-test, and E2E TypeScript SHALL NOT use an empty/comment-only catch body, no-op `.catch(() => {})`, generic rejection-swallow helper, or equivalent Promise spelling to discard an unclassified exception. A genuine user-irrelevant Error MAY be handled directly with `console.error(error)`. An ignored exception SHALL be permitted only for one explicitly named idempotent already-terminal condition proved by structural state or the called API's contract, with the reason adjacent to that boundary.

A secondary Promise observer MAY settle bookkeeping or a serialized tail only when code and focused evidence identify the original returned/emitted failure owner and prove no duplicate event, Toast, or unhandled rejection. Moving a no-op handler to `.then`, `void`, a helper, or another syntax SHALL NOT count as ownership.

This repair SHALL account for the 36 executable sites audited on `develop@a5e32cc6e3592e6f10d2ea3f00e4532e8c1b251e`: 11 empty/comment-only catch clauses and 25 no-op Promise rejection handlers. The seven non-executable static architecture-HTML catches SHALL remain outside the product inventory. The repair SHALL use existing Oxfmt, Oxlint, TypeScript, Vitest, OpenSpec, source search, and review surfaces and SHALL add no parser, linter, repository tool, dependency, or production-only test branch.

#### Scenario: Review the cumulative caught-error inventory

- **WHEN** the source candidate is compared with the audited base and executable catch/rejection sites are inventoried
- **THEN** all 36 audited sites SHALL map to an original rejection, current-user error route, direct `console.error(error)`, exact benign classification, or asserted test/E2E outcome, with no syntax-only relocation or unowned rejection

#### Scenario: Review a secondary Promise observer

- **WHEN** a Promise rejection is consumed by bookkeeping, cleanup observation, or serialized-tail continuation
- **THEN** the original returned/emitted owner and the side branch's real purpose SHALL be explicit and focused evidence SHALL prove exactly one observable failure with no unhandled rejection

#### Scenario: Review a benign cleanup exception

- **WHEN** implementation intentionally ignores a cleanup exception
- **THEN** adjacent code SHALL identify the exact already-terminal condition and its structural/API proof, while every other exception path remains owned diagnostically

### Requirement: Tests assert intentionally rejected work

A unit or integration test that intentionally starts rejected, canceled, superseded, or disposed work SHALL retain its task handle and assert the expected rejection identity/message plus the relevant terminal state. A no-op rejection handler or no-op error listener, including Recovery's audited `onError(() => {})`, SHALL NOT be used to make an unexpected reason pass. Tests MAY prevent unhandled-rejection noise only through an observation that is later asserted within the same test.

Mutation-sensitive controls SHALL fail if the expected rejection is replaced, disappears, reaches a duplicate owner, becomes unhandled, or is satisfied by an unrelated error.

#### Scenario: Intended cancellation rejects for the expected reason

- **GIVEN** a test intentionally supersedes or disposes an in-flight task
- **WHEN** that task rejects
- **THEN** the test SHALL assert its expected reason and terminal state and SHALL fail for a different rejection or unresolved task

#### Scenario: Error routing control proves exact ownership

- **WHEN** a focused control injects a genuine caught failure
- **THEN** it SHALL assert the original Error/message, structural user impact, subsystem, operation, exact scope, continuation or settlement result, and exactly one unchanged-message Toast or direct `console.error(error)` as applicable
