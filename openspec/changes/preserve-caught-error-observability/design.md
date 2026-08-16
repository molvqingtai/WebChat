## Context

The audited source identity is `develop@a5e32cc6e3592e6f10d2ea3f00e4532e8c1b251e`; current `master@a1a90ee29f7ab3e6075c31e87587bcfb0a6dbb6c` contains the same audited `src` and `e2e` bytes. Structural search found 36 executable empty or no-op error handlers. Seven additional empty catches occur only inside static architecture HTML and are not executable extension or test code, so they are outside this repair.

Existing authority already separates lifecycle from presentation. `absorb-transient-recovery-without-error-toasts` requires every genuine current local failure to retain its original message and makes unroutable failures diagnostic. `reset-appbutton-domain-connection-state` makes the manual AppButton World child UI/Toast-silent. This change closes the remaining caught-error ownership gaps without weakening either rule.

## Goals / Non-Goals

**Goals:**

- Give every genuine caught failure exactly one surviving owner and preserve its original `Error`.
- Keep attempt-all, listener isolation, cleanup continuation, serialized tails, and fire-and-forget observation without duplicate Toasts or unhandled rejections.
- Route a failure through the existing Runtime/application error boundary only when it affects the current user's operation, connection/readiness, visible state, or persistence result; otherwise allow its exact owner to call `console.error(error)` directly.
- Make every benign cleanup exclusion structural, narrow, and reviewable.
- Make unit and E2E evidence fail when an unexpected rejection or cleanup failure is hidden.

**Non-Goals:**

- Toasting cancellation, supersession, normal leave, stale completion, hostile input, remote non-delivery, no response, peer departure, or absent/expired History.
- Giving manual AppButton World work loading, completion, error, Toast, or result ownership.
- Making Toast, UI, or Remesh application Domains dependencies of Transport, Database, PagePort, storage preparation, or browser-port adapters.
- Redesigning recovery, retry cadence, Room delivery, History pagination, database schemas, public externs, protocols, or wire data.
- Adding a generic error metadata bag, compatibility alias, custom source parser/linter, dependency, or repository tool.

## Decisions

### 1. Freeze the complete 36-site classification

The implementation must account for every audited executable handler. A site may move or be rewritten, but its classified behavior and evidence cannot disappear from the cumulative diff.

| Class                                       | Count | Audited sites                                                                                                                                                                                                                                                           | Required result                                                                                                                                                                                                                     |
| ------------------------------------------- | ----: | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Direct genuine source loss                  |     6 | `ArticoRoomTransport` peer close (2), `PagePort` provider cancellation, `Coordinator` per-tab reconciliation, Memory watcher, IndexedDB watcher                                                                                                                         | Keep the original Error through the appropriate current-user route or direct `console.error(error)` diagnostic; continue independent work only where its existing contract is attempt-all/listener-isolated.                        |
| Broad cleanup candidates                    |     2 | IndexedDB transaction abort, `PresenceStorePort` disconnect                                                                                                                                                                                                             | Ignore only an exact proved already-settled/already-disconnected condition; every other throw calls `console.error(error)` or follows a user-impacting route and cannot be justified by a broad comment.                            |
| Explicit validation control                 |     1 | Firefox E2E URL construction                                                                                                                                                                                                                                            | Preserve the existing explicit invalid-input failure without an empty catch; invalid input cannot pass.                                                                                                                             |
| Synchronous E2E cleanup loss                |     2 | Chrome CDP close during timeout cleanup and final close                                                                                                                                                                                                                 | Attach each failure to cleanup evidence, continue bounded teardown, and prevent PASS without replacing an existing primary failure.                                                                                                 |
| Source duplicate-rejection consumers        |    16 | ChatRoom attachment (2), WorldRoom attachment tail, Memory operation tracking, IndexedDB operation/transaction tracking (3), Coordinator persistence/pending/release tracking (3), Server reset/release/join/reconnect tracking (4), PresenceStore serialized tails (2) | Preserve the original returned/emitted rejection as the sole product failure. Express the secondary settlement observer explicitly without a syntactically empty handler, duplicate event, duplicate Toast, or unhandled rejection. |
| Promise failures with no surviving evidence |     3 | Coordinator rebuild attachment, install-time `StoragePreparation`, IndexedDB post-callback transaction settlement                                                                                                                                                       | Add one user-impacting route or direct `console.error(error)` owner; keep attempt-all/installation/primary-error settlement semantics otherwise unchanged.                                                                          |
| Unit-test rejection sinks                   |     5 | ChatRoom test tasks (2), Recovery test tasks (2), Server old-generation join task                                                                                                                                                                                       | Observe and assert the expected rejection identity/message and relevant terminal state; an unrelated rejection must fail the test.                                                                                                  |
| Asynchronous E2E cleanup loss               |     1 | Chrome `Browser.close` rejection                                                                                                                                                                                                                                        | Attach failure evidence and continue the shared-budget teardown exactly like synchronous close failure.                                                                                                                             |

