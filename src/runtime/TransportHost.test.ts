import { describe, expect, it, vi } from 'vitest'
import type { RoomTransport } from '@/runtime/RoomTransport'
import { createTransportService } from '@/runtime/TransportHost'

const createTransport = () => {
  let message: Parameters<RoomTransport['onMessage']>[0] = () => {}
  let join: Parameters<RoomTransport['onPeerJoin']>[0] = () => {}
  let leave: Parameters<RoomTransport['onPeerLeave']>[0] = () => {}
  let close: Parameters<RoomTransport['onRoomClose']>[0] = () => {}
  let error: Parameters<RoomTransport['onError']>[0] = () => {}
  const transport: RoomTransport = {
    peerIdOf: (roomId) => `peer:${roomId}`,
    join: async () => {},
    leave: vi.fn(),
    send: vi.fn(async () => {}),
    onMessage: (callback) => {
      message = callback
      return () => {}
    },
    onPeerJoin: (callback) => {
      join = callback
      return () => {}
    },
    onPeerLeave: (callback) => {
      leave = callback
      return () => {}
    },
    onRoomClose: (callback) => {
      close = callback
      return () => {}
    },
    onError: (callback) => {
      error = callback
      return () => {}
    },
    dispose: vi.fn()
  }
  return {
    transport,
    emit: {
      message: (roomId: string, sourcePeerId: string, payload: string) => message(roomId, sourcePeerId, payload),
      join: (roomId: string, peerId: string) => join(roomId, peerId),
      leave: (roomId: string, peerId: string) => leave(roomId, peerId),
      close: (roomId: string) => close(roomId),
      error: (failure: Error, roomId: string) => error(failure, roomId)
    }
  }
}

describe('Offscreen TransportService', () => {
  it('replaces each current callback lane without replaying a prior callback', async () => {
    const fixture = createTransport()
    const service = createTransportService(fixture.transport)
    const first = vi.fn()
    const current = vi.fn()
    const room = await service.join('room-a', 'handle-a')

    await expect(service.onMessage(first)).resolves.toEqual({ rooms: [room] })
    fixture.emit.message('room-a', 'peer-a', 'first')
    await service.onMessage(current)
    fixture.emit.message('room-a', 'peer-a', 'current')

    await service.onPeerJoin(first)
    fixture.emit.join('room-a', 'peer-a')
    await service.onPeerJoin(current)
    fixture.emit.join('room-a', 'peer-b')

    await service.onPeerLeave(first)
    fixture.emit.leave('room-a', 'peer-a')
    await service.onPeerLeave(current)
    fixture.emit.leave('room-a', 'peer-b')

    const failure = new Error('transport failed')
    await service.onError(first)
    fixture.emit.error(failure, 'room-a')
    await service.onError(current)
    fixture.emit.error(failure, 'room-a')

    await service.onRoomClose(first)
    fixture.emit.close('room-a')

    expect(first.mock.calls).toEqual([
      ['room-a', 'handle-a', 'peer-a', 'first'],
      ['room-a', 'handle-a', 'peer-a'],
      ['room-a', 'handle-a', 'peer-a'],
      [failure, 'room-a', 'handle-a'],
      ['room-a', 'handle-a']
    ])
    expect(current.mock.calls).toEqual([
      ['room-a', 'handle-a', 'peer-a', 'current'],
      ['room-a', 'handle-a', 'peer-b'],
      ['room-a', 'handle-a', 'peer-b'],
      [failure, 'room-a', 'handle-a']
    ])
  })

  it('preserves the RoomTransport leave options at the physical boundary', async () => {
    const fixture = createTransport()
    const service = createTransportService(fixture.transport)
    await service.join('room-a', 'handle-a')

    await service.leave('room-a', 'handle-a', { diagnosticOnly: true })

    expect(fixture.transport.leave).toHaveBeenCalledWith('room-a', { diagnosticOnly: true })
  })

  it('rejects a stale physical command before it reaches the room transport', async () => {
    const fixture = createTransport()
    const service = createTransportService(fixture.transport)
    await service.join('room-a', 'current')

    await expect(service.send('room-a', 'stale', 'payload')).rejects.toThrow('no longer current')
    await expect(service.leave('room-a', 'stale')).rejects.toThrow('no longer current')

    expect(fixture.transport.send).not.toHaveBeenCalled()
    expect(fixture.transport.leave).not.toHaveBeenCalled()
  })
})
