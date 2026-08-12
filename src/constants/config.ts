// https://www.webfx.com/tools/emoji-cheat-sheet/
export const EMOJI_LIST = [
  '😀',
  '😄',
  '😁',
  '😆',
  '😅',
  '🤣',
  '😂',
  '🙂',
  '🙃',
  '🫠',
  '😉',
  '😊',
  '😇',
  '🥰',
  '😍',
  '🤩',
  '😘',
  '😗',
  '😚',
  '😙',
  '🥲',
  '😋',
  '😛',
  '😜',
  '🤪',
  '😝',
  '🤑',
  '🤗',
  '🤭',
  '🫢',
  '🫣',
  '🤫',
  '🤔',
  '🫡',
  '🤐',
  '🤨',
  '😐',
  '😶',
  '🫥',
  '😶‍🌫️',
  '😏',
  '😒',
  '🙄',
  '😬',
  '😮‍💨',
  '🤥',
  '😌',
  '😔',
  '😪',
  '🤤',
  '😴',
  '😷',
  '🤒',
  '🤕',
  '🤢',
  '🤮',
  '🤧',
  '🥵',
  '🥶',
  '🥴',
  '😵',
  '😵‍💫',
  '🤯',
  '🤠',
  '🥳',
  '🥸',
  '😎',
  '🤓',
  '🧐',
  '😕',
  '🫤',
  '😟',
  '🙁',
  '😮',
  '😯',
  '😲',
  '😳',
  '🥺',
  '🥹',
  '😦',
  '😧',
  '😨',
  '😰',
  '😥',
  '😢',
  '😭',
  '😱',
  '😖',
  '😣',
  '😞',
  '😓',
  '😩',
  '😫',
  '🥱',
  '😤',
  '😡',
  '😠',
  '🤬',
  '😈',
  '👿',
  '💀',
  '☠',
  '💩',
  '🤡',
  '👹',
  '👺',
  '👻',
  '👽',
  '👾',
  '🤖',
  '👀',
  '😺',
  '😸',
  '😹',
  '😻',
  '😼',
  '😽',
  '🙀',
  '😿',
  '😾',
  '🙈',
  '🙉',
  '🙊',
  '👋',
  '🤚',
  '🖐',
  '✋',
  '🖖',
  '🫱',
  '🫲',
  '🫳',
  '🫴',
  '👌',
  '🤏',
  '✌',
  '🤞',
  '🫰',
  '🤟',
  '🤘',
  '🤙',
  '👈',
  '👉',
  '👆',
  '🖕',
  '👇',
  '☝',
  '🫵',
  '👍',
  '👎',
  '✊',
  '👊',
  '🤛',
  '🤜',
  '👏',
  '🙌',
  '🫶',
  '👐',
  '🤲',
  '🤝',
  '🙏',
  '✍',
  '💅'
] as const

// https://night-tailwindcss.vercel.app/docs/breakpoints
export const BREAKPOINTS = {
  sm: 640,
  // => @media (min-width: 640px) { ... }

  md: 768,
  // => @media (min-width: 768px) { ... }

  lg: 1024,
  // => @media (min-width: 1024px) { ... }

  xl: 1280,
  // => @media (min-width: 1280px) { ... }

  '2xl': 1536
  // => @media (min-width: 1536px) { ... }
} as const

export const MESSAGE_MAX_LENGTH = 500 as const
/** Compression target only; the expanded canonical event remains the hard send boundary. */
export const MESSAGE_IMAGE_TARGET_SIZE = 30 * 1024

/**
 * In chrome storage.sync, each key-value pair supports a maximum storage of 8kb
 * Image is encoded as base64, and the size is increased by about 33%.
 * 8kb * (1 - 0.33) = 5488 bytes
 */
export const MAX_AVATAR_SIZE = 5120 as const

export const HISTORY_WINDOW_DAYS = 180 as const

/** Per-source async decode admission; overflow drops only that source's new frame. */
export const MAX_DECODE_QUEUE_FRAMES = 8
export const MAX_DECODE_QUEUE_BYTES = 256 * 1024

/** Per-domain volatile delivery retained only until a page confirms durable settlement. */
export const MAX_INBOUND_BUFFER_EVENTS = 512
export const MAX_INBOUND_BUFFER_BYTES = 8 * 1024 * 1024

export const HISTORY_REQUEST_TIMEOUT_MS = 10000

/** Global provider admission bounds started jobs, dormant successors, and queued metadata together. */
export const MAX_PROVIDER_SUPPLY_CONCURRENCY = 4
export const MAX_PROVIDER_SUPPLY_QUEUE_JOBS = 32
export const MAX_PROVIDER_SUPPLY_QUEUE_BYTES = 8 * 1024
export const MAX_CONFLICTS_PER_RECORD = 4
export const MAX_STORED_CONFLICTS = 1000

export const CHAT_ROOM_NAMESPACE_V6 = 'WEB_CHAT_CHAT_ROOM_V6' as const
export const WORLD_ROOM_ID_V6 = 'WEB_CHAT_WORLD_ROOM_V6' as const

/**
 * Unified grace window after the last page of a domain disconnects.
 * ChatRoom connection, Runtime domain state, un-ACK buffer, and WorldRoom
 * presence are retained together and released together when it expires.
 */
export const RUNTIME_DOMAIN_GRACE_MS = 5000 as const

/**
 * Observer-side pending-leave grace after the last physical source of a remote presence
 * departs: the generation stays online throughout the deadline; a same-generation rebind
 * cancels it, expiry removes the generation and emits one leave when no other presence remains.
 */
export const PENDING_LEAVE_GRACE_MS = 5000 as const
