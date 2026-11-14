export const CHAT_ROOM_NAMESPACE = 'WEB_CHAT_CHAT_ROOM_V5'
export const WORLD_ROOM_ID = 'WEB_CHAT_WORLD_ROOM_V5'

/** After the last page of a site disconnects, its room is kept this long (covers F5). */
export const DOMAIN_GRACE_MS = 5000
/** A departed remote presence stays listed this long, so a remote F5 shows no leave/join. */
export const PEER_LEAVE_GRACE_MS = 5000
export const JOIN_TIMEOUT_MS = 10000
export const JOIN_RETRY_MS = 10000
export const HISTORY_WINDOW_MS = 30 * 24 * 60 * 60 * 1000
/** Idle time allowed between two pages of one history sync. */
export const HISTORY_IDLE_TIMEOUT_MS = 10000
/** Per-source frames waiting for decode; overflow drops the new frame. */
export const MAX_DECODE_QUEUE_FRAMES = 8
/** Message ids per history request page, before the frame size check. */
export const HISTORY_INVENTORY_PAGE_IDS = 4096
/** A requester announcing more ids than this is ignored. */
export const MAX_HISTORY_INVENTORY_IDS = 500000
/** Live messages kept while a site has no page (only during its grace period). */
export const MAX_BACKLOG_MESSAGES = 512

/**
 * Silence is the only reason to spend a real RTCPeerConnection on a probe, and how long it has to
 * last depends on whether anyone is there to miss: with peers listed, silence means something and
 * the host is checked soon; alone in a room, it is just an empty room.
 */
export const HOST_SILENCE_MS = 15 * 60 * 1000
export const HOST_SILENCE_WITH_PEERS_MS = 5 * 60 * 1000
