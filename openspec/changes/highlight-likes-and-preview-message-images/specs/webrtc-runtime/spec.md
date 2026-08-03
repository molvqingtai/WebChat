## ADDED Requirements

### Requirement: Active reaction aggregates use one symmetric red presentation

For every text message, the like icon and any visible like count SHALL use one red treatment whenever the projected active-like aggregate contains at least one user. The hate icon and any visible hate count SHALL use the same red treatment whenever the projected active-hate aggregate contains at least one user. Each control's red presentation SHALL depend only on whether its own active count is greater than zero, not on which user contributed that reaction or who authored the text message.

Current-user membership in each aggregate SHALL remain the sole input to that user's matching add-or-remove action. A red aggregate whose users do not include the current user SHALL therefore remain an add action for that user. Removing the current user's reaction while another matching reaction remains SHALL keep that control red; removing the final matching reaction SHALL restore that control's default gray icon and remove its zero count.

This presentation SHALL NOT change reaction aggregation, count values, add-or-remove semantics, message ordering, persistence, history, or peer reaction semantics.

#### Scenario: Another user's like is red

- **GIVEN** a text message has one active like from another user and no active like from the current user
- **WHEN** WebChat renders the message actions
- **THEN** the like icon and count SHALL use the canonical active red treatment, and activating the control SHALL add rather than remove the current user's like

#### Scenario: Another user's hate is red

- **GIVEN** a text message has one active hate from another user and no active hate from the current user
- **WHEN** WebChat renders the message actions
- **THEN** the hate icon and count SHALL use the same canonical active red treatment, and activating the control SHALL add rather than remove the current user's hate

#### Scenario: Current-user removal keeps another matching reaction red

- **GIVEN** the current user and another user have both contributed the same active reaction to one message
- **WHEN** the current user removes only their own matching reaction
- **THEN** that count SHALL decrease by one and the remaining positive aggregate SHALL keep its control red

#### Scenario: Final matching removal restores the default treatment

- **GIVEN** the current user owns the only active like or the only active hate on one message
- **WHEN** that user removes the matching reaction
- **THEN** that reaction icon SHALL return to its default gray treatment and no zero count SHALL be rendered

#### Scenario: Reaction colors remain type-local

- **GIVEN** a message has a positive aggregate for one reaction type and zero for the other
- **WHEN** WebChat renders both reaction controls
- **THEN** only the positive reaction control SHALL be red, while the zero-count control SHALL remain gray, and each current-user toggle action SHALL remain independent

### Requirement: Inline message images share one bounded presentation

Every valid image rendered from either Markdown image syntax or an image-valued Markdown link SHALL use the same inline presentation. Its containing message content SHALL establish an inline-size query container. The image SHALL use that container's inline size as the sole basis for equal `70cqi` maximum inline and block sizes, while both used dimensions remain automatic so the complete source preserves its aspect ratio without cropping, distortion, forced expansion, or a square placeholder.

Each message image SHALL own exactly one stable Blob URL for its current image lifecycle. The inline image and preview destination SHALL reuse that same URL. Rendering, rerendering, and preview activation SHALL NOT create another Blob URL. The same message-image lifecycle owner SHALL revoke the URL exactly once when that image leaves its lifecycle.

The shared presentation SHALL preserve the sanitized rendered source and alternative text. It SHALL NOT introduce JavaScript measurement, `ResizeObserver`, measured-size state, a second sizing owner, a second URL parser, a raw-Markdown source path, a replacement fetch owner, or a different dimension policy between the two supported syntaxes.

#### Scenario: Both image axes use the same message-container bound

- **GIVEN** a valid message image whose natural inline size, block size, or both exceed `70%` of its containing message's inline size
- **WHEN** the image renders inside the conversation
- **THEN** neither rendered axis SHALL exceed `70cqi` from that message container, both used dimensions SHALL remain automatic, and the complete image SHALL remain visible at its source aspect ratio without a square placeholder

#### Scenario: Both Markdown image forms are identical

- **GIVEN** one image is written with Markdown image syntax and another valid image URL is written as an image-valued Markdown link
- **WHEN** WebChat renders both messages
- **THEN** both images SHALL use the same query-container owner, equal axis maximums, automatic dimensions, containment, activation, alternative-text, and sanitized-source behavior without runtime measurement state

#### Scenario: Inline and preview images reuse one lifecycle URL

- **GIVEN** one valid message image remains in its message lifecycle across rerenders and preview activation
- **WHEN** WebChat renders its inline image and prepares its preview destination
- **THEN** both image elements SHALL use the same stable Blob URL, no render or activation SHALL create another URL, and the lifecycle owner SHALL revoke that URL exactly once only when the image leaves its lifecycle

### Requirement: One centered preview keeps its backdrop behind and body above the WebChat shell

