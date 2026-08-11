import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const fixture = vi.hoisted(() => ({
  peerStates: [] as ('ready' | 'connecting' | 'disconnected')[],
  peers: [] as {
    id: string
    state: 'ready' | 'connecting' | 'disconnected'
    emit(event: string, ...args: unknown[]): void
  }[],
  joinShouldThrow: undefined as (() => Error) | undefined,
  room: null as null | {
    open(peerId: string): void
    loseReadiness(peerId: string): void
    attempts: { peerId: string; payload: string }[]
    sent: { peerId: string; payload: string }[]
  },
  rooms: new Map<
    string,
    {
      open(peerId: string): void
      loseReadiness(peerId: string): void
      attempts: { peerId: string; payload: string }[]
      sent: { peerId: string; payload: string }[]
    }
  >()
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
      this.listeners.get(event)?.forEach((listener) => listener(...args))
    }
  }

  class FakeRoom extends Emitter {
    readonly calls = new Map<string, boolean>()
    readonly attempts: { peerId: string; payload: string }[] = []
    readonly sent: { peerId: string; payload: string }[] = []

    send(payload: string, target?: string | string[]) {
      const targets = target ? (Array.isArray(target) ? target : [target]) : null
      this.calls.forEach((ready, peerId) => {
        if (targets && !targets.includes(peerId)) return
        this.attempts.push({ peerId, payload })
        if (!ready) throw new Error('Connection is not established yet.')
        this.sent.push({ peerId, payload })
      })
    }

    open(peerId: string) {
      this.calls.set(peerId, true)
      this.emit('join', peerId)
    }

    loseReadiness(peerId: string) {
      this.calls.set(peerId, false)
    }

    leave() {
      this.emit('close')
    }
  }

  class FakeArtico extends Emitter {
    readonly id: string
    state = fixture.peerStates.shift() ?? 'ready'

    constructor(options?: { id?: string }) {
      super()
      this.id = options?.id ?? 'local-peer'
      fixture.peers.push(this)
      if (this.state === 'ready') queueMicrotask(() => this.emit('open'))
    }

    join(roomId: string) {
      if (fixture.joinShouldThrow) throw fixture.joinShouldThrow()
      const room = new FakeRoom()
      fixture.room = room
      fixture.rooms.set(roomId, room)
      return room
    }

    close() {}
  }

  return { Artico: FakeArtico }
})

import { createArticoRoomTransport } from './ArticoRoomTransport'

beforeEach(() => {
  fixture.peerStates.length = 0
  fixture.peers.length = 0
  fixture.room = null
  fixture.rooms.clear()
  fixture.joinShouldThrow = undefined
})
afterEach(() => vi.useRealTimers())

