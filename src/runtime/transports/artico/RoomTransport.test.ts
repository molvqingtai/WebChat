import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const fixture = vi.hoisted(() => ({
  peerStates: [] as ('ready' | 'connecting' | 'disconnected')[],
  peers: [] as {
    id: string
    roomId?: string
    signaling?: { url: string; id: string }
    state: 'ready' | 'connecting' | 'disconnected'
    closed: boolean
    emit(event: string, ...args: unknown[]): void
  }[],
  joinCalls: [] as string[],
  sendCalls: [] as { roomId: string; payload: string; target?: string | string[] }[],
  deliveries: [] as { roomId: string; payload: string }[],
  readySendFailures: new Map<string, Error>(),
  queuedSendFailures: [] as Error[],
  joinShouldThrow: undefined as (() => Error) | undefined,
  leaveShouldThrow: undefined as (() => Error) | undefined,
  closeShouldThrow: undefined as (() => Error) | undefined,
  room: null as null | {
    open(peerId: string): void
    pending(peerId: string): void
    attempts: { peerId: string; payload: string }[]
    sent: { peerId: string; payload: string }[]
  },
  rooms: new Map<
    string,
    {
      open(peerId: string): void
      pending(peerId: string): void
      attempts: { peerId: string; payload: string }[]
      sent: { peerId: string; payload: string }[]
      emit(event: string, ...args: unknown[]): void
    }
  >(),
  failReadySend: (peerId: string, error: Error) => {
    fixture.readySendFailures.set(peerId, error)
  },
  queueSendFailure: (error: Error) => {
    fixture.queuedSendFailures.push(error)
  },
  takeReadySendFailure: (peerId: string) => {
    const failure = fixture.readySendFailures.get(peerId)
    fixture.readySendFailures.delete(peerId)
    return failure
  },
  takeQueuedSendFailure: () => fixture.queuedSendFailures.shift()
}))

vi.mock('@rtco/client', () => {
  class Emitter {
    private readonly listeners = new Map<string, Set<(...args: unknown[]) => void>>()

    on(event: string, listener: (...args: unknown[]) => void) {
      const listeners = this.listeners.get(event) ?? new Set()
      listeners.add(listener)
      this.listeners.set(event, listeners)
      return this
    }

    emit(event: string, ...args: unknown[]) {
      ;(this.listeners.get(event) ?? []).forEach((listener) => listener(...args))
    }
  }

  class FakeRoom extends Emitter {
    readonly calls = new Map<string, boolean>()
    readonly attempts: { peerId: string; payload: string }[] = []
    readonly sent: { peerId: string; payload: string }[] = []

    send(payload: string, target?: string | string[]) {
      fixture.sendCalls.push({ roomId: this.roomId, payload, target })
      const targets = target ? (Array.isArray(target) ? target : [target]) : null
      let firstFailure: Error | undefined
      // The patched Artico Room skips non-ready calls, attempts every selected ready call, and
      // rethrows the first failure after the best-effort pass completes.
      this.calls.forEach((ready, peerId) => {
        if (!ready) return
        if (targets && !targets.includes(peerId)) return
        this.attempts.push({ peerId, payload })
        const failure = fixture.takeReadySendFailure(peerId) ?? fixture.takeQueuedSendFailure()
        if (failure) {
          firstFailure ??= failure
          return
        }
        fixture.deliveries.push({ roomId: this.roomId, payload })
        this.sent.push({ peerId, payload })
      })
      // The shared contract also probes a provider-level rejection with an empty room.
      if (this.calls.size === 0) {
        const failure = fixture.takeQueuedSendFailure()
        firstFailure ??= failure
      }
      if (firstFailure) throw firstFailure
    }

    constructor(readonly roomId: string) {
      super()
    }

    open(peerId: string) {
      this.calls.set(peerId, true)
      this.emit('join', peerId)
    }

    pending(peerId: string) {
      this.calls.set(peerId, false)
    }

    leave() {
      if (fixture.leaveShouldThrow) throw fixture.leaveShouldThrow()
      this.emit('close')
    }
  }

  class FakeSignaling {
    readonly url: string
    readonly id: string

    constructor(options: { url: string; id: string }) {
      this.url = options.url
      this.id = options.id
    }

    connect() {}
    disconnect() {}
    signal() {}
    join() {}
    on() {
      return this
    }
    off() {
      return this
    }
    emit() {
      return this
    }
  }

  class FakeArtico extends Emitter {
    readonly id: string
    readonly signaling?: { url: string; id: string }
    roomId?: string
    state = fixture.peerStates.shift() ?? 'ready'
    closed = false

    constructor(options?: { id?: string; signaling?: { url: string; id: string } }) {
      super()
      this.id = options?.id ?? 'local-peer'
      this.signaling = options?.signaling
      fixture.peers.push(this)
      if (this.state === 'ready') queueMicrotask(() => this.emit('open'))
    }

    join(roomId: string) {
      if (fixture.joinShouldThrow) throw fixture.joinShouldThrow()
      this.roomId = roomId
      const room = new FakeRoom(roomId)
      fixture.joinCalls.push(roomId)
      fixture.room = room
      fixture.rooms.set(roomId, room)
      return room
    }

    close() {
      if (fixture.closeShouldThrow) throw fixture.closeShouldThrow()
      this.closed = true
    }
  }

  return {
    Artico: FakeArtico,
    SocketSignaling: FakeSignaling
  }
})

