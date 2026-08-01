## ADDED Requirements

### Requirement: Active likes use one aggregate red presentation

For every text message, the like heart and any visible like count SHALL use the same red treatment as the current user's active like whenever the projected active-like aggregate contains at least one user. This red presentation SHALL depend only on whether the active-like count is greater than zero, not on which user contributed a like or who authored the text message.

Current-user like membership SHALL remain the sole input to that user's add-or-remove like action. A red aggregate whose users do not include the current user SHALL therefore remain an add-like action for that user. Removing the current user's like while another active like remains SHALL keep the aggregate red; removing the final active like SHALL restore the default gray heart and remove the zero count.

This presentation SHALL NOT change reaction aggregation, count values, hate presentation or interaction, message ordering, persistence, history, or peer reaction semantics.

#### Scenario: Another user's like is red

- **GIVEN** a text message has one active like from another user and no active like from the current user
- **WHEN** WebChat renders the message actions
- **THEN** the like heart and count SHALL use the canonical current self-like red treatment, and activating the control SHALL add rather than remove the current user's like

#### Scenario: Current-user removal keeps another like red

- **GIVEN** the current user and another user have both actively liked one message
- **WHEN** the current user removes only their own like
- **THEN** the count SHALL decrease by one and the remaining positive aggregate SHALL keep the same red treatment

#### Scenario: Final removal restores the default treatment

- **GIVEN** the current user owns the only active like on one message
- **WHEN** that user removes the like
- **THEN** the heart SHALL return to its default gray treatment and no zero count SHALL be rendered

#### Scenario: Hate behavior remains independent

- **WHEN** any combination of active likes and hates is projected for a message
- **THEN** aggregate red presentation SHALL apply only to likes, while hate color, count, and current-user toggle behavior SHALL remain unchanged

### Requirement: Inline message images share one bounded presentation

Every valid image rendered from either Markdown image syntax or an image-valued Markdown link SHALL use the same inline presentation. Its containing message content SHALL establish an inline-size query container. The image SHALL use that container's inline size as the sole basis for equal `70cqi` maximum inline and block sizes, while both used dimensions remain automatic so the complete source preserves its aspect ratio without cropping, distortion, forced expansion, or a square placeholder.

The shared presentation SHALL preserve the sanitized rendered source and alternative text. It SHALL NOT introduce JavaScript measurement, `ResizeObserver`, measured-size state, a second sizing owner, a second URL parser, a raw-Markdown source path, a replacement fetch owner, or a different dimension policy between the two supported syntaxes.

#### Scenario: Both image axes use the same message-container bound

- **GIVEN** a valid message image whose natural inline size, block size, or both exceed `70%` of its containing message's inline size
- **WHEN** the image renders inside the conversation
- **THEN** neither rendered axis SHALL exceed `70cqi` from that message container, both used dimensions SHALL remain automatic, and the complete image SHALL remain visible at its source aspect ratio without a square placeholder

#### Scenario: Both Markdown image forms are identical

- **GIVEN** one image is written with Markdown image syntax and another valid image URL is written as an image-valued Markdown link
- **WHEN** WebChat renders both messages
- **THEN** both images SHALL use the same query-container owner, equal axis maximums, automatic dimensions, containment, activation, alternative-text, and sanitized-source behavior without runtime measurement state

### Requirement: One centered preview remains behind the WebChat shell

Activating a valid rendered message image by pointer, touch, Enter, or Space SHALL open exactly one centered preview within the existing WebChat application root. The preview SHALL fit the complete source image inside a rectangle that remains at least `24px` from every viewport edge. Its initial `1x` state SHALL mean this fitted baseline and SHALL NOT enlarge a source image beyond its natural dimensions.

The fixed preview layer SHALL remain above the host page and below the WebChat shell, AppButton, and Danmaku. Its backdrop SHALL use a neutral dark color at `18%` opacity. The WebChat shell SHALL remain visible and operable above the preview layer; the preview SHALL NOT create a second application root, a document-level portal, or host-document style ownership.

Only one preview SHALL exist. Activating another message image while it is open SHALL replace the current source in that same preview and reset its transform. Clicking the backdrop without a preceding preview drag, activating the close control, pressing Escape, or collapsing the WebChat shell SHALL close the preview. Closing SHALL restore keyboard focus to the activating image when that element still exists.

#### Scenario: Preview opens centered within viewport margins

- **WHEN** the user activates a valid rendered message image
- **THEN** one preview SHALL show the complete image centered within `24px` of every viewport edge at fitted `1x`, without forcing a naturally smaller image larger

#### Scenario: Shell stays above and usable

