## 1. Product Contract

- [x] 1.1 Move the message list to the official shadcn Message Scroller primitives (`@shadcn/react/message-scroller`) through a vendored local wrapper; no self-written scroll engine.
- [x] 1.2 Keep initial latest-message presentation, bottom-only smooth follow as one current follow authorization (transient self-caused off-bottom geometry neither counts nor cancels it; strictly advanced geometry/tail retargets; `scrollend` settles with one deduped reconciliation command; real input intent cancels), off-bottom count plus click recovery, manual departure, and history-prepend anchor preservation as real-DOM behaviors; the recovery action is shown iff the exact bottom distance exceeds 0.5× the current viewport client height (count retained internally and never overriding), and exactly one app-side ResizeObserver keeps that geometry current and reconciles strict post-settle growth once per height/tail generation only while bottom-follow continuity is intact (manual off-bottom never reclaimed).
- [x] 1.3 Apply `content-visibility: auto` and stable `contain-intrinsic-size` on each repeated row surface of the message list (stable 104px fallback, the minimal value passing the frozen real-browser CSS matrix: short-history zero-command/zero-offset, 24/800-row initial end, resize/follow, off-bottom preserve; `auto` never alters measured layout), header room rows (56px) and user rows (28px), and footer autocomplete options (16px content box + 12px padding = the existing 28px option-row outer geometry, probe-verified: skipped outer equals the fallback plus padding at 0/16/28/40px, and 16px yields 28px rows at N=100); no container-level substitute, virtualization, or hidden accessible content.
- [x] 1.4 Keep footer ArrowUp/ArrowDown/Enter selection and focus semantics with the active option natively scrolled into view.
- [x] 1.5 Remove `react-virtuoso` from source, package manifest, lockfile, configuration, types, mocks, and tests.

## 2. Implementation

- [x] 2.1 Add `src/components/ui/message-scroller.tsx` vendored from the official shadcn registry `message-scroller` item, adapted only to repository import aliases and available Tailwind utilities.
- [x] 2.2 Rebuild MessageList on the Message Scroller primitives with the follow/unread layer limited to chat semantics the primitive does not carry; keep the provider/viewport/content shell constantly mounted across loading/empty/loaded phases and gate only rows on non-null content; compose the repository shadcn `ScrollArea` through its `viewport` render-prop seam with the engine Viewport's Owner-authorized minimal `render` patch so one DOM element owns overflow, repository scrollbar, engine ref, geometry, and commands.
- [x] 2.3 Convert Header hover-card lists and the Footer autocomplete list to real DOM rows carrying the row-level geometry contract.
- [x] 2.4 Remove the `react-virtuoso` dependency and lock identities and add `@shadcn/react@0.3.0`.
- [x] 2.5 Replace Virtuoso-mock-only tests with real-DOM unit and Chromium controls; add off-bottom count/click recovery, manual departure, prepend anchor, repeated-append follow, bounded long-list, keyboard/a11y, and row computed-style/real-geometry controls for all three lists.
- [x] 2.6 Update the live `webrtc-runtime` spec to the neutral real-DOM row-identity wording and record this superseding change while leaving `openspec/changes/show-initial-message-list-at-latest-message/` byte-exact as historical PR #164 evidence.

## 3. Verification and Delivery

- [ ] 3.1 Run the frozen-exact gate sequence once: affected unit, Chromium behavior/geometry/a11y, full Node suite, check/static/type, format, diff, strict OpenSpec, and the zero-residual Virtuoso removal proof.
- [ ] 3.2 Freeze one clean single candidate, produce raw evidence, and hand to a fresh independent Inspector review; no CI before review PASS, and merge remains an Owner-only decision.
