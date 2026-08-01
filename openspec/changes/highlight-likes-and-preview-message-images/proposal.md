## Why

Likes from other users currently remain gray unless the current user also likes the message, so one active-like aggregate has two conflicting visual results. Message images also have no height bound and no focused inspection surface, allowing long images to dominate the conversation while leaving their detail difficult to inspect.

## What Changes

- Show the existing active-like red treatment on the like heart and count whenever the message has at least one active like, regardless of whether the current user is one of those users. Return to the default gray treatment only when the active-like count reaches zero.
- Keep current-user like membership as the interaction toggle input without changing reaction aggregation, counts, hate presentation, persistence, or peer semantics.
- Make message content an inline-size query container and render both Markdown image syntax and image-valued links through one message-image presentation whose maximum inline size and maximum block size are both `70cqi`. Keep both used dimensions automatic so the complete image preserves its source aspect ratio without crop, distortion, or a square placeholder.
- Open any valid rendered message image in one centered `MediaPreview` component inside the existing WebChat App root and at the same component level as the Danmaku container.
- Keep the fixed preview layer above the host page but below the WebChat shell, AppButton, and Danmaku. Use a neutral dark backdrop at `18%` opacity while leaving the WebChat shell operable above it.
- Fit the initial preview within a `24px` viewport margin without forcing a small source image larger. Support one bounded `1x` to `4x` zoom and pan state through icon controls, wheel or trackpad, pinch, keyboard, and pointer or touch drag.
- Close through the backdrop, the close control, Escape, or shell collapse; restore focus to the activating image; and replace rather than stack when another image opens. Closing or replacement resets zoom and pan.
- Animate open and close only within the `MediaPreview`-owned WebChat surface when motion is allowed. Keep the host document, its root, its named elements, and its active transitions outside WebChat ownership, and complete the same state change without animation when reduced motion is requested.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `webrtc-runtime`: Define aggregate active-like presentation and the bounded, layered, accessible, zoomable message-image preview result in the existing WebChat application root.

## Impact

- Affected behavior: like color when any user has an active like, inline message-image dimensions, centered preview, zoom, pan, close, focus restoration, layer ordering, and motion fallback.
- Affected implementation: the existing like presentation, the message-content query container, the shared Markdown image renderer, the current App composition, and one `MediaPreview` component/state owner beside the Danmaku container.
- Affected verification: aggregate-like color transitions; both image syntaxes; inline dimensions; preview geometry and layer order; input methods; bounded transform; close/reset/focus behavior; preview-local motion and reduced-motion paths; host-transition isolation; and absence of duplicate owners.
- Unchanged: reaction LWW projection, current-user like toggling, hate presentation, message counts and content, image URLs and sanitization, message delivery/history, notification and unread behavior, Danmaku behavior, Runtime networking, peer protocol, persistence, public APIs, permissions, dependencies, and host-page document styles. Image bounds add no runtime measurement or observer state.