The counts sum to 36. A source repair that only changes syntax, hides a catch behind `.then`, or adds a generic swallow helper does not satisfy this classification.

### 2. One Error, one owner, one routing decision

A caught genuine failure always retains the original `Error`. Its structural owner chooses exactly one of three outcomes:

1. preserve the original caller-visible rejection;
2. when the failure affects the current user's operation, connection/readiness, visible state, or persistence result, publish one closed internal failure event; or
3. when the operation's externally visible result and current user state are unaffected, call `console.error(error)` directly at the owning boundary.

The decision comes only from current ownership, scope, and effect facts. Error message, type, name, code, constructor, or value never decides whether UI is needed. A cross-boundary failure event contains:

- a fresh event identity when it is a distinct failure event;
- the original `error.message`, without replacement by generic text;
- a closed subsystem discriminator;
- a closed operation discriminator; and
- the exact room, domain, page, tab, database/store scope, browser resource, or preparation scope needed to avoid cross-scope delivery.

The existing internal `RuntimeErrorEvent` and current connection/application error flows remain the preferred user-impacting route. Their closed subsystem/operation unions may be extended only for the concrete audited boundaries. A lower layer that lacks an error port may receive the smallest internal composition-owned reporter; it must not import Toast or expose a public/protocol/database compatibility surface. A user-irrelevant failure needs no manufactured event merely to reach that reporter: its exact owner may call `console.error(error)` directly.

An affected current page receives exactly the original `error.message` through the existing Runtime/content boundary and existing `toast.error`. The UI call adds no prefix, suffix, wrapper, subsystem/operation/scope text, mapping, normalization, or replacement copy. Structured fields remain internal routing/diagnostic data. If the failure has no user impact or no current affected page/live route exists, the owner calls `console.error(error)` and does not manufacture a Toast destination. Error-delivery failure also calls `console.error(error)` and does not recursively emit another failure.

The routed UI contract applies to real `Error` values and uses their exact `.message`. Any non-`Error` thrown value may be converted once at the owning boundary only so it becomes an `Error`; that conversion must retain the value's direct string representation and may not substitute a generic product message. Error content never decides retry, readiness, cancellation, settlement, or UI-silent policy.

For the audited boundaries, the user-impact decisions are fixed:

| Boundary                            | User-impacting route                                                                                                                                                | Direct-console route                                                                                                                                                                                                                            |
| ----------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Artico peer retirement/disposal     | An unexpected close failure that blocks, invalidates, or leaves uncertainty in a current Domain or automatic World connection routes to that current affected page. | A failure owned only by manual World, an already non-current owner, or a scope with no current page calls `console.error(error)`.                                                                                                               |
| PagePort History cancellation       | A separate current History operation failure continues through its existing page route.                                                                             | Failure of the cancellation callback after that page is detached calls `console.error(error)` and is never sent to a replacement page.                                                                                                          |
| Coordinator tab work                | Reconciliation or rebuild attachment failure for a still-current page that prevents correct ownership/readiness routes only to that page.                           | A genuine maintenance/cleanup failure after the tab/page is no longer current calls `console.error(error)`; structural tab absence/supersession remains a non-error.                                                                            |
| Runtime host and lease failures     | Host creation and registration retain the provider Error through the current page's existing initialization/readiness Retry route.                                  | A throwing `ClientLease.whenFailure` listener calls `console.error(error)` without replacing the original failure, changing lifecycle, or stopping later listeners.                                                                             |
| Database watchers                   | A failed watcher that owns a current visible or persistence-dependent application projection routes to that page.                                                   | A watcher with no current user-facing owner calls `console.error(error)`; later watchers still run in both backends.                                                                                                                            |
| IndexedDB abort/settlement          | The primary transaction/callback failure retains its existing caller/UI route.                                                                                      | Unexpected abort or secondary settlement failure calls `console.error(error)` without replacing or duplicating the primary failure; an exactly proved already-settled abort is benign.                                                          |
| IndexedDB shared open               | Every returned operation rethrows the original shared-open Error to its caller.                                                                                     | Terminal close consumes an explicit fulfilled/rejected settlement value; it does not broadly catch the shared rejection.                                                                                                                        |
| PresenceStore Port disconnect       | None after the binding and all requests are already terminal.                                                                                                       | An unexpected disconnect throw calls `console.error(error)`; an exactly proved already-disconnected condition is benign.                                                                                                                        |
| Configuration preparation           | A page-requested preparation failure blocks initialization and routes the original `error.message` to that page.                                                    | Install-time failure without a current page calls `console.error(error)`.                                                                                                                                                                       |
| Sixteen secondary Promise observers | The original returned/emitted Promise owner alone decides its existing user route.                                                                                  | The secondary observer produces no additional Toast or console entry for the same Error.                                                                                                                                                        |
| Unit and E2E code                   | No product Toast is created by a test harness.                                                                                                                      | Unit tests assert the expected error; the live DevToolsActivePort poll retries only `ENOENT`/absence and immediately preserves every other read Error, while E2E cleanup attaches ordered evidence rather than relying on console output alone. |

