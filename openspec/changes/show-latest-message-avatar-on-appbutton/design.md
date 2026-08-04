## Context

`AppStatusDomain` owns the one synchronized same-domain AppButton status, including `open` and unread attention. `AppButton` is its sole launcher renderer. A first-delivered remote text already reaches this owner with the complete author identity used by message avatars. The latest-author projection belongs to that same status boundary: it must not create another delivery path, unread owner, timer owner, or launcher renderer.

## Goals / Non-Goals

**Goals:**

- Make every synchronizing same-domain AppButton project the latest accepted eligible remote author while leaving other domains unchanged.
- Keep that author as the current expanded identity until exactly `1,000ms` after the latest eligible delivery, then start fading to the daily logo.
- Keep the latest collapsed unread author visible until the shell expands.
- Select the current author and begin its fade immediately on every newer eligible delivery, including repeated messages from the same author, and restart the expanded lifetime from that delivery.
- Make a paused or delayed same-domain surface converge to the latest accepted state when synchronization resumes, without extending a transient lifetime or leaving an older author as the settled result.
- Prevent an older timeout from clearing a newer author after the current state is observed.
- Fade every visible inner logo/avatar identity change with the existing Motion runtime without making animation progress part of the state machine.
- Preserve the current daily logo as the no-attention result and the current unread badge as an independent collapsed unread marker.

**Non-Goals:**

- Adding a message preview, unread count, sender queue, carousel, sound, setting, tooltip copy, notification rule, protocol field, public API, permission, dependency, Domain, or browser-specific branch.
- Changing message eligibility, delivery, ordering, history, duplicate handling, reactions, system notices, or message durable storage.
- Changing AppButton size, position, border, shimmer, unread badge, menu, drag, open/collapse interaction, label, or shell geometry.
- Queuing one-second author presentations or guaranteeing one second for an author that a newer delivery supersedes.
- Adding an animation queue, document-wide transition owner, custom duration/easing product setting, or another animation dependency.
- Guaranteeing instantaneous agreement with a paused or delayed same-domain surface, or adding another persistence owner or synchronization queue for that surface.

## Decisions

### 1. Reuse the first-delivered remote-text authority

Only a first-delivered remote text from an author other than the configured local user can select the launcher author. Self-authored text, history application, duplicate delivery, reactions, and system notices cannot select or extend it. Browser focus, active/highlighted tab state, and browser-notification enabled/type settings do not gate this projection.

The delivery's complete author identity is the presentation input. The avatar image uses the same author avatar as message presentation; an empty or failed image uses the author's existing name-initial fallback.

### 2. Let accepted delivery order choose the lifetime

An eligible delivery accepted while the shared domain is expanded selects its author immediately on an observing surface and sets one shared deadline exactly `1,000ms` after that delivery. At the deadline, author ownership clears and the fade to the daily logo begins unless a newer eligible delivery owns the projection. A repeated delivery from the same author refreshes the deadline even though the rendered avatar does not visibly change.

An eligible delivery accepted while the shared domain is collapsed selects its author immediately on an observing surface as the persistent unread author. It has no one-second expiry and remains until the shared shell expands. Expanding clears unread and this persistent author together, so every synchronizing same-domain AppButton starts fading to the daily logo. Collapsing without a new unread delivery uses the daily logo and cannot preserve or create unread identity; if an expanded transient author is still current, collapse clears it and starts the fade rather than converting an already-read message into persistent attention.

### 3. The newest eligible delivery always supersedes

Each eligible delivery accepted into the shared status becomes the sole current generation immediately. When that changes the rendered identity, its Motion fade begins without waiting for the outgoing one-second lifetime or an exit animation. A newer delivery from the same author still becomes a new generation but does not need another fade when the rendered identity is unchanged. In an expanded shell, the newest generation receives a fresh exact `1,000ms` deadline; in a collapsed shell, it becomes the persistent unread author.

Expiry, open/clear, hydration, and synchronization effects preserve accepted order. An older timeout cannot clear a newer avatar after that state is observed. When an open/clear and a delivery occur close together, their accepted order is authoritative: opening clears all earlier collapsed attention, while a later expanded delivery starts a new transient projection. A paused surface may temporarily render its older observation, but that observation cannot remain or become the settled same-domain result after current synchronization arrives.

### 4. Keep one same-domain status and one renderer

