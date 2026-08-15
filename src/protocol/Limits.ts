/**
 * Conservative v2 ceiling for one complete Base64 string passed to Artico.
 * This is a protocol policy, not a uniform browser hard limit: SCTP message
 * size and fragmentation behavior differ between WebRTC peers, while v2 has
 * no application-level fragment reassembly.
 *
 * @see https://lgrahl.de/articles/demystifying-webrtc-dc-size-limit.html
 */
export const MAX_WIRE_BYTES = 256 * 1024

/**
 * Streaming decompression stops here before UTF-8 decode/JSON.parse so a small
 * but highly compressible untrusted frame cannot expand into a memory/CPU DoS.
 */
export const MAX_DECODED_JSON_BYTES = 1024 * 1024

/** Per-object limits prevent one ChatMessage or ChatUser snapshot from consuming a whole frame. */
export const MAX_CHAT_EVENT_BYTES = 192 * 1024
export const MAX_USER_BYTES = 8 * 1024

/** Count and encoded-byte limits jointly bound responses containing many small messages. */
export const MAX_HISTORY_RESPONSE_MESSAGES = 100
