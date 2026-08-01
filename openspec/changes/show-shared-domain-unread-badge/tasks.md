## 1. Product Authority

- [x] 1.1 Define one shared AppButton status containing position and unread attention per WebChat domain, with independent expanded/collapsed state per physical tab.
- [x] 1.2 Define badge visibility as the local projection `collapsed && domainUnread`, including the expanded-winner case.
- [x] 1.3 Define a user-driven collapsed-to-expanded transition as the domain read action and preserve cross-domain isolation.
- [x] 1.4 Define first-delivered remote text eligibility, self/history/duplicate exclusions, and independence from browser-notification settings.
- [x] 1.5 Freeze the count-free AppButton indicator's placement, orange ping/center styling, and presence transition.
- [x] 1.6 Define left-bottom and right-bottom position coordinates, midpoint anchor conversion, viewport-derived visibility bounds, and resize-only reprojection with no persistence write.
- [x] 1.7 Freeze same-domain position synchronization, field-scoped position/unread writes, and the current continuous hand-control drag behavior.

## 2. Regression Coverage

- [ ] 2.1 Add a deterministic four-tab control: A expanded, B/C collapsed on domain A, D on domain B; one domain-A remote text shows badges only on B/C regardless of the insertion winner.
- [ ] 2.2 Prove expanding C clears B/C together, leaves D unchanged, and a later domain-A remote text marks collapsed same-domain tabs again.
- [ ] 2.3 Cover self-authored text, history application, duplicate delivery, repeated eligible text, disabled notifications, and both notification-type settings.
- [ ] 2.4 Cover delayed hydration and field-scoped shell, position, and unread writes so they cannot overwrite a newer fact in another scope or shared field.
- [ ] 2.5 Cover left-half and right-half projection, exact-midpoint ownership, same-domain synchronization, cross-domain isolation, and different viewport sizes.
- [ ] 2.6 Prove resize performs no shared write, a smaller viewport bounds only the rendered position, and a larger viewport restores projection from the unchanged shared coordinates.
- [ ] 2.7 Prove midpoint crossing retains the rendered center and current animation-frame pointer following, drag bounds, cursor, selection suppression, and mouse-release behavior without snap, rebound, or easing.
- [ ] 2.8 Cover the AppButton indicator's exact visibility, structure, tokens, animation, and count-free layout through the fixed Vitest, happy-dom, Testing Library, and Vitest Browser Mode stack selected by responsibility.

## 3. Minimum Repair

- [ ] 3.1 Keep `AppStatusDomain` as the sole business owner with tab-local shell state and one domain-shared status containing position and unread attention.
- [ ] 3.2 Set domain attention at the first-delivered remote-text boundary without consulting the insertion winner's local expanded state.
- [ ] 3.3 Clear only the current domain on a user-driven collapsed-to-expanded transition and project badge visibility locally without enumerating browser tabs/windows.
- [ ] 3.4 Persist position and unread through field-scoped writes, synchronize them across same-domain tabs, and keep tab-local shell writes outside the shared status.
- [ ] 3.5 Project the shared position from the selected bottom edge, convert anchors continuously at the midpoint, and derive local visibility bounds without writing on resize.
- [ ] 3.6 Reuse the existing hand-control drag interaction, AppButton indicator, and same-domain synchronization boundary without adding a Domain, count, setting, API, permission, dependency, Runtime/protocol change, or browser-specific branch.

## 4. Delivery Gates

- [ ] 4.1 Pass focused regressions, the complete source test suite, typecheck, lint, format, Chrome/Firefox production builds, strict OpenSpec validation, OpenSpec Doctor, diff, identity, and clean-worktree gates on one exact.
- [ ] 4.2 Obtain fresh architecture-first Review of the complete requirement-branch diff and close every finding before publication.
- [ ] 4.3 Publish the reviewed exact through the single requirement branch/PR and require exact-bound CI to pass.
- [ ] 4.4 Keep QA, QC, and UX absent unless the Owner explicitly requests one; record any performed or unavailable browser behavior verification truthfully without making it a source/CI blocker.
- [ ] 4.5 After explicit Owner acceptance, update final OpenSpec/task truth and complete the conditional Ready/merge closeout on the same requirement branch/PR.
