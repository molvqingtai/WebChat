## 1. Product Authority

- [x] 1.1 Define exact WebChat-domain matching between the clicked notification and currently open tabs.
- [x] 1.2 Define focused-window priority and greatest-index selection as the last, rightmost matching tab.
- [x] 1.3 Define the other-window fallback as the matching tab with the greatest API-provided `Tab.lastAccessed` value, followed by focusing its window.
- [x] 1.4 Define no-match and invalid-context clicks as no-ops that create no tab and perform no navigation.
- [x] 1.5 Exclude every custom timestamp, persisted order, `tabs.onCreated` ledger, ordering cache, and additional state owner.

## 2. Regression Coverage

- [ ] 2.1 Add a deterministic focused-window control with several same-domain tabs and require the greatest current tab index to win.
- [ ] 2.2 Prove focused-window priority over a more recently accessed matching tab in another window.
- [ ] 2.3 Prove the focused-window-absent-match and no-focused-window fallbacks choose the greatest API-provided `Tab.lastAccessed` value and focus its containing window.
- [ ] 2.4 Cover exact same-domain matching, different domains, invalid and missing tab URLs, missing notification context, and non-WebChat tabs.
- [ ] 2.5 Prove no-match and invalid-context clicks create no tab and perform no navigation, reload, close, reorder, or unrelated tab/window mutation.
- [ ] 2.6 Preserve existing notification eligibility, creation, content, settings, exactly-once result, closure cleanup, and request-local creation failure controls.
- [ ] 2.7 Add a structural control excluding custom timestamps, persistence keys, `tabs.onCreated` ordering, subscriptions, ledgers, caches, and additional ordering owners.

## 3. Minimum Repair

- [ ] 3.1 Keep the existing Notification service as the sole browser-notification click and tab/window side-effect owner.
- [ ] 3.2 Resolve the clicked notification's existing WebChat domain context and one fresh inventory of current tabs/windows without retaining the originating tab ID as the selection authority.
- [ ] 3.3 Select the focused window's greatest-index match first; only when absent, select the other-window greatest-`Tab.lastAccessed` match.
- [ ] 3.4 Activate the selected tab and focus its window when required, while deleting every notification-click tab-creation fallback.
- [ ] 3.5 Use only browser-provided tab index, focus, domain, and `lastAccessed` facts without adding a Domain, Extern, event, state, timestamp, persistence, ledger, subscription, cache, permission, dependency, or browser-specific policy.
- [ ] 3.6 Add deterministic regressions for every scenario in the delta specification at the existing Notification service/provider boundary.

## 4. Delivery Gates

- [ ] 4.1 Pass focused regressions, the complete source test suite, typecheck, lint, format, Chrome/Firefox production builds, strict OpenSpec validation, OpenSpec Doctor, diff, identity, and clean-worktree gates on one exact.
- [ ] 4.2 Obtain fresh architecture-first Review of the complete requirement-branch diff and close every finding before publication.
- [ ] 4.3 Publish the reviewed exact through the single requirement branch/PR and require exact-bound CI to pass.
- [ ] 4.4 Keep QA, QC, and UX absent unless the Owner explicitly requests one; record any performed or unavailable browser behavior verification truthfully without making it a source/CI blocker.
- [ ] 4.5 After explicit Owner acceptance, update final OpenSpec/task truth and complete the conditional Ready/merge closeout on the same requirement branch/PR.
