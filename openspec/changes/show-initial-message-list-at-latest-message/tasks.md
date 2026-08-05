## 1. Product Contract

- [x] 1.1 Define the first non-empty message-list frame as already end-aligned at the latest canonical message with no visible top-to-bottom scroll or live-follow animation.
- [x] 1.2 Define canonical history readiness plus the actual Radix viewport as the only prerequisites for the first Virtuoso mount.
- [x] 1.3 Define later smooth following only when the user was already at the bottom, with reading position preserved otherwise.
- [x] 1.4 Define empty-history behavior, stable post-mount list identity, viewport resource lifecycle, unchanged UI, and protected data/runtime boundaries.

## 2. Implementation

- [ ] 2.1 Consume `messageListLoadFinished` only at the business composition layer, rendering `null` while loading and the complete records once ready; keep the presentational list UI free of any readiness prop, gate Virtuoso on non-null content plus the non-null callback-ref viewport handle, and add no other readiness or scroll-position fact.
- [ ] 2.2 First-mount Virtuoso with the complete canonical records, non-null `customScrollParent`, and last-item/end-aligned initial location while leaving the existing ScrollArea shell visible and unchanged; a complete history that fits within the actual viewport presents at its natural position with no `alignToBottom`, block-size declaration, or settlement scroll.
- [ ] 2.3 Use the live follow callback's `isAtBottom` input directly: smooth-follow when true and perform no follow action when false.
- [ ] 2.4 Keep the mounted list identity stable across record updates; let only actual viewport resource destruction or replacement re-enter the mount boundary, and let empty history accept its first message through normal append behavior.
- [ ] 2.5 Add focused component and Browser Mode regressions for both readiness gates, first-frame end alignment without initial scrolling, bottom and non-bottom appends, empty and short histories, variable-height/grouped rows, and stable post-mount identity.
- [ ] 2.6 Add structural controls excluding extra initialization/bottom state, positioning effects, timers, animation frames, imperative scroll commands, CSS hiding, observers, runtime height correction loops, data-driven remount keys, new UI, and dependency changes.

## 3. Verification and Delivery

- [ ] 3.1 Freeze one clean implementation exact as the sole child of this PM authority exact and pass the focused/full Vitest, TypeScript, format, lint, strict OpenSpec/status/doctor, React Doctor, dual production-build, scope, identity, and current-only gates required by the repository.
- [ ] 3.2 Obtain a fresh architecture-first Reviewer verdict on the same exact, including the complete mount/scroll owner graph, stable viewport/list identity, native initial positioning, bottom-aware live following, and every protected boundary.
- [ ] 3.3 Publish the reviewed exact through one independent requirement branch and Draft PR based on `develop`, collect fresh CI, release the branch from every agent worktree, and hand the directly checkout-able branch plus immutable exact to `@molvqingtai` for desktop product acceptance.
- [ ] 3.4 Keep QA, QC, and UX absent unless the Owner explicitly requests one; record any performed or unavailable browser behavior verification truthfully without making it a source or CI blocker.
- [ ] 3.5 After Owner acceptance, let PM immediately close final OpenSpec/task truth; then complete final identity and CI gates and only the merge authorized by that acceptance.
