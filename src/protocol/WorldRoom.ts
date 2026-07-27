import * as v from 'valibot'
import { ChatSessionSchema, isUserWithinLimit, type ChatSession } from './Session'

export interface ChatSite {
  origin: string
  title?: string
  icon?: string
  description?: string
}

export interface WorldRoomMessage extends ChatSession {
  sites: ChatSite[]
}

const boundedString = (maxLength: number) => v.pipe(v.string(), v.maxLength(maxLength))

export const ChatSiteSchema = v.strictObject({
  origin: boundedString(2048),
  title: v.optional(boundedString(512)),
  icon: v.optional(boundedString(16 * 1024)),
  description: v.optional(boundedString(2048))
})

export const WorldRoomMessageSchema = v.strictObject({
  ...ChatSessionSchema.entries,
  sites: v.pipe(v.array(ChatSiteSchema), v.maxLength(100))
})

/** Rejects paths/query/fragments so World presence cannot leak the visited page URL. */
const isOriginOnly = (origin: string): boolean => {
  try {
    return new URL(origin).origin === origin
  } catch {
    return false
  }
}

export const parseWorldRoomMessage = (value: unknown): WorldRoomMessage | null => {
  const parsed = v.safeParse(WorldRoomMessageSchema, value)
  if (!parsed.success) return null
  const message = parsed.output as WorldRoomMessage
  const origins = message.sites.map((site) => site.origin)
  return isUserWithinLimit(message.user) &&
    message.sites.every((site) => isOriginOnly(site.origin)) &&
    new Set(origins).size === origins.length
    ? message
    : null
}

export const checkWorldRoomMessage = (value: unknown): value is WorldRoomMessage =>
  parseWorldRoomMessage(value) !== null
