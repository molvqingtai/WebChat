# Design: replace Virtuoso with the native Message Scroller

## Context

MessageList, Header hover-card lists, and the Footer `@` autocomplete previously rendered through `react-virtuoso`. Its retained internal scroll commands conflicted with product-owned scroll behavior, and its virtual DOM hid real rows from measurement and accessibility surfaces. The replacement uses real DOM for all three lists.

## Decisions

- **Behavior engine**: the official shadcn registry `message-scroller` item, vendored as `src/components/ui/message-scroller.tsx` with only import-alias/Tailwind adaptations. The scroll engine remains `@shadcn/react/message-scroller`; WebChat adds no parallel engine.
- **Chat semantics layer**: the primitive owns initial end presentation (`defaultScrollPosition="end"`), manual scroll intent (wheel/touch/keyboard), and prepend anchoring (`preserveScrollOnPrepend`). MessageList adds only what the primitive does not carry: bottom-settled smooth follow of a new tail and off-bottom arrival counting behind one recovery action.
- **Row-level optimization**: every repeated row carries `content-visibility: auto` with a stable `contain-intrinsic-size` (message rows 104px fallback keyed by `auto` so measured layout is never altered — the minimal value passing the frozen real-browser CSS matrix across short-history zero-scroll, 24/800-row initial end, resize/follow, and off-bottom preserve; header room rows 56px; header user rows 28px; footer options 16px content box + 12px padding = the existing 28px option-row outer geometry, probe-verified: skipped outer equals the intrinsic fallback plus padding, and 16px yields 28px rows at N=100). No container-level substitute.
- **Footer keyboard**: selection state stays in the component; the active option uses native `scrollIntoView({ block: 'nearest' })` instead of the removed Virtuoso handle.

## Historical relation

`openspec/changes/show-initial-message-list-at-latest-message/` remains byte-exact as PR #164 failure evidence. This change supersedes only the live-spec constraints that bound row identity, mount preconditions, and append behavior to Virtuoso.
