import * as v from 'valibot'
import { MAX_CHAT_EVENT_BYTES, MAX_HISTORY_RESPONSE_MESSAGES } from './Limits'
import { ChatSessionSchema, ChatUserSchema, isUserWithinLimit, type ChatSession, type ChatUser } from './Session'

export const MESSAGE_TYPE = {
  SESSION: 'session',
  SESSION_END: 'session-end',
  TEXT: 'text',
  REACTION: 'reaction',
  HISTORY_REQUEST: 'history-request',
  HISTORY_RESPONSE: 'history-response'
} as const

export const REACTION_TYPE = {
  LIKE: 'like',
  HATE: 'hate'
} as const

export type ReactionType = (typeof REACTION_TYPE)[keyof typeof REACTION_TYPE]

export interface HLC {
  timestamp: number
  counter: number
}

export interface MentionedUser extends ChatUser {
  ranges: [number, number][]
}

export interface SessionMessage extends ChatSession {
  type: typeof MESSAGE_TYPE.SESSION
  presenceId: string
  joinedAt: number
}

export interface SessionEndMessage {
  type: typeof MESSAGE_TYPE.SESSION_END
  presenceId: string
}

export interface TextMessage {
  type: typeof MESSAGE_TYPE.TEXT
  id: string
  hlc: HLC
  userId: string
  body: string
  mentions: MentionedUser[]
}

export interface ReactionMessage {
  type: typeof MESSAGE_TYPE.REACTION
  id: string
  hlc: HLC
  targetId: string
  userId: string
  reaction: ReactionType
  active: boolean
}

export type ChatMessage = TextMessage | ReactionMessage

export interface HistoryCursor {
  hlc: HLC
  id: string
}

export interface HistoryRequestMessage {
  type: typeof MESSAGE_TYPE.HISTORY_REQUEST
  syncId: string
  before?: HistoryCursor
}

export interface HistoryResponseMessage {
  type: typeof MESSAGE_TYPE.HISTORY_RESPONSE
  syncId: string
  users: ChatUser[]
  messages: ChatMessage[]
  done: boolean
}

export type ChatRoomMessage =
  | SessionMessage
  | SessionEndMessage
  | ChatMessage
  | HistoryRequestMessage
  | HistoryResponseMessage

const boundedString = (maxLength: number) => v.pipe(v.string(), v.maxLength(maxLength))
const OpaquePresenceIdSchema = v.pipe(v.string(), v.minLength(1), v.maxLength(128))
const safeNonNegativeInteger = v.pipe(v.number(), v.safeInteger(), v.minValue(0))
const byteSize = (value: unknown): number => new TextEncoder().encode(JSON.stringify(value)).byteLength

export const HLCSchema = v.strictObject({
  timestamp: safeNonNegativeInteger,
  counter: safeNonNegativeInteger
})

export const MentionedUserSchema = v.strictObject({
  ...ChatUserSchema.entries,
  ranges: v.pipe(v.array(v.strictTuple([safeNonNegativeInteger, safeNonNegativeInteger])), v.maxLength(100))
})

export const SessionMessageSchema = v.strictObject({
  type: v.literal(MESSAGE_TYPE.SESSION),
  ...ChatSessionSchema.entries,
  presenceId: OpaquePresenceIdSchema,
  joinedAt: safeNonNegativeInteger
})

export const SessionEndMessageSchema = v.strictObject({
  type: v.literal(MESSAGE_TYPE.SESSION_END),
  presenceId: OpaquePresenceIdSchema
})

export const TextMessageSchema = v.strictObject({
  type: v.literal(MESSAGE_TYPE.TEXT),
  id: boundedString(128),
  hlc: HLCSchema,
  userId: boundedString(128),
  body: boundedString(MAX_CHAT_EVENT_BYTES),
  mentions: v.pipe(v.array(MentionedUserSchema), v.maxLength(100))
})

export const ReactionMessageSchema = v.strictObject({
  type: v.literal(MESSAGE_TYPE.REACTION),
  id: boundedString(128),
  hlc: HLCSchema,
  targetId: boundedString(128),
  userId: boundedString(128),
  reaction: v.picklist([REACTION_TYPE.LIKE, REACTION_TYPE.HATE]),
  active: v.boolean()
})

