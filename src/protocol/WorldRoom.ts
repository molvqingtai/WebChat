import * as v from 'valibot'
import { PeerSyncMessageSchema } from './Message'

// Site metadata schema
const SiteMetaSchema = v.object({
  host: v.string(),
  hostname: v.string(),
  href: v.string(),
  origin: v.string(),
  title: v.string(),
  icon: v.string(),
  description: v.string()
})

// WorldRoom Message Schema
// Extends PeerSyncMessageSchema with siteMeta field, but omits lastMessageHLC
// WorldRoom only handles user discovery, not message history sync
export const WorldRoomMessageSchema = v.union([
  v.object({
    ...v.omit(PeerSyncMessageSchema, ['lastMessageHLC']).entries,
    siteMeta: SiteMetaSchema
  })
])

// WorldRoom Types
export type WorldRoomSiteMeta = v.InferOutput<typeof SiteMetaSchema>
export type WorldRoomPeerSyncMessage = v.InferOutput<(typeof WorldRoomMessageSchema.options)[0]>
export type WorldRoomMessage = v.InferInput<typeof WorldRoomMessageSchema>

// Check if the message conforms to the format
export const checkWorldRoomMessage = (message: unknown): message is WorldRoomMessage =>
  v.safeParse(WorldRoomMessageSchema, message).success
