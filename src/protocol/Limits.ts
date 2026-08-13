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

/** The expanded wire `body` field ceiling in JavaScript string/UTF-16 code units. */
export const MAX_CHAT_BODY_CODE_UNITS = 192 * 1024

/** Per-object field ceiling for `ChatUser.avatar` in JavaScript string/UTF-16 code units. */
export const MAX_USER_BYTES = 8 * 1024

/** Count and encoded-byte limits jointly bound responses containing many small messages. */
export const MAX_HISTORY_RESPONSE_MESSAGES = 100
