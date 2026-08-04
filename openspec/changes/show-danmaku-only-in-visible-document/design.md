## Context

Each content document owns one local Danmaku surface through the existing Danmaku Domain/Extern boundary. The existing profile setting owns whether that manager exists. The Danmaku Domain runs in that content document and can read exact `document.visibilityState` itself when a new otherwise-eligible live delivery reaches its existing push boundary; visibility is not manager lifecycle state or App-provided mount state.

See `proposal.md` for the product motivation and `specs/webrtc-runtime/spec.md` for the observable contract.

## Goals / Non-Goals

**Goals:**

- Admit each new Danmaku only when the existing setting is enabled and exact `document.visibilityState === 'visible'` at that delivery.
- Keep the existing setting and content lifecycle as the only manager lifecycle owner.
- Let visibility changes leave every already accepted rendered or pending item untouched by WebChat.
- Drop live deliveries observed while non-visible and allow only later new deliveries after visibility returns.
- Let two same-domain documents independently project their own visibility while preserving every shared Chat, AppStatus, unread, and notification fact.
- Read current document visibility directly inside the Danmaku Domain at admission without adding an App/mount parameter, retained getter, listener, state copy, lifecycle effect, or persistent fact.

**Non-Goals:**

- Changing the existing Danmaku setting, its Options UI, default, persistence, or eligible message classes.
- Using browser-window focus, tab active/highlighted status, background tab APIs, tab enumeration, or cross-tab synchronization to decide Danmaku visibility.
- Passing or retaining a visibility value/getter through the App, mount/unmount commands, or Domain state; adding a visibility listener, state owner, manager lifecycle branch, Domain, Extern, coordinator, persistence key, protocol message, permission, background service, queue, replay path, timer, or dependency.
- Changing message receipt, history/list projection, panel state, unread attention, notifications, Runtime, peer protocol, or cross-domain behavior.
- Promising how the browser or existing Danmaku library advances time while a document is hidden; WebChat only refrains from clearing, restarting, or otherwise changing accepted items because visibility changed.

## Decisions

### 1. Evaluate one exact document-local admission formula

The existing live-message projection evaluates one predicate for each otherwise-eligible delivery:

`danmakuEnabled && document.visibilityState === 'visible'`.

Strict equality means every other browser visibility state rejects that new push. Browser-window focus and browser tab metadata do not participate. The Danmaku Domain reads the predicate synchronously from its own content document at the existing push boundary. The App does not provide a visibility value or getter through mount, and the Domain does not retain one for later use. The predicate is not stored, observed, persisted, synchronized, sent through Runtime, or copied into an independent owner. The existing Danmaku Domain/Extern remains the only Danmaku behavior boundary.

### 2. Keep visibility out of manager lifecycle

The existing setting and content application lifecycle continue to control the local Danmaku manager. While that setting is enabled, the manager remains under the same owner regardless of document visibility. A visibility transition dispatches no Danmaku command and performs no mount, unmount, clear, pause, resume, restart, or manager replacement.

Visibility participates only when the existing live-message effect decides whether to call `push`. The setting remains authoritative: visibility cannot enable Danmaku when the setting is off. Because visibility owns no lifecycle, there is no observer/state synchronization window between a visibility event and message admission.

### 3. Preserve already accepted Danmaku

Once a visible configured document has accepted an item through the existing manager, document visibility does not revoke that acceptance. Switching away and immediately back must not make WebChat clear, replace, restart, or duplicate the rendered or pending item.

The existing Danmaku runtime remains responsible for its normal item timeline. If an item naturally completes while hidden, WebChat does not reconstruct it on return. If it remains current, WebChat does not remove it merely because visibility changed. Setting changes and content disposal retain their existing lifecycle behavior.

### 4. Never queue or replay hidden deliveries

Eligibility is evaluated when an otherwise-eligible live delivery reaches the Danmaku projection. If the local document is non-visible at that point, the delivery produces no Danmaku item and creates no deferred work. Returning to visible does not inspect Chat history or resubmit a dropped projection. Only a later new eligible delivery may be pushed.

A delivery accepted while visible retains its existing manager lifecycle even if the document becomes non-visible afterward. A different delivery observed while non-visible remains absent even when the document becomes visible afterward.

### 5. Keep same-domain documents locally independent

For two same-domain tabs A and B, A's `document.visibilityState` controls only whether A admits that new Danmaku, and B's state controls only whether B admits it. If A is non-visible and B is visible while the same eligible live message reaches both, A shows nothing and B may show the message. Making A visible later does not replay that message.

This local decision does not modify the domain's shared message, AppStatus, open, unread, notification, or persistence truth. It therefore needs no background tab lookup, active-tab arbitration, cross-tab winner, or shared visibility owner.

### 6. Verify admission without lifecycle effects

Deterministic controls cover visible and non-visible admission, `visible -> hidden -> visible` around an already accepted item, setting on and off, delivery before/during/after a non-visible interval, and two same-domain documents with opposite visibility. They require zero visibility-driven manager or item lifecycle actions, zero hidden pushes, zero replay, and one later visible push.

Structural controls keep the existing Danmaku Domain/Extern and setting-driven manager lifecycle as the sole behavior boundary and exclude an App/mount-injected visibility value or getter, retained visibility state, visibility listener/state/lifecycle owner, browser tab/window APIs, background coordination, persistence, protocol, permissions, new UI, and additional dependencies.

## Risks / Trade-offs

- [A document becomes non-visible while Danmaku is moving] -> WebChat performs no lifecycle action, so switching back does not clear or restart the accepted item; its normal library/browser timeline remains unchanged.
- [A live message arrives during a non-visible interval] -> Its Danmaku projection is dropped without a queue; the Chat message itself remains governed by the unchanged message path.
- [The document becomes visible after hidden deliveries] -> Those deliveries have no retained presentation authority and cannot appear; only a later new delivery qualifies.
- [Several same-domain tabs receive the same message] -> Each document applies its own local visibility, so only locally visible surfaces present Danmaku without cross-tab arbitration.
- [Visibility changes rapidly] -> No listener or lifecycle action exists to churn the manager; each new delivery reads the current document state once.
