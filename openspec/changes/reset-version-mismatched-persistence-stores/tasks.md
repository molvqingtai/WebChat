## 1. Persistence Authority

- [ ] 1.1 Keep the existing canonical database identity and rename no public persistence API; move configurable `MESSAGE_STORE_VERSION = 2` into `src/constants/storage.ts` without advancing it for this lifecycle change.
- [ ] 1.2 Add configurable `CONFIG_STORE_VERSION = 1` and private `CONFIG_STORE_VERSION_KEY` in `src/constants/storage.ts`, with scoped completion records for the extension-wide sync configuration scope and each origin-local WebChat configuration scope.
- [ ] 1.3 Keep extension/package/wire versions, deprecated `WEB_CHAT_VERSION`/`VERSION_STORAGE_KEY`, and deprecated unstorage message data outside both decisions.

## 2. Message Store Reset

- [ ] 2.1 Add a private canonical database preparation lifecycle that distinguishes absent, same-version, and any existing non-equal native version before exposing the Database-backed MessageStore.
- [ ] 2.2 On non-equal native version, delete the whole exact per-origin canonical database and recreate the same logical identity empty at `MESSAGE_STORE_VERSION`; do not migrate or clear known stores in place.
- [ ] 2.3 Serialize same-origin contenders, handle native `blocked`/`error`/interruption without a second or late-unowned delete, and prevent target-generation writers until recreation is ready.

## 3. Configuration Store Reset

- [ ] 3.1 Establish missing completion values without clearing pre-version data and preserve all configuration on strict target equality.
- [ ] 3.2 Clear the complete current-origin `${STORAGE_NAME}:` local namespace or extension-wide `browser.storage.sync` scope on any existing non-equal completion value, then record target completion before ordinary writes.
- [ ] 3.3 Eagerly await the extension-wide check from `runtime.onInstalled`; recheck it from startup as an interruption fallback and lazily gate each origin-local scope during content injection.
- [ ] 3.4 Serialize concurrent checks per physical scope so already-current data is never cleared twice and a successful scope is not repeated because another scope failed.

## 4. Startup And Diagnostics

- [ ] 4.1 Gate Remesh store construction, default-state writes, persistence reads/watches, history access, and UI mount until the current page's required message and configuration scopes are ready.
- [ ] 4.2 On read/delete/clear/recreation/completion failure, keep completion unadvanced, stop that startup lifecycle, and emit only bounded privacy-safe console diagnostics.
- [ ] 4.3 Prove no Toast, `AppFeedback`, alert, DOM/status error, notification, SystemNotice, migration control, close-tabs warning, or success copy is added; preserve only ordinary empty-history/default/setup outcomes.

## 5. Regression Matrix

- [ ] 5.1 Add deterministic message-store coverage for absence baseline, same-version preservation, adjacent/skipped/reverse mismatch, complete residue deletion, blocked/error paths, pre/post-delete interruption, retry, recreation, and concurrent no-double-reset behavior.
- [ ] 5.2 Add deterministic configuration coverage for missing-marker baseline with existing data, same-version preservation, adjacent/skipped/reverse/malformed mismatch, extension-sync and multi-origin local scopes, failure/retry, interruption, and concurrency.
- [ ] 5.3 Add cross-family and isolation sentinels proving message/config independence, other-origin laziness, host localStorage namespace isolation, unrelated IndexedDB/browser-area preservation, and deprecated unstorage message-data preservation.
- [ ] 5.4 Add static/startup guards rejecting package-version ownership, old marker/clear paths, public API widening, user-visible migration feedback, and application access before preparation.

## 6. Delivery Gates

- [ ] 6.1 Run focused fail-before controls and the complete repository source, type, lint, format, build, and strict OpenSpec gates on one immutable implementation exact.
- [ ] 6.2 Obtain fresh Reviewer findings on the complete two-family contract, concurrency, failure, isolation, and regression matrix.
- [ ] 6.3 Record nonblocking Chrome MV3 and Firefox MV2 baseline/mismatch/console-only behavior truth where the established environments can create the required persisted states; do not convert unavailable evidence into PASS.
- [ ] 6.4 Keep implementation on the same requirement branch and PR, and wait for separate explicit Owner authorization before merge.
