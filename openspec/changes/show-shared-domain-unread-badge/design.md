## Context

`AppStatusDomain` is the single business owner for one same-domain AppButton status containing `open`, position, and unread attention. Every same-domain tab observes that complete status, while each tab projects the shared edge-relative position into its own viewport. That local projection must account for the expanded shell as well as the launcher; otherwise a shared point that is valid for the launcher can push the shell above the viewport when dragged upward. The first-delivery boundary admits a remote text once, and the same-domain synchronization boundary distributes every AppButton status update.

See `proposal.md` for the product motivation and `specs/webrtc-runtime/spec.md` for the observable contract.

## Goals / Non-Goals

**Goals:**

- Preserve one AppStatus business owner and one same-domain status containing `open`, position, and unread attention.
- Synchronize expand, collapse, position, unread mark, and unread clear across every same-domain tab while isolating other domains.
- Define one edge-relative position that projects from the left-bottom or right-bottom anchor, preserves the launcher's fixed edge margins through viewport-derived bounds, and never writes merely because a viewport resized.
- Keep the expanded shell's top edge at least `40px` below the viewport top at either horizontal anchor and every supported shell width, including upward drag, opening or reopening, same-domain open synchronization, and viewport resize.
- Derive launcher and expanded-shell placement from one local geometry owner without adding persisted position state or a corrective panel-only position.
- Make open, position, and unread writes field-scoped so no update can clobber another shared fact.
- Preserve the current drag start, pointer following, bounds, cursor, selection suppression, release behavior, and continuous midpoint crossing.
- Mark a collapsed domain unread on first-delivered remote text, keep an expanded domain read, and project one count-free badge from `!open && unread`.
- Clear one domain's attention and expand every same-domain surface through a user-driven open action without affecting another domain.
- Preserve the exact top-right orange ping result and keep unread independent of browser focus, active/highlighted tab, and browser-notification settings.

**Non-Goals:**

- Adding a numeric unread count, message preview, sound, copy, setting, permission, public API, Domain, coordinator, retry, or dependency.
- Enumerating browser tabs or windows, coupling unread to browser focus/highlight state, or changing notification behavior.
- Changing message delivery, history, projection, barrage, Runtime, protocol, peer, connection, or persistence-version behavior.
- Adding position snapping, rebound, easing, automatic repositioning writes, drag-handle changes, or a second position owner.
- Changing the shell's existing supported size range, launcher-to-shell relationship, collapsed launcher bounds, or the launcher's horizontal and bottom margins.
- Adding alternate indicator variants or browser-specific unread policy.

## Decisions

### 1. Keep one owner and one synchronized status

`AppStatusDomain` owns one same-domain aggregate business truth containing `open`, position, and boolean unread attention. Tabs A, B, and C on the same domain therefore expand together, collapse together, share one position, and share one attention result. Tab D on another domain has a separate aggregate. A tab that hydrates adopts the current field values without writing hydration back into persistence. Initialization phase and Retry remain outside this persisted AppButton status.

Each write is field-scoped. A position update preserves the latest open and unread values; an unread mark preserves open and position; collapse preserves position and unread. Opening is the intentional combined domain update: it sets `open` and clears unread while preserving position. Delayed hydration and unrelated field updates cannot write stale copies of the other fields.

### 2. Project one edge-relative position without resize writes

The shared position consists of a horizontal anchor, the AppButton center's distance from that selected edge, and the launcher bottom edge's distance from the viewport bottom. A center left of the viewport midpoint uses the left-bottom anchor and a left distance; a center at or right of the midpoint uses the right-bottom anchor and a right distance. The bottom distance is used in both halves.

The launcher is `44x44px`. In either horizontal half, its center remains at least `50px` from the selected left or right viewport edge, leaving `28px` between the launcher's outer edge and that viewport edge. Its bottom edge remains at least `22px` above the viewport bottom. The left-bottom and right-bottom bounds are symmetric.

Each tab derives its rendered position from those coordinates and its own current viewport. Bounds are derived from the current viewport and AppButton geometry so the launcher remains fully visible with those margins. If a viewport can contain the launcher but is too small to satisfy a fixed margin, only that tab uses the nearest fully visible bound with the largest feasible margin; the shared coordinate remains unchanged. A later larger viewport therefore restores the exact `50px` horizontal-center and `22px` bottom-edge minima from the unchanged coordinate. Resize observes the new viewport and performs no persistence write.

### 3. Keep the expanded shell below one local top bound

The collapsed launcher keeps its existing vertical range. While WebChat is expanded, the same local geometry owner adds the shell constraint: the shell's top edge remains at least `40px` below the viewport top. The bound is derived from the existing shell and launcher geometry, and the AppButton and AppMain consume the same projected point. Both horizontal anchors and every supported shell width therefore produce the same top-inset result without a second panel transform, DOM measurement, or position owner.

