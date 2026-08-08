import * as v from 'valibot'
import { MAX_CHAT_EVENT_BYTES, MAX_HISTORY_RESPONSE_MESSAGES, MAX_USER_BYTES } from './Limits'
import { ChatSessionSchema, ChatUserSchema, type ChatSession, type ChatUser } from './Session'

export const MESSAGE_TYPE = {
  SESSION: 'session',
  SESSION_END: 'session-end',
  TEXT: 'text',
  REACTION: 'reaction',
  HISTORY_MESSAGES_PULL: 'history-messages-pull',
  HISTORY_MESSAGES_PUSH: 'history-messages-push'
} as const

export const REACTION_TYPE = {
  LIKE: 'like',
  HATE: 'hate'
} as const

export const ReactionTypeSchema = v.picklist([REACTION_TYPE.LIKE, REACTION_TYPE.HATE])
export type ReactionType = v.InferOutput<typeof ReactionTypeSchema>

const boundedString = (maxLength: number) => v.pipe(v.string(), v.maxLength(maxLength))
const OpaquePresenceIdSchema = v.pipe(v.string(), v.minLength(1), v.maxLength(128))
const safeNonNegativeInteger = v.pipe(v.number(), v.safeInteger(), v.minValue(0))
const byteSize = (value: unknown): number => new TextEncoder().encode(JSON.stringify(value)).byteLength

export const HLCSchema = v.strictObject({
  timestamp: safeNonNegativeInteger,
  counter: safeNonNegativeInteger
})
export type HLC = v.InferOutput<typeof HLCSchema>

export const MentionedUserSchema = v.pipe(
  v.strictObject({
    ...ChatUserSchema.entries,
    ranges: v.pipe(v.array(v.strictTuple([safeNonNegativeInteger, safeNonNegativeInteger])), v.maxLength(100))
  }),
  v.check(
    (mention) => new TextEncoder().encode(JSON.stringify(mention)).byteLength <= MAX_USER_BYTES,
    'Mentioned user exceeds the whole-value byte budget'
  )
)
export type MentionedUser = v.InferOutput<typeof MentionedUserSchema>

export const SessionMessageSchema = v.strictObject({
  type: v.literal(MESSAGE_TYPE.SESSION),
  ...ChatSessionSchema.entries,
  presenceId: OpaquePresenceIdSchema,
  joinedAt: safeNonNegativeInteger
})
export type SessionMessage = v.InferOutput<typeof SessionMessageSchema>

export const SessionEndMessageSchema = v.strictObject({
  type: v.literal(MESSAGE_TYPE.SESSION_END),
  presenceId: OpaquePresenceIdSchema
})
export type SessionEndMessage = v.InferOutput<typeof SessionEndMessageSchema>

export const TextMessageSchema = v.pipe(
  v.strictObject({
    type: v.literal(MESSAGE_TYPE.TEXT),
    id: boundedString(128),
    hlc: HLCSchema,
    userId: boundedString(128),
    body: boundedString(MAX_CHAT_EVENT_BYTES),
    mentions: v.pipe(v.array(MentionedUserSchema), v.maxLength(100))
  }),
  // Mention ranges are relative to the owning body: every range stays inside it.
  v.check(
    (message) =>
      message.mentions.every((mention) =>
        mention.ranges.every(([start, end]) => start <= end && end < message.body.length)
      ),
    'Text mention range exceeds the message body'
  ),
  // Whole-value byte budget for one complete Chat message.
  v.check((message) => byteSize(message) <= MAX_CHAT_EVENT_BYTES, 'Chat message exceeds the whole-value byte budget')
)
export type TextMessage = v.InferOutput<typeof TextMessageSchema>

export const ReactionMessageSchema = v.pipe(
  v.strictObject({
    type: v.literal(MESSAGE_TYPE.REACTION),
    id: boundedString(128),
    hlc: HLCSchema,
    targetId: boundedString(128),
    userId: boundedString(128),
    reaction: ReactionTypeSchema,
    active: v.boolean()
  }),
  v.check((message) => byteSize(message) <= MAX_CHAT_EVENT_BYTES, 'Chat message exceeds the whole-value byte budget')
)
export type ReactionMessage = v.InferOutput<typeof ReactionMessageSchema>

export const ChatMessageSchema = v.variant('type', [TextMessageSchema, ReactionMessageSchema])
export type ChatMessage = v.InferOutput<typeof ChatMessageSchema>

export const HistoryMessagesRequestSchema = v.strictObject({
  type: v.literal(MESSAGE_TYPE.HISTORY_MESSAGES_PULL),
  syncId: boundedString(128),
  page: safeNonNegativeInteger,
  messageIds: v.array(v.string()),
  done: v.boolean()
})
export type HistoryMessagesRequest = v.InferOutput<typeof HistoryMessagesRequestSchema>

export const HistoryMessagesResponseSchema = v.pipe(
  v.strictObject({
    type: v.literal(MESSAGE_TYPE.HISTORY_MESSAGES_PUSH),
    syncId: boundedString(128),
    page: safeNonNegativeInteger,
    users: v.pipe(v.array(ChatUserSchema), v.maxLength(200)),
    messages: v.pipe(v.array(ChatMessageSchema), v.maxLength(MAX_HISTORY_RESPONSE_MESSAGES)),
    done: v.boolean()
  }),
  // History reference completeness: exactly one user per distinct message userId, no duplicates,
  // and every message userId resolves into the page users.
  v.check((response) => {
    const userIds = response.users.map((user) => user.id)
    return (
      new Set(userIds).size === userIds.length && response.messages.every((message) => userIds.includes(message.userId))
    )
  }, 'History response users must be unique and reference-complete')
)
export type HistoryMessagesResponse = v.InferOutput<typeof HistoryMessagesResponseSchema>

export const ChatRoomMessageSchema = v.variant('type', [
  SessionMessageSchema,
  SessionEndMessageSchema,
  TextMessageSchema,
  ReactionMessageSchema,
  HistoryMessagesRequestSchema,
  HistoryMessagesResponseSchema
])
export type ChatRoomMessage = v.InferOutput<typeof ChatRoomMessageSchema>

/** Future HLC skew accepted by the receiving boundary; anything later is rejected inside the schema. */
export const HLC_FUTURE_SKEW_MS = 5 * 60 * 1000

const hlcInRange = (hlc: HLC, now: number): boolean => hlc.timestamp <= now + HLC_FUTURE_SKEW_MS

/**
 * Complete Chat room schema with an explicit receiver `now`: it composes the structural
 * Chat schema and owns the explicit-now HLC time rule for text, reaction, and every History
 * response message. Construction is pure; the schema is built at the authorized parse boundary.
 */
/**
 * Complete Chat message schema with an explicit receiver `now`: composes the structural Chat
 * message schema and owns the explicit-now HLC time rule. Used by the local persistence load
 * boundary when accepting one stored Chat message record.
 */
export const createChatRoomMessageSchema = (now: number) =>
  v.pipe(
    ChatRoomMessageSchema,
    v.check((message) => {
      if (message.type === MESSAGE_TYPE.TEXT || message.type === MESSAGE_TYPE.REACTION) {
        return hlcInRange(message.hlc, now)
      }
      if (message.type === MESSAGE_TYPE.HISTORY_MESSAGES_PUSH) {
        return message.messages.every((item) => hlcInRange(item.hlc, now))
      }
      return true
    }, 'Chat message HLC is outside the explicit receiver allowance')
  )
export type CompleteChatRoomMessage = v.InferOutput<ReturnType<typeof createChatRoomMessageSchema>>
