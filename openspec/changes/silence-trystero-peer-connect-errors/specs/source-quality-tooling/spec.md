## ADDED Requirements

### Requirement: Production console output is Error-only

Executable non-test production source under `src` SHALL call no `console` method other than `console.error`, including but not limited to `warn`, `log`, `debug`, `info`, `trace`, `table`, `dir`, `group`, and timer methods. Comments SHALL NOT retain disabled non-error calls as examples. Tests MAY spy on or mock console methods only to assert behavior. Existing `console.error` calls and their exact failure ownership SHALL remain unchanged.

The implementation SHALL remove the six executable `console.warn` calls present on `develop@b49951189f25530153ee098aa08947fcde28b55f` in Notification, MessageStore, IndexedDB, Wire, and Background, plus the three commented `console.log` examples in the avatar library. It SHALL NOT convert them to `console.error`, Toasts, events, another logger, or a generic swallow helper.

Removing a warning SHALL NOT remove or alter the surrounding operation's existing rejection, deadline, abort, drop, continuation, or recovery result. Where a provider callback is optional, implementation SHALL omit it instead of installing a no-op callback. As the sole exception to the existing no-op rejection-consumer prohibition, this change permits one adjacent inline rejection consumer only for the optional Notification push Promise so its rejection remains handled without output or an unhandled rejection; it SHALL NOT become a generic swallow helper or authorize any other unowned failure.

The general caught-error authority remains in force: a genuine failure still requires its caller-visible rejection, current-user route, or existing `console.error` owner unless this change explicitly classifies that exact frozen warning site as quiet or redundantly owned.

#### Scenario: Complete production inventory contains only Error output

- **WHEN** executable non-test production files under `src` are structurally inventoried
- **THEN** no console call other than `console.error` SHALL exist, no disabled non-error call SHALL remain in comments, and existing `console.error` ownership SHALL remain unchanged

#### Scenario: Optional Notification rejection remains handled and quiet

- **GIVEN** the optional browser notification push rejects
- **WHEN** Notification observes that Promise
- **THEN** exactly one adjacent Notification-specific consumer SHALL settle it with zero console, Toast, event, retained state, generic swallow helper, or unhandled rejection, and later notifications SHALL remain unaffected

#### Scenario: Removed warning is not promoted

- **GIVEN** one of the six frozen warning sites reaches the same surrounding condition
- **WHEN** the implementation handles that condition
- **THEN** it SHALL add no console, Toast, event, or replacement logger output and SHALL preserve the site's existing operation result and lifecycle behavior

#### Scenario: Database blocked warning removal preserves failure settlement

- **GIVEN** message-store deletion remains blocked
- **WHEN** the existing bounded blocked window expires
- **THEN** the operation SHALL still reject with `Message store deletion blocked` through its existing owner without an earlier warning or replacement output

#### Scenario: Hostile frame drop stays quiet

- **GIVEN** Wire rejects an invalid or unsupported peer frame
- **WHEN** the existing protocol-drop path discards it
- **THEN** the frame SHALL remain dropped with no console output, Toast, retry, acknowledgement, or change to trusted protocol state
