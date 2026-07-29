## 1. Freeze Inventory And Ownership

- [ ] 1.1 Record every current configurable production declaration, inline/default authority, exact value, and consumer; classify protocol/discriminant/schema/derived/local-visual/test exclusions with an explicit reason.
- [ ] 1.2 Retain existing general values in `src/constants/config.ts`, event values in `event.ts`, and public peer limits in `src/protocol/Limits.ts`; add no catch-all constants barrel or runtime configuration object.
- [ ] 1.3 Consume the stacked persistence parent's `src/constants/storage.ts` authority and avoid duplicate store-version/key declarations or persistence behavior changes.

## 2. Extract Dedicated Constant Modules

- [ ] 2.1 Move `EMOJI_LIST` and its attribution into `src/constants/emoji.ts` byte-for-byte/element-for-element and update every production/test import directly.
- [ ] 2.2 Move static new-profile preferences into `config.ts`; move AppStatus defaults, AppFeedback/Toast owner/duration/visibility/stability settings, and message-send/setup-message/Danmaku cadence into `src/constants/presentation.ts`; keep derived profile identity/time local and preserve all behavior.
- [ ] 2.3 Move Runtime, host, transport/inbound recovery, ClientLease, Coordinator, Wire diagnostic, presence, namespace, storage-identity, Offscreen-path, and startup-poll values into `src/constants/runtime.ts` with contextual names and unchanged values.
- [ ] 2.4 Move notification/app-action namespace generations into `src/constants/service.ts` and existing WebChat storage name/keys into the parent-owned `src/constants/storage.ts`.
- [ ] 2.5 Delete every old declaration/import and update consumers/tests directly; add no compatibility alias or re-export.
- [ ] 2.6 Replace MessageInput's duplicate literal fallback with direct `MESSAGE_MAX_LENGTH` consumption while preserving the 500-character behavior.

## 3. Protect Semantics And Boundaries

- [ ] 3.1 Preserve distinct semantic constants even when numeric values match; prove each old consumer maps to the correct new owner and no accidental shared tuning is introduced.
- [ ] 3.2 Preserve public protocol ownership/exports, constants leaf dependency direction, runtime-derived composition, explanatory comments, and all exact values/types/generation suffixes.
- [ ] 3.3 Add emoji parity tests for length/order/Unicode values/readonly behavior and focused picker coverage for unchanged render and selection behavior.
- [ ] 3.4 Add a dependency-free source-boundary test for exact migrated-symbol/default-site ownership, old-site residue, imports, forbidden constants dependencies/barrel/aliases, configurable naming/timing patterns, and reasoned protocol/local-visual/non-configurable exceptions.

## 4. Delivery Gates

- [ ] 4.1 Run focused fail-before source-boundary/emoji controls, then the full repository test, type, lint, format, build, and strict OpenSpec gates on one immutable implementation exact.
- [ ] 4.2 Obtain fresh Reviewer findings on classification, full inventory, value/consumer parity, dependency direction, public protocol isolation, and absence of behavior change.
- [ ] 4.3 Record nonblocking unchanged emoji-picker/startup behavior where available; do not require browser evidence for the mechanical source gate or convert unavailable behavior evidence into PASS.
- [ ] 4.4 Keep this requirement on its own stacked branch/PR, rebase only onto the approved parent implementation exact, and wait for stack-order Review plus separate explicit Owner merge authorization.
