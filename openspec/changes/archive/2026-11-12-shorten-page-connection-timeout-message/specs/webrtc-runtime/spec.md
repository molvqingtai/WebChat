## ADDED Requirements

### Requirement: Page connection timeout Toast uses concise user copy

When the existing page connection prerequisite deadline produces content feedback, the existing generic Toast SHALL render exactly `Connection timed out`. The visible message SHALL contain no page, prerequisite, lifecycle, bootstrap, deadline, or other internal implementation terminology.

The same feedback path SHALL retain its current Toast identity, severity, icon, duration, placement, animation, accessibility, replacement, dismissal, and deduplication behavior. WebChat SHALL NOT add another Toast, notification, status surface, timer, action, state owner, or presentation branch for this message.

The copy change SHALL NOT alter the prerequisite deadline, trigger conditions, request settlement, pending state, retry eligibility, recovery behavior, Runtime readiness, connection state, protocol, persistence, schema, or browser behavior. Existing internal diagnostics MAY retain technical context, but SHALL NOT project that context into this user-facing Toast.

#### Scenario: Existing timeout renders the concise message

- **GIVEN** the current page connection prerequisites do not complete before their existing deadline
- **WHEN** the current content feedback path presents the timeout
- **THEN** it SHALL render one generic Toast whose text is exactly `Connection timed out`

#### Scenario: Internal terminology is absent from the Toast

- **GIVEN** the page connection prerequisite timeout is presented
- **WHEN** the user reads the Toast
- **THEN** its visible text SHALL contain no page, prerequisite, lifecycle, bootstrap, deadline, or other internal implementation terminology

#### Scenario: Toast presentation remains unchanged

- **GIVEN** the timeout reaches the existing generic Toast path
- **WHEN** the concise message is rendered and later settles
- **THEN** Toast identity, severity, icon, duration, placement, animation, accessibility, replacement, dismissal, and deduplication SHALL behave exactly as they do for the current timeout feedback

#### Scenario: Connection behavior remains unchanged

- **GIVEN** the existing prerequisite deadline expires
- **WHEN** the timeout operation and connection state settle
- **THEN** request settlement, pending state, retry eligibility, recovery behavior, Runtime readiness, and connection state SHALL remain unchanged by the copy reduction
