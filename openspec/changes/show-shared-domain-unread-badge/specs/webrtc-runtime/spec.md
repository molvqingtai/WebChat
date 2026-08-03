## ADDED Requirements

### Requirement: AppButton status is synchronized by domain

Each WebChat domain SHALL own one shared AppButton status containing `open`, position, and unread attention. Every same-domain tab SHALL observe the same values, while tabs from another domain SHALL remain isolated. A tab that hydrates SHALL adopt the current shared status without writing hydration back into persistence. The shared status SHALL always satisfy `open => !unread`.

The shared position SHALL consist of a horizontal anchor, the AppButton center's distance from that selected viewport edge, and the launcher bottom edge's distance from the viewport bottom. A center left of the viewport midpoint SHALL use a left-bottom anchor with a left distance. A center at or right of the midpoint SHALL use a right-bottom anchor with a right distance. The bottom distance SHALL apply in both halves.

The launcher SHALL be `44x44px`. In a viewport that can satisfy the fixed margins, its center SHALL remain at least `50px` from the selected left or right viewport edge, leaving at least `28px` between the launcher's outer edge and that viewport edge, and its bottom edge SHALL remain at least `22px` above the viewport bottom. The left-bottom and right-bottom bounds SHALL be symmetric.

Each tab SHALL reproject the shared edge-relative coordinates against its own current viewport. It SHALL derive bounds from that viewport and the AppButton geometry so the launcher remains fully visible with the fixed margins. If a viewport can contain the launcher but is too small to satisfy a fixed margin, only that tab's rendered projection SHALL use the nearest fully visible bound with the largest feasible margin; the shared coordinate SHALL remain unchanged. Resizing SHALL perform no shared-state mutation or persistence write, and a later larger viewport SHALL restore the fixed margins from the unchanged shared coordinate.

While WebChat is expanded, the same local geometry projection SHALL add a vertical bound that keeps the shell's top edge at least `40px` below the viewport top. The bound SHALL apply at both horizontal anchors and every shell width allowed by the existing resizer. Upward dragging SHALL stop at the nearest point before the shell would violate that inset, and the shell SHALL NOT render above the viewport top. The collapsed launcher's existing vertical range, the shell's supported size range and launcher relationship, and the launcher's horizontal and bottom margins SHALL remain unchanged.

If a shared coordinate captured while collapsed or in another viewport would place the expanded shell above its top bound, opening, reopening, same-domain open synchronization, and viewport resize SHALL use the nearest shell-safe local projection. Those automatic projections SHALL NOT mutate or persist the shared position. A later compatible local layout SHALL project the unchanged shared coordinate again unless a user drag has written a new bounded position.

Dragging SHALL begin from the existing hand control, follow the latest pointer position once per animation frame, prevent text selection, retain the grab cursor, remain within the derived bounds, and end on mouse release. When the AppButton center crosses the viewport midpoint, the horizontal anchor SHALL change and its edge distance SHALL be converted from the same rendered center in that frame. The button SHALL remain under the pointer without a visual jump, snap, rebound, easing, delayed settle, or release-behavior change.

After initialization, only a user drag SHALL change the shared position. Same-domain tabs SHALL observe that field update.

Updates SHALL be field-scoped within the shared status. A position write SHALL preserve the latest open and unread values. An unread mark SHALL preserve open and position. A collapse SHALL preserve position and unread. Opening SHALL intentionally set `open` and clear unread together while preserving position. Delayed hydration and unrelated field updates SHALL NOT overwrite current values in other fields.

Each first-delivered remote text SHALL mark its WebChat domain as having unread attention exactly once when the shared domain is collapsed, regardless of which same-domain tab wins atomic durable insertion. A remote text delivered while the shared domain is expanded SHALL NOT mark unread. Self-authored text, history application, duplicate delivery, reactions, and system notices SHALL NOT mark unread attention. Browser-window focus, active/highlighted tab, and browser-notification enabled/type settings SHALL NOT participate in unread eligibility or clearing. Highlighted-tab comparison SHALL remain exclusive to browser-notification eligibility.

