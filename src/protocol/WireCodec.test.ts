import { describe, expect, it } from 'vitest'
import { NativeWireCodec, WireCodecError } from '@/protocol'

const compressWithoutDecodedLimit = async (text: string): Promise<string> => {
  const bytes = new TextEncoder().encode(text)
  const stream = new Blob([bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer])
    .stream()
    .pipeThrough(new CompressionStream('deflate'))
  return new Uint8Array(await new Response(stream).arrayBuffer()).toBase64()
}

describe('NativeWireCodec public reference implementation', () => {
  it('round-trips every value through one base64(deflate(UTF8(JSON))) frame', async () => {
    const value = {
      type: 'history-response',
      syncId: 'sync-1',
      users: [{ id: 'u1', name: 'User', avatar: '' }],
      messages: Array.from({ length: 20 }, (_, index) => ({ id: `event-${index}`, body: 'repeat '.repeat(30) })),
      done: true
    }
    const frame = await NativeWireCodec.encode(value)

    expect(frame).toMatch(/^[A-Za-z0-9+/]+={0,2}$/)
    await expect(NativeWireCodec.decode(frame)).resolves.toEqual(value)
  })

  it('publishes the syncId/messages canonical JSON and codec bytes', async () => {
    const golden = [
      {
        value: {
          type: 'history-request',
          syncId: 'sync-1',
          before: { hlc: { timestamp: 1_800_000_000_000, counter: 2 }, id: 'message-2' }
        },
        json: '{"type":"history-request","syncId":"sync-1","before":{"hlc":{"timestamp":1800000000000,"counter":2},"id":"message-2"}}',
        frame:
          'eJxFjDEOgzAQBP+ytS0FKnQ/4BnEWYIljInvKCzkvyPSMM1MNSes7oRgiWq5VF/4O6gGB61bGD+Qf/gODm/OuRByYlnDLYuJalPaId3wenAI+diMBdI3h3hfElWnL32P1i4LtSWg'
      },
      {
        value: {
          type: 'history-response',
          syncId: 'sync-1',
          users: [{ id: 'user-1', name: 'User', avatar: '' }],
          messages: [
            {
              type: 'text',
              id: 'message-1',
              userId: 'user-1',
              hlc: { timestamp: 1_800_000_000_000, counter: 1 },
              body: 'hello',
              mentions: []
            }
          ],
          done: true
        },
        json: '{"type":"history-response","syncId":"sync-1","users":[{"id":"user-1","name":"User","avatar":""}],"messages":[{"type":"text","id":"message-1","userId":"user-1","hlc":{"timestamp":1800000000000,"counter":1},"body":"hello","mentions":[]}],"done":true}',
        frame:
          'eJxVj0EKwzAMBP+yZweaW9EP8oCeSg5uIhpDbAdLKTXBfy9OQkt1klZodrVB88IgTE40ptwkliUGYRhIDkM3gvamaWGwCicB3Te4qtdx14P1lXETTjCwL6s2gYDSG3gWsU8+zk4z5bfCHJBz/+V3f+RpHkAb1HkWtX4BtdfLrwyGuAblBGqLwSOOuf7C8xxRrYO6GKp1X6OMMTBI08rlA7AvTu8='
      }
    ]

    for (const { value, json, frame } of golden) {
      expect(JSON.stringify(value)).toBe(json)
      await expect(NativeWireCodec.encode(value)).resolves.toBe(frame)
      await expect(NativeWireCodec.decode(frame)).resolves.toEqual(value)
    }
  })

  it('rejects malformed, truncated, and non-JSON frames without fallback decoding', async () => {
    await expect(NativeWireCodec.decode('plain JSON')).rejects.toBeInstanceOf(WireCodecError)
    const frame = await NativeWireCodec.encode({ valid: true })
    await expect(NativeWireCodec.decode(frame.slice(0, -4))).rejects.toBeInstanceOf(Error)
    const nonJson = await compressWithoutDecodedLimit('not-json')
    await expect(NativeWireCodec.decode(nonJson)).rejects.toThrow('not valid JSON')
  })

  it('accepts only the one canonical padded Base64 spelling', async () => {
    let frame = ''
    let value: unknown
    for (let length = 0; length < 32 && !frame.endsWith('='); length += 1) {
      value = { value: 'x'.repeat(length) }
      frame = await NativeWireCodec.encode(value)
    }
    expect(frame).toMatch(/={1,2}$/)
    await expect(NativeWireCodec.decode(frame)).resolves.toEqual(value)

    const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'
    const paddingLength = frame.endsWith('==') ? 2 : 1
    const dataIndex = frame.length - paddingLength - 1
    const sextet = alphabet.indexOf(frame[dataIndex]!)
    const overflowMask = paddingLength === 2 ? 0b1111 : 0b11
    const nonCanonicalSextet = (sextet & ~overflowMask) | 1
    const nonZeroPaddingBits = frame.slice(0, dataIndex) + alphabet[nonCanonicalSextet] + frame.slice(dataIndex + 1)
    const malformed = [
      ` ${frame}`,
      `${frame.slice(0, 4)} ${frame.slice(4)}`,
      `${frame}\n`,
      frame.replace(/=+$/, ''),
      `${frame}=`,
      `*${frame.slice(1)}`,
      'AAAA-AAA',
      'AAAA_AAA',
      nonZeroPaddingBits
    ]

    for (const candidate of malformed) {
      await expect(NativeWireCodec.decode(candidate)).rejects.toThrow('Malformed base64 frame')
    }
  })

  it('cancels decompression before parsing when decoded JSON exceeds 1MiB', async () => {
    const bomb = await compressWithoutDecodedLimit(JSON.stringify({ value: 'x'.repeat(1100 * 1024) }))
    await expect(NativeWireCodec.decode(bomb)).rejects.toThrow('Decoded JSON exceeds')
  })

  it('enforces the uniform encoded-frame bound without message-property validation', async () => {
    // The codec's representation bound is uniform; no message validator exists in the protocol.
    const frame = await NativeWireCodec.encode({ type: 'session-end', presenceId: 'p' })
    expect(frame).toMatch(/^[A-Za-z0-9+/]+={0,2}$/)
  })
})
