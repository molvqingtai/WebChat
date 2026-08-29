## Why

The message list, header room list, and footer mention-autocomplete list all depend on the `react-virtuoso` virtualizer. Its retained internal scroll commands have repeatedly conflicted with product-owned scroll behavior (initial bottom settlement, bottom-aware follow, and manual-departure recovery), and its virtual DOM stands between the product and the actual rows. WebChat moves all three lists to real DOM driven by the official shadcn Message Scroller behavior primitives (`@shadcn/react/message-scroller`), with `content-visibility: auto` plus stable `contain-intrinsic-size` as the row-level rendering optimization.

## What Changes

- Add `src/components/ui/message-scroller.tsx`, a local wrapper vendored from the official shadcn registry `message-scroller` item whose behavior engine remains `@shadcn/react/message-scroller`; WebChat SHALL NOT ship a self-written scroll engine.
- MessageList renders every message row as a real DOM item on the Message Scroller: initial presentation at the latest message, smooth follow only when settled at the bottom, off-bottom arrival counting with a single click-recovery action, manual departure detection, and history-prepend reading-anchor preservation.
- Header hover-card room/user lists render every row as real DOM with `content-visibility: auto` and a stable `contain-intrinsic-size` of 56px (room rows) and 28px (user rows).
- Footer `@` autocomplete options render as real DOM rows with `content-visibility: auto` and a stable 28px `contain-intrinsic-size`; ArrowUp/ArrowDown/Enter selection is unchanged and the active option stays visible through native `scrollIntoView({ block: 'nearest' })`.
- Remove the `react-virtuoso` dependency, lockfile identities, types, mocks, and every mechanism that existed only for it. Production, tests, configuration, and current documentation SHALL contain no Virtuoso reference; archived historical change records MAY retain them for their own immutable exacts.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `webrtc-runtime`: The message list, header room list, and footer autocomplete list become real-DOM surfaces on the official shadcn Message Scroller primitives; row identity stays the projected stable identity; the virtualizer and its internal scroll ownership are removed.

## Impact

- Affected behavior: initial latest-message presentation, bottom-aware smooth follow, off-bottom unread counting and click recovery, manual departure, history-prepend anchor preservation, room-list and autocomplete rendering, and keyboard-selected option visibility.
- Affected implementation: `src/components/ui/message-scroller.tsx` (new), MessageList, Header, Footer, `package.json`/`pnpm-lock.yaml` (`react-virtuoso` removed, `@shadcn/react` added), and the row-level `content-visibility`/`contain-intrinsic-size` contract.
- Affected verification: real-DOM behavior equivalence controls, row-level computed-style and long-list real-geometry controls, keyboard/a11y semantics, and the Virtuoso removal proof.
- Historical relation: the archived/active `show-initial-message-list-at-latest-message` change record remains byte-exact as PR #164 failure evidence; this change supersedes its Virtuoso-specific architecture constraints in the live spec only.