- **GIVEN** a message image preview is open
- **WHEN** the preview and WebChat shell occupy overlapping viewport space
- **THEN** the shell, AppButton, and Danmaku SHALL remain above the preview layer, the shell SHALL remain operable, and the neutral backdrop SHALL remain below them at `18%` opacity

#### Scenario: Another image replaces rather than stacks

- **GIVEN** one message image is open and has a non-default zoom or pan
- **WHEN** the user activates another rendered message image through the still-operable shell
- **THEN** the one existing preview SHALL show the new image centered at fitted `1x` with zero pan and SHALL create no second preview or backdrop

#### Scenario: Every close path clears and restores focus

- **WHEN** the user clicks an undragged backdrop, activates the close control, presses Escape, or collapses the shell
- **THEN** the preview SHALL close, clear its source and transform, and restore focus to its surviving activating image without changing message or host-page state

### Requirement: Preview zoom and pan are bounded and input complete

The preview SHALL expose familiar zoom-out, zoom-in, reset, and close icon controls with accessible names and tooltips. Zoom SHALL be clamped from fitted `1x` through `4x`. Zoom-in and zoom-out controls and the `+` and `-` keys SHALL change zoom by `0.25x`; the `0` key and reset control SHALL restore fitted `1x` and zero pan.

Wheel or trackpad input and a two-pointer pinch SHALL zoom around the current gesture focal point while clamping the result to `1x` through `4x`. At any zoom greater than `1x`, pointer or single-touch drag SHALL pan only on axes where the scaled image exceeds the available preview rectangle. Pan SHALL remain bounded so an oversized image edge cannot be dragged past its corresponding `24px` viewport boundary and no blank gap can be revealed beyond that edge.

Preview drag SHALL use pointer capture or equivalent local ownership so releasing a drag does not activate the backdrop close path. Closing or replacing the preview SHALL reset zoom, gesture, and pan state. Preview input handling MAY prevent the specific wheel, pointer, and touch events that it consumes, but SHALL NOT lock scrolling by modifying the host document or `body`.

#### Scenario: Icon and keyboard controls use fixed steps

- **GIVEN** the preview is open at fitted `1x`
- **WHEN** the user activates zoom-in twice and zoom-out once, or uses the equivalent `+` and `-` keys
- **THEN** the resulting zoom SHALL be `1.25x`, the controls SHALL expose accessible names, and zoom SHALL never pass below `1x` or above `4x`

#### Scenario: Reset restores the fitted baseline

- **GIVEN** the preview has non-default zoom and pan
- **WHEN** the user activates reset or presses `0`
- **THEN** the image SHALL return to centered fitted `1x` with zero pan

#### Scenario: Focal zoom and pan stay bounded

- **GIVEN** a preview image is zoomed with wheel, trackpad, or pinch and is larger than the available rectangle
- **WHEN** the user continues zooming around the gesture point and drags in either direction
- **THEN** the gesture point SHALL remain the zoom focus until clamped, pan SHALL apply only along overflowing axes, and no image edge SHALL move past its matching `24px` viewport boundary to reveal an external blank gap

#### Scenario: Drag release does not close the preview

- **GIVEN** the user begins a pointer or touch drag on the zoomed image
- **WHEN** the pointer is released over the backdrop
- **THEN** the preview SHALL retain its bounded pan and SHALL NOT treat that release as a backdrop click

#### Scenario: Host document remains unmodified

- **WHEN** the preview consumes a zoom or pan gesture
- **THEN** only that preview interaction SHALL be intercepted and WebChat SHALL NOT write scroll-lock, overflow, touch-action, or other preview state to the host document or `body`

### Requirement: Preview motion has an immediate accessibility fallback

Opening and closing a message image preview SHALL use one shared-element View Transition when the API is available and the user has not requested reduced motion. Only the activating image and the current preview image SHALL participate in that transition.

When View Transition is unavailable, rejects, or the user requests reduced motion, the same open or close state change SHALL complete immediately without an animation, duplicate preview, stale transition name, delayed focus restoration, or failed interaction.

#### Scenario: Supported motion uses one shared transition

- **GIVEN** View Transition is available and reduced motion is not requested
- **WHEN** the user opens or closes a message image
- **THEN** the activating image and the one preview image SHALL form one shared transition while all preview state changes settle exactly once

#### Scenario: Reduced motion and unsupported APIs complete immediately

- **GIVEN** reduced motion is requested or View Transition is unavailable or rejects
- **WHEN** the user opens or closes a message image
- **THEN** the preview SHALL reach the same final open or closed state immediately with no duplicate owner, stale transition marker, or blocked focus restoration