A shared coordinate may have been captured while the shell was collapsed or in a differently sized tab. Opening, reopening, same-domain open synchronization, and viewport resize locally project such a coordinate to the nearest shell-safe point without mutating or persisting the shared position. A later compatible local layout can project the unchanged coordinate again. An actual user drag still writes the bounded shared point through the existing field-scoped position command.

### 4. Preserve continuous drag behavior across the midpoint

Dragging begins from the existing hand control, follows the latest pointer position once per animation frame, prevents text selection, retains the grab cursor, remains bounded, and ends on mouse release. Crossing the viewport midpoint converts the horizontal coordinate to the opposite edge at the same rendered center in that frame, so the AppButton remains under the pointer with no jump. The anchor change adds no snap, rebound, easing, delayed settle, or alternate release behavior. After initialization, only user drag changes the shared position; same-domain tabs then observe that field update.

### 5. Derive unread from the synchronized open state

The first-delivery path sets unread when the shared domain is collapsed, regardless of which same-domain page wins atomic insertion. When the shared domain is expanded, the conversation is already visible across its tabs and the delivery does not mark unread. Self-authored text, history application, and duplicate delivery do not set attention. Reactions and system notices are outside this text-only contract.

Unread is an attention state, not a visible count. Additional eligible texts keep the same visible result rather than multiplying indicators. Browser-window focus, active/highlighted tab, notification-enabled, and notification-type state never gate, redirect, or clear unread attention. Highlighted-tab comparison belongs only to browser notifications.

### 6. Open and collapse the domain as one surface

A user action that changes the domain from collapsed to expanded sets `open` for every same-domain tab and clears unread as one domain update. A collapse action sets every same-domain tab to collapsed and leaves unread clear. The next eligible remote text then marks the collapsed domain unread. Focus, hydration, and synchronization alone perform neither action.

The shared invariant is `open => !unread`. Opening wins over any earlier unread mark, an eligible delivery cannot mark an expanded domain, and a later eligible delivery after collapse marks the domain again. Clearing or toggling domain A cannot mutate domain B.

### 7. Preserve one exact AppButton indicator

The AppButton owns the only unread presentation. When `!open && unread`, every same-domain AppButton uses a top-right `size-5` container at `-top-1 -right-1`, a full-size fully rounded orange-400 ping at 75% opacity, and a fully rounded orange-500 `size-3` center. Presence enters and exits through a 0.1-second opacity transition. It contains no text or number, does not resize the button, and remains absent while the domain is expanded.

### 8. Verify shared status and local projection together

Deterministic controls model tabs A, B, and C on domain A and tab D on domain B. They first drag a domain-A AppButton to both bottom corners and require A/B/C to share the edge-relative position while D remains unchanged. Both anchors preserve the `50px` center distance (`28px` outer-edge margin) and `22px` bottom margin. With the shell expanded on either side and at each supported width, controls drag upward to the local bound and require at least `40px` above the shell. They open or reopen from a shell-unsafe shared point and resize narrow and wide viewports without a shared write, prove bounded local projection and restoration, cross the midpoint without a visual discontinuity, and preserve the current drag event/animation behavior.

The same controls start A/B/C collapsed, force each possible same-domain insertion winner, admit a remote text once, and require badges on A/B/C only. Opening through C must expand and clear all three without affecting D; delivery while expanded must remain read; collapsing through A and admitting a later text must restore all three badges. They also cover field-write isolation, repeated eligible text, self/history/duplicate exclusions, browser focus and active/highlighted tabs, disabled and mention-only notification settings, delayed hydration, and the exact indicator structure and motion classes.

## Risks / Trade-offs

- [Same-domain tabs can write different fields concurrently] -> Commands persist only their addressed fields; opening intentionally updates open and unread together, preserving position.
- [Tabs can have different viewport sizes] -> Every tab projects the same edge-relative coordinates through local viewport bounds without feeding automatic projection changes back into shared state.
- [A collapsed or differently sized surface can provide a point that is unsafe for an expanded shell] -> The single local geometry projection adds the expanded-shell top bound without rewriting the shared coordinate.
- [A drag changes horizontal anchor] -> Conversion uses the same rendered center in the crossing frame, preserving continuous pointer following without a visible jump.
- [Open and delivery can occur close together] -> The domain invariant keeps every expanded state read; only a first-delivered remote text observed while collapsed can mark unread.
- [Several unread texts arrive before reading] -> They retain one attention truth and one visual indicator; this feature intentionally exposes no count.
