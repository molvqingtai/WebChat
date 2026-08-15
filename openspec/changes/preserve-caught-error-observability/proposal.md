## Why

The current `develop` tree contains 36 executable empty or no-op error handlers: 11 empty/comment-only `catch` clauses and 25 no-op Promise rejection handlers. Some preserve the original rejection through another owner, but others discard real Artico, PagePort, Coordinator, database, storage-preparation, watcher, or E2E cleanup failures. The same syntax therefore hides both valid duplicate-rejection consumption and genuine observability defects.

The product rule is narrower than either "Toast every catch" or "best effort may ignore errors." A genuine current local failure must keep one owner and its original `Error`. A failure that affects the current user's operation, connection/readiness, visible state, or persistence result reaches the existing Runtime/UI error boundary. A failure with no user impact may be retained directly with `console.error(error)`. Cancellation and other structurally expected non-results remain quiet. Attempt-all and cleanup flows may continue, but continuation does not authorize losing the failed item's evidence.

## What Changes

- Classify the complete 36-site executable inventory instead of mechanically converting every handler into a Toast.
- Require every caught genuine failure to keep one explicit owner: propagate the original rejection, route a scoped structured failure across an existing boundary, or directly call `console.error(error)` when structural facts prove that the failure has no user impact.
- Keep Transport, database, PagePort, storage, and other lower layers independent of Toast; the existing Runtime/application composition boundary alone decides whether a current affected page receives `toast.error` or the owning boundary records the original Error with `console.error(error)`.
- When UI projection is allowed, pass the original `error.message` directly to `toast.error` with no prefix, suffix, wrapper, mapping, or replacement copy; structured ownership fields remain internal and never decorate the user-facing text.
- Preserve the existing UI-silent manual AppButton World child, cancellation, supersession, normal leave, stale completion, hostile input, remote non-delivery, and absent/expired History behavior. Genuine manual-World or otherwise user-irrelevant failures still call `console.error(error)` instead of disappearing.
- Permit an ignored cleanup exception only when an exact already-terminal/idempotent condition is proved and named; a broad catch or comment asserting that all exceptions are benign is insufficient.
- Preserve a primary operation failure when cleanup also fails, while recording cleanup failure separately and continuing any contractually required attempt-all or teardown work.
- Replace no-op test rejection sinks with assertions of the expected reason and terminal outcome. Make E2E cleanup failures part of exact-bound evidence without replacing an earlier product/assertion failure.
- Add no Toast dependency to lower layers, no public/protocol/persistence contract, no compatibility path, no dependency, and no custom parser or lint tool.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `webrtc-runtime`: Give every caught genuine Runtime, transport, page-host, persistence, and preparation failure one explicit structured owner and current-scope routing decision without changing non-error lifecycle outcomes.
- `source-quality-tooling`: Make empty catches, rejection consumers, and intentionally rejected test tasks explicitly classifiable and reviewable with existing repository tooling.
- `cross-browser-e2e-runner`: Retain synchronous and asynchronous cleanup failures as ordered evidence while preserving the primary test outcome and zero-residual cleanup contract.

## Impact

- Affected implementation: Artico peer retirement/disposal, PagePort History cancellation, Coordinator persistence/reconciliation/attachment, Memory and IndexedDB watcher/transaction settlement, configuration storage preparation, PresenceStore Port teardown, explicit Promise-owner side branches, and focused unit/E2E controls.
- Affected user behavior: a genuine routable local failure may now pass its original `error.message` unchanged to the existing `toast.error` instead of disappearing; no new UI surface or Toast type is added.
- Affected diagnostics: user-irrelevant, unroutable, manual-World, error-delivery, and cleanup-secondary failures remain non-UI diagnostics and may call `console.error(error)` directly at their exact owner.
- Unchanged: lifecycle decisions from structural state, automatic recovery, AppButton Domain/World ownership, manual World UI silence, canonical messages, protocols, schemas, persistence data, browser manifests, public externs, remote-delivery guarantees, and release/deployment behavior.
