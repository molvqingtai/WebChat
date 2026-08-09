## Why

The collapsed AppButton can currently be dragged flush against the viewport top even though its left, right, and bottom placement retain visible spacing. The top result should keep the same intentional separation from the page edge.

## What Changes

- Keep the AppButton's outer top edge at least `60px` below the viewport top when the viewport can satisfy that margin together with the existing launcher size and bottom bound.
- Apply the top bound through the existing local AppButton geometry owner so active dragging and local projection of a shared position produce the same visible result.
- Preserve the current shared edge-relative position format. User drag continues to write the bounded position, while hydration, synchronization, and viewport resize continue to project locally without a persistence write.
- Retain the existing fully-visible fallback when a viewport cannot satisfy every fixed launcher margin.
- Preserve the current left, right, and bottom bounds; expanded-shell top inset and size relationship; initial position; midpoint crossing; cross-edge animation; pointer behavior; and release behavior.
- Add no UI control, copy, setting, state owner, persistence field, dependency, permission, protocol, or browser-specific branch.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `webrtc-runtime`: Add the AppButton's fixed `60px` top-edge margin to its existing viewport-derived placement contract.

## Impact

- Affected behavior: the nearest top position of the collapsed AppButton after user drag and its equivalent local projection after synchronization or resize.
- Affected implementation: the existing AppButton geometry bounds and focused geometry regression coverage.
- Outside this change: shared AppButton state, unread behavior, shell state and sizing, other edge margins, drag interaction and motion, Runtime, protocol, persistence, browser permissions, and dependencies.