The selected author, its current lifetime, and an expanded deadline sufficient to reproduce the remaining lifetime belong to `AppStatusDomain` beside open and unread attention. Same-domain tabs converge to one author and, during an expanded transient, one deadline; another domain observes neither. A synchronizing same-domain surface that mounts or hydrates during a live window shows only the remaining portion. A surface that receives the current state after expiry or after reading shows the daily logo. A collapsed unread author survives same-domain remount or hydration until expansion.

The status keeps one field-scoped persistence and synchronization boundary. A paused document, delayed event loop, or delayed synchronization may temporarily retain the last author, open, and unread result that surface observed. Once synchronization or hydration resumes and the current same-domain state arrives, the surface converges to it. A transient keeps its original absolute deadline: resuming before the deadline shows only the remainder, while resuming at or after the deadline shows the daily logo and never starts another `1,000ms` window.

Field-scoped updates preserve unrelated current facts. Position writes cannot replace the author; delivery cannot change open or position; unread and persistent author clear together on opening. The expanded invariant remains `open => !unread`, while a transient author is presentation of an already-read delivery rather than unread state.

### 5. Replace only the launcher's inner identity

With no selected author, `AppButton` renders its current day-specific logo. With a selected author, the avatar replaces only that inner logo and fills the same circular launcher content area. The surrounding button, shimmer, shadow, size, hit target, open/close label, context menu, drag handle, geometry, and stacking stay unchanged.

The existing orange unread badge remains visible whenever the collapsed status satisfies `!open && unread`, including while the persistent author avatar is visible. It remains absent while expanded, including during a transient avatar. Restoring the daily logo adds no count, text, layout shift, queued animation, or alternate launcher state.

Every normal-motion change between distinct rendered identities uses the project's existing Motion runtime to fade opacity: daily logo to author avatar, one author avatar to another, and author avatar back to the daily logo. The outgoing identity starts fading out while the current identity starts fading in from the same state update; no normal-motion identity change is an instantaneous replacement.

A newer delivery, clear, collapse, or expiry starts its current fade immediately and supersedes an active fade rather than queueing behind it. Animation progress cannot own, delay, restart, or extend author order, unread truth, or the exact expanded deadline. Expiry clears author ownership and starts the fade to the daily logo exactly at the deadline; opening or collapsing starts the corresponding fade when its state change is accepted. Stale animation settlement cannot restore an older identity.

Motion is scoped only to the AppButton's inner daily-logo/avatar content. It cannot animate or capture the button, unread badge, shell, menu, Danmaku, MediaPreview, or host page. Reduced-motion preference settles the current inner identity directly with the same final DOM and state, no queue, and no lifetime extension.

### 6. Verify the state machine at the public boundaries

Deterministic controls use same-domain tabs A, B, and C plus another-domain tab D. They cover an expanded delivery at `0ms`, exact author ownership before `1,000ms`, the fade to daily logo beginning at `1,000ms`, and a newer delivery before expiry whose author and deadline cannot be cleared by the older timeout. They repeat the burst with the same author, switch between different authors, collapse during a transient, admit multiple collapsed deliveries, reopen, and hydrate both before and after expiry.

Presentation controls require the author image and name-initial fallback inside the unchanged launcher, the unchanged daily logo when clear, and coexistence with the existing collapsed unread badge. They prove Motion opacity fades for daily logo to author, author to a different author, and author to daily logo; latest-state fade supersession without waiting; inner-content-only scope; reduced-motion direct settlement; and no effect on the author deadline. Eligibility controls preserve the current self/history/duplicate/reaction/system exclusions and notification-setting independence.

## Risks / Trade-offs

- [An older timer fires after a newer message] -> Generation ownership prevents it from clearing the latest author.
- [Several tabs receive or hydrate state at different times] -> A delayed surface may briefly show its last observation, then converges to the latest accepted state; the absolute deadline prevents per-tab lifetime extensions.
- [A collapsed avatar outlives a document] -> The same-domain status preserves it until the explicit open/read transition.
- [The shell collapses during an expanded transient] -> The transient clears because that already-visible delivery is not unread; only a later collapsed delivery can create persistent identity.
- [An avatar image is empty or fails] -> The existing author name-initial fallback preserves a recognizable, bounded launcher result.
- [An inner identity fade is active when the next state arrives] -> The next state starts fading immediately and supersedes the prior presentation; animation never owns author order or lifetime.
