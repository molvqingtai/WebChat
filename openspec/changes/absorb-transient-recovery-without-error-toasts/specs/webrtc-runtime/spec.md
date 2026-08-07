## ADDED Requirements

### Requirement: Connection lifecycle uses only current structural state

WebChat SHALL decide retry, readiness, cancellation, and settlement only from current page, navigation, Runtime, Room, owner, revision, and request-continuation facts. Error text, name, type, constructor, code, and value SHALL NOT control lifecycle. Lifecycle owners, retry state, target iteration, Room-attempt handles, error delivery, and cleanup next steps SHALL remain in the current live generation and SHALL NOT be stored as durable owners, outcomes, delivery cursors, outboxes, per-target records, cleanup journals, or compare-and-swap state.

Trusted raw relay and probe-response listeners SHALL be available before awaited business bootstrap. A business envelope SHALL resume exactly once only if its sender, page, navigation, and target remain current.

#### Scenario: Background wake resumes one current handler

- **GIVEN** a business event wakes a Background whose in-memory Coordinator is not ready
- **WHEN** the Background reconstructs minimum facts from the event, current tabs, and the physical Runtime
- **THEN** trusted raw transport SHALL remain available during bootstrap and the original handler SHALL resume exactly once only while its exact caller remains current

#### Scenario: Error content cannot alter lifecycle

- **GIVEN** two failures with different messages or runtime representations
- **WHEN** their structural page, owner, Room, revision, and continuation facts are identical
- **THEN** WebChat SHALL make the same retry, ready, cancel, and settlement decisions for both

### Requirement: Browser restart boundaries preserve only live work

A normal Chrome or Edge MV3 Background idle/restart SHALL preserve the Offscreen physical Runtime, healthy Rooms, and in-flight Runtime owners. Firefox SHALL keep Runtime ownership in its persistent Background. A missing or replaced physical Runtime identity SHALL invalidate the old Runtime generation, mark affected pages non-ready, pause sends, and cancel old page, domain, Room, and iterator owners. One current Background in-memory single-flight SHALL create or adopt a replacement host. The Background SHALL fan invalidation only to live pages in its current memory; every other page SHALL rejoin only through its next live register or watchdog event.

After a full extension reload, an old Content document SHALL remain non-ready and SHALL NOT be promised automatic recovery into the new extension generation. While that document remains current, its existing watchdog SHALL perform ordinary control-plane polling at a bounded cadence. Each real failed poll SHALL create a fresh Content-local failure. Refresh, navigation, close, or supersession SHALL cancel the old polling owner and invalidate late results. WebChat SHALL NOT automatically refresh or reinject the page or add a permission or manifest path for this lifecycle.

WebChat SHALL NOT add user-facing retry controls, status surfaces, or settings for these lifecycle states.

#### Scenario: Normal MV3 worker idle preserves Runtime work

- **GIVEN** a healthy Chrome or Edge Offscreen Runtime with current Rooms and an in-flight Runtime operation
- **WHEN** the MV3 Background idles and later wakes
- **THEN** the physical Runtime, Rooms, and operation SHALL continue without being recreated or replayed

#### Scenario: Full reload leaves the old document polling

- **GIVEN** a Content document whose extension generation is fully reloaded
- **WHEN** the old document remains open and current
- **THEN** it SHALL stay non-ready, poll at a bounded cadence, and create a fresh original-message toast for every real failed poll until refresh, navigation, close, or supersession cancels it

#### Scenario: New document starts in the current generation

- **GIVEN** an old document is non-ready after full reload
- **WHEN** the user refreshes or navigates and a new document is created
- **THEN** the old polling owner SHALL be canceled and the new document SHALL enter normal current-generation binding without automatic injection

### Requirement: Page readiness and Room attempts have exact owners

A page SHALL be ready only while its exact page, navigation, and Runtime generation own a complete callback set and current snapshot, its domain Chat is current, its host World is healthy, and the latest full Presence revision is settled. Attach or repair failure SHALL keep that page non-ready, surface the failure, and retry at a bounded cadence only while the same page owner remains current.

