## ADDED Requirements

### Requirement: Current initialization failure replaces matching loading with a visible error

Every current initialization attempt SHALL use stable Toast ID `webchat-initialization`. Starting the attempt SHALL publish `Preparing WebChat` loading for that ID. Current success SHALL cancel the matching loading descriptor. A genuine current-page failure SHALL mark initialization unavailable and publish an error descriptor containing exactly the original `error.message` with the same ID as a direct replacement; it SHALL NOT issue a cancel for that ID before publishing the error and SHALL add no prefix, suffix, wrapper, mapping, normalization, or replacement copy. A genuine failure with no current affected page/live route or no user impact SHALL call `console.error(error)` directly and SHALL NOT manufacture a Toast destination.

The error SHALL remain governed by the generic Toast's existing default lifetime, user dismissal, and later descriptor replacement. Ordinary failure settlement SHALL NOT immediately remove it. Superseded, aborted, unmounted, or stale generations SHALL publish no terminal error and SHALL NOT cancel or replace feedback owned by a newer attempt. This requirement SHALL add no second Toast identity, presenter, renderer, timer, status component, Retry control, or operation state owner.

#### Scenario: Initial failure replaces loading

- **GIVEN** the current initial attempt owns `webchat-initialization` loading
- **WHEN** that attempt fails while it remains active
- **THEN** one same-ID error containing exactly the original `error.message` SHALL directly replace loading, no preceding same-ID cancel or decorated/replacement copy SHALL occur, and the error SHALL remain under ordinary generic Toast lifetime rules

#### Scenario: Retry failure leaves the new error visible

- **GIVEN** the user has started a current Retry and its same-ID loading descriptor is active
- **WHEN** that retried attempt fails
- **THEN** the current loading descriptor SHALL become the same-ID error containing exactly the original `error.message`, and deferred feedback work from the prior state SHALL NOT remove the new error

#### Scenario: Retry success cancels only matching loading

- **GIVEN** the user has started a current Retry and its same-ID loading descriptor is active
- **WHEN** that attempt reaches ready
- **THEN** WebChat SHALL mark initialization ready and cancel the matching loading descriptor without publishing a success Toast

#### Scenario: Stale attempt cannot settle current feedback

- **GIVEN** a newer initialization generation owns the stable Toast identity
- **WHEN** an older superseded, aborted, or unmounted generation later resolves or rejects
- **THEN** the older generation SHALL publish no ready state, unavailable state, cancel, or error descriptor for the current attempt

#### Scenario: Unrelated Toasts remain independent

- **GIVEN** another business source owns a different Toast identity
- **WHEN** initialization succeeds, fails, or starts Retry
- **THEN** initialization SHALL address only `webchat-initialization` and SHALL NOT dismiss or replace the unrelated Toast
