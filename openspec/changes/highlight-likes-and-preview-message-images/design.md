## Context

The message projection already exposes the current user's like membership separately from the complete active-like aggregate. The shared `LikeButton` currently uses only current-user membership for its color, so likes contributed solely by other users retain the default gray presentation. The same button also renders hates, which must not inherit the new aggregate-like rule.

The shared Markdown renderer currently has two image branches: Markdown image syntax and image-valued links. Both use `max-width:70%`, neither has a height bound, and their duplicated element construction can diverge. The current App mounts AppMain, AppButton, and Danmaku inside one Shadow-root React tree. No image-preview owner exists.

See `proposal.md` for motivation and `specs/webrtc-runtime/spec.md` for the complete observable contract.

## Goals / Non-Goals

**Goals:**

- Keep current-user reaction membership as the like toggle truth while deriving like color from the existing active-like aggregate.
- Give both Markdown image forms one sanitized inline renderer and one preview activation path.
- Size inline images from one message-content CSS query container, with equal `70cqi` maximums on both axes and no runtime geometry owner.
- Keep exactly one local `MediaPreview` component/state owner inside the existing App root and at the Danmaku component level.
- Provide deterministic fit, zoom, pan, layer, close, focus, and motion behavior without host-page ownership.
- Keep interaction controls keyboard-, pointer-, touch-, and reduced-motion-accessible.

**Non-Goals:**

- Changing reaction projection, LWW, counts, hate behavior, send commands, history, persistence, peer protocol, or message content.
- Adding another Domain, Extern, application root, portal root, event bus, persistence key, dependency, permission, public API, or host-page style owner.
- Adding any media type other than the currently confirmed rendered message image.
- Adding image upload, source rewriting, alternate fetching, crop, rotation, download, carousel, annotation, square placeholders, runtime measurement, `ResizeObserver`, or persistent preview state.
- Calling `document.startViewTransition`, assigning `viewTransitionName`, participating in a host transition, styling a host transition pseudo-tree, or adding an experimental/scoped transition API branch.
- Changing the WebChat shell, AppButton, Danmaku, notification, unread, Runtime, or page-scroll behavior.

## Decisions

### 1. Separate aggregate visual emphasis from current-user toggle state

The like row derives `hasActiveLikes` directly from the already projected `reactions.likes.length > 0`. That fact selects the existing current self-like red treatment for the like heart and count. The existing current-user membership boolean remains the interaction state that decides whether the next command adds or removes only that user's like.

The aggregate emphasis is like-specific. It must not be implemented as a generic `count > 0` rule inside the shared button that would silently change hate presentation. No second projection, cached color state, Domain query, or reaction record is needed.

### 2. Render every message image through one shared control

Both ReactMarkdown image callbacks delegate to the same message-image component. The containing message content establishes `container-type: inline-size`. The image applies `max-inline-size: 70cqi`, `max-block-size: 70cqi`, `inline-size: auto`, `block-size: auto`, and `object-fit: contain`, then exposes one accessible preview trigger from the sanitized rendered source and alternative text.

The two equal maximums are derived from the same message-container inline size while the automatic used dimensions preserve the source aspect ratio. There is no fixed square box, crop, JavaScript measurement, `ResizeObserver`, measured-size state, or second sizing owner. This makes size, containment, focus, and activation structurally identical for both syntaxes.

### 3. Make `MediaPreview` the sole local preview owner in the existing root

One `MediaPreview` component owns the current image, activating element, zoom, translation, and in-progress gesture. It lives in the existing App React/Shadow tree at the same composition level as the Danmaku container and renders its overlay in place. A component-scoped React context exposes only the open-image action to the shared message-image renderer; it creates no second business owner, portal, document root, global event, Domain, or Extern.

The current contract accepts only a sanitized image source and alternative text. The generic component name does not authorize any unconfirmed input type, speculative branch, placeholder, or fallback.

### 4. Use explicit internal layer ordering

The preview overlay receives one fixed internal layer above the host page and below the existing WebChat shell, AppButton, and Danmaku layers. The backdrop and preview image share that layer so the shell intentionally remains visible and interactive over either one. The overlay uses a neutral dark fill at exactly `18%` opacity and no blur, gradient, or decorative surface.

Layer tests bind relative order, not a duplicated application root or an assumption about arbitrary host-page z-index values.

