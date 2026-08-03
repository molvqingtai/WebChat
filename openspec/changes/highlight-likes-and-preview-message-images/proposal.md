## Why

Likes and hates from other users currently remain gray unless the current user contributes the same reaction, so each positive reaction aggregate can have two conflicting visual results. Message images also have no height bound and no focused inspection surface, allowing long images to dominate the conversation while leaving their detail difficult to inspect.

## What Changes

- Show one red treatment on each like or hate icon and visible count whenever the matching reaction aggregate contains at least one user, regardless of whether the current user is one of those users. Return that reaction control to the default gray treatment only when its own active count reaches zero.
- Keep current-user membership in each reaction aggregate as that control's interaction toggle input without changing reaction aggregation, counts, persistence, or peer semantics.
- Make message content an inline-size query container and render both Markdown image syntax and image-valued links through one message-image presentation whose maximum inline size and maximum block size are both `70cqi`. Keep both used dimensions automatic so the complete image preserves its source aspect ratio without crop, distortion, or a square placeholder.
- Give each message image one stable Blob URL for its lifecycle. Its inline image and preview image reuse that URL without recreating it on render or activation, and the same lifecycle owner revokes it when the image leaves that lifecycle.
- Open any valid rendered message image in one centered `MediaPreview` component inside the existing WebChat App root and at the same component level as the Danmaku container.
- Keep the neutral dark backdrop at `18%` opacity above the host page but below the WebChat shell, AppButton, and Danmaku. Place the preview body and its controls above those WebChat surfaces; the shell remains visible and operable above the backdrop wherever the preview body does not cover it.
- Fit the initial preview within a `24px` viewport margin without forcing a small source image larger. Keep its icon toolbar below the preview image. Support one bounded `0.25x` to `4x` zoom multiplier over fitted `1x` through icon controls, wheel or trackpad, pinch, keyboard, and pointer or touch drag.
- Accept an image-open request only while no preview is opening or open. Every later image-open request is a no-op that neither replaces the image nor restarts the transition or resets zoom and position.
- Close through the backdrop, the close control, Escape, or shell collapse and restore focus to the activating image. Closing resets zoom and pan.
- Use `document.startViewTransition` for open and close when it is available and motion is allowed. The browser-managed document-root snapshot and brief whole-page crossfade are part of the transition, while WebChat changes no host-page business state or host-element transition styles. Complete the same state change immediately when the API is unavailable, cannot run, or reduced motion is requested.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `webrtc-runtime`: Define symmetric aggregate reaction presentation and the bounded, layered, accessible, zoomable message-image preview result in the existing WebChat application root.

## Impact

- Affected behavior: like and hate color when any user has the matching active reaction, inline message-image dimensions and Blob URL lifetime, centered preview, toolbar placement, guarded opening, zoom, pan, close, focus restoration, layer ordering, and motion fallback.
- Affected implementation: the shared reaction-button presentation, the message-content query container, the shared Markdown image renderer and its one image-resource lifecycle, the current App composition, and one `MediaPreview` component/state owner beside the Danmaku container.
- Affected verification: symmetric like/hate aggregate color transitions; both image syntaxes; stable URL reuse and revocation; inline dimensions; split backdrop/preview-body layer order; toolbar placement; repeated-open no-op behavior; input methods; bounded transform; close/reset/focus behavior; document View Transition and whole-page crossfade; reduced-motion and failure paths; host-state preservation; and absence of duplicate owners.
- Unchanged: reaction LWW projection, current-user reaction toggling, message counts and content, source sanitization, message delivery/history, notification and unread behavior, Danmaku behavior, Runtime networking, peer protocol, persistence, public APIs, permissions, dependencies, and host-page document styles. Image bounds add no runtime measurement or observer state.
