## Context

WebChat currently owns two persistence families with different physical scopes:

1. The canonical message store is one IndexedDB database per page origin. Its released logical name is `${STORAGE_NAME}:EVENTS_V2_CANONICAL_RECORDS:${origin}`, whose embedded `V2` duplicates version language and whose `${origin}` suffix duplicates IndexedDB's native origin isolation. The target stable name is `STORAGE_NAME` itself (currently `WEB_CHAT_STORAGE`), and its private native version remains `MESSAGE_STORE_VERSION = 2`.
2. The configuration store is the existing `Storage` boundary. `LocalStorageImpl` owns the `${STORAGE_NAME}:` namespace in each page origin for `AppStatus`; `BrowserSyncStorageImpl` owns WebChat's extension-wide `browser.storage.sync` area for `UserInfo`.

The first family currently performs an in-place, record-preserving IndexedDB upgrade. The second has no persisted compatibility version. The Owner has restored the original contract: these are independent active generations, each controlled by its own constant, and any active target's persisted version that is not strictly equal to its target makes that scope's values incompatible. Ordinary extension, package, semantic-release, wire, protocol, and non-target-database states do not participate.

The configuration version mechanism is introduced as a non-destructive baseline: a missing completion value records the current target without deleting pre-version configuration data. Message identity replacement is also a clean baseline: production logic stops naming every non-target database and creates the new target empty when absent. It does not inspect or clean up any non-target identity. From then on, every non-equal existing target version resets that active physical store directly to the target. Active-store failures are observable only in the developer console.

## Goals / Non-Goals

**Goals:**

- Centralize every persistence namespace, database identity, business key, marker key, and version authority in `src/constants/storage.ts`.
- Replace the misleading old canonical message identity with version-neutral `STORAGE_NAME`, using the browser's separate IndexedDB/localStorage namespaces, native IndexedDB origin isolation, and no compatibility path.
- Name the two target version authorities symmetrically as `MESSAGE_STORE_VERSION` and `CONFIG_STORE_VERSION`.
- Reset each active persistence scope on strict version inequality in either direction, including skipped versions, without ordered migrations or compatibility reads.
- Preserve existing configuration data when establishing its first marker baseline and preserve target-name message data on every same-version reopen; non-target message data is neither a baseline nor a cleanup target and remains untouched.
- Keep message and configuration decisions independent while preventing application use until every scope required by that page is ready.
- Define exact physical deletion scopes, eager and fallback triggers, concurrency fences, interruption recovery, blocked/error handling, silent success, and console-only failure.
- Bind the policy with deterministic regressions without widening public storage APIs or coupling persistence to the app version.

**Non-Goals:**

- Adding any non-target identity lookup, open, read, migration, conversion, export, copy, clear, delete, retry, or cleanup lifecycle.
- Migrating, exporting, backing up, selectively retaining, restoring, reading, decoding, or converting data from a mismatched active generation.
- Comparing versions by magnitude, supporting an ordered upgrade chain, or preserving a newer stored generation during rollback.
- Clearing data merely because the extension/package/wire/protocol version or `runtime.onInstalled` reason changed.
- Reading, converting, deleting, or marking deprecated unstorage message history.
- Clearing host-page `localStorage` outside the WebChat namespace, another origin eagerly, unrelated IndexedDB databases, or browser storage areas not owned by the current configuration adapters.
- Changing peer wire, Runtime ownership, Chat/World behavior, Memory database semantics, public `Database`/`MessageStore`/`Storage` contracts, dependencies, or UI presentation.
- Advancing either store version merely to land this lifecycle mechanism; a future value change remains an explicit destructive product decision.

## Decisions

### 1. One storage constants module owns every persistence identity and version

The persistence constants SHALL be declared together:

```ts
const STORAGE_NAME = 'WEB_CHAT_STORAGE'
const MESSAGE_STORE_VERSION = 2
const APP_STATUS_STORAGE_KEY = 'WEB_CHAT_APP_STATUS'
const USER_INFO_STORAGE_KEY = 'WEB_CHAT_USER_INFO'
const CONFIG_STORE_VERSION = 1
const CONFIG_STORE_VERSION_KEY = 'WEB_CHAT_CONFIG_STORE_VERSION'
```