### 5. Derive one fitted baseline and one bounded transform

The preview first computes an aspect-preserving natural-size fit inside the viewport minus `24px` on each edge. The smaller of natural size and available size becomes fitted `1x`, so opening does not implicitly upscale a small image. Zoom is one multiplier over that baseline, clamped to `[1,4]`.

For each axis, pan remains zero while the scaled image fits the available rectangle. When it overflows, translation is clamped to half the difference between the scaled and available dimensions. An extreme pan therefore aligns, but never moves, the corresponding image edge past the viewport margin. Focal wheel and pinch zoom preserve the image point under the gesture before applying the same clamp. Viewport resize recomputes fit and clamps the current transform without persisting it.

### 6. Centralize pointer, touch, wheel, and keyboard interaction

The four icon controls use familiar zoom-out, zoom-in, reset, and close symbols with accessible names and tooltips. Button and keyboard zoom use `0.25x` steps; reset and `0` restore fitted `1x`. Wheel/trackpad and two-pointer pinch use their local focal point. A single captured pointer pans only while zoom makes at least one axis overflow.

The owner records whether a pointer sequence became a drag. Release settles pan and suppresses the click that would otherwise bubble to the backdrop. Event prevention is scoped to preview gestures; no handler mutates `document.body`, document scrolling, or host styles. Closing and source replacement clear every gesture and transform fact.

### 7. Keep close, replacement, and focus settlement in one owner

Backdrop click without a drag, the close icon, Escape, and synchronized shell collapse call the same close operation. It clears the current image and transform exactly once, then restores focus to the saved activating element if it is still connected. Opening another image calls one replacement operation that changes the source, saves the new activator, and resets the transform without adding another overlay.

The shell stays operable above the preview. Its ordinary message and control behavior remains independent except that collapsing the shell also closes its current preview.

### 8. Keep preview motion inside the existing WebChat surface

When reduced motion is not requested, `MediaPreview` animates its own backdrop and current preview image for open and close within the existing WebChat Shadow/App surface. The activating inline image remains only the trigger and focus-restoration target; it receives no transition identity or temporary style. The shell, AppButton, and Danmaku retain their local layer order above the preview throughout the effect.

Preview state remains authoritative while local motion is in progress. Replacement, close, or another open settles the latest source and state exactly once without leaving another preview, temporary identity, or presentation owner. Reduced motion takes the same state operation without animation. No motion path calls a document-wide transition, joins an active host transition, captures a host element, mutates host transition styles, or delays close cleanup or focus restoration.

### 9. Verify behavior through current UI boundaries

Focused component controls cover positive and zero aggregate likes, current-user add/remove behavior, and unchanged hates. Shared renderer controls cover both Markdown syntaxes, the message-content query owner, equal `70cqi` maximums, automatic aspect-preserving dimensions, sanitized source/alt preservation, keyboard activation, and the absence of runtime measurement state. `MediaPreview` controls cover composition ancestry, one owner, relative layers, `24px` fit, no implicit upscale, replacement, every close path, focus, zoom inputs, focal math, pan bounds, drag suppression, reset, resize, event cleanup, local motion, interruption, reduced motion, and host-transition isolation.

Browser-mode coverage verifies rendered geometry, input behavior, focus, and computed layer order. Structural controls exclude a second root/portal, Domain/Extern/persistence/dependency, duplicated image policy, and host `body` mutation.

## Risks / Trade-offs

- [A red like no longer means the current user personally liked] -> Current-user membership remains the independent toggle input and accessible pressed state; red intentionally represents any positive aggregate.
- [The WebChat shell can overlap the centered preview] -> This is the confirmed layer result; the shell remains usable and can replace or close the preview without moving its viewport-centered image.
- [Zoom gestures can leak into the host page] -> Consume only active preview wheel/pointer/touch gestures with non-passive handling where required, and never install a body scroll lock.
- [A pan release can look like a backdrop click] -> Track drag intent under pointer capture and suppress only that settlement click.
- [Local motion can be interrupted by replacement or close] -> The latest preview state is authoritative, and the sole component cancels or supersedes only its own presentation effect without retaining another owner or marker.
- [A host page can run an unrelated transition] -> WebChat never joins or controls it; preview motion remains inside the extension-owned surface and preserves the local layer order.
