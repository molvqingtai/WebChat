## Why

Likes and hates from other users currently remain gray unless the current user contributes the same reaction, so each positive reaction aggregate can have two conflicting visual results. Message images also have no height bound and no focused inspection surface, allowing long images to dominate the conversation while leaving their detail difficult to inspect. The shell's cross-edge movement also needs a settled duration and timing curve so switching sides remains readable rather than abrupt.

## What Changes

- Show one red treatment on each like or hate icon and visible count whenever the matching reaction aggregate contains at least one user, regardless of whether the current user is one of those users. Return that reaction control to the default gray treatment only when its own active count reaches zero.
- Keep current-user membership in each reaction aggregate as that control's interaction toggle input without changing reaction aggregation, counts, persistence, or peer semantics.
- Make message content an inline-size query container and render both Markdown image syntax and image-valued links through one message-image presentation whose maximum inline size and maximum block size are both `70cqi`. Keep both used dimensions automatic so the complete image preserves its source aspect ratio without crop, distortion, or a square placeholder.
- Give each message image one stable Blob URL for its lifecycle. Its inline image and preview image reuse that URL without recreating it on render or activation, and the same lifecycle owner revokes it when the image leaves that lifecycle.
- Open any valid rendered message image in one centered `MediaPreview` component inside the existing WebChat App root and at the same component level as the Danmaku container.
- Keep the neutral dark backdrop at `18%` opacity above the host page but below the WebChat shell, AppButton, and Danmaku. Place the preview body and its controls above those WebChat surfaces; the shell remains visible and operable above the backdrop wherever the preview body does not cover it.
- Fit the initial preview within a `24px` viewport margin without forcing a small source image larger. Keep its icon toolbar below the preview image. Support one bounded `0.25x` to `4x` zoom multiplier over fitted `1x` through icon controls, wheel or trackpad, pinch, keyboard, and pointer or touch drag.
- Keep exactly one current preview. When its opening animation is still running, re-activating the same message-inline image immediately skips that opening's remaining visual animation, waits only for its state update to commit, and then plays one independent complete close animation. Activating a different message-inline image while one is opening or open keeps the backdrop and preview surface continuously mounted at their current visual state, replaces only the image content, clears the previous image without a close animation or focus restoration, resets preview transform and gesture state, makes the new image and activator current, and plays the new image's complete opening animation from its own inline source without any backdrop fade, reopen, or flicker. Clicking the enlarged preview image itself does not close it.
- Close through current-inline-image re-activation, the backdrop, the close control, Escape, or shell collapse and restore focus to the current activating image. Closing or switching images resets zoom and pan.
- Use `document.startViewTransition` for open, close, and the new image's opening when it is available and motion is allowed. The browser-managed document-root snapshot and brief whole-page crossfade are part of opening and closing, while a different-image switch preserves the already visible backdrop and preview surface throughout the new image's complete opening. WebChat changes no host-page business state or host-element transition styles. Complete the same state change immediately when the API is unavailable, cannot run, or reduced motion is requested.
- Animate the shell's cross-edge offset between `0` and `-100%` over `300ms` with a `linear` timing function. Keep the exact viewport midpoint as the trigger line and preserve the current endpoints and position behavior.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `webrtc-runtime`: Define symmetric aggregate reaction presentation, the bounded, layered, accessible, zoomable message-image preview result, and the settled shell cross-edge motion in the existing WebChat application root.

## Impact

- Affected behavior: like and hate color when any user has the matching active reaction, inline message-image dimensions and Blob URL lifetime, centered preview, toolbar placement, deterministic same-image opening-to-closing handoff, different-image replacement with an uninterrupted overlay, zoom, pan, close, focus restoration, layer ordering, motion fallback, and shell cross-edge timing.
- Affected implementation: the shared reaction-button presentation, the message-content query container, the shared Markdown image renderer and its one image-resource lifecycle, the current App composition, one `MediaPreview` component/state owner beside the Danmaku container, and the shell's existing cross-edge transition style.
- Affected verification: symmetric like/hate aggregate color transitions; both image syntaxes; stable URL reuse and revocation; inline dimensions; split backdrop/preview-body layer order; toolbar placement; same-image opening skip and complete close animation; different-image replacement with no old-image close animation, no backdrop unmount/fade/reopen, and one fresh opening animation from the new inline source; input methods; bounded transform; close/switch reset and focus behavior; document View Transition and whole-page crossfade; reduced-motion and failure paths; host-state preservation; and absence of duplicate owners. The shell timing amendment adds no new dedicated test.
- Unchanged: reaction LWW projection, current-user reaction toggling, message counts and content, source sanitization, message delivery/history, notification and unread behavior, shell midpoint trigger and offset endpoints, Danmaku behavior, Runtime networking, peer protocol, persistence, public APIs, permissions, dependencies, and host-page document styles. Image bounds add no runtime measurement or observer state.