Each Chat or World join attempt SHALL last at most ten seconds and SHALL retain only an optional Room handle that the attempt created. A Chat attempt SHALL commit only after join and current Session publication; a World attempt SHALL enter the sole Presence iterator after join. After commit, an attempt-created handle SHALL NOT belong to attempt cleanup. On failure or cancellation, WebChat SHALL perform one idempotent leave only for an attempt-created, uncommitted handle and SHALL never leave a reused or committed Room. A cleanup throw SHALL be a separate real failure and SHALL NOT prevent cancellation from completing or create a second cleanup owner. A current Chat or World Room close SHALL mark affected pages non-ready and enter the same recovery path; a close from an older generation SHALL be dropped.

#### Scenario: Page repair cannot ready a superseded navigation

- **GIVEN** a page attach or callback repair is in flight
- **WHEN** its page, navigation, or Runtime generation is superseded
- **THEN** the late result SHALL be ignored and SHALL NOT make either generation ready

#### Scenario: Failed join cleans only its own handle

- **GIVEN** a Chat or World attempt creates a Room handle but does not commit it
- **WHEN** the attempt fails or loses ownership
- **THEN** WebChat SHALL leave that handle idempotently once and SHALL NOT leave any reused or committed Room

#### Scenario: Cleanup failure does not trap cancellation

- **GIVEN** cancellation is cleaning an attempt-created uncommitted handle
- **WHEN** the cleanup leave throws
- **THEN** WebChat SHALL record a distinct real failure where routable and SHALL still complete cancellation without adding a cleanup journal or owner

### Requirement: One World iterator settles the latest Presence and release

Every World publication SHALL enter one current Runtime-local iterator that freezes the latest full Presence revision and its distinct targets. The iterator SHALL call `room.send()` at most once for each target in that revision. A return SHALL record local acceptance. A throw SHALL record target failure, SHALL NOT retry that target, and SHALL NOT prevent remaining targets from being attempted. The revision SHALL settle locally after all targets are attempted without requiring every target to accept or acknowledge.

Runtime, Room, or World-owner loss SHALL cancel the iterator. When only the Presence revision is superseded, WebChat SHALL stop the older revision, preserve the current Room, attempted results, and original ready or release continuation, and enter the latest revision through the same World owner. A stale close event SHALL NOT invalidate the current Runtime or Room.

A current page binding or an exact live domain-release continuation SHALL each be sufficient World demand. A last-page release SHALL therefore publish the latest full Presence and return through its release continuation even after no page binding remains. A real failure with no live affected page SHALL remain diagnostic and SHALL NOT stop the World iterator or release progression.

#### Scenario: Revision supersession preserves the World owner

- **GIVEN** a World iterator has attempted one or more targets for a Presence revision
- **WHEN** a newer Presence revision supersedes it while the Runtime, Room, and World owner remain current
- **THEN** WebChat SHALL preserve the Room, attempted results, and request continuation, SHALL NOT retry a target for the superseded revision, and SHALL enter the latest revision with its own one-call-per-target iterator

#### Scenario: One target failure does not stop publication

- **GIVEN** a Presence revision has multiple distinct targets
- **WHEN** one target's `room.send()` throws
- **THEN** that target SHALL fail without retry, every remaining target SHALL still be attempted once, and the revision SHALL settle locally

#### Scenario: Last-page release completes without a binding

- **GIVEN** the last current page has detached and the live domain release has removed its contribution
- **WHEN** the release requests publication of the latest full Presence
- **THEN** the release continuation SHALL count as World demand, publication SHALL complete through the sole iterator, and the domain SHALL advance to closed without requiring a page binding

### Requirement: Domain and host release advance one live step

A domain release SHALL have one Runtime-local owner and one in-memory next step. It SHALL idempotently leave Chat, remove the domain contribution, publish the latest full Presence through the sole World iterator, and complete in that order. A real step failure SHALL keep the same step and retry boundedly while the release owner and Runtime generation remain current. Explicit reconnect SHALL start a new domain generation only after its release completes.

Host disposal SHALL likewise advance one in-memory step at a time through idempotent Room leaves and host destruction. A missing resource SHALL count as completion. Background-only release or disposal progress SHALL NOT be durably restored after worker loss; a later current event SHALL reconcile current tabs and physical Runtime facts.

