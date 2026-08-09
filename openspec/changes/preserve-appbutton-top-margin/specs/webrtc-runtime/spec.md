## ADDED Requirements

### Requirement: AppButton keeps a fixed top margin

When a viewport can satisfy every fixed launcher margin, the AppButton's outer top edge SHALL remain at least `60px` below the viewport top. With the existing `44px` launcher and `22px` bottom-edge margin, a viewport at least `126px` high SHALL satisfy both vertical margins.

The single local AppButton geometry owner SHALL apply this top bound to active drag capture and to projection of the shared edge-relative position. User drag SHALL continue to write the bounded shared position. Hydration, same-domain synchronization, and viewport resize SHALL project locally without mutating or persisting the shared coordinate.

If a viewport can contain the launcher but cannot satisfy every fixed margin, its local projection SHALL keep the launcher fully visible at the nearest point with the largest feasible margin. A smaller viewport SHALL retain its existing nearest projection. A later compatible viewport SHALL restore the fixed margins from the unchanged shared coordinate unless a user drag has written a new bounded position.

When WebChat is expanded, the existing shell-safe vertical bound SHALL remain authoritative whenever it places the launcher farther from the top. The shell SHALL retain its current `40px` top inset, size range, and launcher relationship. The new top margin SHALL NOT weaken or replace that expanded-shell constraint.

The existing left and right horizontal-center margins, bottom-edge margin, initial position, horizontal anchor representation, midpoint crossing, pointer following, cursor, selection suppression, release behavior, cross-edge animation, and absence of snap/rebound/easing SHALL remain unchanged. This requirement SHALL add no UI control, copy, setting, state owner, persistence field, dependency, permission, protocol value, or browser-specific branch.

#### Scenario: Collapsed upward drag stops below the viewport top

- **GIVEN** WebChat is collapsed in a viewport at least `126px` high and the AppButton is on either horizontal side
- **WHEN** the user drags the AppButton upward beyond its top-safe range
- **THEN** the launcher's outer top edge SHALL stop at least `60px` below the viewport top, the bounded shared position SHALL be written, and the existing horizontal, bottom, pointer-following, and release behavior SHALL remain unchanged

#### Scenario: A top-unsafe shared point is bounded locally

- **GIVEN** a shared edge-relative position would place the collapsed AppButton less than `60px` below the top in a compatible local viewport
- **WHEN** that tab hydrates, synchronizes, or reprojects after resize
- **THEN** it SHALL render the launcher at the nearest top-safe point without mutating or persisting the shared position

#### Scenario: A later compatible viewport restores the fixed margin

- **GIVEN** a smaller viewport could not satisfy every fixed launcher margin and used its local fallback without a shared write
- **WHEN** the same shared position is projected in a viewport that can satisfy the fixed margins
- **THEN** the launcher SHALL again retain at least `60px` above its outer top edge and the existing bottom margin

#### Scenario: Expanded shell safety remains stricter

- **GIVEN** WebChat is expanded and its existing shell-safe bound requires the launcher farther from the viewport top than the collapsed top margin
- **WHEN** the AppButton is dragged or locally projected
- **THEN** the shell-safe bound SHALL win, the shell top SHALL retain its current `40px` inset, and no shell size or launcher relationship SHALL change

#### Scenario: Other placement and motion remain unchanged

- **WHEN** the user drags across the viewport midpoint, toward either horizontal edge, or toward the bottom edge
- **THEN** all current horizontal and bottom bounds, anchor conversion, pointer cadence, cursor, selection suppression, release behavior, and cross-edge motion SHALL remain unchanged
