import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createTrysteroRoomTransport } from '@/runtime/TrysteroRoomTransport'
import { createRoomTransport } from '@/runtime/TransportProvider'

interface FakeAction {
  send: (data: string, options?: { target?: string | string[] | null }) => Promise<void>
  onMessage: ((data: string, context: { peerId: string }) => void) | null
}

interface FakeRoom {
  roomId: string
  action: FakeAction
  makeAction: (namespace: string) => FakeAction
  onPeerJoin: ((peerId: string) => void) | null
  onPeerLeave: ((peerId: string) => void) | null
  leave: () => Promise<void>
  left: boolean
}

const trysteroFixture = vi.hoisted(() => {
  const rooms = new Map<string, FakeRoom>()
  const joinErrors = new Map<string, (details: { error: string }) => void>()
  const sent: { roomId: string; data: string; target?: string | string[] | null }[] = []
  const leaveControls = new Map<
    string,
    { promise: Promise<void>; resolve: () => void; reject: (error: Error) => void }
  >()
  const joinCalls: string[] = []
  let failNextSend: Error | undefined
  return {
    rooms,
    joinErrors,
    sent,
    leaveControls,
    joinCalls,
    deferLeave: (roomId: string) => {
      let resolve!: () => void
      let reject!: (error: Error) => void
      const promise = new Promise<void>((onResolve, onReject) => {
        resolve = onResolve
        reject = onReject
      })
      leaveControls.set(roomId, { promise, resolve, reject })
    },
    fail: (error: Error) => {
      failNextSend = error
    },
    takeFailure: () => {
      const failure = failNextSend
      failNextSend = undefined
      return failure
    }
  }
})

vi.mock('trystero', () => ({
  selfId: 'trystero-self-id',
  joinRoom: (
    _config: { appId: string },
    roomId: string,
    callbacks?: { onJoinError?: (d: { error: string }) => void }
  ) => {
    const action: FakeAction = {
      send: (data, options) => {
        const failure = trysteroFixture.takeFailure()
        if (failure) return Promise.reject(failure)
        trysteroFixture.sent.push({ roomId, data, target: options?.target })
        return Promise.resolve()
      },
      onMessage: null
    }
    trysteroFixture.joinCalls.push(roomId)
    const room: FakeRoom = {
      roomId,
      action,
      makeAction: () => action,
      onPeerJoin: null,
      onPeerLeave: null,
      left: false,
      leave() {
        this.left = true
        const control = trysteroFixture.leaveControls.get(roomId)
        if (control) {
          return control.promise.then(() => {
            trysteroFixture.rooms.delete(roomId)
          })
        }
        trysteroFixture.rooms.delete(roomId)
        return Promise.resolve()
      }
    }
    trysteroFixture.rooms.set(roomId, room)
    if (callbacks?.onJoinError) trysteroFixture.joinErrors.set(roomId, callbacks.onJoinError)
    return room
  }
}))

const settle = async () => {
  await new Promise<void>((resolve) => setTimeout(resolve, 0))
}

const roomOf = (roomId: string) => {
  const room = trysteroFixture.rooms.get(roomId)
  if (!room) throw new Error(`fake room "${roomId}" missing`)
  return room
}

beforeEach(() => {
  vi.stubGlobal('__NAME__', 'web-chat-test')
  trysteroFixture.rooms.clear()
  trysteroFixture.joinErrors.clear()
  trysteroFixture.sent.length = 0
  trysteroFixture.leaveControls.clear()
  trysteroFixture.joinCalls.length = 0
})

