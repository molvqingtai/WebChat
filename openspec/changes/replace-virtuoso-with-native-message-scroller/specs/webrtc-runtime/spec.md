## MODIFIED Requirements

### Requirement: Adjacent SystemNotice grouping is UI-only and history-responsive

After the complete latest application projection is canonically sorted by event `(hlc,id)`, the UI SHALL group each maximal adjacent run of SystemNotice messages. A singleton SHALL render unchanged. A run of two or more SHALL initially render the latest notice and an icon expand/collapse control without a numeric count; expansion and collapse SHALL reveal or hide the earlier notices in canonical order through a height/opacity transition, while reduced-motion preference SHALL remove the transition without changing content. Any non-notice message SHALL split groups. The transform SHALL not alter, delete, merge, or persist canonical records, and lifecycle terminology SHALL not appear in the UI.

Each grouped row SHALL derive one stable UI identity from its first canonical notice's persistent ID. Extending the same run SHALL preserve that identity. Before React and the message list receive a row, text SHALL project as `message:<id>`, singleton notice as `single-notice:<id>`, and grouped notice as `notice-group:<first-notice-id>`. These row-type namespaces SHALL remain structurally disjoint for every wire-valid opaque ID, including IDs that begin with another row type's namespace. Every row SHALL pass that same projected identity to the message list as its real-DOM row key. Raw ID alone, array position, first/last presentation flags, and expand/collapse state SHALL NOT participate in row identity.

Streaming history MAY insert Chat messages before, after, or between existing SystemNotice messages according to canonical event time. The UI SHALL recompute grouping from the new sorted projection so late history can create, split, or reposition a group without changing observer-local notice ownership or synchronizing notices through peer history.

#### Scenario: Non-notice splits a run

- **WHEN** two adjacent notices are followed by a Chat message and then two more adjacent notices
- **THEN** the UI SHALL render two independent collapsible groups separated by the unchanged Chat message

#### Scenario: Late history reprojects grouping

- **WHEN** streaming history inserts a canonically ordered Chat message between notices that were previously adjacent
- **THEN** the next UI projection SHALL split the prior group while every canonical notice and Chat record remains unchanged

#### Scenario: Real-DOM grouped-row identity remains stable

- **WHEN** a two-notice group renders, its expand/collapse state changes, another notice extends the same run, or late history splits that run
- **THEN** every rendered row SHALL receive a defined persistent DOM key; expansion and extension SHALL not remount the original group, and split rows SHALL have distinct non-index identities

#### Scenario: Count-free animated notice disclosure

- **WHEN** a grouped notice row is expanded or collapsed
- **THEN** earlier notices SHALL enter or leave in canonical order through a smooth height/opacity transition, the latest notice SHALL remain the control anchor, reduced-motion preference SHALL remove the transition, and no numeric group count SHALL render

#### Scenario: Opaque IDs cannot impersonate another row type

- **WHEN** text or notice IDs begin with `message:`, `single-notice:`, or `notice-group:` and late history creates or splits an adjacent-notice group
- **THEN** every React and message-list DOM identity SHALL retain its actual row-type namespace, remain unique across the projection, preserve the original group through expansion or extension, and never transfer DOM, measurement, or scroll identity to another row type

## ADDED Requirements

### Requirement: Real-DOM lists on the official Message Scroller primitives

The message list SHALL render every row as a real DOM item driven by the official shadcn Message Scroller behavior primitives (`@shadcn/react/message-scroller`) through the local vendored wrapper `src/components/ui/message-scroller.tsx`. WebChat SHALL NOT ship a self-written scroll engine, a virtualization layer, or a height-estimation substitute for the message list, header room lists, or footer autocomplete list.

