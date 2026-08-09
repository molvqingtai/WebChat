## 1. Freeze The Top-Margin Contract

- [x] 1.1 Define the collapsed AppButton top margin as at least `62px` from the viewport top to the launcher's outer top edge when the viewport can satisfy all fixed launcher margins.
- [x] 1.2 Keep top, bottom, left, and right in one launcher-only viewport boundary mechanism; change only the top value and keep this AppButton calculation independent of shell height.
- [x] 1.3 Retain the existing fully-visible collapsed small-viewport fallback and restore the fixed margin when a later collapsed viewport can satisfy it.
- [x] 1.4 Preserve every horizontal and bottom bound, the complete expanded-shell bound and resulting AppButton position, initial position, cross-edge motion, pointer interaction, and release behavior.

## 2. Change The Existing Geometry Owner

- [x] 2.1 Derive the launcher-only vertical lower bound from the existing `44px` launcher size plus the `62px` outer-edge margin alongside the existing three edge bounds.
- [x] 2.2 Keep the expanded shell's vertical constraint as a separate unchanged layer, including its fallback and resulting AppButton position.
- [x] 2.3 Add no regression case; limit the test diff to mechanical synchronization of an existing expectation directly changed by the collapsed output.
- [x] 2.4 Keep both boundary layers in the existing geometry owner, with no second position owner, persisted correction, component transform, or compatibility path.

## 3. Delivery Gates

- [x] 3.1 Pass the repository's existing required checks and Chrome/Firefox production builds on one exact without adding regression coverage.
- [x] 3.2 Pass strict OpenSpec validation, OpenSpec Doctor and status, diff/scope checks, exact identity, and clean-worktree gates.
- [x] 3.3 Publish the complete requirement through one `fix/appbutton-top-margin` branch and one Draft PR based on `develop`; obtain fresh architecture-first Inspector review and close every finding on that same branch/PR.
- [x] 3.4 Record browser behavior verification truthfully as non-blocking, do not route QA/QC/UX unless the Owner explicitly requests a role, and require Owner acceptance plus final exact identity and CI before Ready/merge.
