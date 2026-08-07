## ADDED Requirements

### Requirement: Page feedback follows the current document lifetime

One Content composition owner SHALL coordinate terminal document exit, BFCache suspension, BFCache restoration, page-owned work cancellation, ClientLease ownership, and page-scoped Runtime feedback. `beforeunload`, a Domain, a component, the feedback adapter, and the ClientLease watchdog SHALL NOT independently own whether the document may attach or present connection state. Ordinary document visibility changes that neither end nor suspend the document SHALL NOT trigger this lifecycle.

When a Content document begins terminal exit or BFCache suspension, the owner SHALL first stop page-scoped Runtime feedback and remove only its current readiness presentation. The owner SHALL then cancel page-owned work and release the ClientLease exactly once. Page-local readiness changes caused by that release SHALL NOT create or update `webchat-runtime-readiness` while the document is departing or suspended.

On `pageshow` with `persisted=true`, the same document generation SHALL start exactly one current attach/init operation and install exactly one current feedback subscription. The restored page SHALL derive presentation from the resulting current Runtime snapshot rather than a suspended local snapshot. Current `ready` SHALL dismiss the stable readiness slot without publishing success feedback. Current `connecting` or `unavailable` MAY use the existing active-page feedback rules.

A non-persisted terminal exit SHALL have no restoration path. A later new document SHALL bootstrap as a new generation and SHALL NOT reuse the ended document's callbacks, watchdog, subscription, lease, or late async results. Duplicate lifecycle signals and repeated Back/Forward cycles SHALL NOT create a second page lease, callback set, feedback subscription, watchdog, UI/store owner, or connection truth.

These rules SHALL NOT change the shared Runtime or Room lifetime, transport or wire protocol, persistence, retry behavior, connection truth, permissions, dependencies, or public UI structure, controls, and copy. WebChat SHALL NOT make a detached page appear ready, persist a document-lifecycle owner, add a parallel lifecycle path, or add a test-only production seam.

#### Scenario: Terminal navigation is silent and final

- **GIVEN** an active ready Content document with page feedback and one ClientLease
- **WHEN** a non-persisted navigation or close ends that document
- **THEN** feedback SHALL stop before page-owned cancellation and lease release, cleanup SHALL occur exactly once, no connection loading Toast SHALL be created or updated by cleanup, and no restoration SHALL be scheduled

#### Scenario: Hard refresh creates no final-frame loading

- **GIVEN** an active ready Content document
- **WHEN** a hard refresh ends its current generation and creates a new document generation
- **THEN** the ended generation SHALL publish no cleanup-owned loading feedback, its late results SHALL be ignored, and only the new generation SHALL perform normal bootstrap

#### Scenario: BFCache suspension preserves no active presentation owner

- **GIVEN** an active Content document whose `pagehide` is persisted
- **WHEN** the browser suspends that document in BFCache
- **THEN** page-scoped feedback SHALL become silent before the lease is released, exactly one suspended document owner SHALL remain, and no duplicate UI, store, callback, subscription, or watchdog owner SHALL exist

#### Scenario: BFCache restoration reconciles current ready truth

- **GIVEN** a suspended Content document whose shared Runtime remained ready
- **WHEN** `pageshow` restores that same document with `persisted=true`
- **THEN** the page SHALL attach/init exactly once, install one current feedback subscription, derive readiness from the current Runtime snapshot, dismiss any stable readiness loading entry, and converge to ready without a success Toast

#### Scenario: Restored page may present a real current transition

- **GIVEN** a suspended Content document whose Runtime is not ready when the document is restored
- **WHEN** its one current attach/init operation observes `connecting` or `unavailable`
- **THEN** the active page MAY use the existing feedback for that current truth and SHALL settle it through the existing readiness rules when the same generation becomes ready

#### Scenario: Repeated Back and Forward cycles keep one owner

- **GIVEN** one Content document is repeatedly suspended and restored through browser history
- **WHEN** multiple persisted hide/show cycles complete
- **THEN** every cycle SHALL perform at most one release and one restore, and the document SHALL retain exactly one current lease, feedback subscription, callback set, watchdog, and UI/store owner while active

#### Scenario: Shared Runtime semantics remain unchanged

- **GIVEN** another Content page keeps the shared Runtime and Rooms healthy while this document exits or is suspended
- **WHEN** this document cleans up or restores
- **THEN** the shared Runtime, Rooms, protocol, persistence, retry semantics, and other page bindings SHALL remain unchanged
