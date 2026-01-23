import * as v from 'valibot'
import { MESSAGE_TYPE, REACTION_TYPE, HLCSchema, MessageMetaSchema, TextMessageSchema } from './Message'

// ChatRoom-specific message schemas
export const ChatRoomMessageSchema = v.union([
  // Text Message (reuse from Message.ts)
  TextMessageSchema,

  // Reaction Message
  v.object({
    ...MessageMetaSchema.entries,
    type: v.literal(MESSAGE_TYPE.REACTION),
    targetId: v.string(),
    reaction: v.union([v.literal(REACTION_TYPE.LIKE), v.literal(REACTION_TYPE.HATE)])
  }),

  // Peer Sync Message
  v.object({
    ...MessageMetaSchema.entries,
    type: v.literal(MESSAGE_TYPE.PEER_SYNC),
    peerId: v.string(),
    joinedAt: v.number(),
    lastMessageHLC: HLCSchema
  }),

  // History Sync Message
  v.object({
    ...MessageMetaSchema.entries,
    type: v.literal(MESSAGE_TYPE.HISTORY_SYNC),
    messages: v.array(TextMessageSchema)
  })
])

// ChatRoom Types
export type ChatRoomMessage = v.InferInput<typeof ChatRoomMessageSchema>
export type ChatRoomTextMessage = v.InferOutput<(typeof ChatRoomMessageSchema.options)[0]>
export type ChatRoomReactionMessage = v.InferOutput<(typeof ChatRoomMessageSchema.options)[1]>
export type ChatRoomPeerSyncMessage = v.InferOutput<(typeof ChatRoomMessageSchema.options)[2]>
export type ChatRoomHistorySyncMessage = v.InferOutput<(typeof ChatRoomMessageSchema.options)[3]>

// Check if the message conforms to the format
export const checkChatRoomMessage = (message: unknown): message is ChatRoomMessage =>
  v.safeParse(ChatRoomMessageSchema, message).success
