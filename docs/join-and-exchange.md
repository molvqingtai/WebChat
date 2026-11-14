# Joining a room and exchanging information

Who sends what, to whom, in what order. Every frame is a `ChatRoomMessage` encoded as JSON → deflate → base64 (`src/protocol/WireCodec.ts`).

## Join

```
A joins ─┐
         ├─ Artico room `WEB_CHAT_CHAT_ROOM_V5:<origin>` (data channel per peer)
B joins ─┘

both sides receive peer join
  ├─ send SESSION to that peer only
  │    { sessionId, user, presenceId, joinedAt }
  │    receiver: rejects a presenceId that changes owner or start, then replaces the
  │    entry of the same source and any entry of the same presence in its leave grace
  │
  └─ send HISTORY_MESSAGES_PULL, its own inventory
       { syncId, page, messageIds[≤4096], done }
       last 30 days, newest first

receiver, once `done` arrives
  └─ own records minus inventory ids → HISTORY_MESSAGES_PUSH
       { syncId, page, users[], messages[≤100], done }

requester, per page
  ├─ must be the next page, otherwise the sync ends
  ├─ drops messages older than its own cutoff
  ├─ persists by id (idempotent), observes the newest HLC
  └─ ends on `done` or 10s without activity
```

Both directions run at the same time: each side asks the other for what it is missing, so both end up with the union. Nothing is broadcast on join.

## Frames

| Type                    | Sent when                          | Carries                        |
| ----------------------- | ---------------------------------- | ------------------------------ |
| `session`               | every peer connect, to that peer   | identity, presence, join time  |
| `text` / `reaction`     | when written, to every peer        | id, HLC, body / target, author |
| `history-messages-pull` | every peer connect                 | message ids the sender has     |
| `history-messages-push` | after a peer's inventory completes | the messages the peer lacks    |

## Limits

| Constant                | Value        | Where                                  |
| ----------------------- | ------------ | -------------------------------------- |
| join timeout            | 10s          | `Config.JOIN_TIMEOUT_MS`               |
| join retry              | 5 × 2s       | `domain/ChatRoom.AUTOMATIC_JOIN_*`     |
| history window          | 30 days      | `Config.HISTORY_WINDOW_MS`             |
| inventory page          | 4096 ids     | `Config.HISTORY_INVENTORY_PAGE_IDS`    |
| inventory ceiling       | 500 000 ids  | `Config.MAX_HISTORY_INVENTORY_IDS`     |
| response page           | 100 messages | `Limits.MAX_HISTORY_RESPONSE_MESSAGES` |
| sync idle timeout       | 10s          | `Config.HISTORY_IDLE_TIMEOUT_MS`       |
| leave grace             | 5s           | `Config.PEER_LEAVE_GRACE_MS`           |
| decode queue per source | 8 frames     | `Config.MAX_DECODE_QUEUE_FRAMES`       |

## Reconnect

A rejoin passes `resume: { presenceId, joinedAt }`, so the peer sees the same presence on a new connection: no leave, no join, no new entry. SESSION is re-sent (it overwrites that entry) and the inventory exchange runs again, which transfers nothing when both sides already match.

## Files

- `src/runtime/core/domain/Room.ts` — join, presence, session exchange
- `src/runtime/core/domain/History.ts` — inventory, diff, paged transfer
- `src/runtime/core/domain/Wire.ts` — transport → validated frames, per-source ordering
- `src/runtime/transports/artico.ts` — Artico signalling and data channels
- `src/protocol/ChatRoom.ts` — frame schemas
