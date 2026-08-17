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

import { describeRoomTransportContract, type RoomTransportHarness } from '@/runtime/RoomTransport.contract'

const trysteroHarness: RoomTransportHarness = {
  provider: 'trystero',
  createTransport: createTrysteroRoomTransport,
  joinedPeerId: () => 'trystero-self-id',
  joinCalls: () => trysteroFixture.joinCalls,
  sendCalls: () =>
    trysteroFixture.sent.map((item) => ({
      roomId: item.roomId,
      payload: item.data,
      // The adapter maps an omitted target to the provider's broadcast (`null`); normalize for
      // the shared contract.
      target: item.target ?? undefined
    })),
  deliveries: () => trysteroFixture.sent.map((item) => item.data),
  failNextSend: (error) => trysteroFixture.fail(error),
  emitMessage: (roomId, sourcePeerId, payload) => {
    trysteroFixture.rooms.get(roomId)?.action.onMessage?.(payload, { peerId: sourcePeerId })
  },
  emitPeerJoin: (roomId, peerId) => {
    trysteroFixture.rooms.get(roomId)?.onPeerJoin?.(peerId)
  },
  emitPeerLeave: (roomId, peerId) => {
    trysteroFixture.rooms.get(roomId)?.onPeerLeave?.(peerId)
  },
  emitJoinError: (roomId, error) => {
    trysteroFixture.joinErrors.get(roomId)?.({ error: error.message })
  },
  settle
}

describeRoomTransportContract(trysteroHarness)

beforeEach(() => {
  vi.stubGlobal('__NAME__', 'web-chat-test')
  trysteroFixture.rooms.clear()
  trysteroFixture.joinErrors.clear()
  trysteroFixture.sent.length = 0
  trysteroFixture.leaveControls.clear()
  trysteroFixture.joinCalls.length = 0
})

describe('TrysteroRoomTransport', () => {
  it('sends nothing for an empty target array without calling the provider', async () => {
    const transport = createTrysteroRoomTransport()
    await transport.join('room-a')

    await transport.send('room-a', 'nobody', [])

    expect(trysteroFixture.sent).toEqual([])
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
    // The failed leave retains the room as occupied but inactive: a same-room join rejects with
    // the exact leave failure identity, no second Room is bound, and the room reports no selfId.
    await expect(transport.join('room-a')).rejects.toBe(leaveFailure)
    expect(trysteroFixture.joinCalls).toEqual(['room-a'])
    expect(roomOf('room-a')).toBe(firstRoom)
    expect(transport.peerIdOf('room-a')).toBe('')
    transport.dispose()
  })

  it('makes a leaving room inert: no selfId, no provider send, no callbacks', async () => {
    const transport = createTrysteroRoomTransport()
    const events: string[] = []
    transport.onMessage((roomId, sourcePeerId) => events.push(`message:${roomId}:${sourcePeerId}`))
    transport.onPeerJoin((roomId, peerId) => events.push(`join:${roomId}:${peerId}`))
    transport.onError((error, roomId) => events.push(`error:${roomId}:${error.message}`))
    await transport.join('room-a')
    const room = roomOf('room-a')
    trysteroFixture.deferLeave('room-a')
    const sentBefore = trysteroFixture.sent.length

    transport.leave('room-a')

    // Pending phase: the retained Room is fully inert.
    expect(transport.peerIdOf('room-a')).toBe('')
    await expect(transport.send('room-a', 'late')).rejects.toThrow('Room "room-a" is leaving')
    expect(trysteroFixture.sent).toHaveLength(sentBefore)
    room.action.onMessage?.('stale', { peerId: 'stale-peer' })
    room.onPeerJoin?.('stale-peer')
    trysteroFixture.joinErrors.get('room-a')?.({ error: 'stale join error' })
    expect(events).toEqual([])

    trysteroFixture.leaveControls.get('room-a')?.resolve()
    await settle()
    expect(transport.peerIdOf('room-a')).toBe('')
    transport.dispose()
  })

  it('keeps a leave-failed room inert while rejecting sends with the retained error', async () => {
    const transport = createTrysteroRoomTransport()
    const events: string[] = []
    transport.onMessage((roomId, sourcePeerId) => events.push(`message:${roomId}:${sourcePeerId}`))
    transport.onError((error, roomId) => events.push(`error:${roomId}:${error.message}`))
    await transport.join('room-a')
    const room = roomOf('room-a')
    trysteroFixture.deferLeave('room-a')
    const leaveFailure = new Error('leave rejected')
    const sentBefore = trysteroFixture.sent.length

    transport.leave('room-a')
    trysteroFixture.leaveControls.get('room-a')?.reject(leaveFailure)
    await settle()

    // Failed phase: exactly one scoped error, then the room is inert for sends and callbacks.
    expect(events).toEqual(['error:room-a:leave rejected'])
    expect(transport.peerIdOf('room-a')).toBe('')
    await expect(transport.send('room-a', 'late')).rejects.toBe(leaveFailure)
    expect(trysteroFixture.sent).toHaveLength(sentBefore)
    room.action.onMessage?.('stale', { peerId: 'stale-peer' })
    expect(events).toEqual(['error:room-a:leave rejected'])
    transport.dispose()
  })

  it('reports a dispose-time leave rejection only as diagnostics', async () => {
    const transport = createTrysteroRoomTransport()
    const errors: string[] = []
    transport.onError((error, roomId) => errors.push(`${roomId}:${error.message}`))
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    await transport.join('room-a')
    trysteroFixture.deferLeave('room-a')

    transport.dispose()
    trysteroFixture.leaveControls.get('room-a')?.reject(new Error('dispose leave failed'))
    await settle()

    expect(errors).toEqual([])
    expect(consoleError).toHaveBeenCalledOnce()
    consoleError.mockRestore()
  })

  it('rejects a join that was waiting on a pending leave when dispose lands first', async () => {
    const transport = createTrysteroRoomTransport()
    await transport.join('room-a')
    trysteroFixture.deferLeave('room-a')

    transport.leave('room-a')
    const waiting = transport.join('room-a')
    const assertion = expect(waiting).rejects.toThrow('Room transport is disposed')
    await settle()
    transport.dispose()
    trysteroFixture.leaveControls.get('room-a')?.resolve()
    await assertion

    expect(trysteroFixture.joinCalls).toEqual(['room-a'])
    expect(transport.peerIdOf('room-a')).toBe('')
  })

  it('rejects a join after dispose even for a fresh room', async () => {
    const transport = createTrysteroRoomTransport()
    transport.dispose()

    await expect(transport.join('room-b')).rejects.toThrow('Room transport is disposed')
    expect(trysteroFixture.joinCalls).toEqual([])
  })

  it('upgrades an ordinary pending leave rejection to diagnostics when dispose lands first', async () => {
    const transport = createTrysteroRoomTransport()
    const errors: string[] = []
    transport.onError((error, roomId) => errors.push(`${roomId}:${error.message}`))
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    await transport.join('room-a')
    trysteroFixture.deferLeave('room-a')

    transport.leave('room-a')
    transport.dispose()
    trysteroFixture.leaveControls.get('room-a')?.reject(new Error('late leave failure'))
    await settle()

    expect(errors).toEqual([])
    expect(consoleError).toHaveBeenCalledOnce()
    consoleError.mockRestore()
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
})

describe('RoomTransport composition', () => {
  it('selects the Trystero provider by default through the single composition point', async () => {
    const transport = createRoomTransport()
    await transport.join('room-a')

    expect(transport.peerIdOf('room-a')).toBe('trystero-self-id')
    transport.dispose()
  })
})
