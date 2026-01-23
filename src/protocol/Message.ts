import * as v from 'valibot'

// ============ Message Type Constants ============

/**
 * Message type constants for type safety and consistency
 */
export const MESSAGE_TYPE = {
  TEXT: 'text',
  REACTION: 'reaction',
  PEER_SYNC: 'peer-sync',
  HISTORY_SYNC: 'history-sync',
  SYSTEM_PROMPT: 'system-prompt'
} as const

export type MessageType = (typeof MESSAGE_TYPE)[keyof typeof MESSAGE_TYPE]

/**
 * Reaction type constants
 */
export const REACTION_TYPE = {
  LIKE: 'like',
  HATE: 'hate'
} as const

export type ReactionType = (typeof REACTION_TYPE)[keyof typeof REACTION_TYPE]

/**
 * System prompt type constants
 */
export const PROMPT_TYPE = {
  JOIN: 'join',
  LEAVE: 'leave',
  INFO: 'info'
} as const

export type PromptType = (typeof PROMPT_TYPE)[keyof typeof PROMPT_TYPE]

// ============ Base Types ============

/**
 * Hybrid Logical Clock
 * Provides causal ordering in distributed systems
 */
export interface HLC {
  timestamp: number // Physical time in milliseconds
  counter: number // Logical counter for same timestamp
}

/**
 * User information
 * Can represent sender, receiver, or mentioned user
 */
export interface MessageUser {
  id: string
  name: string
  avatar: string
}

/**
 * Mentioned user with position information
 */
export interface MentionedUser extends MessageUser {
  positions: [number, number][] // Position ranges in message body
}

/**
 * Base metadata for all messages
 */
export interface MessageMetadata {
  id: string // Unique message identifier
  hlc: HLC // Hybrid Logical Clock for ordering and sync
  sentAt: number // Sender's local physical time (for display)
  receivedAt: number // Receiver's local physical time (for local record)
  sender: MessageUser // Sender information
}

// ============ Message Types ============

/**
 * Text message (used for both network transmission and local storage)
 */
export interface TextMessage extends MessageMetadata {
  type: typeof MESSAGE_TYPE.TEXT
  body: string
  mentions: MentionedUser[]
  reactions: {
    likes: MessageUser[] // Users who liked this message
    hates: MessageUser[] // Users who disliked this message
  }
}

/**
 * Reaction message (network transmission only, not stored)
 * Used to add/remove like/hate on a text message
 */
export interface ReactionMessage extends MessageMetadata {
  type: typeof MESSAGE_TYPE.REACTION
  targetId: string // Target message ID
  reaction: ReactionType
}

/**
 * Peer sync message (network transmission only, not stored)
 * Exchanged when peers connect to sync user info
 */
export interface PeerSyncMessage extends MessageMetadata {
  type: typeof MESSAGE_TYPE.PEER_SYNC
  peerId: string
  joinedAt: number // Timestamp when user joined the room
  lastMessageHLC: HLC // Last message HLC for history sync decision
}

/**
 * History sync message (network transmission only, not stored)
 * Used to sync historical messages to newly joined peers
 */
export interface HistorySyncMessage extends MessageMetadata {
  type: typeof MESSAGE_TYPE.HISTORY_SYNC
  messages: TextMessage[] // Historical text messages
}

/**
 * System prompt message (local storage only, not transmitted)
 * Used for system notifications like user join/leave
 */
export interface SystemPromptMessage extends MessageMetadata {
  type: typeof MESSAGE_TYPE.SYSTEM_PROMPT
  body: string
  promptType: PromptType
}

/**
 * Network message union type
 * Messages that can be transmitted over the network
 */
export type NetworkMessage = TextMessage | ReactionMessage | PeerSyncMessage | HistorySyncMessage

/**
 * Local message union type
 * Messages that are stored locally
 */
export type LocalMessage = TextMessage | SystemPromptMessage

// ============ Valibot Schemas ============

export const HLCSchema = v.object({
  timestamp: v.number(),
  counter: v.number()
})

export const MessageUserSchema = v.object({
  id: v.string(),
  name: v.string(),
  avatar: v.string()
})

export const MentionedUserSchema = v.object({
  id: v.string(),
  name: v.string(),
  avatar: v.string(),
  positions: v.array(v.tuple([v.number(), v.number()]))
})

export const MessageMetaSchema = v.object({
  id: v.string(),
  hlc: HLCSchema,
  sentAt: v.number(),
  receivedAt: v.number(),
  sender: MessageUserSchema
})

// ============ Network Message Schemas ============

export const TextMessageSchema = v.object({
  type: v.literal(MESSAGE_TYPE.TEXT),
  id: v.string(),
  hlc: HLCSchema,
  sentAt: v.number(),
  receivedAt: v.number(),
  sender: MessageUserSchema,
  body: v.string(),
  mentions: v.array(MentionedUserSchema),
  reactions: v.object({
    likes: v.array(MessageUserSchema),
    hates: v.array(MessageUserSchema)
  })
})

export const ReactionMessageSchema = v.object({
  type: v.literal(MESSAGE_TYPE.REACTION),
  id: v.string(),
  hlc: HLCSchema,
  sentAt: v.number(),
  receivedAt: v.number(),
  sender: MessageUserSchema,
  targetId: v.string(),
  reaction: v.union([v.literal(REACTION_TYPE.LIKE), v.literal(REACTION_TYPE.HATE)])
})

export const PeerSyncMessageSchema = v.object({
  type: v.literal(MESSAGE_TYPE.PEER_SYNC),
  id: v.string(),
  hlc: HLCSchema,
  sentAt: v.number(),
  receivedAt: v.number(),
  sender: MessageUserSchema,
  peerId: v.string(),
  joinedAt: v.number(),
  lastMessageHLC: HLCSchema
})

export const HistorySyncMessageSchema = v.object({
  type: v.literal(MESSAGE_TYPE.HISTORY_SYNC),
  id: v.string(),
  hlc: HLCSchema,
  sentAt: v.number(),
  receivedAt: v.number(),
  sender: MessageUserSchema,
  messages: v.array(TextMessageSchema)
})

export const NetworkMessageSchema = v.union([
  TextMessageSchema,
  ReactionMessageSchema,
  PeerSyncMessageSchema,
  HistorySyncMessageSchema
])

// ============ Stored Message Schemas ============

export const SystemPromptMessageSchema = v.object({
  type: v.literal(MESSAGE_TYPE.SYSTEM_PROMPT),
  id: v.string(),
  hlc: HLCSchema,
  sentAt: v.number(),
  receivedAt: v.number(),
  sender: MessageUserSchema,
  body: v.string(),
  promptType: v.union([v.literal(PROMPT_TYPE.JOIN), v.literal(PROMPT_TYPE.LEAVE), v.literal(PROMPT_TYPE.INFO)])
})

export const LocalMessageSchema = v.union([TextMessageSchema, SystemPromptMessageSchema])

// ============ Utility Functions ============

/**
 * Validate network message format
 */
export const validateNetworkMessage = (message: unknown): message is NetworkMessage => {
  return v.safeParse(NetworkMessageSchema, message).success
}

/**
 * Validate local message format
 */
export const validateLocalMessage = (message: unknown): message is LocalMessage => {
  return v.safeParse(LocalMessageSchema, message).success
}
