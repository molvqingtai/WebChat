import { describe, expect, it, vi } from 'vitest'
import { RemoteRoomTransport } from '@/runtime/RemoteRoomTransport'
import type { RecoveryBindingCapability, RoomTransport } from '@/runtime/RoomTransport'
import { createTransportService, type TransportRoomState, type TransportService } from '@/runtime/TransportHost'

const deferred = <Value>() => {
  let resolve!: (value: Value) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<Value>((onResolve, onReject) => {
    resolve = onResolve
    reject = onReject
  })
  return { promise, resolve, reject }
}

const createService = () => {
  const messageCallbacks: Array<Parameters<TransportService['rebind']>[0]> = []
  const joinCallbacks: Array<Parameters<TransportService['rebind']>[1]> = []
  const leaveCallbacks: Array<Parameters<TransportService['rebind']>[2]> = []
  const closeCallbacks: Array<Parameters<TransportService['rebind']>[3]> = []
  const errorCallbacks: Array<Parameters<TransportService['rebind']>[4]> = []
  const rooms = new Map<string, TransportRoomState>()
  const projection = () => ({ rooms: [...rooms.values()] })
  let admission = 0
  const join = vi.fn(async (roomId: string, handle: string, _admission: number) => {
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
    retireRoomForPreparation: vi.fn(async (roomId, handle) => {
      if (rooms.get(roomId)?.handle !== handle) throw new Error('stale handle')
      rooms.delete(roomId)
    }),
    send: vi.fn(async () => {}),
    requireRoomRecovery: vi.fn(async () => {}),
    rememberRoomRecovery: vi.fn(async () => {}),
    rebind: vi.fn(async (message, peerJoin, peerLeave, roomClose, error) => {
      messageCallbacks.push(message)
      joinCallbacks.push(peerJoin)
      leaveCallbacks.push(peerLeave)
      closeCallbacks.push(roomClose)
      errorCallbacks.push(error)
      return {
        ...projection(),
        worldRecovery: { members: [], presences: [] },
        roomRecovery: { rooms: [] },
        recoveryFrames: [],
        admission: ++admission
      }
    })
  }
  return { service, join, rooms, messageCallbacks, joinCallbacks, leaveCallbacks, closeCallbacks, errorCallbacks }
}

describe('RemoteRoomTransport', () => {
  it('shares one pending physical join for concurrent callers in the same generation and admission', async () => {
    const fixture = createService()
    const releaseJoin = deferred<void>()
    vi.mocked(fixture.service.join).mockImplementation(async (roomId, handle) => {
      await releaseJoin.promise
      const room = { roomId, handle, peerId: `peer:${roomId}` }
      fixture.rooms.set(roomId, room)
      return room
    })
    const transport = new RemoteRoomTransport(fixture.service)
    await transport.rebind()
    await transport.activateIngress()

    const first = transport.join('room-a')
    const second = transport.join('room-a')
    await Promise.resolve()
    expect(fixture.join).toHaveBeenCalledOnce()

    releaseJoin.resolve()
    await expect(Promise.all([first, second])).resolves.toEqual([undefined, undefined])
    expect(transport.peerIdOf('room-a')).toBe('peer:room-a')
  })

  it('waits for every local owner-routing retirement before a successor can join', async () => {
    const fixture = createService()
    fixture.rooms.set('room-a', { roomId: 'room-a', handle: 'handle-a', peerId: 'peer:room-a' })
    fixture.rooms.set('room-b', { roomId: 'room-b', handle: 'handle-b', peerId: 'peer:room-b' })
    const first = deferred<void>()
    const second = deferred<void>()
    vi.mocked(fixture.service.retireRoomForPreparation).mockImplementation((roomId, handle) => {
      if (fixture.rooms.get(roomId)?.handle !== handle) return Promise.reject(new Error('stale handle'))
      fixture.rooms.delete(roomId)
      return roomId === 'room-a' ? first.promise : second.promise
    })
    const transport = new RemoteRoomTransport(fixture.service)
    await transport.rebind()
    await transport.activateIngress()

    let retired = false
    const retiring = transport.retireRoomsForPreparation(['room-a', 'room-b']).then(() => {
      retired = true
    })
    await Promise.resolve()
    expect(retired).toBe(false)
    expect(fixture.join).not.toHaveBeenCalled()
    first.resolve()
    await Promise.resolve()
    expect(retired).toBe(false)
    second.resolve()
    await retiring
    expect(retired).toBe(true)

    await transport.join('room-a')
    expect(fixture.join).toHaveBeenCalledTimes(1)
  })

  it('propagates an exact provider retirement rejection without preparing a successor', async () => {
    const fixture = createService()
    fixture.rooms.set('room-a', { roomId: 'room-a', handle: 'handle-a', peerId: 'peer:room-a' })
    fixture.rooms.set('room-b', { roomId: 'room-b', handle: 'handle-b', peerId: 'peer:room-b' })
    const first = deferred<void>()
    const second = deferred<void>()
    const failure = new Error('world leave rejected')
    vi.mocked(fixture.service.retireRoomForPreparation).mockImplementation((roomId, handle) => {
      if (fixture.rooms.get(roomId)?.handle !== handle) return Promise.reject(new Error('stale handle'))
      fixture.rooms.delete(roomId)
      return roomId === 'room-a' ? first.promise : second.promise
    })
    const transport = new RemoteRoomTransport(fixture.service)
    await transport.rebind()
    await transport.activateIngress()

    const retiring = transport.retireRoomsForPreparation(['room-a', 'room-b'])
    await Promise.resolve()
    expect(fixture.join).not.toHaveBeenCalled()
    first.resolve()
    second.reject(failure)

    await expect(retiring).rejects.toBe(failure)
    expect(fixture.join).not.toHaveBeenCalled()
  })

  it('marks an in-flight owner callback invalid when its logical Runtime is disposed', async () => {
    const fixture = createService()
    fixture.rooms.set('room-a', { roomId: 'room-a', handle: 'handle-a', peerId: 'peer:room-a' })
    const transport = new RemoteRoomTransport(fixture.service)
    const owner = deferred<void>()
    transport.onMessage(() => owner.promise)
    await transport.rebind()
    await transport.activateIngress()

    const terminal = fixture.messageCallbacks[0]!('room-a', 'handle-a', 'peer-a', 'frame')
    transport.dispose()

    await expect(terminal).resolves.toBe('invalid')
  })

  it('drains pre-cut recovery frames before cut-time ingress exactly once', async () => {
    const fixture = createService()
    fixture.rooms.set('room-a', { roomId: 'room-a', handle: 'handle-a', peerId: 'peer:room-a' })
    vi.mocked(fixture.service.rebind).mockImplementationOnce(async (message, peerJoin, peerLeave, roomClose, error) => {
      fixture.messageCallbacks.push(message)
      fixture.joinCallbacks.push(peerJoin)
      fixture.leaveCallbacks.push(peerLeave)
      fixture.closeCallbacks.push(roomClose)
      fixture.errorCallbacks.push(error)
      return {
        rooms: [...fixture.rooms.values()],
        worldRecovery: { members: [], presences: [] },
        roomRecovery: { rooms: [] },
        recoveryFrames: [
          {
            roomId: 'room-a',
            sourcePeerId: 'peer-a',
            sourceGeneration: 1,
            payload: 'frame-a',
            sequence: 1
          }
        ],
        admission: 1
      }
    })
    const transport = new RemoteRoomTransport(fixture.service)
    const messages: string[] = []
    transport.onMessage((_roomId, _sourcePeerId, payload) => messages.push(payload))
    await transport.rebind()

    // B arrives only after Offscreen installed the fresh callback lane, but before the new
    // Runtime made recovery visible. It remains buffered until A has been replayed.
    fixture.messageCallbacks[0]!('room-a', 'handle-a', 'peer-a', 'frame-b')
    expect(messages).toEqual([])
    await transport.activateIngress()

    expect(messages).toEqual(['frame-a', 'frame-b'])
  })

  it('aligns a surviving Offscreen projection before accepting current callbacks', async () => {
    const fixture = createService()
    const transport = new RemoteRoomTransport(fixture.service)
    const messages: string[] = []
    const closes: string[] = []
    transport.onMessage((_roomId, _sourcePeerId, payload) => messages.push(payload))
    transport.onRoomClose((roomId) => closes.push(roomId))

    await transport.rebind()
    transport.activateIngress()
    await transport.join('room-a')
    const staleMessage = fixture.messageCallbacks[0]!
    const staleClose = fixture.closeCallbacks[0]!

    await transport.rebind()
    transport.activateIngress()
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
    oldBackground.activateIngress()
    await oldBackground.join('room-a')

    const freshBackground = new RemoteRoomTransport(fixture.service)
    const messages: string[] = []
    freshBackground.onMessage((_roomId, _sourcePeerId, payload) => messages.push(payload))
    await freshBackground.rebind()
    freshBackground.activateIngress()
    const room = fixture.rooms.get('room-a')!
    fixture.messageCallbacks.at(-1)!('room-a', room.handle, 'peer-a', 'current')

    expect(freshBackground.peerIdOf('room-a')).toBe('peer:room-a')
    expect(messages).toEqual(['current'])
  })

  it('consumes current room capabilities atomically by original object identity', async () => {
    const fixture = createService()
    fixture.rooms.set('room-a', { roomId: 'room-a', handle: 'handle-a', peerId: 'peer:room-a' })
    fixture.rooms.set('world', { roomId: 'world', handle: 'handle-world', peerId: 'peer:world' })
    const transport = new RemoteRoomTransport(fixture.service)
    await transport.rebind()
    await transport.activateIngress()

    const room = transport.mintRecoveryBindingCapability('room-a')!
    const world = transport.mintRecoveryBindingCapability('world')!
    expect(
      transport.consumeRecoveryBindingCapabilities([
        { roomId: 'room-a', capability: room },
        { roomId: 'wrong-world', capability: world }
      ])
    ).toBe(false)
    expect(transport.consumeRecoveryBindingCapabilities([{ roomId: 'room-a', capability: room }])).toBe(true)
    expect(transport.consumeRecoveryBindingCapabilities([{ roomId: 'world', capability: world }])).toBe(true)

    const crossDomain = transport.mintRecoveryBindingCapability('room-a')!
    expect(transport.consumeRecoveryBindingCapabilities([{ roomId: 'world', capability: crossDomain }])).toBe(false)
    expect(transport.consumeRecoveryBindingCapabilities([{ roomId: 'room-a', capability: crossDomain }])).toBe(true)

    const serializable = transport.mintRecoveryBindingCapability('room-a')!
    expect(Object.getOwnPropertyNames(serializable)).toEqual([])
    expect(Object.getOwnPropertySymbols(serializable)).toEqual([])
    const copied = JSON.parse(JSON.stringify(serializable)) as RecoveryBindingCapability
    expect(transport.consumeRecoveryBindingCapabilities([{ roomId: 'room-a', capability: copied }])).toBe(false)
    expect(transport.consumeRecoveryBindingCapabilities([{ roomId: 'room-a', capability: serializable }])).toBe(true)

    const forged = Object.freeze(Object.create(null)) as RecoveryBindingCapability
    expect(transport.consumeRecoveryBindingCapabilities([{ roomId: 'room-a', capability: forged }])).toBe(false)

    const duplicate = transport.mintRecoveryBindingCapability('room-a')!
    expect(
      transport.consumeRecoveryBindingCapabilities([
        { roomId: 'room-a', capability: duplicate },
        { roomId: 'room-a', capability: duplicate }
      ])
    ).toBe(false)
    expect(transport.consumeRecoveryBindingCapabilities([{ roomId: 'room-a', capability: duplicate }])).toBe(true)

    const other = new RemoteRoomTransport(fixture.service)
    await other.rebind()
    await other.activateIngress()
    const fromOther = other.mintRecoveryBindingCapability('room-a')!
    expect(transport.consumeRecoveryBindingCapabilities([{ roomId: 'room-a', capability: fromOther }])).toBe(false)
  })

  it('invalidates recovery capabilities on activation, rebind, leave, and disposal', async () => {
    const fixture = createService()
    fixture.rooms.set('room-a', { roomId: 'room-a', handle: 'handle-a', peerId: 'peer:room-a' })
    const transport = new RemoteRoomTransport(fixture.service)
    await transport.rebind()
    const beforeActivation = transport.mintRecoveryBindingCapability('room-a')!
    await transport.activateIngress()
    expect(transport.consumeRecoveryBindingCapabilities([{ roomId: 'room-a', capability: beforeActivation }])).toBe(
      false
    )

    const beforeRebind = transport.mintRecoveryBindingCapability('room-a')!
    await transport.rebind()
    await transport.activateIngress()
    expect(transport.consumeRecoveryBindingCapabilities([{ roomId: 'room-a', capability: beforeRebind }])).toBe(false)

    const beforeLeave = transport.mintRecoveryBindingCapability('room-a')!
    await transport.leave('room-a')
    expect(transport.consumeRecoveryBindingCapabilities([{ roomId: 'room-a', capability: beforeLeave }])).toBe(false)

    fixture.rooms.set('room-a', { roomId: 'room-a', handle: 'handle-next', peerId: 'peer:room-a' })
    await transport.rebind()
    await transport.activateIngress()
    const beforeDispose = transport.mintRecoveryBindingCapability('room-a')!
    transport.dispose()
    expect(transport.consumeRecoveryBindingCapabilities([{ roomId: 'room-a', capability: beforeDispose }])).toBe(false)
  })

  it('includes an old admission entering an empty fresh rebind and fences later expired joins', async () => {
    const joining = deferred<void>()
    let message: Parameters<RoomTransport['onMessage']>[0] = () => {}
    const physical: RoomTransport = {
      peerIdOf: (roomId) => `peer:${roomId}`,
      join: vi.fn(() => joining.promise),
      leave: vi.fn(),
      retireRoomsForPreparation: async (roomIds) => {
        roomIds.forEach((roomId) => physical.leave(roomId))
      },
      send: vi.fn(async () => {}),
      onMessage: (callback) => {
        message = callback
        return () => {}
      },
      onPeerJoin: () => () => {},
      onPeerLeave: () => () => {},
      onRoomClose: () => () => {},
      onError: () => () => {},
      dispose: vi.fn()
    }
    const service = createTransportService(physical)
    const oldBackground = new RemoteRoomTransport(service)
    await oldBackground.rebind()
    oldBackground.activateIngress()

    const freshBackground = new RemoteRoomTransport(service)
    const messages: string[] = []
    freshBackground.onMessage((_roomId, _sourcePeerId, payload) => messages.push(payload))
    const rebinding = freshBackground.rebind()
    const oldJoin = oldBackground.join('room-a')
    await Promise.resolve()
    expect(physical.join).toHaveBeenCalledOnce()

    joining.resolve()
    await oldJoin
    await rebinding
    freshBackground.activateIngress()
    expect(freshBackground.peerIdOf('room-a')).toBe('peer:room-a')
    message('room-a', 'peer-a', 'current')
    expect(messages).toEqual(['current'])

    await expect(oldBackground.join('room-b')).rejects.toThrow('admission is no longer current')
    expect(physical.join).toHaveBeenCalledOnce()
    await freshBackground.join('room-b')
    expect(freshBackground.peerIdOf('room-b')).toBe('peer:room-b')
  })

  it('fences an expired admission after an empty fresh rebind yields once', async () => {
    const physical: RoomTransport = {
      peerIdOf: (roomId) => `peer:${roomId}`,
      join: vi.fn(async () => {}),
      leave: vi.fn(),
      retireRoomsForPreparation: async (roomIds) => {
        roomIds.forEach((roomId) => physical.leave(roomId))
      },
      send: vi.fn(async () => {}),
      onMessage: () => () => {},
      onPeerJoin: () => () => {},
      onPeerLeave: () => () => {},
      onRoomClose: () => () => {},
      onError: () => () => {},
      dispose: vi.fn()
    }
    const service = createTransportService(physical)
    const oldBackground = new RemoteRoomTransport(service)
    await oldBackground.rebind()
    oldBackground.activateIngress()

    const freshBackground = new RemoteRoomTransport(service)
    const rebinding = freshBackground.rebind()
    await Promise.resolve()
    const oldJoin = oldBackground.join('room-a')

    await expect(oldJoin).rejects.toThrow('admission is no longer current')
    await rebinding
    freshBackground.activateIngress()
    expect(physical.join).not.toHaveBeenCalled()
    expect(oldBackground.peerIdOf('room-a')).toBe('')
    expect(freshBackground.peerIdOf('room-a')).toBe('')

    await freshBackground.join('room-a')
    expect(physical.join).toHaveBeenCalledOnce()
    expect(freshBackground.peerIdOf('room-a')).toBe('peer:room-a')
  })

  it('waits for an old admitted join before a fresh Background aligns its usable projection', async () => {
    const joining = deferred<void>()
    let message: Parameters<RoomTransport['onMessage']>[0] = () => {}
    const physical: RoomTransport = {
      peerIdOf: (roomId) => `peer:${roomId}`,
      join: vi.fn(() => joining.promise),
      leave: vi.fn(),
      retireRoomsForPreparation: async (roomIds) => {
        roomIds.forEach((roomId) => physical.leave(roomId))
      },
      send: vi.fn(async () => {}),
      onMessage: (callback) => {
        message = callback
        return () => {}
      },
      onPeerJoin: () => () => {},
      onPeerLeave: () => () => {},
      onRoomClose: () => () => {},
      onError: () => () => {},
      dispose: vi.fn()
    }
    const service = createTransportService(physical)
    const oldBackground = new RemoteRoomTransport(service)
    await oldBackground.rebind()
    oldBackground.activateIngress()
    const oldJoin = oldBackground.join('room-a')
    await Promise.resolve()
    expect(physical.join).toHaveBeenCalledOnce()

    const freshBackground = new RemoteRoomTransport(service)
    const messages: string[] = []
    freshBackground.onMessage((_roomId, _sourcePeerId, payload) => messages.push(payload))
    let rebound = false
    const rebinding = freshBackground.rebind().then(() => {
      rebound = true
    })
    await Promise.resolve()
    expect(rebound).toBe(false)

    joining.resolve()
    await oldJoin
    await rebinding
    freshBackground.activateIngress()
    expect(freshBackground.peerIdOf('room-a')).toBe('peer:room-a')
    message('room-a', 'peer-a', 'current')
    expect(messages).toEqual(['current'])

    await freshBackground.send('room-a', 'payload')
    await freshBackground.leave('room-a')
    expect(physical.join).toHaveBeenCalledOnce()
    expect(physical.send).toHaveBeenCalledWith('room-a', 'payload', undefined)
    expect(physical.leave).toHaveBeenCalledWith('room-a', undefined)
  })

  it('waits for joins admitted while a fresh Background callback projection is registering', async () => {
    const firstJoin = deferred<void>()
    const secondJoin = deferred<void>()
    const physical: RoomTransport = {
      peerIdOf: (roomId) => `peer:${roomId}`,
      join: vi.fn((roomId) => (roomId === 'room-a' ? firstJoin.promise : secondJoin.promise)),
      leave: vi.fn(),
      retireRoomsForPreparation: async (roomIds) => {
        roomIds.forEach((roomId) => physical.leave(roomId))
      },
      send: vi.fn(async () => {}),
      onMessage: () => () => {},
      onPeerJoin: () => () => {},
      onPeerLeave: () => () => {},
      onRoomClose: () => () => {},
      onError: () => () => {},
      dispose: vi.fn()
    }
    const service = createTransportService(physical)
    const oldBackground = new RemoteRoomTransport(service)
    await oldBackground.rebind()
    oldBackground.activateIngress()
    const first = oldBackground.join('room-a')
    await Promise.resolve()

    const freshBackground = new RemoteRoomTransport(service)
    let rebound = false
    const rebinding = freshBackground.rebind().then(() => {
      rebound = true
    })
    await Promise.resolve()
    const second = oldBackground.join('room-b')
    await Promise.resolve()
    expect(physical.join).toHaveBeenCalledTimes(2)

    firstJoin.resolve()
    await first
    await Promise.resolve()
    expect(rebound).toBe(false)

    secondJoin.resolve()
    await second
    await rebinding
    freshBackground.activateIngress()
    expect(freshBackground.peerIdOf('room-a')).toBe('peer:room-a')
    expect(freshBackground.peerIdOf('room-b')).toBe('peer:room-b')
  })

  it('forwards diagnostic-only release once and fences callbacks after disposal', async () => {
    const fixture = createService()
    const transport = new RemoteRoomTransport(fixture.service)
    const errors: Error[] = []
    transport.onError((error) => errors.push(error))
    await transport.rebind()
    transport.activateIngress()
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
    transport.activateIngress()
    await transport.join('room-a')
    fixture.rooms.clear()
    await transport.rebind()
    transport.activateIngress()

    expect(closes).toEqual(['room-a'])
    await expect(transport.send('room-a', 'late')).rejects.toThrow('no current handle')
  })

  it('commits no projection from a rejected rebind and the next explicit rebind enters a fresh accepting generation', async () => {
    const fixture = createService()
    const transport = new RemoteRoomTransport(fixture.service)
    const messages: string[] = []
    const closes: string[] = []
    transport.onMessage((_roomId, _sourcePeerId, payload) => messages.push(payload))
    transport.onRoomClose((roomId) => closes.push(roomId))

    await transport.rebind()
    transport.activateIngress()
    await transport.join('room-a')

    // The failed attempt rejects before any replacement reservation or completion exists:
    // the facade retains its previous projection and admits no ingress from it.
    vi.mocked(fixture.service.rebind).mockRejectedValueOnce(new Error('Transport Room recovery is incomplete'))
    await expect(transport.rebind()).rejects.toThrow('Transport Room recovery is incomplete')
    expect(transport.peerIdOf('room-a')).toBe('peer:room-a')
    expect(fixture.service.join).toHaveBeenCalledTimes(1)

    // The next explicit attempt does not reuse the failure: it commits a fresh projection and
    // reaches the normal accepting state.
    fixture.rooms.clear()
    fixture.rooms.set('room-b', { roomId: 'room-b', handle: 'handle-b', peerId: 'peer:room-b' })
    await transport.rebind()
    transport.activateIngress()

    expect(closes).toEqual(['room-a'])
    expect(transport.peerIdOf('room-b')).toBe('peer:room-b')
    fixture.messageCallbacks.at(-1)!('room-b', 'handle-b', 'peer-a', 'ready')
    expect(messages).toEqual(['ready'])
  })
})
