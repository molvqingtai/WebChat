import 'core-js/actual/typed-array/from-base64'
import 'core-js/actual/typed-array/to-base64'
import { MAX_DECODED_JSON_BYTES, MAX_WIRE_BYTES } from './Limits'

const getByteSize = (value: string): number => new TextEncoder().encode(value).byteLength

/** Uniform encoded-frame representation bound; private codec work, not a message validator. */
const isWireFrameWithinLimit = (value: string): boolean => getByteSize(value) <= MAX_WIRE_BYTES

export interface WireCodec {
  encode: (value: unknown) => Promise<string>
  decode: (value: string) => Promise<unknown>
}

export class WireCodecError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'WireCodecError'
  }
}

const asArrayBuffer = (bytes: Uint8Array): ArrayBuffer =>
  bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer

/** Cancels before materializing oversized output, which is required to stop deflate expansion attacks. */
const readLimited = async (stream: ReadableStream<Uint8Array>, limit: number): Promise<Uint8Array> => {
  const reader = stream.getReader()
  const chunks: Uint8Array[] = []
  let byteLength = 0
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      byteLength += value.byteLength
      if (byteLength > limit) {
        await reader.cancel('decoded payload exceeds limit')
        throw new WireCodecError(`Decoded JSON exceeds ${limit} bytes`)
      }
      chunks.push(value)
    }
  } finally {
    reader.releaseLock()
  }
  return chunks.reduce(
    (acc, chunk) => {
      acc.buffer.set(chunk, acc.offset)
      acc.offset += chunk.byteLength
      return acc
    },
    { buffer: new Uint8Array(byteLength), offset: 0 }
  ).buffer
}

export const NativeWireCodec: WireCodec = {
  encode: async (value) => {
    const json = JSON.stringify(value)
    if (json === undefined) throw new WireCodecError('Value is not JSON serializable')
    const input = new TextEncoder().encode(json)
    if (input.byteLength > MAX_DECODED_JSON_BYTES) {
      throw new WireCodecError(`Decoded JSON exceeds ${MAX_DECODED_JSON_BYTES} bytes`)
    }
    const stream = new Blob([asArrayBuffer(input)]).stream().pipeThrough(new CompressionStream('deflate'))
    const compressed = await readLimited(stream, MAX_WIRE_BYTES)
    const frame = compressed.toBase64()
    if (!isWireFrameWithinLimit(frame)) {
      throw new WireCodecError(`Wire frame exceeds ${MAX_WIRE_BYTES} bytes`)
    }
    return frame
  },
  decode: async (value) => {
    if (!isWireFrameWithinLimit(value)) {
      throw new WireCodecError(`Wire frame exceeds ${MAX_WIRE_BYTES} bytes`)
    }
    let compressed: Uint8Array
    try {
      compressed = Uint8Array.fromBase64(value, {
        alphabet: 'base64',
        lastChunkHandling: 'strict'
      })
    } catch {
      throw new WireCodecError('Malformed base64 frame')
    }
    // Strict parsing alone permits alternate spellings; exact re-encoding defines one canonical wire form.
    if (compressed.toBase64() !== value) throw new WireCodecError('Malformed base64 frame')
    const stream = new Blob([asArrayBuffer(compressed)]).stream().pipeThrough(new DecompressionStream('deflate'))
    const decoded = await readLimited(stream, MAX_DECODED_JSON_BYTES)
    let json: string
    try {
      json = new TextDecoder('utf-8', { fatal: true }).decode(decoded)
    } catch {
      throw new WireCodecError('Decoded frame is not valid UTF-8')
    }
    try {
      return JSON.parse(json)
    } catch {
      throw new WireCodecError('Decoded frame is not valid JSON')
    }
  }
}
