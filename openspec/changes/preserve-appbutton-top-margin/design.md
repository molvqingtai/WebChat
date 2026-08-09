## Context

`AppStatusDomain` owns one shared edge-relative AppButton position per domain. Each tab projects that position through the single local geometry owner, and the same bounds govern active drag capture. The collapsed vertical bound currently allows the `44px` launcher to reach the viewport top with no gap, while horizontal and bottom placement retain fixed margins.

See `proposal.md` for the product motivation and `specs/webrtc-runtime/spec.md` for the observable contract.

## Goals / Non-Goals

**Goals:**

- Keep the collapsed AppButton's outer top edge at least `60px` below the viewport top whenever the viewport can satisfy the fixed launcher margins.
- Use the existing geometry owner for drag capture and local projection, with no second position or corrective transform.
- Preserve shared edge-relative coordinates and the rule that automatic local projection never writes shared state.
- Preserve the existing expanded-shell safety bound and every unrelated placement and drag behavior.
- Retain a fully visible local fallback in viewports too small for every fixed margin.

**Non-Goals:**

- Changing the `44px` launcher size, `50px` horizontal-center margins, `22px` bottom-edge margin, `40px` expanded-shell top inset, shell size, or launcher-to-shell relationship.
- Changing the initial AppButton position, midpoint selection, horizontal anchor conversion, pointer cadence, cursor, selection suppression, release behavior, snap, rebound, easing, or cross-edge animation.
- Adding a position field, Domain, component owner, persisted correction, viewport listener, setting, control, copy, dependency, permission, or browser-specific branch.

## Decisions

### 1. The top margin is measured from the launcher outer edge

The required `60px` gap is the distance from the viewport top to the `44px` launcher's outer top edge, not its center. In a viewport that can also retain the existing `22px` bottom-edge margin, the collapsed launcher's bottom-edge coordinate therefore cannot be less than `104px` from the viewport top.

This bound belongs in the existing viewport-derived geometry calculation. Drag capture and local projection consume the same result, so no component transform, second clamp, or persisted correction is introduced.

### 2. The expanded shell keeps its stricter safety bound

When WebChat is expanded, the existing shell-safe projection continues to keep the shell top at least `40px` below the viewport top while retaining its current minimum size and launcher relationship. The effective vertical bound is whichever current constraint places the launcher farther from the top. The new launcher margin neither replaces nor weakens the expanded-shell contract.

The left, right, and bottom bounds remain unchanged in collapsed and expanded states.

### 3. Small viewports keep the current local fallback

A viewport at least `126px` high can contain the `60px` top gap, `44px` launcher, and existing `22px` bottom gap together. If a viewport can contain the launcher but cannot satisfy every fixed margin, only that tab uses the nearest fully visible point with the largest feasible local margin. A smaller viewport keeps its existing nearest projection.

Automatic projection during hydration, same-domain synchronization, or resize does not mutate or persist the shared coordinate. A later compatible viewport restores the full `60px` top and existing bottom margins from that unchanged coordinate unless a user drag has written a new bounded position.

### 4. Verification stays at the existing geometry boundary

Focused controls cover collapsed upward drag at both horizontal anchors, capture and projection of a top-unsafe shared point, resize without a shared write, the small-viewport fallback, and the unchanged expanded-shell bound. Existing controls continue to own midpoint crossing and all other geometry.

Production changes remain in the current geometry owner. No UI component, Domain, persistence, protocol, or compatibility path is added for a derived bound.

## Risks / Trade-offs

- [A saved position can be closer than `60px` to the top in another viewport] -> Every tab projects through the same local top bound without rewriting the shared coordinate.
- [A short viewport cannot satisfy both fixed vertical margins] -> Keep the launcher fully visible with the largest feasible local margin and restore the fixed result in a later compatible viewport.
- [The expanded shell already has a different top inset] -> Retain the stricter effective geometry bound; the launcher margin does not replace shell safety.
- [A narrow visual fix could create another position owner] -> Change only the existing geometry bound and its focused controls.

## Open Questions

None. The Owner confirmed the `60px` top margin and authorized OpenSpec work on 2026-08-09.
