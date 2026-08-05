## ADDED Requirements

### Requirement: Initial canonical history appears at the latest message without scrolling into place

The existing ScrollArea shell SHALL remain present while the virtual message list waits for its two existing prerequisites: canonical `messageListLoadFinished` history readiness and a non-null handle for the actual Radix viewport. Virtuoso SHALL NOT mount while either prerequisite is unavailable. History readiness SHALL remain the sole loading fact, and one callback-ref-backed `HTMLElement | null` viewport handle SHALL remain the sole scroll-parent resource identity. WebChat SHALL NOT add another initialized, first-load, positioned, or equivalent readiness fact.

The canonical history-readiness fact SHALL be consumed only at the business composition layer, which SHALL express it as the list's content: while loading it SHALL render `null` instead of records, and once ready it SHALL render the complete records (an empty list when the history is empty). The presentational message-list UI SHALL NOT receive, prop-drill, or otherwise consume that business readiness fact. It SHALL keep Virtuoso absent while its content is `null` and SHALL mount Virtuoso once when content (including an empty list) and the real viewport both exist. A `null` loading value and an empty ready list SHALL remain explicitly distinct values; readiness SHALL NOT be encoded through truthiness of the records themselves.

When both prerequisites exist, Virtuoso SHALL mount once with the complete current canonical records, that non-null viewport as its real custom scroll parent, and a last-item/end-aligned initial location. The first non-empty message-list frame presented to the user SHALL already be aligned at the latest canonical message. It SHALL NOT first present the top of history, animate or sweep from top to bottom, or use live-follow smooth scrolling to settle initial history.

A complete non-empty history that fits within the actual viewport SHALL simply present its records without any settlement scroll; WebChat SHALL NOT add alignment styling, minimum block-size declarations, or imperative scrolling to force short histories to the viewport bottom.

Canonical record updates SHALL NOT change the mounted Virtuoso key or otherwise remount it. Only actual destruction or replacement of the Radix viewport resource MAY remove the list and re-enter the same two-prerequisite mount boundary. An empty canonical history SHALL mount normally after both prerequisites exist and SHALL accept its first later message through the normal append behavior.

This behavior SHALL add no loading UI, placeholder, skeleton, status copy, initialization observer, bottom-state copy, positioning effect, timer, `requestAnimationFrame`, imperative scroll command, CSS visibility or opacity gate, height-correction loop, alternative scroll parent, virtualizer migration, dependency, or commercial package. Canonical message data, ordering, grouping, row identity, durable history, composer behavior, shell geometry, Runtime networking, protocol, persistence, permissions, and browser-independent product behavior SHALL remain unchanged.

#### Scenario: History readiness alone does not mount the list

- **GIVEN** canonical history loading is complete and the actual Radix viewport handle is null
- **WHEN** the MessageList composition renders
- **THEN** the ScrollArea shell SHALL remain present, Virtuoso SHALL remain absent, and no temporary scroll parent or visible loading UI SHALL appear

#### Scenario: Viewport readiness alone does not mount the list

- **GIVEN** the actual Radix viewport exists and canonical history loading is not complete
- **WHEN** the MessageList composition renders
- **THEN** Virtuoso SHALL remain absent and the available viewport SHALL NOT turn later history application into a live-follow append

#### Scenario: Complete history first appears at the latest message

- **GIVEN** an overflowing canonical history with variable-height text, notice, or grouped rows is complete and the actual Radix viewport exists
- **WHEN** Virtuoso first mounts
- **THEN** it SHALL receive the complete records and non-null real scroll parent, its first non-empty presented frame SHALL already be end-aligned at the latest canonical message, and no initial live-follow smooth decision or visible top-to-bottom motion SHALL occur

#### Scenario: Short history presents without a settlement scroll

- **GIVEN** a complete non-empty canonical history fits within the actual Radix viewport
- **WHEN** Virtuoso first mounts
- **THEN** the records SHALL present without end-alignment styling or block-size declarations, and initialization SHALL issue no automatic or imperative settlement scroll

#### Scenario: Empty history mounts once and accepts its first message

- **GIVEN** canonical history loading completes with no records and the actual Radix viewport exists
- **WHEN** Virtuoso mounts and a first new message later arrives
- **THEN** the same mounted list SHALL accept that message through normal append behavior without another initialization fact, remount, or positioning path

#### Scenario: Record updates preserve the mounted list

- **GIVEN** Virtuoso is mounted against the current actual viewport
- **WHEN** canonical records append, group, or otherwise reproject under their existing rules
- **THEN** the list and scroll-parent identities SHALL remain stable and the update SHALL NOT re-enter initial positioning

#### Scenario: Business layer alone owns the readiness gate

- **GIVEN** canonical history is loading or ready
- **WHEN** the business composition layer renders the MessageList composition
- **THEN** it SHALL pass `null` while loading and the complete records once ready, the presentational list UI SHALL receive no readiness prop or equivalent business fact, and Virtuoso SHALL mount only when content is non-null and the real viewport exists

#### Scenario: Actual viewport replacement owns remounting

- **GIVEN** Virtuoso is mounted and the owning Radix viewport resource is destroyed or replaced
- **WHEN** the callback-ref handle reflects that resource lifecycle
- **THEN** the list MAY unmount while the handle is null and SHALL mount against only the new non-null viewport after canonical history remains ready, without a data-driven remount key or stale scroll parent

### Requirement: Later appends follow only from the bottom

After the stable initial mount, each later canonical append SHALL use Virtuoso's supplied `isAtBottom` fact directly. When that fact is true, the append SHALL smooth-follow the latest message. When it is false, the append SHALL perform no follow action and SHALL preserve the user's current history-reading position.

WebChat SHALL NOT return an automatic follow result for the non-bottom case, issue an imperative scroll, retain a duplicate bottom-state owner, or add message-type exceptions. Text, notice, and grouped-row appends SHALL use the same decision after their unchanged canonical projection. Initial history application SHALL NOT be treated as a later append.

#### Scenario: Append at the bottom follows smoothly

- **GIVEN** the stable message list is mounted and the user is at the bottom immediately before a later canonical append
- **WHEN** the append reaches Virtuoso
- **THEN** the list SHALL smooth-follow the latest message through the existing live follow boundary

#### Scenario: Append while reading history preserves position

- **GIVEN** the stable message list is mounted and the user is above the bottom reading earlier messages immediately before a later canonical append
- **WHEN** the append reaches Virtuoso
- **THEN** the list SHALL perform no follow action, preserve the user's reading position, and SHALL NOT jump or animate to the bottom

#### Scenario: Message kind does not change the follow rule

- **GIVEN** a later text, notice, or grouped-row update reaches the mounted list
- **WHEN** Virtuoso supplies the current bottom fact
- **THEN** WebChat SHALL smooth-follow only for true and perform no follow action for false without a message-kind branch or copied bottom state

#### Scenario: Initial history never enters live following

- **GIVEN** canonical history and the actual viewport become ready for the first mount
- **WHEN** the complete history is presented at its initial last-item/end-aligned location
- **THEN** WebChat SHALL use only the initial positioning boundary and SHALL NOT invoke smooth live following to reach the latest message
