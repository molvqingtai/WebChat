import { describe, expect, it, vi } from 'vitest'
import { MESSAGE_TYPE, NativeWireCodec } from '@/protocol'
import { getWorldRoomId } from '@/domain/runtime/World'
import type { RoomTransport } from '@/runtime/RoomTransport'
import { createTransportService } from '@/runtime/TransportHost'

const createTransport = () => {
  let message: Parameters<RoomTransport['onMessage']>[0] = () => {}
  let join: Parameters<RoomTransport['onPeerJoin']>[0] = () => {}
  let leave: Parameters<RoomTransport['onPeerLeave']>[0] = () => {}
  let close: Parameters<RoomTransport['onRoomClose']>[0] = () => {}
  let error: Parameters<RoomTransport['onError']>[0] = () => {}
  const joinTransport = vi.fn(async () => {})
  const transport: RoomTransport = {
    peerIdOf: (roomId) => `peer:${roomId}`,
    join: joinTransport,
    leave: vi.fn(),
    retireRoomsForPreparation: async () => {},
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
    join: joinTransport,
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
    const firstBinding = await service.rebind(first, first, first, first, first)
    const room = await service.join('room-a', 'handle-a', firstBinding.admission)

    fixture.emit.message('room-a', 'peer-a', 'first')
    fixture.emit.join('room-a', 'peer-a')
    fixture.emit.leave('room-a', 'peer-a')
    const failure = new Error('transport failed')
    fixture.emit.error(failure, 'room-a')
    const currentBinding = await service.rebind(current, current, current, current, current)
    expect(currentBinding.rooms).toEqual([room])
    fixture.emit.message('room-a', 'peer-a', 'current')
    fixture.emit.join('room-a', 'peer-b')
    fixture.emit.leave('room-a', 'peer-b')
    fixture.emit.error(failure, 'room-a')
    fixture.emit.close('room-a')

    expect(first.mock.calls).toEqual([
      ['room-a', 'handle-a', 'peer-a', 'first'],
      ['room-a', 'handle-a', 'peer-a'],
      ['room-a', 'handle-a', 'peer-a'],
      [failure, 'room-a', 'handle-a']
    ])
    expect(current.mock.calls).toEqual([
      ['room-a', 'handle-a', 'peer-a', 'current'],
      ['room-a', 'handle-a', 'peer-b'],
      ['room-a', 'handle-a', 'peer-b'],
      [failure, 'room-a', 'handle-a'],
      ['room-a', 'handle-a']
    ])
  })

  it('preserves the RoomTransport leave options at the physical boundary', async () => {
    const fixture = createTransport()
    const service = createTransportService(fixture.transport)
    const binding = await service.rebind(
      () => {},
      () => {},
      () => {},
      () => {},
      () => {}
    )
    await service.join('room-a', 'handle-a', binding.admission)

    await service.leave('room-a', 'handle-a', { diagnosticOnly: true })

    expect(fixture.transport.leave).toHaveBeenCalledWith('room-a', { diagnosticOnly: true })
  })

  it('rejects a stale physical command before it reaches the room transport', async () => {
    const fixture = createTransport()
    const service = createTransportService(fixture.transport)
    const binding = await service.rebind(
      () => {},
      () => {},
      () => {},
      () => {},
      () => {}
    )
    await service.join('room-a', 'current', binding.admission)

    await expect(service.send('room-a', 'stale', 'payload')).rejects.toThrow('no longer current')
    await expect(service.leave('room-a', 'stale')).rejects.toThrow('no longer current')

    expect(fixture.transport.send).not.toHaveBeenCalled()
    expect(fixture.transport.leave).not.toHaveBeenCalled()
  })

  it('settles one exact room handle before rejecting an overlapping replacement join', async () => {
    const fixture = createTransport()
    let releaseJoin!: () => void
    const joining = new Promise<void>((resolve) => {
      releaseJoin = resolve
    })
    fixture.join.mockImplementationOnce(async () => joining)
    const service = createTransportService(fixture.transport)
    const binding = await service.rebind(
      () => {},
      () => {},
      () => {},
      () => {},
      () => {}
    )

    const first = service.join('room-a', 'handle-a', binding.admission)
    const second = service.join('room-a', 'handle-b', binding.admission)
    await Promise.resolve()
    expect(fixture.join).toHaveBeenCalledOnce()

    releaseJoin()
    await expect(first).resolves.toMatchObject({ roomId: 'room-a', handle: 'handle-a' })
    await expect(second).rejects.toThrow('owned by a newer handle')
    await expect(service.join('room-a', 'handle-a', binding.admission)).resolves.toMatchObject({ handle: 'handle-a' })
    expect(fixture.join).toHaveBeenCalledOnce()
  })

  it('fails closed when a current Room was declared but no committed recovery identity reached Offscreen', async () => {
    const fixture = createTransport()
    const service = createTransportService(fixture.transport)
    const binding = await service.rebind(
      () => {},
      () => {},
      () => {},
      () => {},
      () => {}
    )
    await service.requireRoomRecovery('room-a', 'https://example.com', binding.admission)
    await service.join('room-a', 'handle-a', binding.admission)

    await expect(
      service.rebind(
        () => {},
        () => {},
        () => {},
        () => {},
        () => {}
      )
    ).rejects.toThrow('recovery is incomplete')
  })

  it('recovers only validated current sessions and fences a late prior-host write', async () => {
    const fixture = createTransport()
    const service = createTransportService(fixture.transport)
    const binding = await service.rebind(
      () => {},
      () => {},
      () => {},
      () => {},
      () => {}
    )
    await service.requireRoomRecovery('room-a', 'https://example.com', binding.admission)
    await service.join('room-a', 'handle-a', binding.admission)
    const recovery = {
      roomId: 'room-a',
      domain: 'https://example.com',
      local: {
        sessionId: 'local-session',
        presenceId: 'local-presence',
        user: { id: 'local', name: 'Local', avatar: '' },
        site: { origin: 'https://example.com', title: 'Example' },
        joinedAt: 1
      },
      sessions: []
    }
    await service.rememberRoomRecovery('room-a', 'handle-a', binding.admission, recovery)
    fixture.emit.join('room-a', 'remote-peer')
    await service.rememberRoomRecovery('room-a', 'handle-a', binding.admission, {
      ...recovery,
      sessions: [
        {
          sourcePeerId: 'remote-peer',
          sourceGeneration: 1,
          session: {
            type: MESSAGE_TYPE.SESSION,
            sessionId: 'remote-session',
            presenceId: 'remote-presence',
            user: { id: 'remote', name: 'Remote', avatar: '' },
            joinedAt: 2
          }
        }
      ]
    })

    const rebound = await service.rebind(
      () => {},
      () => {},
      () => {},
      () => {},
      () => {}
    )
    expect(rebound.roomRecovery.rooms).toEqual([
      {
        ...recovery,
        sessions: [
          {
            sourcePeerId: 'remote-peer',
            sourceGeneration: 1,
            session: {
              type: MESSAGE_TYPE.SESSION,
              sessionId: 'remote-session',
              presenceId: 'remote-presence',
              user: { id: 'remote', name: 'Remote', avatar: '' },
              joinedAt: 2
            }
          }
        ]
      }
    ])
    await expect(service.rememberRoomRecovery('room-a', 'handle-a', binding.admission, recovery)).rejects.toThrow(
      'admission is no longer current'
    )

    fixture.emit.leave('room-a', 'remote-peer')
    const withoutPeer = await service.rebind(
      () => {},
      () => {},
      () => {},
      () => {},
      () => {}
    )
    expect(withoutPeer.roomRecovery.rooms[0]?.sessions).toEqual([])
    fixture.emit.close('room-a')
    const closed = await service.rebind(
      () => {},
      () => {},
      () => {},
      () => {},
      () => {}
    )
    expect(closed.rooms).toEqual([])
    expect(closed.roomRecovery.rooms).toEqual([])
  })

  it('keeps a World recovery source current across a replayed active-peer join', async () => {
    const fixture = createTransport()
    const service = createTransportService(fixture.transport)
    const joins = vi.fn()
    const binding = await service.rebind(
      () => {},
      joins,
      () => {},
      () => {},
      () => {}
    )
    const roomId = getWorldRoomId()
    await service.join(roomId, 'world', binding.admission)
    fixture.emit.join(roomId, 'remote-peer')
    const recovery = {
      members: [{ sourcePeerId: 'remote-peer', sourceGeneration: 1 }],
      presences: []
    }
    await service.rememberWorldRecovery!(binding.admission, recovery)

    fixture.emit.join(roomId, 'remote-peer')

    const rebound = await service.rebind(
      () => {},
      () => {},
      () => {},
      () => {},
      () => {}
    )
    expect(joins).toHaveBeenCalledTimes(2)
    expect(rebound.worldRecovery.members).toEqual(recovery.members)
  })

  it('fences an old World recovery source after its explicit leave and same-id rejoin', async () => {
    const fixture = createTransport()
    const service = createTransportService(fixture.transport)
    const binding = await service.rebind(
      () => {},
      () => {},
      () => {},
      () => {},
      () => {}
    )
    const roomId = getWorldRoomId()
    await service.join(roomId, 'world', binding.admission)
    fixture.emit.join(roomId, 'remote-peer')
    const recovery = {
      members: [{ sourcePeerId: 'remote-peer', sourceGeneration: 1 }],
      presences: []
    }
    await service.rememberWorldRecovery!(binding.admission, recovery)

    fixture.emit.leave(roomId, 'remote-peer')
    fixture.emit.join(roomId, 'remote-peer')

    await expect(service.rememberWorldRecovery!(binding.admission, recovery)).rejects.toThrow('source is no longer current')
    const rebound = await service.rebind(
      () => {},
      () => {},
      () => {},
      () => {},
      () => {}
    )
    expect(rebound.worldRecovery.members).toEqual([{ sourcePeerId: 'remote-peer', sourceGeneration: 2 }])
  })

  it('holds a normal rebind for a pre-cut slow state frame and keeps the cut-time frame distinct', async () => {
    const fixture = createTransport()
    const service = createTransportService(fixture.transport)
    const oldOwner = Promise.withResolvers<'invalid'>()
    const oldMessages = vi.fn(() => oldOwner.promise)
    const first = await service.rebind(
      oldMessages,
      () => {},
      () => {},
      () => {},
      () => {}
    )
    const roomId = getWorldRoomId()
    await service.join(roomId, 'world', first.admission)
    fixture.emit.join(roomId, 'remote-peer')
    await service.rememberWorldRecovery!(first.admission, {
      members: [{ sourcePeerId: 'remote-peer', sourceGeneration: 1 }],
      presences: []
    })

    const a = await NativeWireCodec.encode({
      sessionId: 'presence-a',
      user: { id: 'remote', name: 'A', avatar: '' },
      sites: [{ origin: 'https://a.example', title: 'A' }]
    })
    const deferredDecode = Promise.withResolvers<unknown>()
    const originalDecode = NativeWireCodec.decode
    const slowDecode = vi.spyOn(NativeWireCodec, 'decode').mockImplementationOnce(() => deferredDecode.promise)
    fixture.emit.message(roomId, 'remote-peer', a)

    const currentMessages = vi.fn()
    const rebinding = service.rebind(
      currentMessages,
      () => {},
      () => {},
      () => {},
      () => {}
    )
    let settled = false
    void rebinding.then(() => {
      settled = true
    })
    await Promise.resolve()
    expect(settled).toBe(false)

    // B crosses the cut under the new callback lane. It must not be mistaken for A's pre-cut
    // recovery frame, and the rebind remains pending until A's existing classification settles.
    fixture.emit.message(roomId, 'remote-peer', 'frame-b')
    expect(currentMessages).toHaveBeenCalledWith(roomId, 'world', 'remote-peer', 'frame-b')
    expect(settled).toBe(false)

    deferredDecode.resolve(await originalDecode!(a))
    // Local codec classification is already complete, but a stale logical facade has not
    // reached its terminal. The rebind must remain pending until it explicitly invalidates.
    await vi.waitFor(() => expect(slowDecode).toHaveBeenCalledTimes(1))
    await Promise.resolve()
    await Promise.resolve()
    expect(settled).toBe(false)
    oldOwner.resolve('invalid')
    const rebound = await rebinding
    expect(rebound.recoveryFrames).toEqual([
      expect.objectContaining({ roomId, sourcePeerId: 'remote-peer', payload: a })
    ])
    expect(oldMessages).toHaveBeenCalledWith(roomId, 'world', 'remote-peer', a)
    slowDecode.mockRestore()
  })
})