import { describeRoomTransportContract, type RoomTransportHarness } from '@/runtime/RoomTransport.contract.test-utils'
import { createRoomTransport } from './RoomTransport'

const articoHarness: RoomTransportHarness = {
  provider: 'artico',
  createTransport: createRoomTransport,
  joinedPeerId: () => fixture.peers[fixture.peers.length - 1]?.id ?? '',
  joinCalls: () => fixture.joinCalls,
  sendCalls: () => fixture.sendCalls,
  deliveries: () => fixture.deliveries.map(({ payload }) => payload),
  failNextSend: (error) => fixture.queueSendFailure(error),
  emitMessage: (roomId, sourcePeerId, payload) => {
    fixture.rooms.get(roomId)?.emit('message', payload, sourcePeerId)
  },
  emitPeerJoin: (roomId, peerId) => {
    fixture.rooms.get(roomId)?.open(peerId)
  },
  emitPeerLeave: (roomId, peerId) => {
    fixture.rooms.get(roomId)?.emit('leave', peerId)
  },
  emitJoinError: (roomId, error) => {
    fixture.peers.find((peer) => peer.roomId === roomId)?.emit('error', error)
  },
  settle: async () => {
    await new Promise<void>((resolve) => setTimeout(resolve, 0))
  }
}

describeRoomTransportContract(articoHarness)

beforeEach(() => {
  vi.stubGlobal('__NAME__', 'web-chat-test')
  fixture.peerStates.length = 0
  fixture.peers.length = 0
  fixture.joinCalls.length = 0
  fixture.sendCalls.length = 0
  fixture.deliveries.length = 0
  fixture.readySendFailures.clear()
  fixture.queuedSendFailures.length = 0
  fixture.room = null
  fixture.rooms.clear()
  fixture.joinShouldThrow = undefined
  fixture.leaveShouldThrow = undefined
  fixture.closeShouldThrow = undefined
})
afterEach(() => vi.useRealTimers())

