## 1. Product Authority

- [x] 1.1 Define one shared AppButton status containing `open`, position, and unread attention per WebChat domain.
- [x] 1.2 Define every same-domain expand/collapse action as synchronized and badge visibility as the shared projection `!open && unread`.
- [x] 1.3 Define a user-driven open action as the domain read action, collapse as a synchronized domain action, and preserve cross-domain isolation.
- [x] 1.4 Define collapsed first-delivery eligibility, expanded delivery as already read, self/history/duplicate exclusions, and independence from browser focus, active/highlighted tab, and notification settings.
- [x] 1.5 Freeze the count-free AppButton indicator's placement, orange ping/center styling, and presence transition.
- [x] 1.6 Define left-bottom and right-bottom position coordinates, symmetric `50px` horizontal-center / `28px` outer-edge / `22px` bottom-edge minimum margins, midpoint anchor conversion, viewport-derived visibility bounds, and resize-only reprojection with no persistence write.
- [x] 1.7 Freeze whole-status synchronization, field-scoped open/position/unread writes, and the current continuous hand-control drag behavior.

## 2. Regression Coverage

- [x] 2.1 Add a deterministic four-tab control: A/B/C collapsed on domain A and D on domain B; one domain-A remote text shows badges on A/B/C only regardless of the insertion winner.
- [x] 2.2 Prove opening through C expands and clears A/B/C together, expanded delivery remains read, collapsing through A collapses all three, a later text restores all three badges, and D remains unchanged.
- [x] 2.3 Cover self-authored text, history application, duplicate delivery, repeated eligible text, browser focus, active/highlighted tabs, disabled notifications, and both notification-type settings.
- [x] 2.4 Cover delayed hydration and field-scoped open, position, and unread writes so they cannot overwrite another current field or violate `open => !unread`.
- [x] 2.5 Cover left-half and right-half projection, symmetric fixed edge margins at both bottom corners, exact-midpoint ownership, same-domain synchronization, cross-domain isolation, and different viewport sizes.
- [x] 2.6 Prove resize performs no shared write, a smaller viewport bounds only the rendered position, and a larger viewport restores projection from the unchanged shared coordinates.
- [x] 2.7 Prove midpoint crossing retains the rendered center and current animation-frame pointer following, drag bounds, cursor, selection suppression, and mouse-release behavior without snap, rebound, or easing.
- [x] 2.8 Cover the AppButton indicator's exact visibility, structure, tokens, animation, and count-free layout through the fixed Vitest, happy-dom, Testing Library, and Vitest Browser Mode stack selected by responsibility.

## 3. Minimum Repair

- [x] 3.1 Keep `AppStatusDomain` as the sole business owner for one same-domain status containing `open`, position, and unread attention.
- [x] 3.2 Set domain attention at the first-delivered remote-text boundary only while the shared domain is collapsed.
- [x] 3.3 Synchronize expand/collapse across the current domain, clear unread on open, enforce `open => !unread`, and project badge visibility without enumerating browser tabs/windows.
- [x] 3.4 Persist open, position, and boolean unread attention through field-scoped updates within one shared status, with hydration adopting rather than rewriting current field values.
- [x] 3.5 Project the shared position from the selected bottom edge, preserve the symmetric fixed edge margins, convert anchors continuously at the midpoint, and derive local visibility bounds without writing on resize.
- [x] 3.6 Reuse the existing hand-control drag interaction, AppButton indicator, and same-domain synchronization boundary without adding a Domain, count, setting, API, permission, dependency, Runtime/protocol change, or browser-specific branch.

## 4. Delivery Gates

- [ ] 4.1 Pass focused regressions, the complete source test suite, typecheck, lint, format, Chrome/Firefox production builds, strict OpenSpec validation, OpenSpec Doctor, diff, identity, and clean-worktree gates on one exact.
- [ ] 4.2 Obtain fresh architecture-first Review of the complete requirement-branch diff and close every finding before publication.
- [ ] 4.3 Publish the reviewed exact through the single requirement branch/PR and require exact-bound CI to pass.
- [ ] 4.4 Keep QA, QC, and UX absent unless the Owner explicitly requests one; record any performed or unavailable browser behavior verification truthfully without making it a source/CI blocker.
- [ ] 4.5 After explicit Owner acceptance, update final OpenSpec/task truth and complete the conditional Ready/merge closeout on the same requirement branch/PR.
