> **Completion status (2026-07-30):** The Owner explicitly accepted PR #81 at implementation exact `7d86309636ccef56ec4d9cb495114b3ce907aef3` and authorized merge after this documentation and task closeout. Exact CI run `30551473319` passed setup/linter/tests/build 4/4, and fresh Review task #416 passed P0/P1/P2 `0/0/0`. Browser evidence remains exact-bound: Chrome MV3 passed only on superseded exact `f44f25015a38d4ef65d94a8b768d9e620d8f3463`; a final-exact browser rerun, a real no-Web-Locks environment, and Firefox MV2 remain `UNVERIFIED` and nonblocking. A checked item means implemented, freshly gated, truthfully recorded, or explicitly closed by Owner acceptance; it does not reinterpret any `UNVERIFIED` result as PASS.

## 1. Persistence Authority

- [x] 1.1 Move configurable `MESSAGE_STORE_VERSION = 2` into `src/constants/storage.ts` without advancing it for the initial reset lifecycle and without renaming any public persistence API.
- [x] 1.2 Add configurable `CONFIG_STORE_VERSION = 1` and private `CONFIG_STORE_VERSION_KEY` in `src/constants/storage.ts`, with scoped completion records for the extension-wide sync configuration scope and each origin-local WebChat configuration scope.
- [x] 1.3 Keep extension/package/wire versions outside both persistence decisions.
- [x] 1.4 Keep `STORAGE_NAME`, `APP_STATUS_STORAGE_KEY`, and `USER_INFO_STORAGE_KEY` in `src/constants/storage.ts`; use exact direct `STORAGE_NAME` as the canonical IndexedDB name, while `${STORAGE_NAME}:` remains the separate localStorage configuration prefix.
- [x] 1.5 Keep every non-target identity outside production persistence logic: no constant/construction, lookup, branch, open/read, migration/conversion/export/copy, clear/delete, error/retry, readiness, or completion path; encode no message or origin suffix in the target name.

## 2. Message Store Reset

- [x] 2.1 Add a private canonical database preparation lifecycle that distinguishes absent, same-version, and any existing non-equal native version before exposing the Database-backed MessageStore.
- [x] 2.2 On a non-equal native version, delete the whole active canonical database and recreate its configured target identity empty at `MESSAGE_STORE_VERSION`; do not migrate or clear known stores in place.
- [x] 2.3 Serialize same-origin contenders, handle native `blocked`/`error`/interruption without a second or late-unowned delete, and prevent target-generation writers until recreation is ready.
- [x] 2.4 Switch the active canonical definition and serialized preparation lifecycle to direct `STORAGE_NAME`; leave every non-target database untouched and evaluate only target absence, same native version, or target native-version mismatch.

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
- [x] 5.3 Update cross-family and isolation sentinels proving message/config independence, other-origin laziness, host localStorage namespace isolation, generated non-target IndexedDB preservation, and browser-area preservation.
- [x] 5.4 Add static/startup guards rejecting package-version ownership, broad startup clearing, public API widening, user-visible migration feedback, and application access before preparation.
- [x] 5.5 Update deterministic exact-target-name regressions to direct `STORAGE_NAME` with no message/origin suffix for target absence, same version, mismatch, same-origin contenders, and separate origins sharing the name; use one generated unrelated database to prove the non-target boundary without enumerating alternate identities.

## 6. Delivery Gates

- [x] 6.1 Run the initial reset lifecycle's focused fail-before controls and complete repository source, type, lint, format, build, and strict OpenSpec gates on one immutable implementation exact.
- [x] 6.2 Obtain fresh Reviewer findings on the complete two-family contract, concurrency, failure, isolation, and regression matrix.
- [x] 6.3 Record nonblocking Chrome MV3 and Firefox MV2 baseline/mismatch/console-only behavior truth where the established environments can create the required persisted states; do not convert unavailable evidence into PASS.
- [x] 6.4 Keep implementation on the same requirement branch and PR, and wait for separate explicit Owner authorization before merge.
- [x] 6.5 Re-run focused, complete static/source/build, and Review gates on the replacement exact after the direct `STORAGE_NAME` identity switch and history-specific test cleanup; prior exact evidence does not transfer.