`STORAGE_NAME` is the stable WebChat persistence name. It is the exact canonical IndexedDB database name, while `${STORAGE_NAME}:` remains the localStorage configuration-key prefix. IndexedDB and localStorage are separate browser-managed physical namespaces, so these two uses do not collide. `STORAGE_NAME` contains neither a version token nor `${origin}` because the browser already partitions IndexedDB by origin. `MESSAGE_STORE_VERSION` owns only that canonical message database's native schema generation. `APP_STATUS_STORAGE_KEY` owns the per-origin AppStatus value, `USER_INFO_STORAGE_KEY` owns the extension-wide sync UserInfo value, and `CONFIG_STORE_VERSION` owns both configuration scopes through their separate `CONFIG_STORE_VERSION_KEY` completion values.

Both version names use `<domain>_STORE_VERSION`. `USER_STORE_VERSION` is rejected because it would omit `AppStatus`; generic `STORAGE_VERSION` is rejected because it is not symmetric with the specific message-store owner; `APP_VERSION` and `PACKAGE_VERSION` are rejected because they reintroduce release-version coupling. `STORAGE_NAME` is a physical identity/name root, not a version authority, and `CONFIG_STORE_VERSION_KEY` is a marker location, not a third version.

All six constants SHALL live in `src/constants/storage.ts`, not partly in generic `config.ts` and not inside an IndexedDB, storage-adapter, background, or content implementation. Their persistence owners import them from that module. No `MESSAGE_STORE_NAME` alias or composition SHALL exist. This centralizes storage constants without moving unrelated layout, protocol, runtime, or emoji values.

The message database uses its native positive IndexedDB version as the persisted version. Configuration scopes use a private `CONFIG_STORE_VERSION_KEY` completion value. The same target constant governs both current configuration scopes, but each physical scope records completion separately: once for the extension-wide sync area and once in each origin's WebChat local namespace. These completion values record application of the one configuration authority; they are not additional version authorities.

### 2. Absence establishes a baseline; every existing unequal value resets

For every active physical persistence identity, the decision table is:

| Persisted active state                                                | Required action                                                                                   |
| --------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| Target IndexedDB named `STORAGE_NAME` absent                          | Create the target database directly at `MESSAGE_STORE_VERSION`; import no non-target data         |
| Configuration completion value absent                                 | Preserve existing values and write `CONFIG_STORE_VERSION`; perform no clear                       |
| Persisted target value strictly equals its target                     | Open or load unchanged and preserve every owned value                                             |
| Persisted target value exists and is not strictly equal to its target | Delete or clear the entire owned physical scope, rebuild it at the target, then record completion |

The unequal case includes adjacent upgrades, skipped upgrades, rollbacks, future values, and any other non-equal value; configuration markers additionally treat malformed values as mismatches. Versions are generation identifiers, not an ordered migration sequence. A V1-to-V3 reset and a V3-to-V1 reset follow the same lifecycle. No smaller-than comparison, downgrade exception, per-version upgrade callback, shape detection, compatibility decode, or best-effort conversion is allowed.

The missing configuration value rule deliberately preserves installations that predate the marker. An absent target message database is created empty, and an already-existing same-version target is preserved. Presence, absence, native version, blocked state, or contents of any non-target database SHALL have no effect on either decision because production logic never addresses those identities.

### 3. Physical scope is exact and reset is complete

The target canonical database identity SHALL be `STORAGE_NAME` with the exact current value `WEB_CHAT_STORAGE`. IndexedDB's API namespace and origin partition supply boundaries from localStorage and other origins, so every origin independently owns a database with that same opaque name; a message suffix and `${origin}` SHALL NOT be encoded in the name.

Production persistence logic SHALL use only `STORAGE_NAME` as the canonical IndexedDB database identity. The released-retired `${STORAGE_NAME}:EVENTS_V2_CANONICAL_RECORDS:${origin}` identity and every other non-target identity SHALL have no production constant, construction, lookup, branch, open/read path, compatibility decoder, migration/export/copy path, clear/delete request, blocked/error handling, retry, readiness dependency, or completion marker. Their browser-managed bytes remain untouched, and their presence does not delay or change target preparation.

For a native-version mismatch on the target identity, the implementation deletes exactly the IndexedDB database named `STORAGE_NAME` in the current origin partition and recreates it empty from the target private `MessageDatabaseSchema` at `MESSAGE_STORE_VERSION`. Clearing known stores in place is insufficient because a skipped generation can contain unknown schema residue. This one-time physical identity replacement does not advance `MESSAGE_STORE_VERSION` because it changes naming, not the target schema generation.

For a configuration mismatch, each non-current physical scope is cleared completely:

