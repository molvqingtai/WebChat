/**
 * Conservative v6 ceiling for one complete Base64 string passed to Artico.
 * This is a protocol policy, not a uniform browser hard limit: SCTP message
 * size and fragmentation behavior differ between WebRTC peers, while v6 has
 * no application-level fragment reassembly. The v6 capacity generation
 * intentionally raises the old 64KiB budget to 256KiB as a clean cut; the
 * exact interop ceiling is verified with dual-browser bidirectional tests.
 *
 * @see https://lgrahl.de/articles/demystifying-webrtc-dc-size-limit.html
 */
export const MAX_WIRE_BYTES = 256 * 1024

/**
 * Streaming decompression stops here before UTF-8 decode/JSON.parse so a small
 * but highly compressible untrusted frame cannot expand into a memory/CPU DoS.
 * v6 raises this ceiling to 1MiB, above the final-frame ceiling, so every
 * legal frame can decode.
 */
export const MAX_DECODED_JSON_BYTES = 1024 * 1024

/**
 * One complete canonical ChatMessage (including its discriminator, ID, HLC,
 * user/target fields, body with every expanded image data URL, mentions,
 * avatars, ranges, and every other variant field) SHALL be no larger than
 * 192KiB of UTF-8 JSON. The pure complete-object guard measures exactly this;
 * the structural schema additionally bounds the wire body field to
 * 192 * 1024 UTF-16 code units so send-time data URLs are representable.
 */
export const MAX_CHAT_MESSAGE_BYTES = 192 * 1024
/** The expanded wire `body` field ceiling in JavaScript string/UTF-16 code units. */
export const MAX_CHAT_BODY_CODE_UNITS = 192 * 1024

/** Per-object limits prevent one ChatMessage or ChatUser snapshot from consuming a whole frame. */
export const MAX_USER_BYTES = 8 * 1024

/** Count and encoded-byte limits jointly bound responses containing many small messages. */
export const MAX_HISTORY_RESPONSE_MESSAGES = 100

import type { ChatMessage } from './ChatRoom'
import type { ChatUser } from './Session'

/** Pure UTF-8 byte measurement of a string; no dependency on app utilities. */
const utf8ByteLength = (value: string): number => new TextEncoder().encode(value).length

/**
 * Pure complete-object resource guard: the canonical UTF-8 JSON byte length of
 * one complete ChatMessage must be at most MAX_CHAT_MESSAGE_BYTES. It performs
 * only deterministic byte measurement and never transforms, parses, or
 * semantically validates the value.
 */
export const isChatMessageWithinBudget = (message: ChatMessage): boolean =>
  utf8ByteLength(JSON.stringify(message)) <= MAX_CHAT_MESSAGE_BYTES

/**
 * Pure complete-object resource guard: the canonical UTF-8 JSON byte length of
 * one complete ChatUser must be at most MAX_USER_BYTES. A complete user is
 * rejected when its canonical representation is over budget even if the avatar
 * field alone is shorter than the ceiling.
 */
export const isChatUserWithinBudget = (user: ChatUser): boolean =>
  utf8ByteLength(JSON.stringify(user)) <= MAX_USER_BYTES
