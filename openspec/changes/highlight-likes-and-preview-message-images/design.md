## Context

The message projection already exposes the current user's membership separately from the complete aggregate for both likes and hates. The shared `LikeButton` currently uses only current-user membership for each control's color, so either reaction contributed solely by other users retains the default gray presentation.

The shared Markdown renderer currently has two image branches: Markdown image syntax and image-valued links. Both use `max-width:70%`, neither has a height bound, and their duplicated element construction can diverge. The current App mounts AppMain, AppButton, and Danmaku inside one Shadow-root React tree. No image-preview owner exists.

See `proposal.md` for motivation and `specs/webrtc-runtime/spec.md` for the complete observable contract.

## Goals / Non-Goals

**Goals:**

- Keep current-user membership as each reaction control's toggle truth while deriving both like and hate color from their matching existing aggregates.
- Give both Markdown image forms one sanitized inline renderer and one preview activation path.
- Give each message image one lifecycle-owned Blob URL that its inline and preview images reuse.
- Size inline images from one message-content CSS query container, with equal `70cqi` maximums on both axes and no runtime geometry owner.
- Keep exactly one local `MediaPreview` component/state owner inside the existing App root and at the Danmaku component level.
- Provide deterministic fit, toolbar order, guarded opening, zoom, pan, layer, close, focus, and motion behavior without host-page ownership.
- Keep interaction controls keyboard-, pointer-, touch-, and reduced-motion-accessible.

**Non-Goals:**

- Changing reaction projection, LWW, count values, add-or-remove semantics, send commands, history, persistence, peer protocol, or message content.
- Adding another Domain, Extern, application root, portal root, event bus, persistence key, dependency, permission, public API, or host-page style owner.
- Adding any media type other than the currently confirmed rendered message image.
- Adding image upload, alternate network fetching, crop, rotation, download, carousel, annotation, square placeholders, runtime measurement, `ResizeObserver`, or persistent preview state.
- Mutating host-page business state, assigning transition names or styles to host elements, styling the document transition pseudo-tree, or adding an experimental/scoped transition API branch.
- Changing the WebChat shell, AppButton, Danmaku, notification, unread, Runtime, or page-scroll behavior.

## Decisions

### 1. Separate aggregate reaction emphasis from current-user toggle state

Each reaction control derives its active visual fact directly from whether its already projected aggregate count is greater than zero. A positive like selects the same red treatment for the like icon and count; a positive hate selects that same red treatment for the hate icon and count. Each existing current-user membership boolean remains the independent interaction state that decides whether the next command adds or removes only that user's matching reaction.

The shared reaction-button presentation owns this symmetric `count > 0` rule. Like count changes affect only the like control, and hate count changes affect only the hate control. No second projection, cached color state, Domain query, or reaction record is needed.

### 2. Render every message image through one shared control

Both ReactMarkdown image callbacks delegate to the same message-image component. The containing message content establishes `container-type: inline-size`. The image applies `max-inline-size: 70cqi`, `max-block-size: 70cqi`, `inline-size: auto`, `block-size: auto`, and `object-fit: contain`, then exposes one accessible preview trigger from the sanitized rendered source and alternative text.

That message-image component owns exactly one Blob URL for its current source. The inline image and the preview request reuse that URL; rerendering and activation do not create another URL. The same lifecycle owner revokes it exactly once when its image leaves the message lifecycle. This removes repeated source conversion without making browser image-decoding behavior part of the product contract.

The two equal maximums are derived from the same message-container inline size while the automatic used dimensions preserve the source aspect ratio. There is no fixed square box, crop, JavaScript measurement, `ResizeObserver`, measured-size state, or second sizing owner. This makes size, containment, focus, and activation structurally identical for both syntaxes.

### 3. Make `MediaPreview` the sole local preview owner in the existing root

One `MediaPreview` component owns the current image, activating element, zoom, translation, and in-progress gesture. It lives in the existing App React/Shadow tree at the same composition level as the Danmaku container and renders its overlay in place. A component-scoped React context exposes only the open-image action to the shared message-image renderer; it creates no second business owner, portal, document root, global event, Domain, or Extern.

The current contract accepts only the lifecycle-owned Blob URL and alternative text derived by the shared message-image renderer. The generic component name does not authorize any unconfirmed input type, speculative branch, placeholder, or fallback.

### 4. Split backdrop and preview-body layer ownership

The extension-owned application surface establishes one stacking context above host-page content. Inside it, the backdrop uses a local layer below the existing WebChat shell, AppButton, and Danmaku, while the preview body, image, and controls use a local layer above those surfaces. The icon toolbar is laid out below the preview image rather than above it or over it. The shell therefore remains visible and operable above the backdrop wherever the preview body does not cover it. The backdrop uses a neutral dark fill at exactly `18%` opacity and no blur, gradient, or decorative surface.

During a document View Transition, browser-owned snapshots render in the transition pseudo-layer above ordinary document stacking. That temporary transition placement is consistent with the preview body being above the shell. Layer tests bind the real application stacking context and relative order, not a duplicated root or an assumption about arbitrary host-page z-index values.

### 5. Derive one fitted baseline and one bounded transform

