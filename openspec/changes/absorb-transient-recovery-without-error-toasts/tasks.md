## 1. Product Contract

- [x] 1.1 Define current structural facts as the sole lifecycle authority and keep all connection owner, retry, iterator, attempt-handle, error-delivery, and cleanup state in the live generation.
- [x] 1.2 Define normal MV3 Background wake, Firefox persistent Runtime, physical Runtime replacement, and full extension reload as distinct lifecycle boundaries.
- [x] 1.3 Define exact page readiness plus Chat and World attempt ownership, including cleanup of only an attempt-created uncommitted Room handle.
- [x] 1.4 Define one World iterator, revision supersession, per-target single call, and an exact live release continuation as valid World demand after the last page detaches.
- [x] 1.5 Define ordered live domain and host release, local send acceptance, target failure without retry, and History no-result behavior.
- [x] 1.6 Define a fresh original-message toast for every distinct real local failure, same-event transport deduplication, diagnostic-only unroutable failures, and quiet cancellation or remote no-result outcomes.

## 2. Implementation

- [ ] 2.1 Keep raw transport available before business bootstrap and reconstruct only minimum Background memory from current event, tabs, and physical Runtime facts.
- [ ] 2.2 Separate normal MV3 Background wake from physical Runtime replacement and full extension reload, including bounded old-document polling and lifecycle cancellation.
- [ ] 2.3 Make page readiness exact and keep Chat and World recovery generation-scoped with only an optional attempt-created Room handle.
- [ ] 2.4 Route every Presence revision through one World iterator, preserve continuation on revision supersession, and let last-page release complete through its live release continuation.
- [ ] 2.5 Advance domain and host release through one live in-memory next step without durable lifecycle state or retrying an already called target for the same revision.
- [ ] 2.6 Enforce preflight-before-send, one call per target, local acceptance on return, no retry on throw, and History no-result settlement.
- [ ] 2.7 Give every distinct real local failure a fresh original-message toast on each current affected page, with same-event transport deduplication and diagnostic-only delivery failure.
- [ ] 2.8 Add focused regressions for every requirement and failure boundary without test-only production branches or behavior outside the current contract.

## 3. Verification and Delivery

- [ ] 3.1 Freeze one clean implementation exact as the sole child of this PM authority and pass focused/full Vitest, TypeScript, format, lint, strict OpenSpec/status/doctor, React Doctor, dual production-build, scope, identity, and current-only gates required by the repository.
- [ ] 3.2 Obtain a fresh architecture-first Inspector verdict on the same exact, covering the complete owner graph, browser lifecycle split, release continuation, error semantics, and protected boundaries; use a `fix`-type commit for the user-visible repair.
- [ ] 3.3 Publish the reviewed exact through this requirement's existing branch and Draft PR, collect fresh CI, release the branch from every agent worktree, and hand the directly checkout-able branch plus immutable exact to `@molvqingtai` for desktop product acceptance.
- [ ] 3.4 After Owner acceptance, let PM immediately close final OpenSpec and task truth; then complete final identity and CI gates and only the merge authorized by that acceptance.
