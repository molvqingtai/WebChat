import * as v from 'valibot'
import { MAX_USER_BYTES } from './Limits'

const boundedString = (maxLength: number) => v.pipe(v.string(), v.maxLength(maxLength))
const byteSize = (value: unknown): number => new TextEncoder().encode(JSON.stringify(value)).byteLength

export const ChatUserSchema = v.pipe(
  v.strictObject({
    id: boundedString(128),
    name: boundedString(128),
    avatar: boundedString(MAX_USER_BYTES)
  }),
  // Whole-value byte budget: the complete user value must fit the user wire budget.
  v.check((user) => byteSize(user) <= MAX_USER_BYTES, 'Chat user exceeds the whole-value byte budget')
)
export type ChatUser = v.InferOutput<typeof ChatUserSchema>

export const ChatSessionSchema = v.strictObject({
  sessionId: boundedString(128),
  user: ChatUserSchema
})
export type ChatSession = v.InferOutput<typeof ChatSessionSchema>