A user-driven transition from collapsed to expanded SHALL set every same-domain tab to expanded and clear the domain's unread attention as one update. A user-driven transition from expanded to collapsed SHALL set every same-domain tab to collapsed and SHALL NOT create unread attention. Focus, hydration, and synchronization alone SHALL perform neither transition. A later first-delivered remote text while collapsed SHALL mark the domain unread again. Toggling one domain SHALL NOT affect another domain.

A same-domain AppButton SHALL show the unread indicator if and only if the shared status satisfies `!open && unread`. Every same-domain tab SHALL therefore show the same indicator visibility, and every expanded same-domain tab SHALL show none.

The visible AppButton indicator SHALL be count-free and SHALL NOT resize the button. It SHALL occupy the top-right `size-5` container at `-top-1 -right-1`, with a full-size fully rounded orange-400 ping at 75% opacity and a fully rounded orange-500 `size-3` center. Its presence SHALL enter and exit through a 0.1-second opacity transition.

#### Scenario: Same-domain tabs synchronize the complete status

- **GIVEN** tabs A, B, and C belong to domain A and tab D belongs to domain B
- **WHEN** open, position, or unread changes through any domain-A tab
- **THEN** A, B, and C SHALL observe the same complete AppButton status in their own viewports and D SHALL remain unchanged

#### Scenario: Left-half position uses the left-bottom anchor

- **GIVEN** an AppButton center is left of the viewport midpoint
- **WHEN** its position is projected or dragged within the left half
- **THEN** its shared horizontal coordinate SHALL be the distance from the left viewport edge, its vertical coordinate SHALL be the distance from the bottom edge, its center SHALL remain at least `50px` from the left edge, its outer edge SHALL retain at least `28px`, its bottom edge SHALL retain at least `22px`, and resizing SHALL reproject those unchanged coordinates without a persistence write

#### Scenario: Right-half position uses the right-bottom anchor

- **GIVEN** an AppButton center is at or right of the viewport midpoint
- **WHEN** its position is projected or dragged within the right half
- **THEN** its shared horizontal coordinate SHALL be the distance from the right viewport edge, its vertical coordinate SHALL be the distance from the bottom edge, its center SHALL remain at least `50px` from the right edge, its outer edge SHALL retain at least `28px`, its bottom edge SHALL retain at least `22px`, and resizing SHALL reproject those unchanged coordinates without a persistence write

#### Scenario: A smaller viewport bounds only the rendered projection

- **GIVEN** a shared edge-relative position that lies beyond a smaller tab viewport's fully visible range
- **WHEN** that tab projects the AppButton after resize
- **THEN** the launcher SHALL remain fully visible at the nearest derived bound with the largest feasible local margin, the shared position SHALL NOT be rewritten, and a later larger viewport SHALL project the original shared coordinate and fixed margins again

#### Scenario: Upward drag preserves the expanded-shell top inset

- **GIVEN** WebChat is expanded at either horizontal anchor and at any shell width allowed by the existing resizer
- **WHEN** the user drags the AppButton upward beyond the shell-safe range
- **THEN** the rendered AppButton SHALL stop at the nearest local bound, the shell top SHALL remain at least `40px` below the viewport top and SHALL NOT overflow above it, and the existing horizontal, bottom, pointer-following, and release behavior SHALL remain unchanged

#### Scenario: Opening locally bounds a shell-unsafe shared point

- **GIVEN** the shared position was captured while collapsed or in another viewport and would place an expanded shell above its top bound in this tab
- **WHEN** WebChat opens, reopens, or becomes open through same-domain synchronization
- **THEN** this tab SHALL use the nearest shell-safe local projection with at least `40px` above the shell, SHALL NOT mutate or persist the shared position, and SHALL preserve that position for a later compatible local layout

#### Scenario: Resize locally preserves the expanded-shell top inset

- **GIVEN** WebChat is expanded and the viewport changes so the current local projection would violate the shell's top bound
- **WHEN** the tab reprojects the shared position
- **THEN** it SHALL keep the shell at least `40px` below the viewport top without a shared mutation or persistence write, at either horizontal anchor and every supported shell width

