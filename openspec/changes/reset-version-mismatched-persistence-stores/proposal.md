## Why

WebChat has two independent persistent-data families: the canonical message database and the configuration stores used for `AppStatus` and `UserInfo`. Their compatibility boundaries must be explicit and independent. The released message-database contract currently preserves records across a schema-version change, while configuration data has no equivalent version boundary. Both behaviors contradict the Owner's original rule: once an existing store's own persisted version differs from its current target version, every value from that old generation is incompatible and must be deleted rather than migrated.

The extension/package version is only a release identifier. It must never substitute for either persistence version or erase data on an ordinary update.

## What Changes

- **BREAKING (local data)**: Define symmetric private authorities `MESSAGE_STORE_VERSION` and `CONFIG_STORE_VERSION`. An existing canonical message database whose native version is not equal to `MESSAGE_STORE_VERSION` is deleted in full and rebuilt empty at the target version.
- **BREAKING (configuration data)**: An existing configuration scope whose persisted completion value is not equal to `CONFIG_STORE_VERSION` is cleared in full and rebuilt at the target version. The current scopes are the per-origin WebChat `localStorage` namespace used by `AppStatus` and the extension-wide `browser.storage.sync` area used by `UserInfo`.
- Keep the configurable persistence constants out of implementation modules: `MESSAGE_STORE_VERSION`, `CONFIG_STORE_VERSION`, and `CONFIG_STORE_VERSION_KEY` live in the storage-specific constants module under `src/constants/` and are imported by their owners.
- Establish a non-destructive baseline when a database or version marker does not exist, preserve all data on a same-version reopen, and apply one direct reset for adjacent, skipped, or reverse version mismatches. Versions are compared for strict equality and are not ordered migration steps.
- Use `runtime.onInstalled` as an eager opportunity for extension-scoped configuration cleanup and content injection as the required current-origin gate and interrupted-work fallback. Ordinary app/package/wire updates do nothing when both persistence versions remain unchanged.
- Serialize concurrent attempts per physical store identity. A reset becomes ready only after deletion or clearing and target reconstruction complete; interruption, blocked deletion, or failure cannot publish readiness, advance the completion state, or permit a later duplicate reset to erase new-generation writes.
- Keep successful resets silent. Failure or blocked work may write only bounded `console` diagnostics: no Toast, `AppFeedback`, alert, status page, migration control, or other user-visible error is allowed. The affected WebChat startup remains closed and retries on a later lifecycle.
- Keep deprecated unstorage message data unread, unconverted, and uncleared. Keep host-page storage outside the WebChat namespace, unrelated IndexedDB databases, other origins not currently injected, and browser storage areas outside the configuration-store ownership untouched.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `webrtc-runtime`: Replace record-preserving message schema upgrades with destructive version mismatch resets, add the independent configuration-store version boundary, and define both families' identity, baseline, trigger, lifecycle, isolation, concurrency, failure, and regression behavior.

## Impact

- Affected implementation after authority approval: private IndexedDB message-database opening, configuration storage adapters and version markers, background `runtime.onInstalled`, and content-injection startup ordering.
- Affected tests after authority approval: first install, same version, adjacent/skipped/reverse mismatch, two-family independence, cross-tab concurrency, blocked/error/interruption recovery, isolation, console-only failure, and absence of app-version ownership.
- Unchanged surfaces: public `Database`, `MessageStore`, and `Storage` interfaces; Chat/World and peer wire; Runtime lifecycle ownership; Memory database semantics; dependencies; and deprecated unstorage message data.
