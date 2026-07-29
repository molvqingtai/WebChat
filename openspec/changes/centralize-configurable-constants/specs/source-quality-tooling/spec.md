## ADDED Requirements

### Requirement: Configurable production constants have one source boundary

Every configurable production value SHALL be declared in a domain-named module under `src/constants/` and imported directly from that owner. Configurable values SHALL include application/runtime tuning values, behavioral limits and cadence, timeouts, intervals, retry/grace windows, stable extension topology identifiers, storage names/keys/prefixes/versions, context namespaces, extension paths, application/surface defaults, presentation lifecycle settings, breakpoints, resource/input sizes, and static selectable catalogs. The rule SHALL apply when a current authority is embedded as an inline/default literal rather than already named. Constants modules SHALL contain data declarations and necessary orienting comments only; they SHALL NOT depend on application, Runtime, service, protocol, browser, React, or Remesh owners, compute from mutable/runtime state, or expose a catch-all runtime configuration object.

This boundary SHALL NOT absorb a value merely because TypeScript declares it with `const` or because it is a literal. Protocol/domain discriminants, public peer protocol limits, schemas/validators, Remesh Domains/Externs, functions, components, immutable DTOs without configurable defaults, exact domain/error copy, runtime-derived values, module-private implementation sentinels, component-local JSX/CSS geometry or animation tokens, build/tool manifest configuration, and test fixtures SHALL remain with their semantic owners. `src/protocol/Limits.ts` SHALL continue owning and exporting the public peer resource limits without importing application configuration.

The target production modules SHALL be `config.ts` for existing general values and static profile preference defaults, `emoji.ts` for `EMOJI_LIST`, `presentation.ts` for AppStatus/feedback/Toast/interaction/onboarding configuration, `runtime.ts` for Runtime/Coordinator/ClientLease/presence/transport/Offscreen configuration, `service.ts` for service namespace generations, `storage.ts` for storage identities and store versions, and existing `event.ts` for event constants. Consumers SHALL import the exact owning module; no constants barrel, old-location compatibility re-export, alias, or duplicate declaration SHALL remain.

The migration SHALL preserve every current value, type, semantic owner, generation suffix, comment that explains a real constraint, and consumer behavior. Equal-valued timeouts or limits with distinct meanings SHALL remain distinct constants and SHALL NOT be unified merely because their current numeric values match. Runtime-derived values MAY compose imported constant prefixes locally but SHALL NOT move mutable/runtime inputs into a constants module. Runtime service/Extern APIs and protocol exports SHALL remain unchanged.

The frozen current migration set SHALL include static new-profile preference defaults and AppStatus defaults; feedback/Toast owner, duration, visibility, and stability settings; message-send, setup-message, and Danmaku cadence; page/host heartbeat values; host startup polling; physical room-join timeout; Artico peer-restart and inbound-persistence retry delays; ClientLease defaults and RPC timeout; Coordinator cadence, RPC timeout, and session key; Wire diagnostic cap/interval; presence observation cap and storage/port prefixes; Runtime/Coordinator/notification/app-action namespaces; Offscreen document path; existing storage name/keys plus the stacked parent store versions/completion key; the MessageInput fallback's direct use of existing `MESSAGE_MAX_LENGTH`; and the emoji catalog. Runtime-derived profile identity/time and blank setup fields SHALL remain local. Existing configurable values already under `src/constants/` SHALL remain centralized even when they are not otherwise reorganized by this change.

A dependency-free deterministic source test SHALL assert exactly one expected declaration for every frozen migrated symbol, reject its old declaration/import or inline/default sites, verify constants-module dependency direction, and scan production source for configurable naming patterns and direct timing/cadence authorities outside `src/constants/`. The pattern scan MAY use a narrow documented exception set for public protocol contract constants, local visual tokens, and other proven non-configurable facts. Adding a future exception SHALL require a reason that identifies the semantic owner; an unexplained allowlist entry SHALL fail review.

#### Scenario: Configurable value is declared once under constants

- **WHEN** a production timeout, interval, retry/grace value, behavioral cadence, cap, stable infrastructure identifier, storage identity/version, extension path, application default, presentation lifecycle setting, resource/input size, breakpoint, or selectable catalog is introduced or inspected
- **THEN** it SHALL have exactly one declaration in its domain-named `src/constants/*.ts` owner and every consumer SHALL import that owner directly

#### Scenario: Ordinary module constants keep their semantic owner

- **WHEN** a declaration or literal is a protocol/domain discriminant, schema, Domain/Extern, function, component, DTO without configurable defaults, exact domain/error copy, runtime-derived value, private implementation sentinel, local JSX/CSS visual token, or test fixture rather than configuration
- **THEN** it SHALL remain in its semantic module or test and SHALL not be moved merely to satisfy a syntactic `const` rule

#### Scenario: Public peer limits remain protocol-owned

- **WHEN** the constants migration is inspected
- **THEN** the peer resource limits SHALL still be declared/exported by `src/protocol/Limits.ts`, the public protocol SHALL retain no application/constants dependency, and its existing boundary tests SHALL pass unchanged

#### Scenario: Equal values do not create accidental coupling

- **GIVEN** two current timeouts or limits have the same numeric value but own different ClientLease, Coordinator, heartbeat, or presentation semantics
- **WHEN** they move under `src/constants/`
- **THEN** they SHALL retain distinct contextual names and consumer mappings unless a pre-existing single authority already owns both; changing one SHALL not silently change the other

#### Scenario: Constants modules remain leaf data owners

- **WHEN** imports under `src/constants/` are inspected
- **THEN** they SHALL contain no application, Runtime, service, protocol, browser, React, or Remesh owner dependency, no mutable/runtime computation, no configuration service/object, and no barrel that hides the canonical module

#### Scenario: Static guard rejects a misplaced configuration

- **WHEN** a frozen migrated symbol/default site is duplicated or a new production declaration matches a configurable timeout/interval/grace/retry/version/key/prefix/namespace/path or `MAX_*` pattern outside `src/constants/` without a reasoned exception
- **THEN** the source-boundary test SHALL fail and identify the misplaced or duplicate declaration

### Requirement: Emoji catalog has a dedicated constant owner

`EMOJI_LIST` SHALL be declared only in `src/constants/emoji.ts` with its existing source attribution and readonly tuple behavior. `src/constants/config.ts` SHALL contain no emoji list, alias, or re-export. Production and test consumers SHALL import `@/constants/emoji` directly.

The extraction SHALL preserve the exact list length, element order, Unicode scalar and multi-code-point sequences, rendered keys, selection callback values, and emoji-picker behavior. It SHALL NOT add, remove, sort, group, categorize, localize, fetch, mutate, or dynamically configure emoji, and SHALL change no UI layout or copy.

#### Scenario: Emoji extraction preserves exact data

- **WHEN** the pre-change and post-change emoji catalogs are compared element by element
- **THEN** their length, order, values, Unicode sequences, source attribution, and readonly typing SHALL be identical

#### Scenario: Emoji picker uses the dedicated owner

- **WHEN** the emoji picker renders and a user selects any entry
- **THEN** it SHALL render the same ordered choices and emit the same selected value while importing only `EMOJI_LIST` from `@/constants/emoji`

#### Scenario: Generic configuration contains no emoji residue

- **WHEN** `src/constants/config.ts` and repository imports are inspected
- **THEN** `config.ts` SHALL contain no emoji catalog or compatibility export, and no production/test consumer SHALL import `EMOJI_LIST` from the old path
