## ADDED Requirements

### Requirement: AppButton status is shared by domain and projected per tab

Each WebChat domain SHALL own one shared AppButton status containing its position and unread-attention truth. Every same-domain tab SHALL observe the same position and unread values, while tabs from another domain SHALL remain isolated. Expanded or collapsed shell state SHALL belong to each physical tab independently. The same physical tab SHALL retain its own shell state across reload without adopting a same-domain sibling tab's shell state.

The shared position SHALL consist of a horizontal anchor, the AppButton center's distance from that selected viewport edge, and the launcher bottom edge's distance from the viewport bottom. A center left of the viewport midpoint SHALL use a left-bottom anchor with a left distance. A center at or right of the midpoint SHALL use a right-bottom anchor with a right distance. The bottom distance SHALL apply in both halves.

Each tab SHALL reproject the shared edge-relative coordinates against its own current viewport. It SHALL derive bounds from that viewport and the AppButton geometry so the launcher remains fully visible. If a saved coordinate lies beyond a viewport's visible range, only that tab's rendered projection SHALL be bounded; the shared coordinate SHALL remain unchanged. Resizing SHALL perform no shared-state mutation or persistence write, and a later larger viewport SHALL project from the unchanged shared coordinate.

Dragging SHALL begin from the existing hand control, follow the latest pointer position once per animation frame, prevent text selection, retain the grab cursor, remain within the derived bounds, and end on mouse release. When the AppButton center crosses the viewport midpoint, the horizontal anchor SHALL change and its edge distance SHALL be converted from the same rendered center in that frame. The button SHALL remain under the pointer without a visual jump, snap, rebound, easing, delayed settle, or release-behavior change.

After initialization, only a user drag SHALL change the shared position. Same-domain tabs SHALL observe that field update.

Position and unread updates SHALL be field-scoped within the shared status. A position write SHALL preserve the latest unread value, and an unread mark or clear SHALL preserve the latest position. A tab-local shell write SHALL persist neither shared field, and a shared write SHALL NOT toggle any tab's shell state.

Each first-delivered remote text SHALL mark its WebChat domain as having unread attention exactly once, regardless of which same-domain tab wins atomic durable insertion and regardless of whether that winning tab is expanded. Self-authored text, history application, duplicate delivery, reactions, and system notices SHALL NOT mark unread attention. Browser-notification enabled and type settings SHALL NOT participate in unread eligibility.

A tab SHALL show the AppButton unread indicator if and only if its own panel is collapsed and its domain has unread attention. An already expanded tab SHALL show no indicator and SHALL NOT clear domain attention merely by remaining expanded, hydrating, becoming focused, or observing synchronization.

A user-driven transition from collapsed to expanded SHALL mark that WebChat domain read and clear its unread attention from every same-domain tab. Collapsing a tab SHALL NOT clear attention. Clearing one domain SHALL NOT affect another domain. A later first-delivered remote text SHALL mark its domain unread again. Delayed hydration and unrelated shell or position updates SHALL NOT overwrite a newer domain unread mark or clear.

The visible AppButton indicator SHALL be count-free and SHALL NOT resize the button. It SHALL occupy the top-right `size-5` container at `-top-1 -right-1`, with a full-size fully rounded orange-400 ping at 75% opacity and a fully rounded orange-500 `size-3` center. Its presence SHALL enter and exit through a 0.1-second opacity transition.

#### Scenario: Same-domain tabs share position but not open state

- **GIVEN** tabs A, B, and C belong to domain A, tab D belongs to domain B, and their panels have independent expanded or collapsed states
- **WHEN** the user drags the AppButton in tab A to a new position
- **THEN** A, B, and C SHALL observe the same shared position in their own viewports, D SHALL remain unchanged, and no panel's expanded or collapsed state SHALL change

#### Scenario: Left-half position uses the left-bottom anchor

- **GIVEN** an AppButton center is left of the viewport midpoint
- **WHEN** its position is projected or dragged within the left half
- **THEN** its shared horizontal coordinate SHALL be the distance from the left viewport edge, its vertical coordinate SHALL be the distance from the bottom edge, and resizing SHALL reproject those unchanged coordinates without a persistence write

#### Scenario: Right-half position uses the right-bottom anchor

- **GIVEN** an AppButton center is at or right of the viewport midpoint
- **WHEN** its position is projected or dragged within the right half
- **THEN** its shared horizontal coordinate SHALL be the distance from the right viewport edge, its vertical coordinate SHALL be the distance from the bottom edge, and resizing SHALL reproject those unchanged coordinates without a persistence write

