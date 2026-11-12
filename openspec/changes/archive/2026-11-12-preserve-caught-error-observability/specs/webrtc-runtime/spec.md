## ADDED Requirements

### Requirement: Caught genuine failures retain one scoped owner

Every caught genuine local `Error`, rejection, or operation-owned deadline in Runtime, transport, page-host, persistence, storage preparation, or browser-port work SHALL keep exactly one owner. It SHALL either remain the original caller-visible rejection, become one structured internal failure containing its original `error.message`, subsystem, operation, and exact scope when it affects a current user, or be passed directly to `console.error(error)` when structural facts prove that the current user's operation, connection/readiness, visible state, and persistence result are unaffected. A distinct cross-boundary failure event SHALL retain a fresh event identity. Error content SHALL NOT control retry, readiness, cancellation, settlement, or presentation policy.

Transport, Database, PagePort, storage preparation, and browser-port adapters SHALL NOT import or invoke Toast. The existing Runtime/application composition boundary SHALL route a genuine failure to `toast.error` only when it affects a current page generation's user operation, connection/readiness, visible state, or persistence result. That call SHALL receive exactly the original `error.message` with no prefix, suffix, wrapper, subsystem/operation/scope decoration, mapping, normalization, or replacement copy. Structured ownership fields SHALL remain internal. A user-irrelevant failure, a failure with no current affected page/live route, and an error-delivery failure SHALL call `console.error(error)` at their exact owner and SHALL NOT recursively create another failure.

Cancellation, supersession, normal leave, stale completion, hostile or untrusted input, remote non-delivery, no response, peer departure, and absent or expired History SHALL remain non-error outcomes. A separate local operation that throws while processing one of those outcomes is still a genuine failure.

#### Scenario: Lower-layer failure reaches one current UI route

- **GIVEN** a Transport, PagePort, Coordinator, Database, or preparation operation throws and affects one current page's user operation, connection/readiness, visible state, or persistence result
- **WHEN** its composition boundary classifies the failure's structural owner and scope
- **THEN** exactly one structured event SHALL retain the original `error.message` and the existing application boundary SHALL pass that unchanged message to `toast.error` once without a lower-layer Toast dependency

#### Scenario: User-irrelevant failure is logged directly

- **GIVEN** a genuine failure does not affect the current user's operation, connection/readiness, visible state, or persistence result, or has no current affected page/live route
- **WHEN** its exact owner classifies the failure from structural scope and effect facts
- **THEN** that owner SHALL call `console.error(error)` directly and SHALL NOT send a Toast to a current, replacement, or unrelated page

#### Scenario: Structural non-result stays quiet

- **WHEN** work settles only because of cancellation, supersession, normal leave, stale completion, hostile input, remote non-delivery, no response, peer departure, or absent/expired History
- **THEN** WebChat SHALL create neither a product-error record nor a Toast for that outcome

### Requirement: Attempt-all and cleanup preserve failed-item evidence

Attempt-all reconciliation, attachment, publication, listener notification, and cleanup SHALL continue contractually independent remaining items after one item fails, but SHALL retain the failed item's original Error through its user-impacting route or direct `console.error(error)` owner. Listener failure SHALL NOT roll back a committed database write or prevent later listeners, and Memory and IndexedDB SHALL expose the same watcher-failure behavior.

A cleanup failure SHALL NOT replace, normalize, or hide a primary operation failure. The primary operation SHALL retain its original settlement while cleanup failure follows its own user-impacting route or direct `console.error(error)` diagnostic. If cleanup is independently required by an existing stop-before-start, transaction, or disposal contract, an uncompleted cleanup SHALL NOT be represented as successful merely because its failure was recorded.

An exception MAY be ignored only when an exact structural fact or called-API contract proves one named idempotent already-terminal condition. A terminal owner, broad `catch`, or explanatory comment alone SHALL NOT classify every exception as benign.

#### Scenario: One tab failure does not erase attempt-all evidence

- **GIVEN** Coordinator reconciliation or rebuild attachment has multiple current tab items
- **WHEN** one tab item throws
- **THEN** remaining independent tabs SHALL still be attempted and the failed tab SHALL retain its original Error through one current-user route or direct `console.error(error)` according to its structural impact

#### Scenario: One watcher failure preserves commit and later listeners

