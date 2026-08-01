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

### Requirement: One centered preview keeps its backdrop behind and body above the WebChat shell

Activating a valid rendered message image by pointer, touch, Enter, or Space SHALL open exactly one centered preview within the existing WebChat application root. The preview SHALL fit the complete source image inside a rectangle that remains at least `24px` from every viewport edge. Its initial `1x` state SHALL mean this fitted baseline and SHALL NOT enlarge a source image beyond its natural dimensions.

The WebChat application surface SHALL establish one stacking context above host-page content. The preview backdrop SHALL use a neutral dark color at `18%` opacity and remain below the WebChat shell, AppButton, and Danmaku. The preview body, image, and controls SHALL remain above those WebChat surfaces. The shell SHALL remain visible and operable above the backdrop wherever the preview body does not cover it. The preview SHALL NOT create a second application root or a document-level portal.

Only one preview SHALL exist. Activating another message image while it is open SHALL replace the current source in that same preview and reset its transform. Clicking the backdrop without a preceding preview drag, activating the close control, pressing Escape, or collapsing the WebChat shell SHALL close the preview. Closing SHALL restore keyboard focus to the activating image when that element still exists.

#### Scenario: Preview opens centered within viewport margins

- **WHEN** the user activates a valid rendered message image
- **THEN** one preview SHALL show the complete image centered within `24px` of every viewport edge at fitted `1x`, without forcing a naturally smaller image larger

#### Scenario: Backdrop stays behind the shell and preview body stays above it

- **GIVEN** a message image preview is open
- **WHEN** the preview and WebChat shell occupy overlapping viewport space
- **THEN** the `18%` neutral backdrop SHALL remain below the shell, AppButton, and Danmaku; the preview body SHALL remain above them; and uncovered shell areas SHALL remain visible and operable

#### Scenario: Another image replaces rather than stacks

- **GIVEN** one message image is open and has a non-default zoom or pan
- **WHEN** the user activates another rendered message image through an uncovered, operable shell area
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

### Requirement: Preview motion uses one document View Transition

When `document.startViewTransition` is available and the user has not requested reduced motion, opening and closing a message image preview SHALL perform the state operation inside one document View Transition. The activating image and current preview image SHALL use one generation-scoped temporary shared identity. The browser-managed document-root snapshot and brief whole-page crossfade, including the shell, SHALL be part of that transition, while the preview transition remains above ordinary shell stacking. A pre-existing host-defined named participant MAY also participate under browser ownership.

WebChat SHALL NOT assign a transition name or style to a host-page element, style the document transition pseudo-tree, mutate host-page business state, or create another preview state owner. The sole preview owner SHALL restore its active temporary identity before a replacement, close, or another open supersedes it, and settlement from an older generation SHALL NOT overwrite the current owner. The latest preview source or closed state SHALL settle exactly once without a duplicate preview or stale marker.

When reduced motion is requested, the API is missing, the transition throws, rejects, or is skipped, or another document transition prevents execution, the same open or close state change SHALL complete immediately without animation. Motion SHALL NOT delay close cleanup or focus restoration. Final page layout, colors, layer order, and business state SHALL be identical on animated and immediate paths.

#### Scenario: Supported motion includes the accepted root crossfade

- **GIVEN** document View Transition is available and reduced motion is not requested
- **WHEN** the user opens or closes a message image
- **THEN** the activating image and current preview image SHALL share one temporary transition identity, the browser MAY crossfade the document root and shell or include a pre-existing host-defined named participant, the preview transition SHALL remain above ordinary shell stacking, and WebChat SHALL assign no host name or style and change no host business state

#### Scenario: Overlapping transitions leave no stale identity

- **GIVEN** an open or close transition has not settled
- **WHEN** another open, replacement, or close supersedes it and the transitions settle in either order
- **THEN** the latest source or closed state SHALL settle exactly once, every temporary image identity SHALL be restored, and no older generation SHALL overwrite the current owner

#### Scenario: Immediate paths preserve the same final visual state

- **GIVEN** reduced motion is requested or document View Transition is missing, throws, rejects, is skipped, or cannot run beside another document transition
- **WHEN** the user opens or closes a message image
- **THEN** the preview SHALL reach the same final open or closed state immediately with identical final layout, colors, and layer order and with no duplicate owner, stale identity, delayed cleanup, blocked focus restoration, or host business-state mutation
