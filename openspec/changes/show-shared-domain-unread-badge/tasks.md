## 1. Product Authority

- [x] 1.1 Define one shared unread-attention truth per WebChat domain and independent expanded/collapsed state per physical tab.
- [x] 1.2 Define badge visibility as the local projection `collapsed && domainUnread`, including the expanded-winner case.
- [x] 1.3 Define a user-driven collapsed-to-expanded transition as the domain read action and preserve cross-domain isolation.
- [x] 1.4 Define first-delivered remote text eligibility, self/history/duplicate exclusions, and independence from browser-notification settings.
- [x] 1.5 Freeze the count-free AppButton indicator's placement, orange ping/center styling, and presence transition.

## 2. Regression Coverage

- [ ] 2.1 Add a deterministic four-tab control: A expanded, B/C collapsed on domain A, D on domain B; one domain-A remote text shows badges only on B/C regardless of the insertion winner.
- [ ] 2.2 Prove expanding C clears B/C together, leaves D unchanged, and a later domain-A remote text marks collapsed same-domain tabs again.
- [ ] 2.3 Cover self-authored text, history application, duplicate delivery, repeated eligible text, disabled notifications, and both notification-type settings.
- [ ] 2.4 Cover delayed hydration and unrelated shell/position updates so they cannot erase or resurrect a newer domain unread result.
- [ ] 2.5 Cover the AppButton indicator's exact visibility, structure, tokens, animation, and count-free layout through the fixed Vitest, happy-dom, Testing Library, and Vitest Browser Mode stack selected by responsibility.

## 3. Minimum Repair

- [ ] 3.1 Keep `AppStatusDomain` as the sole business owner while giving tab-local shell state and domain-shared unread attention independent update and synchronization semantics.
- [ ] 3.2 Set domain attention at the first-delivered remote-text boundary without consulting the insertion winner's local expanded state.
- [ ] 3.3 Clear only the current domain on a user-driven collapsed-to-expanded transition and project badge visibility locally without enumerating browser tabs/windows.
- [ ] 3.4 Reuse the existing AppButton indicator and origin-local synchronization boundary without adding a Domain, count, setting, API, permission, dependency, Runtime/protocol change, or browser-specific branch.

## 4. Delivery Gates

- [ ] 4.1 Pass focused regressions, the complete source test suite, typecheck, lint, format, Chrome/Firefox production builds, strict OpenSpec validation, OpenSpec Doctor, diff, identity, and clean-worktree gates on one exact.
- [ ] 4.2 Obtain fresh architecture-first Review of the complete requirement-branch diff and close every finding before publication.
- [ ] 4.3 Publish the reviewed exact through the single requirement branch/PR and require exact-bound CI to pass.
- [ ] 4.4 Keep QA, QC, and UX absent unless the Owner explicitly requests one; record any performed or unavailable browser behavior verification truthfully without making it a source/CI blocker.
- [ ] 4.5 After explicit Owner acceptance, update final OpenSpec/task truth and complete the conditional Ready/merge closeout on the same requirement branch/PR.
