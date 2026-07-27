import * as v from 'valibot'
import { MAX_USER_BYTES } from './Limits'

export interface ChatUser {
  id: string
  name: string
  avatar: string
}

export interface ChatSession {
  sessionId: string
  user: ChatUser
}

const boundedString = (maxLength: number) => v.pipe(v.string(), v.maxLength(maxLength))
const byteSize = (value: unknown): number => new TextEncoder().encode(JSON.stringify(value)).byteLength

export const ChatUserSchema = v.strictObject({
  id: boundedString(128),
  name: boundedString(128),
  avatar: boundedString(MAX_USER_BYTES)
})

export const ChatSessionSchema = v.strictObject({
  sessionId: boundedString(128),
  user: ChatUserSchema
})

export const isUserWithinLimit = (user: ChatUser): boolean => byteSize(user) <= MAX_USER_BYTES