describe('TrysteroRoomTransport', () => {
  it('joins a room with the default config and exposes the global selfId while joined', async () => {
    const transport = createTrysteroRoomTransport()
    expect(transport.peerIdOf('room-a')).toBe('')

    await transport.join('room-a')

    expect(trysteroFixture.rooms.has('room-a')).toBe(true)
    expect(transport.peerIdOf('room-a')).toBe('trystero-self-id')
    transport.dispose()
  })

  it('sends with broadcast, single, array, and unknown target semantics', async () => {
    const transport = createTrysteroRoomTransport()
    await transport.join('room-a')

    await transport.send('room-a', 'all')
    await transport.send('room-a', 'one', 'peer-a')
    await transport.send('room-a', 'two', ['peer-a', 'peer-b'])
    await transport.send('room-a', 'none', 'missing-peer')

    expect(trysteroFixture.sent).toEqual([
      { roomId: 'room-a', data: 'all', target: null },
      { roomId: 'room-a', data: 'one', target: 'peer-a' },
      { roomId: 'room-a', data: 'two', target: ['peer-a', 'peer-b'] },
      { roomId: 'room-a', data: 'none', target: 'missing-peer' }
    ])
    transport.dispose()
  })

  it('sends nothing for an empty target array without calling the provider', async () => {
    const transport = createTrysteroRoomTransport()
    await transport.join('room-a')

    await transport.send('room-a', 'nobody', [])

    expect(trysteroFixture.sent).toEqual([])
    transport.dispose()
  })

  it('surfaces provider send rejections as-is', async () => {
    const transport = createTrysteroRoomTransport()
    await transport.join('room-a')
    const failure = new Error('relay publish failed')
    trysteroFixture.fail(failure)

    await expect(transport.send('room-a', 'boom')).rejects.toBe(failure)
    transport.dispose()
  })

  it('delivers messages, peer joins, and peer leaves with the exact room scope', async () => {
    const transport = createTrysteroRoomTransport()
    const events: string[] = []
    transport.onMessage((roomId, sourcePeerId, payload) => events.push(`message:${roomId}:${sourcePeerId}:${payload}`))
    transport.onPeerJoin((roomId, peerId) => events.push(`join:${roomId}:${peerId}`))
    transport.onPeerLeave((roomId, peerId) => events.push(`leave:${roomId}:${peerId}`))
    await transport.join('room-a')
    await transport.join('room-b')

    roomOf('room-a').action.onMessage?.('hello', { peerId: 'peer-a' })
    roomOf('room-a').onPeerJoin?.('peer-a')
    roomOf('room-b').onPeerLeave?.('peer-b')

    expect(events).toEqual(['message:room-a:peer-a:hello', 'join:room-a:peer-a', 'leave:room-b:peer-b'])
    transport.dispose()
  })

  it('routes join errors to the scoped room error listeners', async () => {
    const transport = createTrysteroRoomTransport()
    const errors: string[] = []
    transport.onError((error, roomId) => errors.push(`${roomId}:${error.message}`))
    await transport.join('room-a')

    trysteroFixture.joinErrors.get('room-a')?.({ error: 'handshake failed' })

    expect(errors).toEqual(['room-a:handshake failed'])
    transport.dispose()
  })

  it('leave removes the room after the physical settlement, fences its stale callbacks, and rejects later sends', async () => {
    const transport = createTrysteroRoomTransport()
    const events: string[] = []
    transport.onPeerJoin((roomId, peerId) => events.push(`join:${roomId}:${peerId}`))
    await transport.join('room-a')
    const room = roomOf('room-a')

    transport.leave('room-a')
    expect(room.left).toBe(true)
    await settle()

    expect(transport.peerIdOf('room-a')).toBe('')
    room.onPeerJoin?.('stale-peer')
    expect(events).toEqual([])
    await expect(transport.send('room-a', 'late')).rejects.toThrow('Room "room-a" not joined')
    transport.dispose()
  })

  it('waits for a pending physical leave before rejoining the same room', async () => {
    const transport = createTrysteroRoomTransport()
    await transport.join('room-a')
    const firstRoom = roomOf('room-a')
    trysteroFixture.deferLeave('room-a')

    transport.leave('room-a')
    let rejoined = false
    const rejoin = transport.join('room-a').then(() => {
      rejoined = true
    })
    await settle()

    // The leave is still in flight: no second Room may be created and the join stays pending.
    expect(rejoined).toBe(false)
    expect(trysteroFixture.joinCalls).toEqual(['room-a'])

    trysteroFixture.leaveControls.get('room-a')?.resolve()
    await rejoin

    expect(trysteroFixture.joinCalls).toEqual(['room-a', 'room-a'])
    expect(roomOf('room-a')).not.toBe(firstRoom)
    expect(transport.peerIdOf('room-a')).toBe('trystero-self-id')
    transport.dispose()
  })

  it('keeps the room occupied and reports a normal leave failure without rejoining a stale Room', async () => {
    const transport = createTrysteroRoomTransport()
    const errors: string[] = []
    transport.onError((error, roomId) => errors.push(`${roomId}:${error.message}`))
    await transport.join('room-a')
    const firstRoom = roomOf('room-a')
    trysteroFixture.deferLeave('room-a')

    transport.leave('room-a')
    const leaveFailure = new Error('leave rejected')
    trysteroFixture.leaveControls.get('room-a')?.reject(leaveFailure)
    await settle()

    expect(errors).toEqual(['room-a:leave rejected'])
    // The failed leave retains the room as occupied: a same-room join rejects with the exact
    // leave failure identity and never binds a second Room.
    await expect(transport.join('room-a')).rejects.toBe(leaveFailure)
    expect(trysteroFixture.joinCalls).toEqual(['room-a'])
    expect(roomOf('room-a')).toBe(firstRoom)
    expect(transport.peerIdOf('room-a')).toBe('trystero-self-id')
    transport.dispose()
  })

  it('keeps a diagnostic-only leave failure out of the error stream while retaining the room', async () => {
    const transport = createTrysteroRoomTransport()
    const errors: string[] = []
    transport.onError((error, roomId) => errors.push(`${roomId}:${error.message}`))
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    await transport.join('room-a')
    trysteroFixture.deferLeave('room-a')

    transport.leave('room-a', { diagnosticOnly: true })
    trysteroFixture.leaveControls.get('room-a')?.reject(new Error('diagnostic leave failed'))
    await settle()

    expect(errors).toEqual([])
    expect(consoleError).toHaveBeenCalledOnce()
    await expect(transport.join('room-a')).rejects.toThrow('diagnostic leave failed')
    expect(trysteroFixture.joinCalls).toEqual(['room-a'])
    consoleError.mockRestore()
    transport.dispose()
  })

  it('dispose leaves every room and clears all listeners', async () => {
    const transport = createTrysteroRoomTransport()
    await transport.join('room-a')
    await transport.join('room-b')

    transport.dispose()
    await settle()

    expect(trysteroFixture.rooms.size).toBe(0)
    expect(transport.peerIdOf('room-a')).toBe('')
    expect(transport.peerIdOf('room-b')).toBe('')
  })
})

describe('RoomTransport composition', () => {
  it('selects the Trystero provider by default through the single composition point', async () => {
    const transport = createRoomTransport()
    await transport.join('room-a')

    expect(transport.peerIdOf('room-a')).toBe('trystero-self-id')
    transport.dispose()
  })
})
