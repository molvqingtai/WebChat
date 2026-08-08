import * as v from 'valibot'
import { ChatSessionSchema } from './Session'

const boundedString = (maxLength: number) => v.pipe(v.string(), v.maxLength(maxLength))

export const ChatSiteSchema = v.strictObject({
  origin: boundedString(2048),
  title: v.optional(boundedString(512)),
  icon: v.optional(boundedString(16 * 1024)),
  description: v.optional(boundedString(2048))
})
export type ChatSite = v.InferOutput<typeof ChatSiteSchema>

export const WorldRoomMessageSchema = v.strictObject({
  ...ChatSessionSchema.entries,
  sites: v.pipe(v.array(ChatSiteSchema), v.maxLength(100))
})
export type WorldRoomMessage = v.InferOutput<typeof WorldRoomMessageSchema>