The message list's provider, viewport, and content shell SHALL remain mounted across the loading (`null` children), empty (`[]`), and loaded phases; only rows SHALL appear or disappear with content, and a `null` loading value SHALL remain explicitly distinct from an empty ready list. Initial end presentation SHALL be driven by the primitive's item-count zero-to-nonzero transition in a commit after the shell's refs attach, without any timer, animation-frame workaround, retry, observer, second scroll command, or additional readiness state. The message list SHALL compose the repository shadcn `ScrollArea` so that, through its backward-compatible `viewport` render-prop seam and a minimal Owner-authorized dependency patch giving the engine Viewport a `render` seam mirroring its own Button, the engine Viewport renders with the repository's Radix Viewport as its render target: one DOM element SHALL own overflow, the repository `ScrollBar`, Radix scrollbar measurement, the engine viewport ref, every geometry read, and every scroll command, with no native overflow owner, nested scroll viewport, second geometry source, or alternate scrollbar.

The message list SHALL smooth-follow a new tail only while settled at the bottom, as one current follow authorization: while the authorization is unsettled, transient off-bottom geometry caused by its own motion or by an intrinsic reserve converting to a taller real row SHALL neither increment the arrival count nor cancel it; a newer tail commit or native scroll event SHALL retarget only when scroll height or tail generation strictly advanced; native `scrollend` SHALL settle it, retiring at physical bottom or issuing one deduped smooth command to the current max when geometry advanced; real wheel, touch, navigation-key, and scrollbar-drag intent SHALL cancel it, while pointer, click, selection, and programmatic scroll events SHALL NOT. The list SHALL count off-bottom arrivals behind one click-recovery action, respect manual departure, and preserve the reading anchor across history prepends. The footer autocomplete SHALL keep ArrowUp/ArrowDown/Enter selection and focus semantics and keep the active option natively visible. Production, tests, configuration, package manifest, lockfile, and current documentation SHALL contain no `react-virtuoso` dependency, identity, type, mock, or Virtuoso-only mechanism; archived historical change records MAY retain Virtuoso names for their own immutable exacts.

#### Scenario: Real-DOM message rows

- **WHEN** a long history renders
- **THEN** every row SHALL exist as a real DOM item keyed by its projected identity, with no virtualization, hidden accessible content, or container-level rendering substitute

#### Scenario: Constant shell across loading phases

- **WHEN** the business composition reports loading (`null` content), an empty ready history, or a loaded history
- **THEN** the message-list shell SHALL remain the same mounted instance in every phase, rows SHALL appear only with non-null content, and the first non-empty content SHALL initially present at the latest message

#### Scenario: Bottom-aware follow and recovery

- **WHEN** a new tail message arrives while the user is settled at the bottom
- **THEN** the list SHALL smooth-follow to the latest message; while the user is off the bottom, arrivals SHALL instead increment one recovery action whose activation returns to the latest tail and clears the count

#### Scenario: Virtuoso removal is complete

- **WHEN** source, tests, configuration, package manifest, lockfile, and current documentation are inspected
- **THEN** no `react-virtuoso` reference, patch identity, type, mock, or Virtuoso-only mechanism SHALL remain

### Requirement: Row-level rendering optimization contract

Each repeated row of the message list, header room and user lists, and footer autocomplete list SHALL carry `content-visibility: auto` with a stable `contain-intrinsic-size` on the row surface itself. Header room rows SHALL reserve 56px and header user rows 28px. Footer autocomplete options SHALL reserve 28px, consistent with the existing option-row geometry. Variable-height message rows SHALL use a stable fallback that SHALL NOT alter layout once the row's real measurement is known. These properties SHALL NOT be replaced by container-level styling, virtualization, or hidden accessible content.

#### Scenario: Row surfaces carry the contract

- **WHEN** a rendered row of any of the three lists is inspected
- **THEN** its own computed style SHALL show `content-visibility: auto` and its stable `contain-intrinsic-size` reservation

#### Scenario: Long lists keep bounded real geometry

- **WHEN** a long message history, room list, or option list renders
- **THEN** every row SHALL remain real DOM and the viewport scroll height SHALL stay within the bounded envelope implied by real row heights and the intrinsic reservation
