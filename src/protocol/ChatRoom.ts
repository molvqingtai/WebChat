import * as v from 'valibot'

// ChatRoom MessageType
export enum ChatRoomMessageType {
  Normal = 'normal',
  Prompt = 'prompt'
}

// ChatRoom SendType
export enum ChatRoomSendType {
  Text = 'Text',
  Like = 'Like',
  Hate = 'Hate',
  SyncUser = 'SyncUser',
  SyncHistory = 'SyncHistory'
}

// ChatRoom Message Schemas
const ChatRoomMessageUserSchema = {
  userId: v.string(),
  username: v.string(),
  userAvatar: v.string()
}

const ChatRoomMessageAtUserSchema = {
  positions: v.array(v.tuple([v.number(), v.number()])),
  ...ChatRoomMessageUserSchema
}

export const ChatRoomNormalMessageSchema = {
  id: v.string(),
  type: v.literal(ChatRoomMessageType.Normal),
  body: v.string(),
  sendTime: v.number(),
  receiveTime: v.number(),
  likeUsers: v.array(v.object(ChatRoomMessageUserSchema)),
  hateUsers: v.array(v.object(ChatRoomMessageUserSchema)),
  atUsers: v.array(v.object(ChatRoomMessageAtUserSchema)),
  ...ChatRoomMessageUserSchema
}

// ChatRoom Message Schema
export const ChatRoomMessageSchema = v.union([
  v.object({
    type: v.literal(ChatRoomSendType.Text),
    id: v.string(),
    body: v.string(),
    sendTime: v.number(),
    atUsers: v.array(v.object(ChatRoomMessageAtUserSchema)),
    ...ChatRoomMessageUserSchema
  }),
  v.object({
    type: v.literal(ChatRoomSendType.Like),
    id: v.string(),
    sendTime: v.number(),
    ...ChatRoomMessageUserSchema
  }),
  v.object({
    type: v.literal(ChatRoomSendType.Hate),
    id: v.string(),
    sendTime: v.number(),
    ...ChatRoomMessageUserSchema
  }),
  v.object({
    type: v.literal(ChatRoomSendType.SyncUser),
    id: v.string(),
    peerId: v.string(),
    joinTime: v.number(),
    sendTime: v.number(),
    lastMessageTime: v.number(),
    ...ChatRoomMessageUserSchema
  }),
  v.object({
    type: v.literal(ChatRoomSendType.SyncHistory),
    id: v.string(),
    sendTime: v.number(),
    messages: v.array(v.object(ChatRoomNormalMessageSchema)),
    ...ChatRoomMessageUserSchema
  })
])

// ChatRoom Types
export type ChatRoomMessageUser = v.InferOutput<v.ObjectSchema<typeof ChatRoomMessageUserSchema, undefined>>
export type ChatRoomMessageAtUser = v.InferOutput<v.ObjectSchema<typeof ChatRoomMessageAtUserSchema, undefined>>
export type ChatRoomNormalMessage = v.InferOutput<v.ObjectSchema<typeof ChatRoomNormalMessageSchema, undefined>>
export type ChatRoomTextMessage = v.InferOutput<(typeof ChatRoomMessageSchema.options)[0]>
export type ChatRoomLikeMessage = v.InferOutput<(typeof ChatRoomMessageSchema.options)[1]>
export type ChatRoomHateMessage = v.InferOutput<(typeof ChatRoomMessageSchema.options)[2]>
export type ChatRoomSyncUserMessage = v.InferOutput<(typeof ChatRoomMessageSchema.options)[3]>
export type ChatRoomSyncHistoryMessage = v.InferOutput<(typeof ChatRoomMessageSchema.options)[4]>
export type ChatRoomMessage = v.InferInput<typeof ChatRoomMessageSchema>

// Check if the message conforms to the format
export const checkChatRoomMessage = (message: ChatRoomMessage) => v.safeParse(ChatRoomMessageSchema, message).success
