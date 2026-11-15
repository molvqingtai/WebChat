import { beforeEach, describe, expect, it, vi } from 'vitest'

const joinRoom = vi.fn()

vi.mock('trystero', () => ({
  joinRoom: (...args: unknown[]) => joinRoom(...args),
  selfId: 'self'
}))

const { createRoomTransport } = await import('./trystero')
const { isPeerLevelFailure } = await import('./trystero')

const lastConfig = () => joinRoom.mock.calls.at(-1)?.[2] as { onJoinError: (details: { error: string }) => void }
const silentRoom = () => ({
  makeAction: () => ({ send: vi.fn(), onMessage: null }),
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
})
