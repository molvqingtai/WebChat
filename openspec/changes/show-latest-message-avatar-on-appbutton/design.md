## Context

`AppStatusDomain` owns the one synchronized same-domain AppButton status, including `open` and unread attention. `AppButton` is its sole launcher renderer. A first-delivered remote text already reaches this owner with the complete author identity used by message avatars. The latest-author projection belongs to that same status boundary: it must not create another delivery path, unread owner, timer owner, or launcher renderer.

## Goals / Non-Goals

**Goals:**

- Give every same-domain AppButton the same latest eligible remote author while leaving other domains unchanged.
- Show that author for exactly `1,000ms` after the latest eligible expanded delivery.
- Keep the latest collapsed unread author visible until the shell expands.
- Replace an earlier author immediately on every newer eligible delivery, including repeated messages from the same author, and restart the expanded lifetime from that delivery.
- Prevent an older timeout, delayed hydration, or older synchronization value from clearing or restoring a newer author.
- Permit one launcher-local View Transition for inner icon replacement without making animation availability part of the state machine.
- Preserve the current daily logo as the no-attention result and the current unread badge as an independent collapsed unread marker.

**Non-Goals:**

- Adding a message preview, unread count, sender queue, carousel, sound, setting, tooltip copy, notification rule, protocol field, public API, permission, dependency, Domain, or browser-specific branch.
- Changing message eligibility, delivery, ordering, history, duplicate handling, reactions, system notices, or message durable storage.
- Changing AppButton size, position, border, shimmer, unread badge, menu, drag, open/collapse interaction, label, or shell geometry.
- Queuing one-second author presentations or guaranteeing one second for an author that a newer delivery supersedes.
- Adding an animation queue, a second document-transition owner, a new motion duration/easing contract, or any dependency on native View Transition availability.

## Decisions

### 1. Reuse the first-delivered remote-text authority

Only a first-delivered remote text from an author other than the configured local user can select the launcher author. Self-authored text, history application, duplicate delivery, reactions, and system notices cannot select or extend it. Browser focus, active/highlighted tab state, and browser-notification enabled/type settings do not gate this projection.

The delivery's complete author identity is the presentation input. The avatar image uses the same author avatar as message presentation; an empty or failed image uses the author's existing name-initial fallback.

### 2. Let delivery-time open state choose the lifetime

An eligible delivery observed while the shared domain is expanded selects its author immediately and sets one shared deadline exactly `1,000ms` after that delivery. At the deadline, the daily logo returns unless a newer eligible delivery owns the projection. A repeated delivery from the same author refreshes the deadline even though the rendered avatar does not visibly change.

An eligible delivery observed while the shared domain is collapsed selects its author immediately as the persistent unread author. It has no one-second expiry and remains until the shared shell expands. Expanding clears unread and this persistent author together, so every same-domain AppButton immediately returns to the daily logo. Collapsing without a new unread delivery shows the daily logo and cannot preserve or create unread identity; if an expanded transient author is still visible, collapse clears it rather than converting an already-read message into persistent attention.

### 3. The newest eligible delivery always supersedes

Each eligible delivery becomes the sole current generation. A newer author replaces the visible avatar immediately, without waiting for the outgoing one-second lifetime or an exit animation. A newer delivery from the same author still becomes a new generation. In an expanded shell, the newest generation receives a fresh exact `1,000ms` deadline; in a collapsed shell, it becomes the persistent unread author.

Expiry, open/clear, hydration, and synchronization effects are generation-aware. An older timeout cannot clear a newer avatar, and an older stored or synchronized value cannot resurrect an expired or read avatar. When an open/clear and a delivery occur close together, their accepted order is authoritative: opening clears all earlier collapsed attention, while a later expanded delivery starts a new transient projection.

### 4. Keep one same-domain status and one renderer

The selected author, its current lifetime, and an expanded deadline sufficient to reproduce the remaining lifetime belong to `AppStatusDomain` beside open and unread attention. Same-domain tabs observe one author and, during an expanded transient, one deadline; another domain observes neither. A same-domain surface that mounts or hydrates during a live window shows only the remaining portion. A surface that mounts after expiry or after reading shows the daily logo. A collapsed unread author survives same-domain remount or hydration until expansion.

Field-scoped updates preserve unrelated current facts. Position writes cannot replace the author; delivery cannot change open or position; unread and persistent author clear together on opening. The expanded invariant remains `open => !unread`, while a transient author is presentation of an already-read delivery rather than unread state.

### 5. Replace only the launcher's inner identity

With no selected author, `AppButton` renders its current day-specific logo. With a selected author, the avatar replaces only that inner logo and fills the same circular launcher content area. The surrounding button, shimmer, shadow, size, hit target, open/close label, context menu, drag handle, geometry, and stacking stay unchanged.

The existing orange unread badge remains visible whenever the collapsed status satisfies `!open && unread`, including while the persistent author avatar is visible. It remains absent while expanded, including during a transient avatar. Restoring the daily logo adds no count, text, layout shift, queued animation, or alternate launcher state.

The inner logo/avatar replacement may run through one launcher-local same-document View Transition. The state update begins in the transition callback without waiting for any previous animation. A newer delivery, clear, collapse, or expiry supersedes an active icon transition rather than queueing behind it, and its own author/deadline remains authoritative. The transition identity is scoped only to the AppButton's inner logo/avatar; it cannot capture the button, unread badge, shell, menu, Danmaku, MediaPreview, or host page. Reduced-motion preference, missing native support, start rejection, callback failure, or transition failure produces the same immediate final DOM and state with no animation and no extended lifetime.

### 6. Verify the state machine at the public boundaries

Deterministic controls use same-domain tabs A, B, and C plus another-domain tab D. They cover an expanded delivery at `0ms`, exact retention before `1,000ms`, restoration at `1,000ms`, and a newer delivery before expiry whose author and deadline cannot be cleared by the older timeout. They repeat the burst with the same author, switch between different authors, collapse during a transient, admit multiple collapsed deliveries, reopen, and hydrate both before and after expiry.

Presentation controls require the author image and name-initial fallback inside the unchanged launcher, the unchanged daily logo when clear, and coexistence with the existing collapsed unread badge. If the implementation uses View Transition, controls also prove inner-icon-only capture, immediate supersession, reduced-motion/no-support/rejection/failure settlement, and no effect on the author deadline. Eligibility controls preserve the current self/history/duplicate/reaction/system exclusions and notification-setting independence.

## Risks / Trade-offs

- [An older timer fires after a newer message] -> Generation ownership prevents it from clearing the latest author.
- [Several tabs receive or hydrate the same state at different times] -> One shared author and absolute deadline provide the same remaining expanded lifetime without per-tab extensions.
- [A collapsed avatar outlives a document] -> The same-domain status preserves it until the explicit open/read transition.
- [The shell collapses during an expanded transient] -> The transient clears because that already-visible delivery is not unread; only a later collapsed delivery can create persistent identity.
- [An avatar image is empty or fails] -> The existing author name-initial fallback preserves a recognizable, bounded launcher result.
- [A native icon transition is active when the next state arrives] -> The next state supersedes the animation immediately; the transition never owns author order or lifetime.
