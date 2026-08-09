import * as v from 'valibot'
import { MAX_USER_BYTES } from './Limits'

const boundedString = (maxLength: number) => v.pipe(v.string(), v.maxLength(maxLength))

export const ChatUserSchema = v.strictObject({
  id: boundedString(128),
  name: boundedString(128),
  avatar: boundedString(MAX_USER_BYTES)
})
export type ChatUser = v.InferOutput<typeof ChatUserSchema>

export const ChatSessionSchema = v.strictObject({
  sessionId: boundedString(128),
  user: ChatUserSchema
})
export type ChatSession = v.InferOutput<typeof ChatSessionSchema>
