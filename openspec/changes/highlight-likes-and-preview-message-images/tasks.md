## 1. Product Authority

- [x] 1.1 Define symmetric reaction presentation: any positive like or hate aggregate makes only its matching icon and visible count red, while current-user membership remains that control's independent add-or-remove input.
- [x] 1.2 Define one message-content inline-size query owner and equal `70cqi` maximum inline and block sizes for both rendered Markdown image forms, with automatic aspect-preserving dimensions and no runtime measurement state.
- [x] 1.3 Define one centered `MediaPreview` owner in the existing App root, with an `18%` backdrop below the shell/AppButton/Danmaku, a preview body above them, a toolbar below the preview image, and a `24px` viewport fit margin.
- [x] 1.4 Define a fitted `1x` opening baseline, user zoom from `0.25x` through `4x`, fixed `0.25x` controls, shared wheel/trackpad/pinch bounds, centered reduced images, bounded drag pan, and reset on close or image switch.
- [x] 1.5 Define same-inline-image animated close during opening and open, different-image replacement with no old-image close motion and one complete fresh opening, current-activator focus restoration, backdrop/control/Escape/shell-collapse close, and document View Transition settlement with immediate reduced-motion/failure fallback.
- [x] 1.6 Exclude enlarged-preview-image click-to-close, transform inheritance or static source replacement across image switches, reaction projection/count/add-or-remove changes, protocol, persistence, host-scroll, upload, download, carousel, speculative media, second-root, second-owner, runtime image measurement, host-element transition naming/styling, host business-state mutation, and experimental transition-API changes.
- [x] 1.7 Define exactly one lifecycle-owned Blob URL per message image, reused by the inline and preview images and revoked by that same owner when the image leaves its lifecycle.

## 2. Regression Coverage

- [x] 2.1 Cover symmetric like/hate positive-aggregate red, zero-aggregate gray, type-local independence, current-user add/remove semantics, and removal while another matching reaction remains.
- [x] 2.2 Cover both Markdown image forms through one shared renderer with the same message-content query owner, one stable Blob URL reused by inline and preview images, one-time lifecycle revocation, equal `70cqi` maximums, automatic dimensions, complete containment, and sanitized source and alternative text.
- [x] 2.3 Add structural controls excluding per-render or per-activation Blob URL creation, JavaScript measurement, `ResizeObserver`, measured-size state, square placeholders, duplicate image policies, and a second sizing or URL-lifecycle owner.
- [x] 2.4 Cover preview ancestry, one-owner composition, centered `24px` fit, natural-size non-upscale, the real host/backdrop/shell/preview-body order, toolbar placement below the preview image, neutral `18%` backdrop, preview-body overlap, and uncovered shell operability.
- [x] 2.5 Cover production-boundary pointer, touch, keyboard, wheel/trackpad, and pinch activation; editable-shell isolation; icon names and tooltips; fixed `0.25x` control steps; the shared `0.25x` through `4x` bounds; centered, non-pannable reduced images; focal zoom; axis-specific pan bounds; resize reclamping; drag-release suppression; and reset to fitted `1x`.
- [ ] 2.6 Cover same-inline-image animated close during opening and open; enlarged-preview-image gesture ownership without close; different-image replacement with no old-image close motion and one complete fresh opening; new-source/activator ownership; switch-time transform cleanup; current-activator focus restoration; backdrop, close-control, production-boundary Escape, and shell-collapse settlement; and preview-local event handling without host scroll lock.
- [ ] 2.7 Cover document View Transition, accepted root/shell crossfade and pre-existing host-named participants, superseded temporary image identity, no old-image close motion during replacement, one fresh new-image opening generation, reduced-motion and every unavailable/failure path, identical final visuals, and host name/style/business-state preservation without duplicate state or stale markers.

## 3. Minimum Implementation

- [x] 3.1 Derive each reaction control's red emphasis directly from its own positive aggregate while preserving matching current-user membership as the independent pressed/toggle truth.
- [x] 3.2 Consolidate both Markdown image paths into one accessible image control that owns one stable Blob URL per image lifecycle, reuses it for inline and preview images, revokes it exactly once on lifecycle exit, and establishes the message-content inline-size query container with equal `70cqi` maximums on both image axes.
- [x] 3.3 Keep image dimensions automatic and contained without JavaScript measurement, `ResizeObserver`, measured-size state, crop, distortion, forced expansion, or a square placeholder.
- [x] 3.4 Add one `MediaPreview` component/state owner beside Danmaku in the existing App root, exposing only the preview-open action to rendered message images.
- [ ] 3.5 Implement the confirmed extension-owned stacking context and split backdrop/shell/preview-body order, toolbar below the preview image, fit, same-inline-image animated close, different-image replacement with new activator and reset state, current-activator focus, enlarged-preview gesture ownership, preview-subtree keyboard ownership, shared `0.25x` through `4x` zoom bounds, centered reduced images, focal transform, pre-paint bounded pan, gesture cleanup, and shell-collapse behavior without a portal, Domain, Extern, persistence, dependency, or host business-state mutation.
- [ ] 3.6 Use one document View Transition owner with generation-scoped temporary image identity; supersede an unfinished same-image opening with one close generation, settle old identity without close motion before a different image's fresh opening, fence stale settlement, accept the browser root crossfade, and preserve direct reduced-motion/unavailable/failure settlement without host-element styling, another state owner, or delayed cleanup.

## 4. Delivery Gates

- [ ] 4.1 Pass focused regressions, the complete source test suite, typecheck, lint, format, Chrome/Firefox production builds, strict OpenSpec validation, OpenSpec Doctor, diff, identity, and clean-worktree gates on one exact.
- [ ] 4.2 Obtain fresh architecture-first Review of the complete requirement-branch diff and close every finding before publication.
- [ ] 4.3 Publish the reviewed exact through the single `feat/like-color-and-image-preview` branch and one Draft PR, then require exact-bound CI to pass.
- [ ] 4.4 Keep QA, QC, and UX absent unless the Owner explicitly requests one; record any performed or unavailable browser behavior verification truthfully without making it a source/CI blocker.
- [ ] 4.5 Publish the pushed final branch and exact in the parent channel, update final OpenSpec/task truth, and keep Ready/merge conditional on the closeout exact's identity and CI under the Owner's same-PR merge authorization.
