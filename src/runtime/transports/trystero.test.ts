import { beforeEach, describe, expect, it, vi } from 'vitest'

const joinRoom = vi.fn()

vi.mock('@trystero-p2p/ws-relay', () => ({
  joinRoom: (...args: unknown[]) => joinRoom(...args),
  selfId: 'self'
}))

const { createRoomTransport } = await import('./trystero')
const { isPeerLevelError, isTransientSendFailure } = await import('./trystero')

// SAFETY: the transport passes this shape as the third argument of every joinRoom call.
const kindError = (kind: string) => Object.assign(new Error(kind), { kind })
const sendMock = vi.fn()
const errorHandlers: ((error: { code: string; message: string }) => void)[] = []

const silentRoom = () => ({
  ready: Promise.resolve(),
  getSelf: async () => ({ peerId: 'self', userId: 'user' }),
  makeAction: () => ({ send: sendMock, onMessage: () => () => {} }),
  onPeerJoin: () => () => {},
  onPeerLeave: () => () => {},
  onError: (handler: (error: { code: string; message: string }) => void) => {
    errorHandlers.push(handler)
    return () => {}
  }
})

describe('trystero transport', () => {
  beforeEach(() => {
    vi.stubGlobal('__NAME__', 'web-chat')
    joinRoom.mockReset()
    joinRoom.mockImplementation(() => silentRoom())
  })

  it('keeps an unreachable peer out of the room error path', async () => {
    const transport = createRoomTransport()
    const errors: string[] = []
    transport.onError((error) => errors.push(error.message))
    await transport.join('room')
    const handler = errorHandlers.at(-1)!
    handler({ code: 'peer-connect-failed', message: 'a peer could not be reached' })
    handler({ code: 'handshake-failed', message: 'handshake timed out' })
    expect(errors).toEqual([])
  })

  it('still reports a failure that belongs to the room', async () => {
    const transport = createRoomTransport()
    const errors: string[] = []
    transport.onError((error) => errors.push(error.message))
    await transport.join('room')
    errorHandlers.at(-1)!({ code: 'relay-failed', message: 'the relay refused the connection' })
    expect(errors).toEqual(['the relay refused the connection'])
  })

  it('recognises the error codes that belong to one peer', () => {
    expect(isPeerLevelError('peer-connect-failed')).toBe(true)
    expect(isPeerLevelError('handshake-failed')).toBe(true)
    expect(isPeerLevelError('decrypt-failed')).toBe(true)
    expect(isPeerLevelError('relay-failed')).toBe(false)
    expect(isPeerLevelError('room-full')).toBe(false)
  })

  it('reports a frame that never left as a plain delivery failure', async () => {
    const transport = createRoomTransport()
    await transport.join('room')
    const gone = Object.assign(new Error('data channel stopped draining'), { kind: 'disconnected' })
    sendMock.mockRejectedValueOnce(gone)
    await expect(transport.send('room', 'payload')).rejects.toThrow('Message not delivered')
    sendMock.mockRejectedValueOnce(Object.assign(new Error('rejected by the room'), { kind: 'rejected' }))
    await expect(transport.send('room', 'payload')).rejects.toThrow('rejected by the room')
  })

  it('recognises the failures that belong to a single frame', () => {
    expect(isTransientSendFailure(kindError('disconnected'))).toBe(true)
    expect(isTransientSendFailure(kindError('timeout'))).toBe(true)
    expect(isTransientSendFailure(kindError('aborted'))).toBe(true)
    expect(isTransientSendFailure(kindError('rejected'))).toBe(false)
    expect(isTransientSendFailure(new Error('nope'))).toBe(false)
  })
})
