import { describe, expect, it, vi } from 'vitest'
import { RemoteRoomTransport } from '@/runtime/RemoteRoomTransport'
import type { RoomTransport } from '@/runtime/RoomTransport'
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
    send: vi.fn(async () => {}),
    rebind: vi.fn(async (message, peerJoin, peerLeave, roomClose, error) => {
      messageCallbacks.push(message)
      joinCallbacks.push(peerJoin)
      leaveCallbacks.push(peerLeave)
      closeCallbacks.push(roomClose)
      errorCallbacks.push(error)
      return { ...projection(), admission: ++admission }
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

  it('includes an old admission entering an empty fresh rebind and fences later expired joins', async () => {
    const joining = deferred<void>()
    let message: Parameters<RoomTransport['onMessage']>[0] = () => {}
    const physical: RoomTransport = {
      peerIdOf: (roomId) => `peer:${roomId}`,
      join: vi.fn(() => joining.promise),
      leave: vi.fn(),
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
    expect(freshBackground.peerIdOf('room-a')).toBe('peer:room-a')
    message('room-a', 'peer-a', 'current')
    expect(messages).toEqual(['current'])

    await expect(oldBackground.join('room-b')).rejects.toThrow('admission is no longer current')
    expect(physical.join).toHaveBeenCalledOnce()
    await freshBackground.join('room-b')
    expect(freshBackground.peerIdOf('room-b')).toBe('peer:room-b')
  })

  it('waits for an old admitted join before a fresh Background aligns its usable projection', async () => {
    const joining = deferred<void>()
    let message: Parameters<RoomTransport['onMessage']>[0] = () => {}
    const physical: RoomTransport = {
      peerIdOf: (roomId) => `peer:${roomId}`,
      join: vi.fn(() => joining.promise),
      leave: vi.fn(),
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
    expect(freshBackground.peerIdOf('room-a')).toBe('peer:room-a')
    expect(freshBackground.peerIdOf('room-b')).toBe('peer:room-b')
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