#### Scenario: Crossing the midpoint is visually continuous

- **GIVEN** the user is dragging the AppButton from one viewport half toward the other
- **WHEN** its center crosses the midpoint
- **THEN** the anchor SHALL change using the same rendered center, and pointer following, bounds, cursor, selection suppression, and mouse-release behavior SHALL continue without a visual jump, snap, rebound, easing, or delayed settle

#### Scenario: Shared field updates cannot clobber each other

- **GIVEN** same-domain tabs observe current open, position, and unread values
- **WHEN** field updates occur from different tabs or one tab completes delayed hydration
- **THEN** each update SHALL preserve every unaddressed current field, opening SHALL clear unread while preserving position, and the result SHALL satisfy `open => !unread`

#### Scenario: Collapsed delivery marks every same-domain AppButton

- **GIVEN** tabs A, B, and C are collapsed on domain A and tab D belongs to domain B
- **WHEN** a remote domain-A text is first-delivered and A, B, or C wins atomic durable insertion
- **THEN** A, B, and C SHALL each show the flashing AppButton indicator, D SHALL remain unchanged, and no domain's open state SHALL change

#### Scenario: Expanded delivery remains read

- **GIVEN** tabs A, B, and C are expanded on the same domain
- **WHEN** a remote domain text is first-delivered
- **THEN** the domain SHALL remain read and A, B, and C SHALL remain expanded without an indicator

#### Scenario: Opening one tab opens and reads the domain

- **GIVEN** collapsed tabs A, B, and C show unread indicators for domain A
- **WHEN** the user opens WebChat through tab C
- **THEN** A, B, and C SHALL all become expanded, domain A SHALL be marked read, every indicator SHALL disappear, and every other domain SHALL remain unchanged

#### Scenario: Collapse synchronizes and later delivery marks again

- **GIVEN** tabs A, B, and C are expanded and read on domain A
- **WHEN** the user collapses WebChat through tab A and a later remote domain-A text is first-delivered
- **THEN** A, B, and C SHALL first collapse together and then each show one unread indicator

#### Scenario: Non-delivery paths do not mark unread

- **WHEN** a text is self-authored, applied from history, or a duplicate delivery, or the inbound value is a reaction or system notice
- **THEN** no domain unread attention SHALL be added and no AppButton indicator SHALL appear because of that value

#### Scenario: Notification settings do not gate collapsed unread attention

- **GIVEN** a domain is collapsed and browser notifications are disabled or configured as `Only @self`
- **WHEN** a first-delivered remote text is otherwise ineligible for a browser notification
- **THEN** every collapsed tab of that text's domain SHALL still show the unread indicator and other domains SHALL remain unchanged

#### Scenario: Highlighted tab does not partition unread attention

- **GIVEN** domain A is collapsed and any same-domain or other-domain tab is active or highlighted in the focused browser window
- **WHEN** a remote domain-A text is first-delivered
- **THEN** every domain-A AppButton SHALL show the same shared unread indicator, and browser focus or active/highlighted status SHALL NOT suppress, redirect, or clear it

#### Scenario: Multiple texts retain one count-free indicator

- **GIVEN** a domain is already unread
- **WHEN** another eligible remote text is first-delivered before the domain is read
- **THEN** each collapsed same-domain AppButton SHALL retain one visually unchanged indicator with no number, label, duplicate marker, or layout shift

#### Scenario: Unrelated status updates cannot clobber shared facts

- **GIVEN** one same-domain tab has observed a newer open, position, unread mark, or read clear
- **WHEN** another tab completes delayed hydration or writes another field
- **THEN** each current shared fact SHALL remain authoritative and every same-domain tab SHALL retain the same complete status

#### Scenario: Indicator uses the fixed visual result

- **WHEN** a collapsed tab projects domain unread attention on its AppButton
- **THEN** it SHALL render the top-right orange ping and opaque center with the specified sizes, offsets, opacity, rounding, and 0.1-second presence transition, without text, count, or button resizing