describe('Artico RoomTransport', () => {
  it('returns an exact pending-H receipt only after fencing the old peer from a late open', async () => {
    fixture.peerStates.push('connecting')
    const transport = createRoomTransport()
    const joining = transport.join('room-a', { joinId: 'h-1' })

    await transport.abortJoin!('room-a', 'h-1')
    await expect(joining).rejects.toThrow('join cancelled')
    fixture.peers[0]?.emit('open')

    expect(fixture.peers[0]?.closed).toBe(true)
    expect(fixture.rooms.has('room-a')).toBe(false)
    transport.dispose()
  })

  it('keeps an exact H occupied when an applicable close throws', async () => {
    fixture.peerStates.push('connecting')
    const transport = createRoomTransport()
    void transport.join('room-a', { joinId: 'h-1' }).catch(() => {})
    fixture.closeShouldThrow = () => new Error('close failed')
    let settled = false
    void transport.abortJoin!('room-a', 'h-1').then(() => {
      settled = true
    })
    await Promise.resolve()
    fixture.peers[0]?.emit('open')
    await Promise.resolve()

    expect(settled).toBe(false)
    expect(fixture.rooms.has('room-a')).toBe(false)
    transport.dispose()
  })

  it('uses one scoped peer and the fixed WebChat signaling endpoint per room', async () => {
    const transport = createRoomTransport()

    await transport.join('chat-a')
    await transport.join('world-a')

    expect(fixture.peers).toHaveLength(2)
    expect(fixture.peers.map((peer) => peer.signaling)).toEqual([
      { url: 'wss://web-chat.io', id: fixture.peers[0].id },
      { url: 'wss://web-chat.io', id: fixture.peers[1].id }
    ])
    expect(fixture.joinCalls).toEqual(['chat-a', 'world-a'])
    transport.dispose()
  })

  it('retains a retired peer close failure and still constructs its successor', async () => {
    vi.useFakeTimers()
    const transport = createRoomTransport()
    await transport.join('chat-a')
    const stalePeer = fixture.peers[0]
    const failure = new Error('retired peer close failed')
    fixture.closeShouldThrow = () => failure
    const diagnostic = vi.spyOn(console, 'error').mockImplementation(() => {})

    stalePeer.emit('close')
    await vi.advanceTimersByTimeAsync(10000)

    expect(diagnostic).toHaveBeenCalledOnce()
    expect(diagnostic).toHaveBeenCalledWith(failure)
    expect(fixture.peers).toHaveLength(2)
    expect(transport.peerIdOf('chat-a')).toBe(fixture.peers[1].id)
    fixture.closeShouldThrow = undefined
    diagnostic.mockRestore()
    transport.dispose()
  })

  it('retains a disposed peer close failure after removing its exact owner', async () => {
    const transport = createRoomTransport()
    await transport.join('chat-a')
    const failure = new Error('disposed peer close failed')
    fixture.closeShouldThrow = () => failure
    const errors: Error[] = []
    transport.onError((error) => errors.push(error))
    const diagnostic = vi.spyOn(console, 'error').mockImplementation(() => {})

    transport.leave('chat-a')

    expect(errors).toEqual([])
    expect(diagnostic).toHaveBeenCalledOnce()
    expect(diagnostic).toHaveBeenCalledWith(failure)
    expect(transport.peerIdOf('chat-a')).toBe('')
    diagnostic.mockRestore()
    transport.dispose()
  })

  it('routes a diagnostic-only physical leave failure directly without a transport error event', async () => {
    const transport = createRoomTransport()
    await transport.join('room-a')
    const failure = new Error('manual physical leave failed')
    fixture.leaveShouldThrow = () => failure
    const errors: Error[] = []
    transport.onError((error) => errors.push(error))
    const diagnostic = vi.spyOn(console, 'error').mockImplementation(() => {})

    transport.leave('room-a', { diagnosticOnly: true })

    expect(errors).toEqual([])
    expect(diagnostic).toHaveBeenCalledOnce()
    expect(diagnostic).toHaveBeenCalledWith(failure)
    expect(transport.peerIdOf('room-a')).toBe('')
    diagnostic.mockRestore()
    transport.dispose()
  })

  it('converges initial and later full broadcasts without entering never-ready calls', async () => {
    const transport = createRoomTransport()
    await transport.join('room-a')
    fixture.room!.open('ready-peer')

    await expect(transport.send('room-a', 'initial-presence')).resolves.toBeUndefined()
    fixture.room!.open('slow-peer')
    await expect(transport.send('room-a', 'full-presence')).resolves.toBeUndefined()
    await expect(transport.send('room-a', 'targeted', 'ready-peer')).resolves.toBeUndefined()

    expect(fixture.room!.sent).toEqual([
      { peerId: 'ready-peer', payload: 'initial-presence' },
      { peerId: 'ready-peer', payload: 'full-presence' },
      { peerId: 'slow-peer', payload: 'full-presence' },
      { peerId: 'ready-peer', payload: 'targeted' }
    ])
  })

  it('skips an untargeted pending call and attempts every ready peer exactly once', async () => {
    const transport = createRoomTransport()
    await transport.join('room-a')
    fixture.room!.pending('closing-peer')
    fixture.room!.open('ready-b')
    fixture.room!.open('ready-a')

    await expect(transport.send('room-a', 'presence')).resolves.toBeUndefined()

    expect(fixture.room!.attempts).toEqual([
      { peerId: 'ready-b', payload: 'presence' },
      { peerId: 'ready-a', payload: 'presence' }
    ])
    expect(fixture.room!.sent).toEqual([
      { peerId: 'ready-b', payload: 'presence' },
      { peerId: 'ready-a', payload: 'presence' }
    ])
  })

  it('preserves explicit first-seen order while skipping pending targets', async () => {
    const transport = createRoomTransport()
    await transport.join('room-a')
    fixture.room!.pending('closing-peer')
    fixture.room!.open('ready-a')
    fixture.room!.open('ready-b')

    await expect(
      transport.send('room-a', 'targeted', ['ready-b', 'closing-peer', 'ready-a', 'ready-b'])
    ).resolves.toBeUndefined()

    expect(fixture.room!.attempts).toEqual([
      { peerId: 'ready-a', payload: 'targeted' },
      { peerId: 'ready-b', payload: 'targeted' }
    ])
    expect(fixture.room!.sent).toEqual([
      { peerId: 'ready-a', payload: 'targeted' },
      { peerId: 'ready-b', payload: 'targeted' }
    ])
  })

  it('attempts every ready call and rethrows the first ready failure by identity', async () => {
    const transport = createRoomTransport()
    await transport.join('room-a')
    fixture.room!.pending('pending-first')
    fixture.room!.open('ready-first')
    fixture.room!.open('ready-success')
    fixture.room!.open('ready-last')
    const firstFailure = new Error('first ready call failed')
    const lastFailure = new Error('last ready call failed')
    fixture.failReadySend('ready-first', firstFailure)
    fixture.failReadySend('ready-last', lastFailure)

    await expect(transport.send('room-a', 'presence')).rejects.toBe(firstFailure)

    expect(fixture.room!.attempts).toEqual([
      { peerId: 'ready-first', payload: 'presence' },
      { peerId: 'ready-success', payload: 'presence' },
      { peerId: 'ready-last', payload: 'presence' }
    ])
    expect(fixture.room!.sent).toEqual([{ peerId: 'ready-success', payload: 'presence' }])
  })

  it('settles empty recipient sets and still rejects a missing room', async () => {
    const transport = createRoomTransport()
    await transport.join('room-a')

    await expect(transport.send('room-a', 'empty')).resolves.toBeUndefined()
    await expect(transport.send('room-a', 'explicit-empty', [])).resolves.toBeUndefined()
    expect(fixture.room!.attempts).toEqual([])
    await expect(transport.send('missing-room', 'payload')).rejects.toThrow('Room "missing-room" not joined')
  })

  it('gives fresh Chat and World demand independent scoped peers and replacement owners', async () => {
    fixture.peerStates.push('disconnected', 'ready', 'disconnected', 'ready')
    const transport = createRoomTransport()
    const chat = transport.join('chat-v3')
    const world = transport.join('world-v3')

    try {
      await Promise.all([chat, world])
      // Each room owns its own physical peer; nothing is shared between scopes.
      expect(fixture.peers).toHaveLength(4)
      expect(fixture.peers[0].state).toBe('disconnected')
      expect(fixture.peers[1].state).toBe('ready')
      expect(fixture.peers[2].state).toBe('disconnected')
      expect(fixture.peers[3].state).toBe('ready')
      expect(fixture.rooms.has('chat-v3')).toBe(true)
      expect(fixture.rooms.has('world-v3')).toBe(true)
    } finally {
      transport.dispose()
    }
  })

  it('fences stale callbacks after fresh demand replaces a disconnected peer', async () => {
    vi.useFakeTimers()
    fixture.peerStates.push('disconnected', 'ready')
    const transport = createRoomTransport()
    const errors: Error[] = []
    transport.onError((error) => errors.push(error))

    await transport.join('chat-v3')
    const stalePeer = fixture.peers[0]
    expect(stalePeer.state).toBe('disconnected')
    // Fresh demand for the same scope replaces the retained disconnected peer with one current peer.
    const rejoin = transport.join('chat-v3')
    stalePeer.emit('open')
    stalePeer.emit('error', new Error('stale peer error'))
    stalePeer.emit('close')
    await rejoin
    await vi.advanceTimersByTimeAsync(10000)

    expect(fixture.peers).toHaveLength(2)
    expect(errors).toEqual([])
    transport.dispose()
  })

  it('surfaces a peer id-conflict error without message classification and still recovers on close', async () => {
    vi.useFakeTimers()
    const transport = createRoomTransport()
    const errors: Error[] = []
    transport.onError((error) => errors.push(error))

    await transport.join('chat-v3')
    const currentPeer = fixture.peers[0]
    // No provider error message is classified; a peer id-conflict surfaces as a real error, and the
    // structural close->restart path still retries with the same stable identity.
    currentPeer.emit('error', new Error('id-taken'))

    expect(errors.map((error) => error.message)).toEqual(['id-taken'])

    currentPeer.emit('close')
    await vi.advanceTimersByTimeAsync(10000)

    expect(fixture.peers).toHaveLength(2)
    transport.dispose()
  })

  it('still forwards a genuine signaling error', async () => {
    const transport = createRoomTransport()
    const errors: Error[] = []
    transport.onError((error) => errors.push(error))

    await transport.join('chat-v3')
    const currentPeer = fixture.peers[0]
    currentPeer.emit('error', new Error('connect-error'))

    expect(errors.map((error) => error.message)).toEqual(['connect-error'])
    transport.dispose()
  })

  it('rejects a throwing join scoped to its attempt without a duplicate global onError', async () => {
    const transport = createRoomTransport()
    const errors: Error[] = []
    transport.onError((error) => errors.push(error))
    fixture.joinShouldThrow = () => new Error('provider join refused')

    const joining = transport.join('chat-v3')

    await expect(joining).rejects.toThrow('provider join refused')
    // The join rejection is delivered scoped to the owning attempt via the join rejection only. It
    // must not also fan out as a global error for another room.
    expect(errors).toEqual([])
    fixture.joinShouldThrow = undefined
    transport.dispose()
  })

  it('cancels a queued restart when the final desired room leaves', async () => {
    vi.useFakeTimers()
    const transport = createRoomTransport()
    await transport.join('chat-v3')
    const currentPeer = fixture.peers[0]
    currentPeer.state = 'disconnected'
    currentPeer.emit('close')

    transport.leave('chat-v3')
    await vi.advanceTimersByTimeAsync(10000)

    expect(fixture.peers).toHaveLength(1)
    transport.dispose()
  })

  it('settles a pending join when the transport is disposed', async () => {
    fixture.peerStates.push('connecting')
    const transport = createRoomTransport()
    const joining = transport.join('chat-v3')

    transport.dispose()

    await expect(joining).rejects.toThrow('Room "chat-v3" join cancelled')
    fixture.peers[0].emit('open')
    expect(fixture.room).toBeNull()
  })

  it('gives each scope its own physical identity and rotates it on rejoin', async () => {
    const transport = createRoomTransport()
    await transport.join('world-v3')
    await transport.join('chat-a')
    await transport.join('chat-b')

    const worldId = transport.peerIdOf('world-v3')
    const chatAId = transport.peerIdOf('chat-a')
    const chatBId = transport.peerIdOf('chat-b')
    expect(new Set([worldId, chatAId, chatBId]).size).toBe(3)
    expect(fixture.peers.map((peer) => peer.id)).toEqual([worldId, chatAId, chatBId])

    transport.leave('chat-a')
    expect(transport.peerIdOf('chat-a')).toBe('')
    await transport.join('chat-a')
    const rotatedChatAId = transport.peerIdOf('chat-a')
    expect(rotatedChatAId).not.toBe(chatAId)
    expect(transport.peerIdOf('world-v3')).toBe(worldId)
    expect(transport.peerIdOf('chat-b')).toBe(chatBId)
    transport.dispose()
  })

  it('restarts only the closing owner and rejoins only its own room', async () => {
    vi.useFakeTimers()
    const transport = createRoomTransport()
    await transport.join('world-v3')
    await transport.join('chat-a')
    const worldPeer = fixture.peers[0]
    const chatPeer = fixture.peers[1]
    const worldRoom = fixture.rooms.get('world-v3')!
    const chatRoom = fixture.rooms.get('chat-a')!

    chatPeer.emit('close')
    await vi.advanceTimersByTimeAsync(10000)

    expect(fixture.peers).toHaveLength(3)
    const replacement = fixture.peers[2]
    // The close->restart repair retires the predecessor, rotates the physical identity for the
    // replacement generation, and genuinely rejoins the exact room on the successor peer; the
    // World owner is untouched.
    expect(replacement.id).not.toBe(chatPeer.id)
    expect(transport.peerIdOf('chat-a')).toBe(replacement.id)
    expect(transport.peerIdOf('world-v3')).toBe(worldPeer.id)
    expect(fixture.rooms.get('chat-a')).not.toBe(chatRoom)
    expect(fixture.rooms.get('world-v3')).toBe(worldRoom)
    transport.dispose()
  })

  it('settles scoped leave and dispose against only their exact owner', async () => {
    vi.useFakeTimers()
    const transport = createRoomTransport()
    await transport.join('world-v3')
    await transport.join('chat-a')
    const worldPeer = fixture.peers[0]
    const worldRoom = fixture.rooms.get('world-v3')!

    transport.leave('chat-a')
    await vi.advanceTimersByTimeAsync(10000)

    expect(fixture.peers).toHaveLength(2)
    expect(transport.peerIdOf('chat-a')).toBe('')
    expect(transport.peerIdOf('world-v3')).toBe(worldPeer.id)
    expect(fixture.rooms.get('world-v3')).toBe(worldRoom)
    transport.dispose()
  })

  it('closes the retired predecessor before constructing its successor and rebinds a new room', async () => {
    vi.useFakeTimers()
    const transport = createRoomTransport()
    await transport.join('chat-a')
    const stalePeer = fixture.peers[0]
    const staleRoom = fixture.rooms.get('chat-a')!

    stalePeer.emit('close')
    await vi.advanceTimersByTimeAsync(10000)

    expect(stalePeer.closed).toBe(true)
    expect(fixture.peers).toHaveLength(2)
    expect(fixture.rooms.get('chat-a')).not.toBe(staleRoom)
    transport.dispose()
  })

  it('never forwards an error from a retired or disposed owner', async () => {
    vi.useFakeTimers()
    const transport = createRoomTransport()
    const errors: Error[] = []
    transport.onError((error) => errors.push(error))
    await transport.join('chat-a')
    const stalePeer = fixture.peers[0]

    stalePeer.emit('close')
    await vi.advanceTimersByTimeAsync(10000)
    stalePeer.emit('error', new Error('retired peer error'))
    expect(errors).toEqual([])

    transport.leave('chat-a')
    const disposedPeer = fixture.peers[1]
    disposedPeer.emit('error', new Error('disposed owner error'))
    expect(errors).toEqual([])
    transport.dispose()
  })
})
