import * as v from 'valibot'
import { ChatSessionSchema } from './Session'

export const ChatSiteSchema = v.strictObject({
  origin: v.pipe(v.string(), v.maxLength(2048)),
  title: v.optional(v.pipe(v.string(), v.maxLength(512))),
  icon: v.optional(v.pipe(v.string(), v.maxLength(16 * 1024))),
  description: v.optional(v.pipe(v.string(), v.maxLength(2048)))
})
export type ChatSite = v.InferOutput<typeof ChatSiteSchema>

export const WorldRoomMessageSchema = v.strictObject({
  ...ChatSessionSchema.entries,
  sites: v.pipe(v.array(ChatSiteSchema), v.maxLength(100))
})
export type WorldRoomMessage = v.InferOutput<typeof WorldRoomMessageSchema>