### 3. Structural non-errors remain quiet

Cancellation, supersession, normal leave, stale completion, hostile/untrusted input rejection, remote non-delivery, no response, peer departure, and absent or expired History are outcomes, not product failures. They neither create a Toast nor require a diagnostic failure record unless a separate local operation itself throws while processing them.

An empty/comment-only catch or no-op rejection callback may ignore an exception only when the called operation can fail exclusively with one named idempotent already-terminal condition, or when a preceding structural fact proves that exact condition. Current broad IndexedDB abort and Port disconnect catches do not meet that proof merely because their surrounding owner is terminal. Unexpected exceptions still require a diagnostic.

### 4. Attempt-all continues and retains each failed item

Coordinator tab reconciliation/attachment and database watcher notification must continue independent items after one item throws. The failed tab/listener still produces a record with its exact scope and original message. Attempt-all does not manufacture a parent failure when the existing parent contract settles after all attempts, but it also cannot convert a failed item into success without evidence.

Watcher failure must not roll back a committed write or stop later watchers. Memory and IndexedDB must have the same behavior and ownership decision. A watcher that prevents current visible or persistence-dependent application state from updating uses the current-user error route; a watcher with no current user effect may log directly. A PagePort cancellation callback failure must not leave the pending History supply unsettled or reroute the error to a replacement page; detach continues, the original pending result settles according to its existing contract, and the cleanup failure calls `console.error(error)` at its detached-page owner.

### 5. Primary failure and cleanup failure are independent

When an operation fails and its abort, close, disconnect, cancellation callback, transaction settlement, or teardown also fails, the original operation failure remains the primary rejection/result. A user-irrelevant cleanup failure calls `console.error(error)`; a user-impacting cleanup failure uses its own structured route; an E2E cleanup failure becomes a separate evidence attachment. None replaces, rewrites, or hides the primary failure.

When cleanup is an independently required precondition, visibility alone cannot convert incomplete cleanup into success. Existing stop-before-start, transaction, and zero-residual E2E contracts still decide whether the operation may progress or pass. Best-effort continuation is allowed only where the existing behavior already requires continuing independent work.

### 6. Duplicate-rejection consumers do not double-report

Sixteen source handlers observe a Promise side branch whose original operation is already returned to a caller or emitted through one error owner. These are not 16 new Toast producers. The implementation must make the surviving original owner and the secondary settlement purpose explicit, preserve the original Promise result, and avoid creating a second event for the same rejection.

A named settled queue/tail or a success-and-failure observer that performs real ownership cleanup is acceptable when the original task remains independently observable. Moving the same no-op into `.then`, `void`, a generic swallow helper, or an unasserted callback is not acceptable. Mutation-sensitive tests must fail if the original rejection stops reaching its owner or if the secondary branch creates an unhandled or duplicate failure.

### 7. Manual World remains UI-silent, not evidence-silent