Activating a valid rendered message image by pointer, touch, Enter, or Space SHALL open exactly one centered preview within the existing WebChat application root. The preview SHALL fit the complete source image inside a rectangle that remains at least `24px` from every viewport edge. Its initial `1x` state SHALL mean this fitted baseline and SHALL NOT enlarge a source image beyond its natural dimensions.

The WebChat application surface SHALL establish one stacking context above host-page content. The preview backdrop SHALL use a neutral dark color at `18%` opacity and remain below the WebChat shell, AppButton, and Danmaku. The preview body, image, and controls SHALL remain above those WebChat surfaces. The icon toolbar SHALL render below the preview image rather than above or over it. The shell SHALL remain visible and operable above the backdrop wherever the preview body does not cover it. The preview SHALL NOT create a second application root or a document-level portal.

Only one preview SHALL exist. Activating its current message-inline image again SHALL close that preview with a close animation. If the current image is still opening, re-activation SHALL supersede the opening and begin the close animation from the current rendered state without waiting for opening to finish. Clicking the enlarged preview image itself SHALL NOT close it and SHALL remain available to preview zoom and pan gestures.

Activating a different message-inline image while one is opening or open SHALL clear the previous image immediately without a close animation or focus restoration, select the new source and activating element, reset zoom, pan, and gesture state, and perform the new image's complete opening animation. The new image SHALL NOT inherit the previous image's transform, appear as a static in-place source replacement, overlap a second preview, or be cleared by stale settlement from the previous transition. Clicking the backdrop without a preceding preview drag, activating the close control, pressing Escape, or collapsing the WebChat shell SHALL close the current preview. Ordinary close SHALL restore keyboard focus to the current activating image when that element still exists.

#### Scenario: Preview opens centered within viewport margins

- **WHEN** the user activates a valid rendered message image
- **THEN** one preview SHALL show the complete image centered within `24px` of every viewport edge at fitted `1x`, without forcing a naturally smaller image larger

#### Scenario: Backdrop stays behind the shell and preview body stays above it

- **GIVEN** a message image preview is open
- **WHEN** the preview and WebChat shell occupy overlapping viewport space
- **THEN** the `18%` neutral backdrop SHALL remain below the shell, AppButton, and Danmaku; the preview body SHALL remain above them; and uncovered shell areas SHALL remain visible and operable

#### Scenario: Toolbar stays below the preview image

- **GIVEN** a message image preview is open
- **WHEN** WebChat lays out the preview image and icon controls
- **THEN** the toolbar SHALL appear below the preview image without overlaying it

#### Scenario: Re-activating the current inline image closes its preview

- **GIVEN** one message image preview is open
- **WHEN** the user activates that same message-inline image again through an uncovered, operable shell area
- **THEN** the preview SHALL use its ordinary close behavior, clear its transform and gesture state, and restore focus to that same surviving inline image

#### Scenario: Same-image activation during opening plays close motion

- **GIVEN** one message image is still performing its opening animation
- **WHEN** the user activates that same message-inline image again
- **THEN** the opening SHALL be superseded immediately by one close animation from the current rendered state, after which the preview SHALL clear without a duplicate preview, stale temporary identity, or delayed transform and gesture cleanup

#### Scenario: A different image receives a complete fresh opening

- **GIVEN** image A is opening or open with any zoom, pan, or in-progress gesture state
- **WHEN** the user activates message-inline image B
- **THEN** A SHALL clear immediately without a close animation or focus restoration, B SHALL become the sole current source and activator at its own centered fitted `1x` and zero pan, and B SHALL perform its complete opening animation rather than appear as a static source replacement

#### Scenario: Enlarged-image activation remains a preview gesture

- **GIVEN** one message image preview is open
- **WHEN** the user clicks or taps the enlarged preview image itself without activating its message-inline image
- **THEN** that activation SHALL NOT close the preview, and the preview image SHALL remain available to its bounded zoom and pan gesture behavior

#### Scenario: Every close path clears and restores focus

- **WHEN** the user clicks an undragged backdrop, activates the close control, presses Escape, or collapses the shell
- **THEN** the preview SHALL close, clear its source and transform, and restore focus to its surviving activating image without changing message or host-page state

### Requirement: Preview zoom and pan are bounded and input complete

The preview SHALL expose familiar zoom-out, zoom-in, reset, and close icon controls with accessible names and tooltips. Zoom SHALL be clamped from `0.25x` through `4x` relative to the fitted `1x` opening baseline, allowing the user to reduce an image below both that baseline and its natural dimensions. Zoom-in and zoom-out controls and the `+` and `-` keys SHALL change zoom by `0.25x`; zoom-out SHALL remain available above `0.25x` and zoom-in SHALL remain available below `4x`. The `0` key and reset control SHALL restore fitted `1x` and zero pan.

Wheel or trackpad input and a two-pointer pinch SHALL zoom around the current gesture focal point while sharing the same `0.25x` through `4x` bounds. On every axis where the scaled image fits the available preview rectangle, translation SHALL be zero so a reduced image remains centered and cannot be dragged away from that center. Pointer or single-touch drag SHALL pan only on axes where the scaled image exceeds the available rectangle. Pan SHALL remain bounded so an oversized image edge cannot be dragged past its corresponding `24px` viewport boundary and no blank gap can be revealed beyond that edge.