The preview first computes an aspect-preserving natural-size fit inside the viewport minus `24px` on each edge. The smaller of natural size and available size becomes fitted `1x`, so opening does not implicitly upscale a small image. Zoom is one multiplier over that baseline, clamped to `[0.25,4]`. User zoom may therefore reduce the image below its fitted baseline and natural dimensions without changing the initial open size.

For each axis, pan remains zero while the scaled image fits the available rectangle, so every reduced image stays centered. When it overflows, translation is clamped to half the difference between the scaled and available dimensions. An extreme pan therefore aligns, but never moves, the corresponding image edge past the viewport margin. Focal wheel and pinch zoom preserve the image point under the gesture before applying the same clamp. Viewport resize recomputes fit and clamps the current transform without persisting it.

### 6. Centralize pointer, touch, wheel, and keyboard interaction

The four icon controls use familiar zoom-out, zoom-in, reset, and close symbols with accessible names and tooltips. Button and keyboard zoom use `0.25x` steps; every zoom input shares the `0.25x` through `4x` bounds; reset and `0` restore fitted `1x`. The zoom-out control is disabled only at `0.25x`, and zoom-in is disabled at `4x`. Wheel/trackpad and two-pointer pinch use their local focal point. A single captured pointer pans only while zoom makes at least one axis overflow; reduced images that fit remain centered and do not pan.

The owner records whether a pointer sequence became a drag. Release settles pan and suppresses the click that would otherwise bubble to the backdrop. Event prevention is scoped to preview gestures; no handler mutates `document.body`, document scrolling, or host styles. Closing clears every gesture and transform fact.

### 7. Keep open admission, close, and focus settlement in one owner

The owner admits one open request only while it is closed and records the opening state synchronously. Every later open request while opening or open returns without changing the source, activator, transition, zoom, pan, or gesture state. There is no replacement operation.

Backdrop click without a drag, the close icon, Escape, and synchronized shell collapse call the same close operation. It clears the current image and transform exactly once, then restores focus to the saved activating element if it is still connected.

The shell stays operable above the backdrop in every area the preview body does not cover. Its ordinary message and control behavior remains independent except that collapsing the shell also closes its current preview.

### 8. Use one document View Transition with one temporary image identity

When `document.startViewTransition` is available and reduced motion is not requested, `MediaPreview` performs the admitted open or close state operation inside one document View Transition. The activating image and current preview image share one generation-scoped temporary identity, while the browser also captures and briefly crossfades the document root. A pre-existing host-defined named participant remains browser-owned and may also participate. That document participation is visual only: WebChat assigns no name or style to a host element and changes no host business state.

The sole preview owner keeps one active temporary-identity record and restores the original identity when the operation settles or closes. A repeated open cannot supersede that record. Preview state remains authoritative, and the admitted operation settles exactly once without another preview or stale marker. Reduced motion, a missing API, a synchronous failure, a rejected or skipped transition, or another document transition that prevents execution takes the same state operation immediately. Motion never delays close cleanup or focus restoration.

### 9. Verify behavior through current UI boundaries

Focused component controls cover positive and zero aggregates for both likes and hates, type-local color independence, and current-user add/remove behavior for each control. Shared renderer controls cover both Markdown syntaxes, the message-content query owner, equal `70cqi` maximums, automatic aspect-preserving dimensions, one Blob URL per image lifecycle, inline/preview URL identity, one-time revocation, sanitized source/alt preservation, keyboard activation, and the absence of runtime measurement state. `MediaPreview` controls cover composition ancestry, one owner, the split backdrop/body layers, toolbar placement below the image, `24px` fit, no implicit upscale, opening/open repeated-request no-op behavior, every close path, focus, zoom inputs, focal math, pan bounds, drag suppression, reset, resize, event cleanup, document View Transition, whole-page crossfade, reduced motion, failure fallback, and host-state preservation.

Browser-mode coverage verifies rendered geometry, input behavior, focus, and computed layer order. Structural controls exclude a second root/portal, Domain/Extern/persistence/dependency, duplicated image policy, and host `body` mutation.

## Risks / Trade-offs

- [A red reaction no longer means the current user personally contributed it] -> Current-user membership remains the independent toggle input and accessible pressed state for each reaction; red intentionally represents any positive matching aggregate.
- [The preview body can overlap the WebChat shell] -> This is the confirmed layer result; the preview body wins above the shell while the shell remains visible and operable above the backdrop wherever it is not covered.
- [Zoom gestures can leak into the host page] -> Consume only active preview wheel/pointer/touch gestures with non-passive handling where required, and never install a body scroll lock.
- [A pan release can look like a backdrop click] -> Track drag intent under pointer capture and suppress only that settlement click.
- [Document View Transition crossfades the page root] -> The brief whole-page and shell crossfade is accepted for open and close; final layout, color, layer, and business state remain unchanged.
- [A later image activation can arrive while opening or open] -> The sole owner records opening synchronously and treats every later open request as a no-op, so no second source, transition, or transform state can compete.
- [Another document transition can prevent execution] -> The unavailable, skipped, rejected, or blocked path applies the admitted preview state directly.