The AppButton manual World child remains outside loading, progress, completion, error, Toast, and manual result projection. A genuine failure produced exclusively by that child calls `console.error(error)` at its exact owner and retains existing automatic recovery behavior; the Runtime/application boundary does not project it to UI. Domain failures from the same click remain independently routable. This decision is structural from the operation owner and never inferred from message/type/code content.

### 8. Storage preparation and E2E cleanup preserve original evidence

Install-time configuration preparation has no guaranteed current page route. Its failure must therefore call `console.error(error)` with the original provider Error instead of logging only a replacement generic message and consuming the listener rejection. A later page-requested preparation failure affects initialization and continues through its existing application boundary with the original `error.message`.

The Chrome E2E close sequence attempts remaining cleanup within the one existing absolute cleanup budget after any synchronous or asynchronous close failure. Each failure records resource identity, phase, and original message. Profile verification treats only a structured `ENOENT` from `access(profilePath)` as proof that removal succeeded; every other I/O Error remains `profile / verify-removed / original-message` cleanup evidence. If product/assertion/setup already failed, that remains primary and cleanup failures are ordered secondary evidence. If behavior passed but cleanup failed, the project fails cleanup. Firefox invalid-URL validation remains an explicit input failure rather than an empty-catch control-flow pattern.

### 9. Tests prove ownership, not just absence of unhandled noise

Focused controls must cover Artico retirement/disposal, PagePort cancellation, both Coordinator attempt-all paths, Memory/IndexedDB watcher parity, IndexedDB abort/settlement, Port disconnect, install preparation, the live profile-verification cleanup composition, primary-plus-cleanup failure, and manual-World diagnostic-only routing. Each verifies original Error/message, structural user impact, subsystem, operation, scope, continuation/settlement, exact Toast count for current-user routes, and direct `console.error(error)` for user-irrelevant routes.

The five original unit-test sinks and the later-equivalent ClientLease timeout sink must retain task handles and assert their exact expected rejection/terminal reason. Recovery's additional no-op `onError(() => {})` listener is outside the 36 catch/rejection-handler count but must also be replaced by captured and asserted errors. A throwing ClientLease failure listener must be isolated without stopping later listeners or changing the original lifecycle. The E2E controls must prove the live DevToolsActivePort polling composition retries only ENOENT/absence and preserves the identity of any other read Error, plus cleanup evidence and primary-result preservation. Existing source search and review must account for all 36 sites; this change adds no parser, linter, fixture-only production branch, or dependency.

## Risks / Trade-offs

- [A blanket conversion creates duplicate Toasts] -> Preserve the original owner for the 16 secondary consumers and test same-event exactly-once delivery with the unmodified `error.message`.
- [Attempt-all starts failing as a whole] -> Keep parent settlement unchanged while recording each failed tab/listener separately.
- [A cleanup diagnostic replaces the useful primary error] -> Keep ordered primary and cleanup-secondary ownership and original messages.
- [A broad terminal comment hides a provider defect] -> Require exact structural proof and route every unexpected throw diagnostically.
- [Manual World failures become visible UI] -> Derive UI silence from the manual World operation owner and call `console.error(error)` directly.
- [Lower layers become coupled to presentation] -> Use current structured reporters only for user-impacting cross-boundary delivery, permit direct `console.error(error)` for user-irrelevant failures, and prohibit Toast imports/calls below the application boundary.
- [Tests pass on the wrong rejection] -> Assert expected reason plus terminal state and make unexpected rejection fail.

## Migration Plan

1. Publish this docs-only authority as one clean sole child of `develop@a5e32cc6e3592e6f10d2ea3f00e4532e8c1b251e` and obtain a fresh exact-bound Inspector PASS.
2. From that reviewed exact, add fail-before controls for the genuine-loss, duplicate-owner, narrow-cleanup, test, and E2E evidence boundaries.
3. Repair all 36 classified sites in one cumulative source child, using existing internal error/application boundaries and the smallest necessary closed reporter extensions.
4. Run focused and full tests, TypeScript, Oxfmt/Oxlint, dual production builds, strict OpenSpec/status/doctor, scope/residue checks, and exact hosted CI; then obtain one fresh cumulative Inspector verdict.
5. Keep the pull request Draft and do not merge, deploy, release, or publish without later explicit authority.

Rollback is source-only: revert the focused error-ownership and test/E2E evidence changes. No data, schema, protocol, public API, migration, or compatibility rollback exists.
