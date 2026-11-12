## Why

WebChat has two independent persistence-generation authorities: the canonical message database and the version-managed configuration scopes. The canonical database uses direct `STORAGE_NAME`, with IndexedDB providing native origin isolation. The configuration authority governs extension-wide sync data and version-managed values in each origin-local WebChat namespace. `AppStatusDomain` separately persists one aggregate business truth through three preserved field keys for open, position, and boolean unread attention. Only an active target's own persisted-version mismatch authorizes a destructive reset.

The extension/package version is only a release identifier. It must never substitute for either persistence version or erase data on an ordinary update.

## What Changes

- **BREAKING (local data)**: Use direct `STORAGE_NAME`, whose exact current value is `WEB_CHAT_STORAGE`, as the active per-origin database identity. IndexedDB's separate API namespace and origin partition prevent collision with the `${STORAGE_NAME}:` localStorage prefix. Every non-target database remains outside the lifecycle. An absent target is created empty, while an already-existing same-version target is preserved byte-for-byte.
- Define symmetric private authorities `MESSAGE_STORE_VERSION` and `CONFIG_STORE_VERSION`. An existing target-name message database whose native version is not equal to `MESSAGE_STORE_VERSION` is deleted in full and rebuilt empty at the target version; the identity-only replacement does not advance `MESSAGE_STORE_VERSION = 2`.
- **BREAKING (configuration data)**: An existing configuration scope whose persisted completion value is not equal to `CONFIG_STORE_VERSION` clears its version-managed values and records the target version. The current scopes are the per-origin WebChat `localStorage` namespace, excluding the three AppStatus field keys, and the extension-wide `browser.storage.sync` area used by `UserInfo`.
- Keep all persistence identities, keys, and versions together in `src/constants/storage.ts`: `STORAGE_NAME`, `MESSAGE_STORE_VERSION`, `APP_OPEN_STORAGE_KEY`, `APP_POSITION_STORAGE_KEY`, `APP_UNREAD_STORAGE_KEY`, `USER_INFO_STORAGE_KEY`, `CONFIG_STORE_VERSION`, and `CONFIG_STORE_VERSION_KEY`. Persistence owners import them instead of declaring storage constants in `config.ts` or implementation modules.
- Establish a non-destructive baseline whenever the target message database is absent or a configuration version marker does not exist. Preserve target-name data on a same-version reopen and apply one direct reset for adjacent, skipped, or reverse target-version mismatches. Versions are compared for strict equality and are not ordered migration steps; non-target database state does not participate.
- Use `runtime.onInstalled` as an eager opportunity for extension-scoped configuration cleanup and content injection as the required current-origin gate and interrupted-work fallback. Ordinary app/package/wire updates do nothing when both active persistence versions remain unchanged.
- Serialize concurrent attempts per physical store identity. A reset becomes ready only after deletion or clearing and target reconstruction complete; interruption, blocked deletion, or failure cannot publish readiness, advance the completion state, or permit a later duplicate reset to erase new-generation writes.
- Keep successful resets and native blocked states free of reset-specific UI. A terminal preparation failure owned by a current page request that prevents that page's initialization or persistence readiness uses the existing application error route and passes exactly the original `error.message` to `toast.error`. Install-time work with no current page, work with no current user impact, and blocked diagnostics remain direct bounded console diagnostics. The existing privacy-safe Error construction boundary remains unchanged, and routing adds no persisted value, user content, or origin detail. Every failure keeps the affected WebChat startup closed and retries on a later lifecycle; no route adds `AppFeedback`, alert, status page, migration control, decorated copy, or another user-visible surface.
- Keep every non-target database outside every active lifecycle: it remains untouched and provides no data, readiness, failure, or cleanup signal. Keep host-page storage outside the WebChat namespace, unrelated IndexedDB databases, other origins not currently injected, and browser storage areas outside the configuration-store ownership untouched.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `webrtc-runtime`: Replace record-preserving message schema upgrades with destructive version mismatch resets, add the independent configuration-store version boundary, and define both families' identity, baseline, trigger, lifecycle, isolation, concurrency, failure, and regression behavior.

## Impact

- Affected implementation after authority approval: private IndexedDB message-database opening, configuration storage adapters and version markers, background `runtime.onInstalled`, and content-injection startup ordering.
- Affected tests after authority approval: exact direct `STORAGE_NAME` target, first install, target same version, adjacent/skipped/reverse target mismatch, absence of any non-target identity production path, two-family independence, cross-tab concurrency, blocked/error/interruption recovery, cross-origin isolation, current-page unchanged-message routing versus no-page/no-impact direct console diagnostics, and absence of app-version ownership.
- Unchanged surfaces: every non-target database; public `Database`, `MessageStore`, and `Storage` interfaces; Chat/World and peer wire; Runtime lifecycle ownership; Memory database semantics; and dependencies.
