## Why

WebChat already has a `src/constants/` boundary, but production configuration remains split between that directory and the modules that consume it. Runtime timeouts, retry intervals, resource caps, namespace/storage identities, Offscreen topology, surface defaults, and behavioral presentation timing are declared beside implementations or embedded as inline/default values, while the large emoji catalog is mixed into the generic configuration file. Discovering or reviewing a configurable value therefore requires searching the whole source tree, and equal-looking local values can become accidental duplicate authorities.

The Owner has fixed the structural rule: every configurable production constant belongs under `src/constants/`; a module-private value that is not configuration remains with its owner. Emoji data must have a dedicated constants file.

## What Changes

- Define a narrow, testable classification for configurable production constants: application/runtime tuning values, behavioral limits and cadence, timeouts, intervals, retry/grace windows, stable infrastructure identifiers, storage keys/prefixes/versions, extension paths, application defaults, presentation lifecycle settings, breakpoints, resource/input sizes, and selectable catalog data. A current value remains in scope when it is embedded as an inline/default literal rather than already named.
- Move every current configurable declaration or inline/default authority into a domain-named module under `src/constants/`, including the currently scattered Runtime, coordinator, presence, Offscreen, service-routing, profile/AppStatus defaults, Toast, onboarding, message-send, and Danmaku values. Consumers and tests import the new owner directly; old declarations and compatibility re-exports are removed.
- Move `EMOJI_LIST` byte-for-byte from `src/constants/config.ts` into dedicated `src/constants/emoji.ts`; preserve its order, values, readonly typing, component behavior, and source attribution.
- Keep non-configurable code local: protocol/domain discriminants, schemas, Remesh Domains/Externs, functions, runtime-derived values, exact diagnostic/business copy, test fixtures, public peer protocol limits, and component-local JSX/CSS geometry or animation tokens are not application configuration and do not move under this rule.
- Preserve every value and runtime behavior. Equal-valued constants with different semantic owners remain distinct; relocation must not silently couple, rename generations, tune limits, change copy, or widen a public API.
- Add a dependency-free static source guard for the frozen inventory, configuration-name patterns, and literal timing/default sites so a future configurable constant cannot be reintroduced outside `src/constants/` without an explicit reviewed exception.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `source-quality-tooling`: Add a constants ownership boundary, current-source inventory, direct-import rule, emoji module, and static regression guard while preserving source behavior and public protocol ownership.

## Impact

- Affected implementation after authority approval: constant declarations and their imports in `src/constants`, Runtime, application state/feedback/presentation, onboarding, service contracts, storage, background, and related tests.
- Affected tests after authority approval: exact constant ownership/inventory, no-old-declaration residue, emoji parity, import direction, public-protocol isolation, and unchanged runtime values.
- Unchanged surfaces: product behavior, visible copy, UI layout, peer wire, public protocol exports and limits, persistence semantics, permissions, dependencies, build outputs, and all constant values.
- Delivery relationship: this is a separate stacked requirement/PR above the persistence-version authority so the parent-owned `MESSAGE_STORE_VERSION`, `CONFIG_STORE_VERSION`, and `CONFIG_STORE_VERSION_KEY` participate without duplicate source ownership.