describe('ArticoRoomTransport per-target isolation', () => {
  it('converges initial and later full broadcasts without entering never-ready calls', async () => {
    const transport = createArticoRoomTransport()
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

  it('contains an untargeted ready-to-closing miss, attempts later peers exactly once, and surfaces the failure', async () => {
    const transport = createArticoRoomTransport()
    await transport.join('room-a')
    fixture.room!.open('closing-peer')
    fixture.room!.open('ready-b')
    fixture.room!.open('ready-a')
    fixture.room!.loseReadiness('closing-peer')

    await expect(transport.send('room-a', 'presence')).rejects.toThrow('Connection is not established yet.')

    expect(fixture.room!.attempts).toEqual([
      { peerId: 'closing-peer', payload: 'presence' },
      { peerId: 'ready-b', payload: 'presence' },
      { peerId: 'ready-a', payload: 'presence' }
    ])
    expect(fixture.room!.sent).toEqual([
      { peerId: 'ready-b', payload: 'presence' },
      { peerId: 'ready-a', payload: 'presence' }
    ])
  })

  it('preserves explicit first-seen order while deduplicating targets', async () => {
    const transport = createArticoRoomTransport()
    await transport.join('room-a')
    fixture.room!.open('closing-peer')
    fixture.room!.open('ready-a')
    fixture.room!.open('ready-b')
    fixture.room!.loseReadiness('closing-peer')

    await expect(
      transport.send('room-a', 'targeted', ['ready-b', 'closing-peer', 'ready-a', 'ready-b'])
    ).rejects.toThrow('Connection is not established yet.')

    expect(fixture.room!.attempts).toEqual([
      { peerId: 'ready-b', payload: 'targeted' },
      { peerId: 'closing-peer', payload: 'targeted' },
      { peerId: 'ready-a', payload: 'targeted' }
    ])
    expect(fixture.room!.sent).toEqual([
      { peerId: 'ready-b', payload: 'targeted' },
      { peerId: 'ready-a', payload: 'targeted' }
    ])
  })

  it('settles empty recipient sets and still rejects a missing room', async () => {
    const transport = createArticoRoomTransport()
    await transport.join('room-a')

    await expect(transport.send('room-a', 'empty')).resolves.toBeUndefined()
    await expect(transport.send('room-a', 'explicit-empty', [])).resolves.toBeUndefined()
    expect(fixture.room!.attempts).toEqual([])
    await expect(transport.send('missing-room', 'payload')).rejects.toThrow('Room "missing-room" not joined')
  })

  it('gives fresh Chat and World demand independent scoped peers and replacement owners', async () => {
    fixture.peerStates.push('disconnected', 'ready', 'disconnected', 'ready')
    const transport = createArticoRoomTransport()
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
    const transport = createArticoRoomTransport()
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
    await vi.advanceTimersByTimeAsync(5000)

    expect(fixture.peers).toHaveLength(2)
    expect(errors).toEqual([])
    transport.dispose()
  })

  it('surfaces a peer id-conflict error without message classification and still recovers on close', async () => {
    vi.useFakeTimers()
    const transport = createArticoRoomTransport()
    const errors: Error[] = []
    transport.onError((error) => errors.push(error))

    await transport.join('chat-v3')
    const currentPeer = fixture.peers[0]
    // No provider error message is classified; a peer id-conflict surfaces as a real error, and the
    // structural close→restart path still retries with the same stable identity.
    currentPeer.emit('error', new Error('id-taken'))

    expect(errors.map((error) => error.message)).toEqual(['id-taken'])

    currentPeer.emit('close')
    await vi.advanceTimersByTimeAsync(5000)

    expect(fixture.peers).toHaveLength(2)
    transport.dispose()
  })

  it('still forwards a genuine signaling error', async () => {
    const transport = createArticoRoomTransport()
    const errors: Error[] = []
    transport.onError((error) => errors.push(error))

    await transport.join('chat-v3')
    const currentPeer = fixture.peers[0]
    currentPeer.emit('error', new Error('connect-error'))

    expect(errors.map((error) => error.message)).toEqual(['connect-error'])
    transport.dispose()
  })

  it('rejects a throwing join scoped to its attempt without a duplicate global onError', async () => {
    const transport = createArticoRoomTransport()
    const errors: Error[] = []
    transport.onError((error) => errors.push(error))
    fixture.joinShouldThrow = () => new Error('provider join refused')

    const joining = transport.join('chat-v3')

    await expect(joining).rejects.toThrow('provider join refused')
    // The join rejection is delivered scoped to the owning attempt. It must not also fan out as a
    // room-less global error (which would surface as a duplicate cross-domain toast).
    expect(errors).toEqual([])
    fixture.joinShouldThrow = undefined
    transport.dispose()
  })

  it('cancels a queued restart when the final desired room leaves', async () => {
    vi.useFakeTimers()
    const transport = createArticoRoomTransport()
    await transport.join('chat-v3')
    const currentPeer = fixture.peers[0]
    currentPeer.state = 'disconnected'
    currentPeer.emit('close')

    transport.leave('chat-v3')
    await vi.advanceTimersByTimeAsync(5000)

    expect(fixture.peers).toHaveLength(1)
    transport.dispose()
  })

  it('settles a pending join when the transport is disposed', async () => {
    fixture.peerStates.push('connecting')
    const transport = createArticoRoomTransport()
    const joining = transport.join('chat-v3')

    transport.dispose()

    await expect(joining).rejects.toThrow('Room "chat-v3" join cancelled')
    fixture.peers[0].emit('open')
    expect(fixture.room).toBeNull()
  })

  it('gives each scope its own physical identity and rotates it on rejoin', async () => {
    const transport = createArticoRoomTransport()
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
    const transport = createArticoRoomTransport()
    await transport.join('world-v3')
    await transport.join('chat-a')
    const worldPeer = fixture.peers[0]
    const chatPeer = fixture.peers[1]
    const worldRoom = fixture.rooms.get('world-v3')!
    const chatRoom = fixture.rooms.get('chat-a')!

    chatPeer.emit('close')
    await vi.advanceTimersByTimeAsync(5000)

    expect(fixture.peers).toHaveLength(3)
    const replacement = fixture.peers[2]
    // The close→restart self-healing path retains the scoped owner's identity and room; only the
    // physical peer generation is new.
    expect(replacement.id).toBe(chatPeer.id)
    expect(transport.peerIdOf('chat-a')).toBe(chatPeer.id)
    expect(transport.peerIdOf('world-v3')).toBe(worldPeer.id)
    expect(fixture.rooms.get('chat-a')).toBe(chatRoom)
    expect(fixture.rooms.get('world-v3')).toBe(worldRoom)
    transport.dispose()
  })

  it('settles scoped leave and dispose against only their exact owner', async () => {
    vi.useFakeTimers()
    const transport = createArticoRoomTransport()
    await transport.join('world-v3')
    await transport.join('chat-a')
    const worldPeer = fixture.peers[0]
    const worldRoom = fixture.rooms.get('world-v3')!

    transport.leave('chat-a')
    await vi.advanceTimersByTimeAsync(5000)

    expect(fixture.peers).toHaveLength(2)
    expect(transport.peerIdOf('chat-a')).toBe('')
    expect(transport.peerIdOf('world-v3')).toBe(worldPeer.id)
    expect(fixture.rooms.get('world-v3')).toBe(worldRoom)
    expect(transport.peers('world-v3')).toEqual([])
    transport.dispose()
  })
})
