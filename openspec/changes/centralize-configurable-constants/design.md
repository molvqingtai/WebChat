## Context

`src/constants/config.ts` currently owns most application configuration, and `src/constants/event.ts` owns DOM event names. The boundary is incomplete:

- `EMOJI_LIST` occupies the first 166 lines of the generic configuration file.
- App feedback and Toast presentation own a stable feedback ID, a 300ms minimum visible duration, a 1,000ms settlement timeout, a four-second default duration, one-visible-Toast limit, and three-frame stability threshold locally.
- Runtime clients, background hosting, physical room joins, room transport/inbound recovery, ClientLease, Coordinator, Wire diagnostics, and PresenceStore declare local timeouts, intervals, caps, namespace values, storage identities, an Offscreen path, and startup polling values.
- New-profile preferences, AppStatus, message sending, Danmaku, and setup/onboarding embed configurable defaults or cadence directly in application modules; MessageInput also duplicates the existing 500-character application limit as a local fallback.
- Service routing declares notification and app-action namespaces beside its contract.
- The persistence-version change introduces symmetric store versions and a completion key in `src/constants/storage.ts`; this change is stacked above that authority rather than duplicating it.

Not every module-level `const` or literal is configuration. Protocol `MESSAGE_TYPE`/`REACTION_TYPE`, application record discriminants, Valibot schemas, Remesh Domains/Externs, codec functions, exact domain/error copy, runtime-derived namespaces containing `browser.runtime.id`, React components, component-local JSX/CSS geometry and animation tokens, build/tool manifest configuration, and test fixtures are executable, visual, or contractual owners rather than application configuration. Public resource limits in `src/protocol/Limits.ts` are peer-protocol contract facts and are explicitly required to remain protocol-owned.

## Goals / Non-Goals

**Goals:**

- Make `src/constants/` the only declaration boundary for every configurable production value.
- Preserve semantic ownership through small domain-named modules instead of one undifferentiated constants dump.
- Give emoji catalog data one dedicated `src/constants/emoji.ts` owner.
- Preserve exact values, types, order, comments, runtime behavior, public surfaces, and dependency direction.
- Remove old declarations and aliases, update all production/test imports, and add a source guard that prevents recurrence.
- Coordinate with the persistence-version parent so each configurable constant has only one requirement and source owner.

**Non-Goals:**

- Moving every JavaScript/TypeScript `const`, literal, function, schema, component, Domain, Extern, or test fixture.
- Extracting icon sizes, Tailwind/CSS tokens, one-off motion coordinates/durations, or generic component prop defaults that are local visual implementation rather than an application-level behavioral authority.
- Moving `package.json`, WXT, Oxc, TypeScript, CI, or other build/tool configuration into application constants.
- Changing any timeout, interval, cap, path, key, version, namespace, copy, emoji, breakpoint, size, or default.
- Combining equal-valued constants whose meanings are independent, or adding a runtime configuration service/object.
- Moving public peer-protocol limits or discriminants out of `src/protocol`, or changing protocol exports/import boundaries.
- Adding environment variables, remote configuration, user settings, dynamic mutation, a constants barrel, dependencies, code generation, or compatibility re-exports.
- Reimplementing persistence reset behavior, changing its store versions, or editing source before its parent authority is approved.

## Decisions

### 1. Configuration is defined by purpose, not syntax

A production value is configurable when its primary role is to select or tune behavior without changing the algorithm or domain type. The current categories are:

- timeouts, intervals, retry cadence, grace windows, and presentation dwell/settlement timing;
- capacity, byte, queue, observation, history, conflict, and diagnostic-log bounds;
- stable extension topology paths, storage keys/prefixes/names/versions, context namespaces, and feedback owner IDs;
- application/surface defaults and behavioral cadence that are intended to be tuned independently of their algorithms;
- breakpoints, resource/input/image/avatar sizes, and static selectable catalogs such as emoji.

These values SHALL live under `src/constants/` even when only one production module consumes them and even when the current source embeds the value as an inline/default literal. A value is not configuration merely because it uses `const` or is a literal. Closed discriminants, schemas/validators, protocol wire facts, Remesh definitions, functions, immutable DTOs without configurable defaults, derived runtime values, exact domain/error strings, local implementation sentinels, and component-local visual tokens remain with their semantic owners. Test-only values remain beside tests.