#### Scenario: A smaller viewport bounds only the rendered projection

- **GIVEN** a shared edge-relative position that lies beyond a smaller tab viewport's fully visible range
- **WHEN** that tab projects the AppButton after resize
- **THEN** the launcher SHALL remain fully visible at the nearest derived bound, the shared position SHALL NOT be rewritten, and a later larger viewport SHALL project the original shared coordinate again

#### Scenario: Crossing the midpoint is visually continuous

- **GIVEN** the user is dragging the AppButton from one viewport half toward the other
- **WHEN** its center crosses the midpoint
- **THEN** the anchor SHALL change using the same rendered center, and pointer following, bounds, cursor, selection suppression, and mouse-release behavior SHALL continue without a visual jump, snap, rebound, easing, or delayed settle

#### Scenario: Shared field updates cannot clobber each other

- **GIVEN** same-domain tabs observe a position and unread value
- **WHEN** position and unread updates occur from different tabs or after delayed hydration
- **THEN** each update SHALL change only its addressed field, the latest value of the other shared field SHALL remain authoritative, and no tab's expanded or collapsed state SHALL change

#### Scenario: Expanded insertion winner does not consume sibling attention

- **GIVEN** tab A is expanded, tabs B and C are collapsed on domain A, and tab D belongs to domain B
- **WHEN** a remote domain-A text is first-delivered and tab A wins atomic durable insertion
- **THEN** B and C SHALL each show the flashing AppButton indicator, A SHALL show none, D SHALL remain unchanged, and no tab's expanded/collapsed state SHALL change

#### Scenario: Any same-domain insertion winner produces the same projection

- **GIVEN** tab A is expanded and tabs B and C are collapsed on the same domain
- **WHEN** one eligible remote text is first-delivered and A, B, or C wins atomic durable insertion
- **THEN** the domain unread result SHALL be identical for every winner: only B and C SHALL show the indicator

#### Scenario: Expanding one collapsed tab reads the domain

- **GIVEN** tabs B and C show unread indicators for domain A while tab A is already expanded
- **WHEN** the user expands tab C
- **THEN** domain A SHALL be marked read, B and C SHALL both show no indicator, A SHALL remain expanded without an indicator, and every other domain SHALL remain unchanged

#### Scenario: Existing expanded tab is not a surrogate read action

- **GIVEN** tab A is already expanded while same-domain tabs B and C are collapsed
- **WHEN** an eligible remote text marks domain A unread and tab A remains expanded
- **THEN** A SHALL show no indicator, B and C SHALL keep their indicators, and focus, hydration, or synchronization in A SHALL NOT clear them

#### Scenario: Later remote text marks attention again after reading

- **GIVEN** a user expansion has cleared domain A unread attention
- **WHEN** a later remote domain-A text is first-delivered
- **THEN** every collapsed domain-A tab SHALL show one indicator again and expanded domain-A tabs SHALL show none

#### Scenario: Non-delivery paths do not mark unread

- **WHEN** a text is self-authored, applied from history, or a duplicate delivery, or the inbound value is a reaction or system notice
- **THEN** no domain unread attention SHALL be added and no AppButton indicator SHALL appear because of that value

#### Scenario: Notification settings do not gate unread attention

- **GIVEN** browser notifications are disabled or configured as `Only @self`
- **WHEN** a first-delivered remote text is otherwise ineligible for a browser notification
- **THEN** every collapsed tab of that text's domain SHALL still show the unread indicator and other domains SHALL remain unchanged

#### Scenario: Multiple texts retain one count-free indicator

- **GIVEN** a domain is already unread
- **WHEN** another eligible remote text is first-delivered before the domain is read
- **THEN** each collapsed same-domain AppButton SHALL retain one visually unchanged indicator with no number, label, duplicate marker, or layout shift

#### Scenario: Unrelated status updates cannot clobber shared facts

- **GIVEN** one same-domain tab has observed a newer position, unread mark, or read clear
- **WHEN** another tab completes delayed hydration or writes its shell state or the other shared field
- **THEN** each newer shared fact SHALL remain authoritative and no sibling tab's expanded/collapsed state SHALL change

#### Scenario: Indicator uses the fixed visual result

- **WHEN** a collapsed tab projects domain unread attention on its AppButton
- **THEN** it SHALL render the top-right orange ping and opaque center with the specified sizes, offsets, opacity, rounding, and 0.1-second presence transition, without text, count, or button resizing
