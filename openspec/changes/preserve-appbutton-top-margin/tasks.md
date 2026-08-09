## 1. Freeze The Top-Margin Contract

- [ ] 1.1 Define the AppButton top margin as at least `60px` from the viewport top to the launcher's outer top edge when the viewport can satisfy all fixed launcher margins.
- [ ] 1.2 Apply the top bound to active drag capture and local projection while preserving shared edge-relative coordinates and zero automatic persistence writes.
- [ ] 1.3 Retain the existing fully-visible small-viewport fallback and restore the fixed margin when a later viewport can satisfy it.
- [ ] 1.4 Preserve every horizontal and bottom bound, expanded-shell safety constraint, initial position, cross-edge motion, pointer interaction, and release behavior.

## 2. Change The Existing Geometry Owner

- [ ] 2.1 Derive the collapsed vertical lower bound from the existing `44px` launcher size plus the `60px` outer-edge margin in the current AppButton geometry module.
- [ ] 2.2 Keep the expanded shell's existing stricter vertical bound and introduce no second clamp, position owner, persisted correction, component transform, or compatibility path.
- [ ] 2.3 Add focused geometry controls for both horizontal anchors, drag capture, shared-position projection, resize, small-viewport fallback, and unchanged expanded-shell placement.
- [ ] 2.4 Keep production and test scope limited to the existing geometry boundary unless a directly required existing assertion needs mechanical synchronization.

## 3. Delivery Gates

- [ ] 3.1 Pass focused geometry regressions, the complete source suite, typecheck, lint, format, and Chrome/Firefox production builds on one exact.
- [ ] 3.2 Pass strict OpenSpec validation, OpenSpec Doctor and status, diff/scope checks, exact identity, and clean-worktree gates.
- [ ] 3.3 Publish the complete requirement through one `fix/appbutton-top-margin` branch and one Draft PR based on `develop`; obtain fresh architecture-first Inspector review and close every finding on that same branch/PR.
- [ ] 3.4 Record browser behavior verification truthfully as non-blocking, do not route QA/QC/UX unless the Owner explicitly requests a role, and require Owner acceptance plus final exact identity and CI before Ready/merge.
