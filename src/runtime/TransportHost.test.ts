import { describe, expect, it, vi } from 'vitest'
import type { RoomTransport } from '@/runtime/RoomTransport'
import { createTransportService } from '@/runtime/TransportHost'

const deferred = <Value>() => {
  let resolve!: (value: Value) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<Value>((onResolve, onReject) => {
    resolve = onResolve
    reject = onReject
  })
  return { promise, resolve, reject }
}

const createTransport = () => {
  let message: Parameters<RoomTransport['onMessage']>[0] = () => {}
  let join: Parameters<RoomTransport['onPeerJoin']>[0] = () => {}
  let leave: Parameters<RoomTransport['onPeerLeave']>[0] = () => {}
  let close: Parameters<RoomTransport['onRoomClose']>[0] = () => {}
  let error: Parameters<RoomTransport['onError']>[0] = () => {}
  const joinTransport = vi.fn<RoomTransport['join']>(async () => {})
  const transport: RoomTransport = {
    peerIdOf: (roomId) => `peer:${roomId}`,
    join: joinTransport,
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

  it('treats an already-settled Q room as inapplicable while the pending room supplies the abort receipt', async () => {
    const fixture = createTransport()
    const chatJoin = deferred<void>()
    const abortReceipt = deferred<void>()
    fixture.join.mockImplementation((roomId) => (roomId === 'chat' ? chatJoin.promise : Promise.resolve()))
    fixture.transport.abortJoin = vi.fn(async (roomId) => {
      if (roomId !== 'chat') throw new Error('only the pending Chat H may be aborted')
      await abortReceipt.promise
      chatJoin.reject(new Error('Chat H aborted'))
    })
    const service = createTransportService(fixture.transport)
    const binding = await service.rebind(
      () => {},
      () => {},
      () => {},
      () => {},
      () => {}
    )

    await service.join('world', 'world-owner', binding.admission, 'q:world')
    const pendingChat = service.join('chat', 'chat-owner', binding.admission, 'q:chat')
    const ignoredPendingChat = pendingChat.catch(() => undefined)
    await Promise.resolve()

    let settled = false
    const qAbort = Promise.all([service.abortJoin!('world', 'q:world'), service.abortJoin!('chat', 'q:chat')]).then(
      () => {
        settled = true
      }
    )
    await Promise.resolve()
    expect(fixture.transport.abortJoin).toHaveBeenCalledWith('chat', 'q:chat')
    expect(settled).toBe(false)

    abortReceipt.resolve()
    await qAbort
    await ignoredPendingChat
    expect(settled).toBe(true)
  })
})