#### Scenario: Release retries only its current step

- **GIVEN** a live domain release is at one cleanup or publication step
- **WHEN** that step throws or reaches its own deadline
- **THEN** WebChat SHALL keep the same in-memory step, surface the failure where routable, and retry only that step while the release owner remains current

#### Scenario: Runtime loss cancels old release work

- **GIVEN** domain or host release work belongs to a physical Runtime generation
- **WHEN** that Runtime identity is lost or replaced
- **THEN** old release work SHALL be canceled and late results SHALL NOT advance the current generation

### Requirement: Send settlement distinguishes local acceptance from no-result

Before any provider send, WebChat SHALL validate the trusted Room, wire payload, encoding, and distinct targets. A preflight failure SHALL perform zero provider sends. Each target SHALL receive at most one `room.send()` call. A return SHALL mean local acceptance only and SHALL NOT promise remote acknowledgement or delivery. A throw SHALL fail that target, SHALL NOT be retried, and SHALL surface as a real local failure when routable. An explicit single-target throw SHALL reject its call; multi-target work SHALL retain each accepted and failed result after every target is attempted.

A History request MAY wait for a response only after local acceptance. No response, no retained History, peer departure, response expiry, or remote non-delivery SHALL be a no-result outcome and SHALL NOT create an error, toast, acknowledgement, or resend.

#### Scenario: Returned send is locally accepted

- **GIVEN** a current Room and a valid target send
- **WHEN** `room.send()` returns without throwing
- **THEN** WebChat SHALL record local acceptance without waiting for or asserting remote delivery

#### Scenario: Thrown target is never retried

- **GIVEN** a current multi-target operation
- **WHEN** one target's `room.send()` throws
- **THEN** WebChat SHALL surface that failure where routable, SHALL NOT call that target again, and SHALL continue to remaining targets

#### Scenario: Missing History is no-result

- **GIVEN** a locally accepted History request
- **WHEN** no valid response arrives before the response window ends
- **THEN** WebChat SHALL settle no-result without an error, toast, acknowledgement, or resend

### Requirement: Every distinct real local failure keeps its original message

Every current local operation throw, rejection, or operation-owned deadline SHALL have one failure owner and SHALL create a fresh event identifier containing the original message, subsystem, operation, and exact scope. WebChat SHALL route a Runtime, Background, or Room failure to every current affected page generation in that exact scope and SHALL NOT route it elsewhere. Each current Content generation SHALL deduplicate transport delivery of the same event identifier, but every later real failed attempt SHALL create another fresh toast.

WebChat SHALL NOT suppress, reuse, merge, update, throttle, normalize, map, or rewrite genuine error toasts. A toast SHALL contain the original error message and SHALL NOT control readiness, retry, cancellation, or settlement. A live in-memory delivery attempt MAY retry at a bounded cadence only while its producer and exact target remain current. If no affected page or live route exists, the failure SHALL be diagnostic. Error-delivery failure SHALL also be diagnostic and SHALL NOT recursively create another toast.

Cancellation, supersession, normal leave, stale completion, hostile transport input, remote non-delivery, no response, peer departure, and absent or expired History SHALL NOT be treated as product errors.

#### Scenario: Repeated failed attempts create fresh toasts

- **GIVEN** a current page whose recovery operation fails on multiple distinct attempts
- **WHEN** each attempt produces a real local failure
- **THEN** every attempt SHALL create a separate toast with that failure's original message and WebChat SHALL NOT merge, update, or throttle those toasts

#### Scenario: Transport duplicate is shown once

- **GIVEN** one failure event is delivered more than once by transport
- **WHEN** the same event identifier reaches the current Content generation
- **THEN** WebChat SHALL show one toast for that event while preserving fresh toasts for distinct later failures

#### Scenario: Unroutable failure is diagnostic

- **GIVEN** a real Runtime failure has no current affected page or live route
- **WHEN** error delivery evaluates its exact scope
- **THEN** WebChat SHALL keep the failure diagnostic and SHALL NOT deliver it to a replacement navigation or create a recursive toast