- the current origin's `${STORAGE_NAME}:` local namespace, including `APP_STATUS_STORAGE_KEY` and any other WebChat-owned local configuration value;
- the WebChat extension's `browser.storage.sync` area, including `USER_INFO_STORAGE_KEY` and any other value owned through `BrowserSyncStorageImpl`.

After clear success, only the matching private completion value is established before ordinary defaults or newly entered values may be written. Resetting one configuration scope does not broadly clear unrelated host-page keys, another origin, browser storage areas outside current ownership, or any IndexedDB database. Resetting the message store does not clear configuration, and resetting configuration does not delete the canonical message database.

The released-retired canonical database, every other non-target IndexedDB database, and deprecated unstorage IndexedDB message data are neither the active canonical message database nor active configuration data. They remain unread, unconverted, uncleared, unmarked, and outside readiness. The active `LocalStorageImpl` and `BrowserSyncStorageImpl` wrappers are configuration stores and therefore are reset only by `CONFIG_STORE_VERSION`.

### 4. `onInstalled` is eager; injection is the required gate and fallback

`runtime.onInstalled` is an execution opportunity, not a version authority. On install or update it SHALL await the extension-wide configuration check and any required clear; it SHALL not fire and forget. A missing marker establishes the baseline, and an ordinary package update with the same `CONFIG_STORE_VERSION` preserves every value.

The background cannot access every page origin's local namespace or target message database. The content injection for an origin therefore SHALL, before constructing the Remesh store or mounting WebChat:

1. await the extension-wide configuration readiness check as a retry fallback if `onInstalled` was interrupted or failed;
2. await the current origin's local configuration check;
3. await the current origin's target message-database check and any target recreation.

Origins are handled lazily when they are next injected; an update SHALL not enumerate tabs merely to delete data. No affected application read, watch, write, history query, default-state write, or UI mount may start before all required checks settle ready. The two store families MAY prepare independently, and a successfully completed family is not rolled back or repeated merely because the other one failed.

### 5. Reset ownership is serialized per physical identity

The decision and reset form one exclusive lifecycle keyed by active physical store identity and target version. Concurrent callers SHALL join the current lifecycle or acquire ownership only after it finishes and re-read persisted target state. A caller that observes target completion current SHALL open or load the target without issuing another delete or clear. This prevents a late same-version contender from erasing new-generation messages, identity, preferences, or status written after the first reset.

No new application writer is admitted while its scope is being evaluated or reset. Message database recreation is part of the same owned lifecycle as deletion; configuration completion is recorded only after the full owned clear succeeds. A cross-version notification protocol, old-extension handshake, store-by-store migration transaction, or app-version marker is not required. Native IndexedDB `blocked`, `error`, `success`, and recreation settlement remain authoritative for the message operation.

If target-mismatch deletion is blocked, the current application remains unmounted and the request SHALL NOT be reported as ready. The implementation MAY log one bounded console diagnostic and await the same native request; it SHALL not display a close-tabs warning, start a second delete, or time out into a late unowned deletion. When the blocker releases, the same lifecycle may complete. If its execution context ends, the next injection re-observes the target identity and starts or joins the required lifecycle from persisted state.

### 6. Completion is durable; failure is console-only and retryable

Each target database deletion success is irreversible. If execution stops before target-mismatch deletion, the target remains non-current and the next injection retries. If execution stops after target deletion but before recreation, the next injection creates the absent target empty. Target readiness at `MESSAGE_STORE_VERSION` is the message completion state; there is no second message migration marker and no non-target-identity state participates.

The configuration completion value advances only after the corresponding clear succeeds. If execution stops after a clear but before recording completion, the next attempt may repeat an idempotent clear of that still-unreleased scope, but no application writer may have populated it in between. Once the target completion value exists, later same-version attempts preserve new data.

Any read, delete, clear, recreation, or completion-write error SHALL:

- emit only a bounded `console.error` diagnostic without persisted values, user content, origin details beyond existing safe context, or raw data;
- leave the mismatched or missing completion state unadvanced;
- keep the affected WebChat application startup closed for that lifecycle; and
- retry through the next `onInstalled`, Runtime startup, or content injection that owns the scope.

There SHALL be no Toast, `AppFeedback`, alert, DOM error, status page, notification, SystemNotice, retry button, migration progress, or success message. A blocked request MAY emit a bounded console diagnostic but is not success. Creating or recreating the message target is visible only as empty history. A successful configuration reset is visible only through the ordinary default/setup state caused by absent `AppStatus` or `UserInfo`; those normal product states are not migration feedback.

