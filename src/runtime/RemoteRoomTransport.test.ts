import { describe, expect, it, vi } from 'vitest'
import { RemoteRoomTransport } from '@/runtime/RemoteRoomTransport'
import type { TransportRoomState, TransportService } from '@/runtime/TransportHost'

const createService = () => {
  const messageCallbacks: Array<Parameters<TransportService['onMessage']>[0]> = []
  const joinCallbacks: Array<Parameters<TransportService['onPeerJoin']>[0]> = []
  const leaveCallbacks: Array<Parameters<TransportService['onPeerLeave']>[0]> = []
  const closeCallbacks: Array<Parameters<TransportService['onRoomClose']>[0]> = []
  const errorCallbacks: Array<Parameters<TransportService['onError']>[0]> = []
  const rooms = new Map<string, TransportRoomState>()
  const projection = () => ({ rooms: [...rooms.values()] })
  const join = vi.fn(async (roomId: string, handle: string) => {
    const room = { roomId, handle, peerId: `peer:${roomId}` }
    rooms.set(roomId, room)
    return room
  })
  const service: TransportService = {
    join,
    leave: vi.fn(async (roomId, handle) => {
      if (rooms.get(roomId)?.handle !== handle) throw new Error('stale handle')
      rooms.delete(roomId)
    }),
    send: vi.fn(async () => {}),
    onMessage: vi.fn(async (callback) => {
      messageCallbacks.push(callback)
      return projection()
    }),
    onPeerJoin: vi.fn(async (callback) => {
      joinCallbacks.push(callback)
      return projection()
    }),
    onPeerLeave: vi.fn(async (callback) => {
      leaveCallbacks.push(callback)
      return projection()
    }),
    onRoomClose: vi.fn(async (callback) => {
      closeCallbacks.push(callback)
      return projection()
    }),
    onError: vi.fn(async (callback) => {
      errorCallbacks.push(callback)
      return projection()
    })
  }
  return { service, join, rooms, messageCallbacks, joinCallbacks, leaveCallbacks, closeCallbacks, errorCallbacks }
}

describe('RemoteRoomTransport', () => {
  it('aligns a surviving Offscreen projection before accepting current callbacks', async () => {
    const fixture = createService()
    const transport = new RemoteRoomTransport(fixture.service)
    const messages: string[] = []
    const closes: string[] = []
    transport.onMessage((_roomId, _sourcePeerId, payload) => messages.push(payload))
    transport.onRoomClose((roomId) => closes.push(roomId))

    await transport.rebind()
    await transport.join('room-a')
    const staleMessage = fixture.messageCallbacks[0]!
    const staleClose = fixture.closeCallbacks[0]!

    await transport.rebind()
    const currentMessage = fixture.messageCallbacks[1]!
    const currentClose = fixture.closeCallbacks[1]!
    const handle = fixture.join.mock.results[0]?.value
    const room = await handle
    staleMessage('room-a', room.handle, 'peer-a', 'stale')
    staleClose('room-a', room.handle)
    currentMessage('room-a', room.handle, 'peer-a', 'current')

    expect(messages).toEqual(['current'])
    expect(closes).toEqual([])
    expect(transport.peerIdOf('room-a')).toBe('peer:room-a')

    currentClose('room-a', room.handle)
    expect(closes).toEqual(['room-a'])
  })

  it('recovers a fresh Background facade from the surviving Offscreen projection', async () => {
    const fixture = createService()
    const oldBackground = new RemoteRoomTransport(fixture.service)
    await oldBackground.rebind()
    await oldBackground.join('room-a')

    const freshBackground = new RemoteRoomTransport(fixture.service)
    const messages: string[] = []
    freshBackground.onMessage((_roomId, _sourcePeerId, payload) => messages.push(payload))
    await freshBackground.rebind()
    const room = fixture.rooms.get('room-a')!
    fixture.messageCallbacks.at(-1)!('room-a', room.handle, 'peer-a', 'current')

    expect(freshBackground.peerIdOf('room-a')).toBe('peer:room-a')
    expect(messages).toEqual(['current'])
  })

  it('forwards diagnostic-only release once and fences callbacks after disposal', async () => {
    const fixture = createService()
    const transport = new RemoteRoomTransport(fixture.service)
    const errors: Error[] = []
    transport.onError((error) => errors.push(error))
    await transport.rebind()
    const errorCallback = fixture.errorCallbacks[0]!
    await transport.join('room-a')
    const room = await fixture.join.mock.results[0]?.value

    await transport.leave('room-a', { diagnosticOnly: true })
    transport.dispose()
    errorCallback(new Error('late physical failure'), 'room-a', room.handle)

    expect(fixture.service.leave).toHaveBeenCalledWith('room-a', room.handle, { diagnosticOnly: true })
    expect(errors).toEqual([])
  })

  it('projects a fresh Offscreen replacement as exact closes before later Page work', async () => {
    const fixture = createService()
    const transport = new RemoteRoomTransport(fixture.service)
    const closes: string[] = []
    transport.onRoomClose((roomId) => closes.push(roomId))

    await transport.rebind()
    await transport.join('room-a')
    fixture.rooms.clear()
    await transport.rebind()

    expect(closes).toEqual(['room-a'])
    await expect(transport.send('room-a', 'late')).rejects.toThrow('no current handle')
  })
})
