import * as v from 'valibot'
import { ChatSessionSchema, type ChatSession } from './Session'

const boundedString = (maxLength: number) => v.pipe(v.string(), v.maxLength(maxLength))

/** Rejects paths/query/fragments so World presence cannot leak the visited page URL. */
const isOriginOnly = (origin: string): boolean => {
  try {
    return new URL(origin).origin === origin
  } catch {
    return false
  }
}

export const ChatSiteSchema = v.pipe(
  v.strictObject({
    origin: boundedString(2048),
    title: v.optional(boundedString(512)),
    icon: v.optional(boundedString(16 * 1024)),
    description: v.optional(boundedString(2048))
  }),
  // Rejects paths/query/fragments so World presence cannot leak the visited page URL.
  v.check((site) => isOriginOnly(site.origin), 'World site origin must be origin-only')
)
export type ChatSite = v.InferOutput<typeof ChatSiteSchema>

export const WorldRoomMessageSchema = v.pipe(
  v.strictObject({
    ...ChatSessionSchema.entries,
    sites: v.pipe(v.array(ChatSiteSchema), v.maxLength(100))
  }),
  // One snapshot per distinct origin: duplicate World sites are rejected.
  v.check(
    (message) => new Set(message.sites.map((site) => site.origin)).size === message.sites.length,
    'World sites must be unique'
  )
)
export type WorldRoomMessage = v.InferOutput<typeof WorldRoomMessageSchema>
