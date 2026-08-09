## Context

`AppStatusDomain` owns one shared edge-relative AppButton position per domain. Each tab projects that position through the single local geometry owner, and the same bounds govern active drag capture. The collapsed vertical bound currently allows the `44px` launcher to reach the viewport top with no gap, while horizontal and bottom placement retain fixed margins.

See `proposal.md` for the product motivation and `specs/webrtc-runtime/spec.md` for the observable contract.

## Goals / Non-Goals

**Goals:**

- Keep the collapsed AppButton's outer top edge at least `62px` below the viewport top whenever the viewport can satisfy the fixed launcher margins.
- Use one launcher-only viewport boundary mechanism for all four AppButton edges. The top value changes; the existing left, right, and bottom values do not.
- Use the existing geometry owner for drag capture and local projection, with no second position or corrective transform.
- Preserve shared edge-relative coordinates and the rule that automatic local projection never writes shared state.
- Preserve the existing expanded-shell safety bound, expanded AppButton position, and every unrelated placement and drag behavior.
- Retain a fully visible collapsed local fallback in viewports too small for every fixed margin.

**Non-Goals:**

- Changing the `44px` launcher size, `50px` horizontal-center margins, `22px` bottom-edge margin, `40px` expanded-shell top inset, shell size, launcher-to-shell relationship, or expanded AppButton position.
- Changing the initial AppButton position, midpoint selection, horizontal anchor conversion, pointer cadence, cursor, selection suppression, release behavior, snap, rebound, easing, or cross-edge animation.
- Adding a position field, Domain, component owner, persisted correction, viewport listener, setting, control, copy, dependency, permission, browser-specific branch, or new regression case.

## Decisions

### 1. The top margin is measured from the launcher outer edge

The required `62px` gap is the distance from the viewport top to the `44px` launcher's outer top edge, not its center. In a viewport that can also retain the existing `22px` bottom-edge margin, the collapsed launcher's bottom-edge coordinate therefore cannot be less than `106px` from the viewport top.

The top value belongs to the same launcher-only viewport boundary calculation as the existing left, right, and bottom values. Every launcher edge is derived from the launcher and viewport; this AppButton calculation does not use shell height. Drag capture and local projection consume the same result, so no component transform, second position owner, or persisted correction is introduced.

### 2. Expanded placement remains unchanged

When WebChat is expanded, the existing shell-safe constraint remains a separate layer after the launcher-only bounds. It continues to keep the shell top at least `40px` below the viewport top while retaining its current size and launcher relationship. This shell constraint, including its fallback, and the resulting AppButton position remain unchanged. It is not part of the AppButton margin calculation, so the new `62px` value is visible only while collapsed.

The left, right, and bottom bounds remain unchanged in collapsed and expanded states.

### 3. Small viewports keep the current local fallback

A collapsed viewport at least `128px` high can contain the `62px` top gap, `44px` launcher, and existing `22px` bottom gap together. If a collapsed viewport can contain the launcher but cannot satisfy every fixed margin, only that tab uses the nearest fully visible point with the largest feasible local margin. A smaller collapsed viewport keeps its existing nearest projection. Expanded fallback behavior remains unchanged.

Automatic projection during hydration, same-domain synchronization, or resize does not mutate or persist the shared coordinate. A later compatible viewport restores the full `62px` top and existing bottom margins from that unchanged coordinate unless a user drag has written a new bounded position.

### 4. Delivery changes production geometry only

Production changes remain in the current geometry owner, where the launcher-only four-edge bounds and the separate expanded-shell constraint are resolved. This requirement adds no regression case; an existing expectation may be synchronized only when the changed collapsed output directly requires it. No UI component, Domain, persistence, protocol, compatibility path, or expanded-state behavior is added.

## Risks / Trade-offs

- [A saved position can be closer than `62px` to the top in another viewport] -> Every collapsed tab projects through the same local top bound without rewriting the shared coordinate.
- [A short viewport cannot satisfy both fixed vertical margins] -> Keep the launcher fully visible with the largest feasible local margin and restore the fixed result in a later compatible viewport.
- [The expanded shell already has a different top inset] -> Keep its existing bound and resulting AppButton position unchanged; only collapsed placement receives the new margin.
- [A narrow visual fix could create another position owner] -> Keep both boundary layers in the existing geometry owner.

## Open Questions

None.
