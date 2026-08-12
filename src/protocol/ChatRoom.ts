import * as v from 'valibot'
import { MAX_CHAT_BODY_CODE_UNITS, MAX_HISTORY_RESPONSE_MESSAGES } from './Limits'
import { ChatSessionSchema, ChatUserSchema } from './Session'

export const MESSAGE_TYPE = {
  SESSION: 'session',
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

export const HLCSchema = v.strictObject({
  timestamp: safeNonNegativeInteger,
  counter: safeNonNegativeInteger
})
export type HLC = v.InferOutput<typeof HLCSchema>

export const MentionedUserSchema = v.strictObject({
  ...ChatUserSchema.entries,
  ranges: v.pipe(v.array(v.strictTuple([safeNonNegativeInteger, safeNonNegativeInteger])), v.maxLength(100))
})
export type MentionedUser = v.InferOutput<typeof MentionedUserSchema>

export const SessionMessageSchema = v.strictObject({
  type: v.literal(MESSAGE_TYPE.SESSION),
  ...ChatSessionSchema.entries,
  presenceId: OpaquePresenceIdSchema,
  joinedAt: safeNonNegativeInteger
})
export type SessionMessage = v.InferOutput<typeof SessionMessageSchema>

export const TextMessageSchema = v.strictObject({
  type: v.literal(MESSAGE_TYPE.TEXT),
  id: boundedString(128),
  hlc: HLCSchema,
  userId: boundedString(128),
  body: boundedString(MAX_CHAT_BODY_CODE_UNITS),
  mentions: v.pipe(v.array(MentionedUserSchema), v.maxLength(100))
})
export type TextMessage = v.InferOutput<typeof TextMessageSchema>

export const ReactionMessageSchema = v.strictObject({
  type: v.literal(MESSAGE_TYPE.REACTION),
  id: boundedString(128),
  hlc: HLCSchema,
  targetId: boundedString(128),
  userId: boundedString(128),
  reaction: ReactionTypeSchema,
  active: v.boolean()
})
export type ReactionMessage = v.InferOutput<typeof ReactionMessageSchema>

export const ChatMessageSchema = v.variant('type', [TextMessageSchema, ReactionMessageSchema])
export type ChatMessage = v.InferOutput<typeof ChatMessageSchema>

export const HistoryMessagesPullSchema = v.strictObject({
  type: v.literal(MESSAGE_TYPE.HISTORY_MESSAGES_PULL),
  syncId: boundedString(128),
  page: safeNonNegativeInteger,
  // Each element is an opaque string bounded only by the containing codec frame and Runtime
  // attempt budgets; no standalone length or format rule applies.
  messageIds: v.array(v.string()),
  done: v.boolean()
})
export type HistoryMessagesPull = v.InferOutput<typeof HistoryMessagesPullSchema>

export const HistoryMessagesPushSchema = v.strictObject({
  type: v.literal(MESSAGE_TYPE.HISTORY_MESSAGES_PUSH),
  syncId: boundedString(128),
  page: safeNonNegativeInteger,
  users: v.pipe(v.array(ChatUserSchema), v.maxLength(200)),
  messages: v.pipe(v.array(ChatMessageSchema), v.maxLength(MAX_HISTORY_RESPONSE_MESSAGES)),
  done: v.boolean()
})
export type HistoryMessagesPush = v.InferOutput<typeof HistoryMessagesPushSchema>

export const ChatRoomMessageSchema = v.variant('type', [
  SessionMessageSchema,
  TextMessageSchema,
  ReactionMessageSchema,
  HistoryMessagesPullSchema,
  HistoryMessagesPushSchema
])
export type ChatRoomMessage = v.InferOutput<typeof ChatRoomMessageSchema>