This classification prevents two failure modes: leaving tunable behavior hidden inside an implementation, and stripping ordinary implementation details of the context that makes them understandable.

### 2. Domain-named constant modules preserve ownership

The target boundary SHALL use direct imports from these modules:

| Module                          | Ownership after this change                                                                                                                                                                                                                                                                                                         |
| ------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/constants/config.ts`       | Existing centralized general product limits/tuning values, static new-profile preference defaults, and values not reassigned below                                                                                                                                                                                                  |
| `src/constants/emoji.ts`        | Exact readonly `EMOJI_LIST` and its source attribution only                                                                                                                                                                                                                                                                         |
| `src/constants/presentation.ts` | AppStatus defaults; Runtime feedback owner ID; Toast duration/visibility/stability values; message-send, Danmaku, and setup/onboarding behavioral cadence                                                                                                                                                                           |
| `src/constants/runtime.ts`      | Runtime/host heartbeat values, host-startup poll values, physical-join deadline, transport/inbound retry cadence, ClientLease defaults/RPC deadline, Coordinator cadence/deadline/session key, Wire diagnostic cap/interval, presence observation cap/storage prefixes, Runtime/Coordinator namespaces, and Offscreen document path |
| `src/constants/service.ts`      | Notification and app-action service namespace generations                                                                                                                                                                                                                                                                           |
| `src/constants/storage.ts`      | Existing WebChat storage name/keys plus the parent authority's message/config store versions and configuration completion key                                                                                                                                                                                                       |
| `src/constants/event.ts`        | Existing DOM/custom event constants, unchanged                                                                                                                                                                                                                                                                                      |

No `src/constants/index.ts` barrel is added. Consumers SHALL import the exact module that owns the value, which keeps dependencies and review scope visible. Constants modules SHALL contain data declarations and necessary orienting comments only; they SHALL NOT import application, Runtime, service, protocol, browser, React, or Remesh owners or compute values from mutable/runtime state.

The existing non-emoji values in `config.ts` MAY remain there unless this frozen inventory assigns them to `storage.ts`; this task is an ownership correction, not a speculative taxonomy rewrite. Storage-related values move to `storage.ts` because that module already exists in the stacked parent. A later reorganization requires its own justified requirement rather than silently extending this migration.

### 3. The frozen migration inventory is behavior-preserving

The implementation SHALL relocate the following current configuration facts without changing their values or semantics:

- App/surface defaults: profile preferences `themeMode: 'system'`, `danmakuEnabled: true`, `notificationEnabled: true`, and `notificationType: 'at'`; AppStatus `open: false`, `unread: 0`, and bottom-right position `{ x: 50, y: 22 }`. Runtime-derived profile `id`/`createTime` and blank setup fields remain local.
- Feedback/presentation: `webchat-runtime-readiness`, 300ms minimum visible time, 1,000ms presentation timeout, 4,000ms default Toast duration, one-visible-Toast limit, and three eligible animation frames before presentation settlement.
- Interaction/onboarding: 1,000ms message-send throttle, 2,000ms generated setup-message cadence, and Danmaku duration range `[7,000, 10,000]`ms.
- Runtime transport/hosting: the two semantically distinct 5,000ms comctx heartbeat defaults, 15,000ms host-startup poll deadline, 250ms host-startup poll interval, 10,000ms physical room-join deadline, 1,000ms Artico peer-restart delay, 1,000ms inbound-persistence retry delay, `/offscreen.html`, Runtime/Coordinator namespace generations, and service namespace generations.
- ClientLease/Coordinator: 15,000ms startup/recovery budget, 500ms retry interval, 5,000ms watchdog interval, 5,000ms per-RPC deadline, 5,000ms Coordinator health interval, 5,000ms Coordinator RPC deadline, and the Coordinator session-storage key.
- Runtime resources: 256 logged-source entries, 10,000ms repeated-log interval, 512 presence observations, and both presence storage/port namespace prefixes.
- Existing storage/configuration: `STORAGE_NAME`, `USER_INFO_STORAGE_KEY`, and `APP_STATUS_STORAGE_KEY` move from generic config into storage constants; the parent-owned store versions/key stay in that same module.
- Existing input authority: MessageInput's active default SHALL consume `MESSAGE_MAX_LENGTH` rather than retain a second literal `500` authority.
- Emoji: every existing code point/sequence and its exact order move from `config.ts` into `emoji.ts` with readonly tuple behavior intact.

Equal numeric values SHALL not be merged merely because they are equal. In particular, client and host heartbeats, ClientLease RPC, Coordinator RPC, Coordinator health, and ClientLease watchdog each retain distinct semantic names unless their existing code already consumes one shared authority. Runtime-derived strings such as `${namespace}:${browser.runtime.id}` remain in the consuming module; only the stable prefix is configuration.

Exported constants currently imported by tests SHALL move without a compatibility re-export from their old source. Tests and production consumers update to the canonical constants module. Public peer protocol limits remain in `src/protocol/Limits.ts` and are not duplicated under `src/constants/`.

### 4. Emoji extraction is exact and isolated

`src/constants/emoji.ts` SHALL contain the current `EMOJI_LIST` and its existing source reference. `src/constants/config.ts` SHALL contain no emoji catalog or compatibility re-export. `emoji-button.tsx` and tests SHALL import `EMOJI_LIST` directly from `@/constants/emoji`.

The list's length, index order, scalar values, multi-code-point sequences, and readonly typing SHALL remain byte-for-byte/element-for-element equivalent. The UI SHALL retain the same groups, keys, selection callback values, rendering order, and accessible behavior. This task SHALL NOT add, remove, sort, categorize, localize, fetch, or dynamically configure emoji.

### 5. A dependency-free static guard protects the boundary

A deterministic Vitest source-boundary test SHALL enumerate the frozen migrated symbols and assert that each has exactly one declaration in its expected `src/constants/*.ts` owner. It SHALL scan production TypeScript outside `src/constants/` for configurable naming patterns such as timeout/interval/grace/retry/version/key/prefix/namespace/path and `MAX_*`, and for direct literal/default authorities in timing/cadence APIs covered by the frozen inventory, while maintaining a narrow reviewed exception set for public protocol contract constants and other explicitly non-configurable facts.

The guard SHALL also prove:

- old declaration sites and imports are absent;
- `config.ts` contains no `EMOJI_LIST`, while `emoji.ts` contains the exact catalog;
- constants modules import no higher-level application/Runtime/service/protocol/browser/UI owners;
- no compatibility alias, re-export, duplicate literal authority, or constants barrel was introduced; and
- current public protocol ownership and boundary tests remain unchanged.

The guard does not decide product semantics automatically. A future value that matches a configuration pattern must either move under `src/constants/` or receive an explicit source-test exception with a reason showing why it is a contract/discriminant/implementation sentinel instead of configuration.

## Risks / Trade-offs

- [A broad rule can turn `src/constants/` into a dumping ground] -> Classify by configurability and split by domain; keep executable/contractual/local values with their owners.
- [Equal values can be accidentally coupled] -> Preserve distinct semantic constants unless an existing single authority already exists; test every value and consumer mapping.
- [Moving exported test constants can create compatibility aliases] -> Update all imports directly and forbid old-source re-exports.
- [Static naming heuristics can report false positives] -> Keep a narrow reasoned exception list and pair pattern checks with the exact frozen inventory.
- [Moving protocol limits would violate the peer boundary] -> Explicitly exclude `src/protocol/Limits.ts` and retain its existing ownership tests.
- [The persistence parent also introduces constants] -> Keep this change stacked above that authority and do not duplicate its declarations or behavior.

## Migration Plan

1. Freeze and review this docs-only authority as a separate child branch/PR above the persistence-version authority; make no source changes yet.
2. After both authorities are approved and the parent implementation exact is fixed, relocate the frozen inventory in one mechanical source child while preserving values and updating all imports/tests.
3. Run targeted constant-boundary/emoji parity tests, the full repository source/static/build gates, and fresh Review on one immutable exact. UI behavior testing is nonblocking and only needs to confirm the unchanged emoji picker and startup surface.
4. Merge only in stack order and only after separate explicit Owner authorization. Archive each requirement independently after delivery.

Rollback before release restores the old declaration locations and imports. Because this change alters no persisted data or behavior, it has no data rollback step.

## Open Questions

None. The Owner has fixed the configurable-only boundary and dedicated emoji file; this design fixes the classification, inventory, module ownership, dependency direction, no-alias migration, and regression guard.