Preview drag SHALL use pointer capture or equivalent local ownership so releasing a drag does not activate the backdrop close path. Closing the preview SHALL reset zoom, gesture, and pan state, and every later accepted opening SHALL begin at fitted `1x` with zero pan. Preview input handling MAY prevent the specific wheel, pointer, and touch events that it consumes, but SHALL NOT lock scrolling by modifying the host document or `body`.

#### Scenario: Fixed controls reach the shared lower bound

- **GIVEN** the preview is open at fitted `1x`
- **WHEN** the user activates zoom-out three times through the icon or `-` key and then tries to zoom out again
- **THEN** the image SHALL be centered at `0.25x` with zero pan, the next zoom-out SHALL have no effect, the zoom-out control SHALL be disabled at that bound, and one zoom-in step SHALL produce `0.5x`

#### Scenario: Reset restores the fitted baseline

- **GIVEN** the preview has non-default zoom and pan
- **WHEN** the user activates reset or presses `0`
- **THEN** the image SHALL return to centered fitted `1x` with zero pan

#### Scenario: Focal zoom and pan stay bounded

- **GIVEN** a preview image is zoomed with wheel, trackpad, or pinch and is larger than the available rectangle
- **WHEN** the user continues zooming around the gesture point and drags in either direction
- **THEN** the gesture point SHALL remain the zoom focus until clamped to `0.25x` through `4x`, pan SHALL apply only along overflowing axes, every fitting axis SHALL remain centered, and no image edge SHALL move past its matching `24px` viewport boundary to reveal an external blank gap

#### Scenario: Drag release does not close the preview

- **GIVEN** the user begins a pointer or touch drag on the zoomed image
- **WHEN** the pointer is released over the backdrop
- **THEN** the preview SHALL retain its bounded pan and SHALL NOT treat that release as a backdrop click

#### Scenario: Host document remains unmodified

- **WHEN** the preview consumes a zoom or pan gesture
- **THEN** only that preview interaction SHALL be intercepted and WebChat SHALL NOT write scroll-lock, overflow, touch-action, or other preview state to the host document or `body`

### Requirement: Preview motion uses one document View Transition

When `document.startViewTransition` is available and the user has not requested reduced motion, the accepted opening and closing of a message image preview SHALL perform the state operation inside one document View Transition. The activating image and current preview image SHALL use one generation-scoped temporary shared identity. The browser-managed document-root snapshot and brief whole-page crossfade, including the shell, SHALL be part of that transition, while the preview transition remains above ordinary shell stacking. A pre-existing host-defined named participant MAY also participate under browser ownership.

WebChat SHALL NOT assign a transition name or style to a host-page element, style the document transition pseudo-tree, mutate host-page business state, or create another preview state owner. The sole preview owner SHALL restore an active temporary identity when its generation settles, closes, or is superseded. Same-image activation during opening SHALL supersede that opening generation and start one close generation from the current rendered state. Different-image activation SHALL clear the previous generation without a close transition and then start one fresh opening generation whose temporary identity belongs only to the new inline image and preview destination. Stale settlement SHALL NOT alter the current source, activator, transform, focus target, or identity.

When reduced motion is requested, the API is missing, the transition throws, rejects, or is skipped, or another document transition prevents execution, the same open or close state change SHALL complete immediately without animation. Motion SHALL NOT delay close cleanup or focus restoration. Final page layout, colors, layer order, and business state SHALL be identical on animated and immediate paths.

#### Scenario: Supported motion includes the accepted root crossfade

- **GIVEN** document View Transition is available and reduced motion is not requested
- **WHEN** the user opens or closes a message image
- **THEN** the activating image and current preview image SHALL share one temporary transition identity, the browser MAY crossfade the document root and shell or include a pre-existing host-defined named participant, the preview transition SHALL remain above ordinary shell stacking, and WebChat SHALL assign no host name or style and change no host business state

#### Scenario: Immediate paths preserve the same final visual state

- **GIVEN** reduced motion is requested or document View Transition is missing, throws, rejects, is skipped, or cannot run beside another document transition
- **WHEN** the user opens or closes a message image
- **THEN** the preview SHALL reach the same final open or closed state immediately with identical final layout, colors, and layer order and with no duplicate owner, stale identity, delayed cleanup, blocked focus restoration, or host business-state mutation

#### Scenario: Image replacement skips old close motion and opens the new image

- **GIVEN** image A is opening or open with an active temporary transition identity
- **WHEN** the user activates message-inline image B
- **THEN** A's identity SHALL be restored and A SHALL clear without close motion before one fresh opening generation gives B and its preview destination the only WebChat-owned temporary identity, while stale A settlement SHALL have no effect on B
