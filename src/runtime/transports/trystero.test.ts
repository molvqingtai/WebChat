import { beforeEach, describe, expect, it, vi } from 'vitest'

const joinRoom = vi.fn()

vi.mock('trystero', () => ({
  joinRoom: (...args: unknown[]) => joinRoom(...args),
  selfId: 'self'
}))

const { createRoomTransport } = await import('./trystero')
const { isPeerLevelFailure, isTransientSendFailure } = await import('./trystero')

// SAFETY: the transport passes this shape as the third argument of every joinRoom call.
const lastConfig = () => joinRoom.mock.calls.at(-1)?.[2] as { onJoinError: (details: { error: string }) => void }
const sendMock = vi.fn()

const silentRoom = () => ({
  makeAction: () => ({ send: sendMock, onMessage: null }),
  onPeerJoin: null,
  onPeerLeave: null
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
    lastConfig().onJoinError({ error: 'Trystero: handshake timed out after 10000ms' })
    lastConfig().onJoinError({ error: 'could not connect to peer abc' })
    expect(errors).toEqual([])
  })

  it('still reports a failure that belongs to the room', async () => {
    const transport = createRoomTransport()
    const errors: string[] = []
    transport.onError((error) => errors.push(error.message))
    await transport.join('room')
    lastConfig().onJoinError({ error: 'Trystero: signaling server refused the connection' })
    expect(errors).toEqual(['Trystero: signaling server refused the connection'])
  })

  it('recognises the markers trystero prefixes', () => {
    expect(isPeerLevelFailure('Trystero: handshake timed out after 10000ms')).toBe(true)
    expect(isPeerLevelFailure('Trystero: handshake failed: incorrect password')).toBe(true)
    expect(isPeerLevelFailure('Trystero: signaling server refused the connection')).toBe(false)
  })

  it('reports a frame that never left as a plain delivery failure', async () => {
    const transport = createRoomTransport()
    await transport.join('room')
    sendMock.mockRejectedValueOnce(new Error('Trystero: data channel stopped draining'))
    await expect(transport.send('room', 'payload')).rejects.toThrow('Message not delivered')
    sendMock.mockRejectedValueOnce(new Error('Trystero: something else broke'))
    await expect(transport.send('room', 'payload')).rejects.toThrow('Trystero: something else broke')
  })

  it('recognises the failures that belong to a single frame', () => {
    expect(isTransientSendFailure('Trystero: data channel stopped draining')).toBe(true)
    expect(isTransientSendFailure('Trystero: peer disconnected')).toBe(true)
    expect(isTransientSendFailure('Trystero: no peer with id abc found')).toBe(true)
    expect(isTransientSendFailure('Trystero: signaling server refused the connection')).toBe(false)
  })
})