- **GIVEN** a successful write commit notifies multiple Memory or IndexedDB watchers
- **WHEN** one watcher throws
- **THEN** the commit SHALL remain successful, later relevant watchers SHALL still run, and both backends SHALL retain the failed listener's original Error through the same structural user-impact decision

#### Scenario: Current projection watcher failure reaches its page

- **GIVEN** a Database watcher owns a current page's visible or persistence-dependent projection
- **WHEN** that watcher throws
- **THEN** the original `error.message` SHALL reach that page's existing `toast.error` route once while the commit and later watchers remain unaffected

#### Scenario: Detached PagePort cancellation logs without Toast

- **GIVEN** PagePort has detached a provider page and is settling its pending History supplies
- **WHEN** the detached page's cancellation callback throws
- **THEN** PagePort SHALL finish the existing pending-supply settlement, call `console.error(error)`, and SHALL NOT send a Toast to that page, a replacement page, or another domain

#### Scenario: Cleanup also fails after a primary failure

- **GIVEN** an operation has one primary failure and its abort, close, disconnect, cancellation, settlement, or disposal step also fails
- **WHEN** the operation and cleanup settle
- **THEN** the primary failure SHALL remain unchanged and cleanup failure SHALL use a separate user-impacting route or direct `console.error(error)` without preventing contractually independent cleanup attempts

#### Scenario: Exact already-terminal cleanup is benign

- **GIVEN** structural state or the called API proves that a cleanup target already reached the one named terminal condition
- **WHEN** the idempotent cleanup reports only that exact condition
- **THEN** WebChat MAY ignore it without a failure event, while any other exception SHALL use its current-user route or direct `console.error(error)` owner

### Requirement: Secondary rejection observation is explicit and exactly once

A Promise side branch MAY consume a rejection without a second product failure only when the same original Promise is returned to its caller or the same failure was synchronously transferred to one existing structured owner. The side branch SHALL express its real settlement, tail-continuation, or ownership-cleanup purpose and SHALL NOT use an empty/comment-only catch, a no-op rejection callback, a generic swallow helper, or equivalent syntax that obscures the surviving owner.

The original rejection SHALL remain observable exactly once. A secondary branch SHALL create neither an unhandled rejection nor a duplicate structured event or Toast.

#### Scenario: Returned task owns the rejection

- **GIVEN** an in-flight operation is returned to its caller and a side branch removes only its ownership record
- **WHEN** the operation rejects
- **THEN** the caller SHALL receive the original rejection, the ownership record SHALL be removed, and the side branch SHALL create no unhandled rejection, duplicate event, or duplicate Toast

#### Scenario: Serialized tail continues after an owned rejection

- **GIVEN** a serialized queue must continue after a prior task whose caller already received its rejection
- **WHEN** the next task enters the queue
- **THEN** the settled queue token MAY permit continuation, but the original failure owner SHALL remain explicit and no generic or syntactically hidden swallow path SHALL be introduced

### Requirement: Manual World failure remains UI-silent but diagnostic

A genuine failure owned exclusively by the AppButton manual World child SHALL call `console.error(error)` at that exact owner and retain its existing automatic recovery consequences. It SHALL NOT produce loading, progress, disabled state, completion, error, Toast, or manual result UI and SHALL NOT change the concurrent Domain child's routing or result. This policy SHALL derive from the exact manual World operation owner and SHALL NOT inspect error content.

#### Scenario: Manual World cleanup fails while Domain settles

- **GIVEN** one ready-state AppButton activation has independent Domain and manual World children
- **WHEN** the World child's provider close, disposal, join, or publication cleanup genuinely fails
- **THEN** WebChat SHALL call `console.error(error)` without a Toast or AppButton result change, while the Domain child SHALL settle and route its own failures independently

### Requirement: Preparation failures keep provider detail

Configuration storage preparation SHALL preserve the original provider Error. An install-time failure with no current page route SHALL call `console.error(error)` rather than being replaced by a generic message and silently consumed. A current page-requested preparation failure affects initialization and SHALL continue through its existing application error boundary with the exact original `error.message`.

#### Scenario: Install-time preparation rejects

- **GIVEN** configuration storage preparation is triggered by installation without a current page route
- **WHEN** the underlying storage or lock operation rejects
- **THEN** WebChat SHALL call `console.error(error)` with the original provider Error and SHALL NOT leave an unhandled rejection or manufacture a Toast destination
