## Context

`AppStatusDomain` remains the single business owner for AppButton status. The final model has two explicit scopes inside that owner: expanded/collapsed presentation belongs to one physical tab, while one shared status containing position and unread attention belongs to the WebChat domain. Position is expressed from the viewport's left-bottom or right-bottom edge so every same-domain tab can project it into its own viewport without mutating the shared coordinates. The first-delivery boundary admits a remote text once, and the same-domain synchronization boundary distributes position and unread updates.

See `proposal.md` for the product motivation and `specs/webrtc-runtime/spec.md` for the observable contract.

## Goals / Non-Goals

**Goals:**

- Preserve one AppStatus business owner while separating tab-local shell presentation from domain-shared position and unread attention.
- Define one edge-relative position that projects from the left-bottom or right-bottom anchor, remains visible through viewport-derived bounds, and never writes merely because a viewport resized.
- Keep same-domain position synchronized and make position and unread writes independent so neither field can clobber the other.
- Preserve the current drag start, pointer following, bounds, cursor, selection suppression, release behavior, and continuous midpoint crossing.
- Make first-delivered remote text set domain attention independently of the insertion winner's local shell state.
- Project one count-free badge from `collapsed && domainUnread` in every same-domain tab.
- Clear one domain's attention through a user-driven collapsed-to-expanded transition without affecting another domain.
- Preserve the exact top-right orange ping result and keep unread independent of browser-notification settings.

**Non-Goals:**

- Adding a numeric unread count, message preview, sound, copy, setting, permission, public API, Domain, coordinator, retry, or dependency.
- Enumerating browser tabs or windows, coupling unread to browser focus/highlight state, or changing notification behavior.
- Changing message delivery, history, projection, barrage, Runtime, protocol, peer, connection, or persistence-version behavior.
- Adding position snapping, rebound, easing, automatic repositioning writes, drag-handle changes, or a second position owner.
- Adding alternate indicator variants or browser-specific unread policy.

## Decisions

### 1. Keep one owner with two explicit scopes and field-scoped writes

`AppStatusDomain` remains the only business owner. Each physical tab owns its expanded/collapsed shell state, so tab A may remain expanded while same-domain tabs B and C remain collapsed. A same-tab reload keeps that tab's shell state without importing a sibling tab's shell state. The domain owns one shared status containing position and unread attention, observed by all of its tabs. Initialization phase and Retry remain outside this shared status.

Each shared write is field-scoped. A position update changes only position and preserves the latest unread truth; an unread mark or clear changes only unread and preserves the latest position. A tab-local shell write cannot persist either shared field, and a shared update cannot toggle any tab's shell. Same-domain tabs observe both shared fields, while another WebChat domain observes neither.

### 2. Project one edge-relative position without resize writes

The shared position consists of a horizontal anchor, the AppButton center's distance from that selected edge, and the launcher bottom edge's distance from the viewport bottom. A center left of the viewport midpoint uses the left-bottom anchor and a left distance; a center at or right of the midpoint uses the right-bottom anchor and a right distance. The bottom distance is used in both halves.

Each tab derives its rendered position from those coordinates and its own current viewport. Bounds are derived from the current viewport and AppButton geometry so the launcher remains fully visible. When a saved coordinate lies beyond a smaller viewport's visible range, only the rendered projection is bounded; the shared coordinate remains unchanged. A later larger viewport therefore projects the same saved coordinate again. Resize observes the new viewport and performs no persistence write.

### 3. Preserve continuous drag behavior across the midpoint

Dragging begins from the existing hand control, follows the latest pointer position once per animation frame, prevents text selection, retains the grab cursor, remains bounded, and ends on mouse release. Crossing the viewport midpoint converts the horizontal coordinate to the opposite edge at the same rendered center in that frame, so the AppButton remains under the pointer with no jump. The anchor change adds no snap, rebound, easing, delayed settle, or alternate release behavior. After initialization, only user drag changes the shared position; same-domain tabs then observe that field update.

### 4. Mark attention once at the admitted delivery boundary

The first-delivery path sets the message domain's unread attention regardless of which same-domain page wins the atomic insert and regardless of whether that winner is expanded. Self-authored text, history application, and duplicate delivery do not set attention. Reactions and system notices are outside this text-only contract.

Unread is an attention state, not a visible count. Additional eligible texts keep the same visible result rather than multiplying indicators. Notification-enabled and notification-type settings gate only browser notifications and never gate unread attention.

### 5. Read through a user-driven expansion transition

A user action that changes one tab from collapsed to expanded clears the shared unread attention for that tab's domain. Every same-domain tab then projects no badge. A tab that was already expanded when the text arrived does not clear attention merely because it remains expanded, hydrates, becomes focused, or observes synchronization. Collapsing a tab does not clear attention.

Read clearing and later admitted delivery are ordered domain updates: a later clear wins over an earlier mark, while a later eligible text marks the domain unread again. Delayed hydration or an unrelated shell update cannot reverse the newer domain result. Clearing domain A cannot mutate domain B.

### 6. Preserve one exact AppButton indicator

The existing AppButton owns the only unread presentation. When visible, its top-right indicator uses a `size-5` container at `-top-1 -right-1`, a full-size fully rounded orange-400 ping at 75% opacity, and a fully rounded orange-500 `size-3` center. Presence enters and exits through a 0.1-second opacity transition. It contains no text or number, does not resize the button, and remains absent while that tab is expanded.

### 7. Verify shared status and local projection together

Deterministic controls model tab A expanded, tabs B and C collapsed on domain A, and tab D on domain B. They first drag a domain-A AppButton in both viewport halves and require A/B/C to share the edge-relative position while D remains unchanged. Controls resize narrow and wide viewports without a shared write, prove bounded projection and restoration, cross the midpoint without a visual discontinuity, and preserve the current drag event/animation behavior.

The same controls force each possible same-domain insertion winner, admit a remote text once, and require badges only on B and C. Expanding C must clear B and C together without affecting D. They also cover position/unread write isolation, repeated eligible text, subsequent text after clearing, self/history/duplicate exclusions, disabled and mention-only notification settings, delayed hydration, unrelated shell writes, and the exact indicator structure and motion classes.

## Risks / Trade-offs

- [The durable-insert winner can be an expanded tab] -> The winner sets domain attention without consulting its local expanded state; visibility is derived separately in every tab.
- [Same-domain tabs can write different shared fields concurrently] -> Position and unread commands persist only their own field, so neither can clobber the latest value of the other.
- [Tabs can have different viewport sizes] -> Every tab projects the same edge-relative coordinates through local viewport bounds without feeding automatic projection changes back into shared state.
- [A drag changes horizontal anchor] -> Conversion uses the same rendered center in the crossing frame, preserving continuous pointer following without a visible jump.
- [Several unread texts arrive before reading] -> They retain one attention truth and one visual indicator; this feature intentionally exposes no count.
- [Read clearing races with a new text] -> The later admitted domain update wins, so no newer eligible text is silently consumed by an earlier clear.