### 7. Regression evidence proves both positive and negative boundaries

Deterministic tests SHALL cover, separately for message and configuration persistence: missing-state baseline, same-version preservation, adjacent mismatch, skipped mismatch, reverse mismatch, deletion/clear failure, interruption before and after the irreversible boundary, retry, target reconstruction, and concurrent contenders without double reset. IndexedDB tests SHALL additionally cover exact `STORAGE_NAME` target identity, absence of a message or origin suffix, target mismatch cleanup, same-origin concurrent opens, and two browser origins independently using the same target name. Static guards SHALL reject any production non-target identity construction, access, compatibility, or cleanup path without introducing a non-target-database runtime lifecycle suite. Configuration tests SHALL cover the extension-wide sync scope and multiple independent origin-local scopes, including malformed completion values.

Sentinels SHALL prove family independence and isolation: a message reset preserves configuration; a configuration reset preserves the active canonical database; resetting one origin preserves another origin; host-page local keys outside `${STORAGE_NAME}:`, non-target IndexedDB databases, browser areas outside current ownership, and deprecated unstorage message data remain unchanged. Startup and static tests SHALL reject package-version imports, `WEB_CHAT_VERSION`, `VERSION_STORAGE_KEY`, app-version comparisons, non-target-database handling, old startup `clear()` ownership, user-visible migration feedback, and public API widening.

Nonblocking production Chrome MV3 and Firefox MV2 verification SHOULD record baseline, mismatch, silent-success/default-state, and console-only failure outcomes when the established browser environments can create those persisted starting states. Browser evidence does not replace deterministic source tests and remains nonblocking under the Owner's established workflow.

## Risks / Trade-offs

- [Every active target mismatch permanently deletes the affected generation, including rollback] -> This is the explicit product rule; keep the two version triggers narrow and prove ordinary release updates preserve data.
- [The identity switch stops exposing released history while leaving those database bytes behind] -> This is the Owner's explicit no-compatibility/no-cleanup decision; production code neither reads nor deletes any non-target identity, and the `STORAGE_NAME` target starts independently.
- [A missing marker preserves pre-version data] -> This is the explicit baseline rule; only a later existing unequal value authorizes deletion.
- [Per-origin persistence cannot be cleared globally from `onInstalled`] -> Gate and lazily reset each origin on its next injection, while eagerly handling only the extension-wide configuration scope.
- [Concurrent tabs can observe the same stale version] -> Serialize by physical identity, prohibit writers before readiness, and require every later contender to re-read completion before deleting.
- [IndexedDB deletion can remain blocked] -> Keep the page unmounted, retain one owned native request, log only to console, and retry from persisted state after interruption.
- [A failure gives the user no in-app recovery message] -> This is the Owner's explicit console-only requirement; preserve retryability without introducing a second UI lifecycle.
- [Configuration sync data can disappear after a version change] -> `CONFIG_STORE_VERSION` changes are explicit destructive decisions; normal UserInfo setup/default behavior is the intended post-reset state.

## Migration Plan

1. Freeze this requirements-only OpenSpec authority on the existing requirement branch and PR without advancing either store version.
2. After explicit Owner/Planner release, centralize the storage constants, replace the active canonical message identity with direct `STORAGE_NAME` without any non-target-identity access or cleanup, and extend the two private target reset lifecycles/regressions as the sole source continuation on the same requirement branch and PR.
3. Run the repository source/static/build gates on one immutable implementation exact, then obtain fresh Review and record nonblocking Chrome MV3/Firefox MV2 behavior truth.
4. Release only through the normal PR flow and separate explicit Owner merge authorization. Future changes to either constant remain independent destructive product decisions.

Before release, rollback is code-only by reverting the requirement branch. After release, an older build that still names the released-retired database may expose its untouched stale history and ignore the new target; the forward implementation provides no compatibility bridge. After any active target mismatch reset succeeds, rollback cannot restore the deleted target values, and reverse mismatch remains destructive.

## Open Questions

None. The Owner has fixed the two persistence families, six centralized storage constants with no `MESSAGE_STORE_NAME`, exact direct `STORAGE_NAME` canonical IndexedDB identity, separate browser API namespaces, native origin isolation, completely untouched non-target identities, no compatibility under any identity/version change, strict target-version non-equality semantics, baseline, independent scope, lazy origin handling, direct active-target reset, awaited completion, console-only failure, and ordinary app-version exclusion.
