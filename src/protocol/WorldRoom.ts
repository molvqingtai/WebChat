import * as v from 'valibot'

// WorldRoom SendType
export enum WorldRoomSendType {
  SyncUser = 'SyncUser'
}

// WorldRoom Message Schemas
const WorldRoomMessageUserSchema = {
  userId: v.string(),
  username: v.string(),
  userAvatar: v.string()
}

const WorldRoomMessageFromInfoSchema = {
  peerId: v.string(),
  host: v.string(),
  hostname: v.string(),
  href: v.string(),
  origin: v.string(),
  title: v.string(),
  icon: v.string(),
  description: v.string()
}

// WorldRoom Message Schema
export const WorldRoomMessageSchema = v.union([
  v.object({
    type: v.literal(WorldRoomSendType.SyncUser),
    id: v.string(),
    peerId: v.string(),
    joinTime: v.number(),
    sendTime: v.number(),
    fromInfo: v.object(WorldRoomMessageFromInfoSchema),
    ...WorldRoomMessageUserSchema
  })
])

// WorldRoom Types
export type WorldRoomMessageUser = v.InferOutput<v.ObjectSchema<typeof WorldRoomMessageUserSchema, undefined>>
export type WorldRoomMessageFromInfo = v.InferOutput<v.ObjectSchema<typeof WorldRoomMessageFromInfoSchema, undefined>>
export type WorldRoomSyncUserMessage = v.InferOutput<(typeof WorldRoomMessageSchema.options)[0]>
export type WorldRoomMessage = v.InferInput<typeof WorldRoomMessageSchema>

// Check if the message conforms to the format
export const checkWorldRoomMessage = (message: WorldRoomMessage) => v.safeParse(WorldRoomMessageSchema, message).success
