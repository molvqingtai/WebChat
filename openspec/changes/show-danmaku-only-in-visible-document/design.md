## Context

Each content document owns one local Danmaku surface through the existing Danmaku Domain/Extern boundary. The existing profile setting determines whether the user permits Danmaku. The browser document supplies the only additional local fact: exact `document.visibilityState`. These two facts form one presentation eligibility value for that document.

See `proposal.md` for the product motivation and `specs/webrtc-runtime/spec.md` for the observable contract.

## Goals / Non-Goals

**Goals:**

- Define one local Danmaku eligibility result as `danmakuEnabled && document.visibilityState === 'visible'`.
- Use that same result for the existing Danmaku presentation lifecycle and every live-message push so mounted state and admission cannot disagree.
- Clear all current local Danmaku immediately when eligibility becomes false.
- Drop live deliveries observed while eligibility is false and allow only later new deliveries after eligibility becomes true.
- Let two same-domain documents independently project their own visibility while preserving every shared Chat, AppStatus, unread, and notification fact.
- Observe and clean up the document visibility lifecycle without adding shared or persistent state.

**Non-Goals:**

- Changing the existing Danmaku setting, its Options UI, default, persistence, or eligible message classes.
- Using browser-window focus, tab active/highlighted status, background tab APIs, tab enumeration, or cross-tab synchronization to decide Danmaku visibility.
- Adding a Domain, Extern, coordinator, persistence key, protocol message, permission, background service, queue, replay path, timer, or dependency.
- Changing message receipt, history/list projection, panel state, unread attention, notifications, Runtime, peer protocol, or cross-domain behavior.
- Pausing or resuming cleared Danmaku items across a visibility transition.

## Decisions

### 1. Use one exact document-local eligibility formula

The existing Danmaku application boundary owns one derived boolean for the local content document:

`danmakuEnabled && document.visibilityState === 'visible'`.

Strict equality means every other browser visibility state is non-visible. Browser-window focus and browser tab metadata do not participate. The value is ephemeral presentation state: it is not persisted, synchronized, sent through Runtime, or copied into an independent owner. The existing Danmaku Domain/Extern remains the only Danmaku behavior boundary.

### 2. Drive lifecycle and message admission from the same result

The same derived eligibility controls both the local Danmaku surface lifecycle and every otherwise-eligible live-text push. When it is true, the existing Danmaku manager may present new eligible deliveries. When it is false, the manager presents nothing and the message path performs no Danmaku push.

This single gate prevents a non-visible document from having an unmounted surface while its message effect still tries to push, and prevents a mounted surface from accepting messages under a different visibility truth. The setting remains authoritative: visibility cannot enable Danmaku when the setting is off.

### 3. Clear immediately when the document is not visible

The content document reads its initial visibility and observes its own `visibilitychange` lifecycle. A transition from eligible to ineligible clears all rendered and pending local Danmaku items in the same accepted transition. No item may remain on screen, finish its prior motion, pause for later, or reappear after the document becomes visible.

Repeated non-visible observations are idempotent. The visibility listener and Danmaku resources are disposed with the content document so remounting cannot duplicate listeners, managers, clears, or pushes.

### 4. Never queue or replay hidden deliveries

Eligibility is evaluated when an otherwise-eligible live delivery reaches the Danmaku projection. If the local document is non-visible at that point, the delivery produces no Danmaku item and creates no deferred work. Returning to visible does not inspect Chat history, resubmit a dropped projection, or resume an old item. Only a later new eligible delivery may appear.

A delivery accepted while visible is still removed if the document becomes non-visible before its visual lifetime finishes. A delivery observed while non-visible remains absent even when the document becomes visible afterward.

### 5. Keep same-domain documents locally independent

For two same-domain tabs A and B, A's `document.visibilityState` controls only A's Danmaku surface and B's state controls only B's. If A is non-visible and B is visible while the same eligible live message reaches both, A shows nothing and B may show the message. Making A visible later does not replay that message.

This local decision does not modify the domain's shared message, AppStatus, open, unread, notification, or persistence truth. It therefore needs no background tab lookup, active-tab arbitration, cross-tab winner, or shared visibility owner.

### 6. Verify visibility, setting, and delivery as one matrix

Deterministic controls cover initial visible and non-visible documents, `visible -> hidden -> visible`, repeated visibility events, setting on and off, delivery before/during/after a non-visible interval, and two same-domain documents with opposite visibility. They require immediate clear, zero hidden pushes, zero replay, one later visible push, and complete listener/resource cleanup.

Structural controls keep the existing Danmaku Domain/Extern as the sole behavior boundary and exclude browser tab/window APIs, background coordination, persistence, protocol, permissions, new UI, and additional dependencies.

## Risks / Trade-offs

- [A document becomes non-visible while Danmaku is moving] -> The current surface is cleared immediately; visual completion and resume do not outlive eligibility.
- [A live message arrives during a non-visible interval] -> Its Danmaku projection is dropped without a queue; the Chat message itself remains governed by the unchanged message path.
- [The document becomes visible before an asynchronously pending cleared item would render] -> The cleared item has no retained presentation authority and cannot appear; only a later new delivery qualifies.
- [Several same-domain tabs receive the same message] -> Each document applies its own local visibility, so only locally visible surfaces present Danmaku without cross-tab arbitration.
- [Visibility events repeat or the content application remounts] -> Idempotent lifecycle handling and cleanup prevent duplicate listeners, managers, clears, and pushes.