export const ChatMessageSchema = v.variant('type', [TextMessageSchema, ReactionMessageSchema])

export const HistoryCursorSchema = v.strictObject({
  hlc: HLCSchema,
  id: boundedString(128)
})

export const HistoryRequestMessageSchema = v.strictObject({
  type: v.literal(MESSAGE_TYPE.HISTORY_REQUEST),
  syncId: boundedString(128),
  before: v.optional(HistoryCursorSchema)
})

export const HistoryResponseMessageSchema = v.strictObject({
  type: v.literal(MESSAGE_TYPE.HISTORY_RESPONSE),
  syncId: boundedString(128),
  users: v.pipe(v.array(ChatUserSchema), v.maxLength(200)),
  messages: v.pipe(v.array(ChatMessageSchema), v.maxLength(MAX_HISTORY_RESPONSE_MESSAGES)),
  done: v.boolean()
})

export const ChatRoomMessageSchema = v.variant('type', [
  SessionMessageSchema,
  SessionEndMessageSchema,
  TextMessageSchema,
  ReactionMessageSchema,
  HistoryRequestMessageSchema,
  HistoryResponseMessageSchema
])

export const isHLCInRange = (hlc: HLC, now: number): boolean =>
  Number.isSafeInteger(hlc.timestamp) &&
  Number.isSafeInteger(hlc.counter) &&
  hlc.timestamp >= 0 &&
  hlc.counter >= 0 &&
  hlc.timestamp <= now + 5 * 60 * 1000

export const isMessageWithinLimit = (message: ChatMessage): boolean => {
  if (byteSize(message) > MAX_CHAT_EVENT_BYTES) return false
  if (message.type !== MESSAGE_TYPE.TEXT) return true
  return message.mentions.every(
    (mention) =>
      isUserWithinLimit(mention) && mention.ranges.every(([start, end]) => start <= end && end < message.body.length)
  )
}

/** Strict public structure and resource validation for one decoded Chat frame. */
export const parseChatRoomMessage = (value: unknown): ChatRoomMessage | null => {
  const parsed = v.safeParse(ChatRoomMessageSchema, value)
  if (!parsed.success) return null
  const message = parsed.output as ChatRoomMessage
  if (message.type === MESSAGE_TYPE.SESSION) return isUserWithinLimit(message.user) ? message : null
  if (message.type === MESSAGE_TYPE.SESSION_END) return message
  if (message.type === MESSAGE_TYPE.TEXT || message.type === MESSAGE_TYPE.REACTION) {
    return isMessageWithinLimit(message) ? message : null
  }
  if (message.type !== MESSAGE_TYPE.HISTORY_RESPONSE) return message

  const userIds = message.users.map((user) => user.id)
  return message.users.every(isUserWithinLimit) &&
    new Set(userIds).size === userIds.length &&
    message.messages.every(isMessageWithinLimit)
    ? message
    : null
}

/** Pure time-relative and reference validation; explicit now prevents protocol code from hiding clock authority. */
export const isChatRoomMessageSemanticallyValid = (message: ChatRoomMessage, now: number): boolean => {
  if (message.type === MESSAGE_TYPE.SESSION || message.type === MESSAGE_TYPE.SESSION_END) return true
  if (message.type === MESSAGE_TYPE.TEXT || message.type === MESSAGE_TYPE.REACTION) {
    return isHLCInRange(message.hlc, now)
  }
  if (message.type === MESSAGE_TYPE.HISTORY_REQUEST) {
    return !message.before || isHLCInRange(message.before.hlc, now)
  }
  const userIds = new Set(message.users.map((user) => user.id))
  return message.messages.every((item) => isHLCInRange(item.hlc, now) && userIds.has(item.userId))
}

export const checkChatRoomMessage = (value: unknown, now: number): value is ChatRoomMessage => {
  const message = parseChatRoomMessage(value)
  return message !== null && isChatRoomMessageSemanticallyValid(message, now)
}
