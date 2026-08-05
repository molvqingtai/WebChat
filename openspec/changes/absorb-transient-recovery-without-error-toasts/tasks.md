## 1. Product Contract

- [x] 1.1 Define the enumerated recoverable scenarios (page refresh, successful extension/background handoff, reconnect generation takeover, room teardown races) as producing no user-visible error.
- [x] 1.2 Define operations inside transient windows as carried by recovery to eventual success.
- [x] 1.3 Define the single unrecoverable-failure scenario as one error toast with the original error text verbatim, and the pass-through presentation as retained.
- [x] 1.4 Define recoverability by a valid path to eventual success; classify `Extension context invalidated.` as terminal for the affected old content generation, with no manifest, permission, injection, protocol, or page-refresh change.

## 2. Implementation

- [x] 2.1 Make recovery carry operations through each transient window so none reject into a user-visible failure, without copy normalization, suppression of genuine errors, retry UI, status surfaces, settings, dependency, or protocol changes.
- [x] 2.2 Add focused regressions proving each enumerated transient scenario surfaces no error toast and the operation eventually succeeds.
- [x] 2.3 Add a focused regression proving a genuinely unrecoverable failure surfaces exactly one toast with the original error text.
- [ ] 2.4 Make a proven terminal native endpoint failure stop its owning generation's retry/watchdog/loading cycle and enter the existing error pass-through exactly once, without terminalizing unknown errors by default.
- [ ] 2.5 Add focused regressions proving `Extension context invalidated.` is unchanged in one error toast, the failed generation stops retrying, later loading cannot replace the error, and valid recoverable transients remain silent.

## 3. Verification and Delivery

- [ ] 3.1 Freeze one clean implementation exact as the sole child of this PM authority exact and pass the focused/full Vitest, TypeScript, format, lint, strict OpenSpec/status/doctor, React Doctor, dual production-build, scope, identity, and current-only gates required by the repository.
- [ ] 3.2 Obtain a fresh architecture-first Reviewer verdict on the same exact, including the complete recovery owner graph and every protected boundary; use a `fix`-type commit for the user-visible repair.
- [ ] 3.3 Publish the reviewed exact through one independent requirement branch and Draft PR based on `develop`, collect fresh CI, release the branch from every agent worktree, and hand the directly checkout-able branch plus immutable exact to `@molvqingtai` for desktop product acceptance.
- [ ] 3.4 After Owner acceptance, let PM immediately close final OpenSpec/task truth; then complete final identity and CI gates and only the merge authorized by that acceptance.
