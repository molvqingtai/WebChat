import * as v from 'valibot'
import { MAX_USER_BYTES } from './Limits'

export const ChatUserSchema = v.strictObject({
  id: v.pipe(v.string(), v.maxLength(128)),
  name: v.pipe(v.string(), v.maxLength(128)),
  avatar: v.pipe(v.string(), v.maxLength(MAX_USER_BYTES))
})
export type ChatUser = v.InferOutput<typeof ChatUserSchema>

export const ChatSessionSchema = v.strictObject({
  sessionId: v.pipe(v.string(), v.maxLength(128)),
  user: ChatUserSchema
})
export type ChatSession = v.InferOutput<typeof ChatSessionSchema>
