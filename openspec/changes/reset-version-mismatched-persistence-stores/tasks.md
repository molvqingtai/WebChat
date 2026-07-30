## 1. Persistence Authority

- [x] 1.1 Move configurable `MESSAGE_STORE_VERSION = 2` into `src/constants/storage.ts` without advancing it for the initial reset lifecycle and without renaming any public persistence API.
- [x] 1.2 Add configurable `CONFIG_STORE_VERSION = 1` and private `CONFIG_STORE_VERSION_KEY` in `src/constants/storage.ts`, with scoped completion records for the extension-wide sync configuration scope and each origin-local WebChat configuration scope.
- [x] 1.3 Keep extension/package/wire versions, deprecated `WEB_CHAT_VERSION`/`VERSION_STORAGE_KEY`, and deprecated unstorage message data outside both decisions.
- [ ] 1.4 Move `STORAGE_NAME`, `APP_STATUS_STORAGE_KEY`, and `USER_INFO_STORAGE_KEY` from generic `config.ts` into `src/constants/storage.ts`; define `MESSAGE_STORE_NAME` there with exact value `${STORAGE_NAME}:MESSAGES` so all persistence identities, keys, and versions have one constants owner.
- [ ] 1.5 Remove the retired canonical identity from production persistence logic entirely: no name construction, lookup, branch, open/read, migration/conversion/export/copy, clear/delete, error/retry, readiness, or completion path; encode no origin suffix in the target name.

## 2. Message Store Reset

- [x] 2.1 Add a private canonical database preparation lifecycle that distinguishes absent, same-version, and any existing non-equal native version before exposing the Database-backed MessageStore.
- [x] 2.2 On a non-equal native version, delete the whole active canonical database and recreate its configured target identity empty at `MESSAGE_STORE_VERSION`; do not migrate or clear known stores in place.
- [x] 2.3 Serialize same-origin contenders, handle native `blocked`/`error`/interruption without a second or late-unowned delete, and prevent target-generation writers until recreation is ready.
- [ ] 2.4 Switch the active canonical definition and serialized preparation lifecycle to only `MESSAGE_STORE_NAME`; leave every retired database untouched and evaluate only target absence, same native version, or target native-version mismatch.

## 3. Configuration Store Reset

- [x] 3.1 Establish missing completion values without clearing pre-version data and preserve all configuration on strict target equality.
- [x] 3.2 Clear the complete current-origin `${STORAGE_NAME}:` local namespace or extension-wide `browser.storage.sync` scope on any existing non-equal completion value, then record target completion before ordinary writes.
- [x] 3.3 Eagerly await the extension-wide check from `runtime.onInstalled`; recheck it from startup as an interruption fallback and lazily gate each origin-local scope during content injection.
- [x] 3.4 Serialize concurrent checks per physical scope so already-current data is never cleared twice and a successful scope is not repeated because another scope failed.

## 4. Startup And Diagnostics

- [x] 4.1 Gate Remesh store construction, default-state writes, persistence reads/watches, history access, and UI mount until the current page's required message and configuration scopes are ready.
- [x] 4.2 On read/delete/clear/recreation/completion failure, keep completion unadvanced, stop that startup lifecycle, and emit only bounded privacy-safe console diagnostics.
- [x] 4.3 Prove no Toast, `AppFeedback`, alert, DOM/status error, notification, SystemNotice, migration control, close-tabs warning, or success copy is added; preserve only ordinary empty-history/default/setup outcomes.

## 5. Regression Matrix

- [x] 5.1 Add deterministic message-store coverage for absence baseline, same-version preservation, adjacent/skipped/reverse mismatch, complete residue deletion, blocked/error paths, pre/post-delete interruption, retry, recreation, and concurrent no-double-reset behavior.
- [x] 5.2 Add deterministic configuration coverage for missing-marker baseline with existing data, same-version preservation, adjacent/skipped/reverse/malformed mismatch, extension-sync and multi-origin local scopes, failure/retry, interruption, and concurrency.
- [x] 5.3 Add cross-family and isolation sentinels proving message/config independence, other-origin laziness, host localStorage namespace isolation, unrelated IndexedDB/browser-area preservation, and deprecated unstorage message-data preservation.
- [x] 5.4 Add static/startup guards rejecting package-version ownership, old marker/clear paths, public API widening, user-visible migration feedback, and application access before preparation.
- [ ] 5.5 Add deterministic exact-target-name/no-origin-suffix regressions for target absence, same version, mismatch, same-origin contenders, and separate origins sharing the name; add a static no-retired-identity-production-path guard, but no retired-database delete/no-op/failure/retry lifecycle tests.

## 6. Delivery Gates

- [x] 6.1 Run the initial reset lifecycle's focused fail-before controls and complete repository source, type, lint, format, build, and strict OpenSpec gates on one immutable implementation exact.
- [ ] 6.2 Obtain fresh Reviewer findings on the complete two-family contract, concurrency, failure, isolation, and regression matrix.
- [ ] 6.3 Record nonblocking Chrome MV3 and Firefox MV2 baseline/mismatch/console-only behavior truth where the established environments can create the required persisted states; do not convert unavailable evidence into PASS.
- [ ] 6.4 Keep implementation on the same requirement branch and PR, and wait for separate explicit Owner authorization before merge.
- [ ] 6.5 Re-run focused fail-before, complete static/source/build, Review, and nonblocking browser gates on the replacement exact after the untouched identity switch and constants centralization; prior exact evidence does not transfer.
