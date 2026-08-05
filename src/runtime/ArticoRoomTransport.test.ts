import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const fixture = vi.hoisted(() => ({
  peerStates: [] as ('ready' | 'connecting' | 'disconnected')[],
  peers: [] as { state: 'ready' | 'connecting' | 'disconnected'; emit(event: string, ...args: unknown[]): void }[],
  room: null as null | {
    open(peerId: string): void
    loseReadiness(peerId: string): void
    attempts: { peerId: string; payload: string }[]
    sent: { peerId: string; payload: string }[]
  }
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
    readonly id = 'local-peer'
    state = fixture.peerStates.shift() ?? 'ready'

    constructor() {
      super()
      fixture.peers.push(this)
      if (this.state === 'ready') queueMicrotask(() => this.emit('open'))
    }

    join() {
      const room = new FakeRoom()
      fixture.room = room
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

  it('contains an untargeted ready-to-closing miss and continues later peers exactly once', async () => {
    const transport = createArticoRoomTransport()
    await transport.join('room-a')
    fixture.room!.open('closing-peer')
    fixture.room!.open('ready-b')
    fixture.room!.open('ready-a')
    fixture.room!.loseReadiness('closing-peer')

    await expect(transport.send('room-a', 'presence')).resolves.toBeUndefined()

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
    ).resolves.toBeUndefined()

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

  it('shares one replacement when fresh Chat and World demand finds a disconnected retained peer', async () => {
    fixture.peerStates.push('disconnected', 'ready')
    const transport = createArticoRoomTransport()
    const chat = transport.join('chat-v3')
    const world = transport.join('world-v3')

    try {
      await Promise.all([chat, world])
      expect(fixture.peers).toHaveLength(2)
      expect(fixture.peers[0].state).toBe('disconnected')
      expect(fixture.peers[1].state).toBe('ready')
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
    const stalePeer = fixture.peers[0]

    await transport.join('chat-v3')
    stalePeer.emit('open')
    stalePeer.emit('error', new Error('stale peer error'))
    stalePeer.emit('close')
    await vi.advanceTimersByTimeAsync(1000)

    expect(fixture.peers).toHaveLength(2)
    expect(errors).toEqual([])
    transport.dispose()
  })

  it('absorbs a signaling stale-session conflict and recovers through the restart path', async () => {
    vi.useFakeTimers()
    const transport = createArticoRoomTransport()
    const errors: Error[] = []
    transport.onError((error) => errors.push(error))
    const stalePeer = fixture.peers[0]

    await transport.join('chat-v3')
    stalePeer.emit('error', new Error('id-taken'))

    expect(errors).toEqual([])

    stalePeer.emit('close')
    await vi.advanceTimersByTimeAsync(1000)

    expect(fixture.peers).toHaveLength(2)
    expect(errors).toEqual([])
    transport.dispose()
  })

  it('still forwards a genuine signaling error', async () => {
    const transport = createArticoRoomTransport()
    const errors: Error[] = []
    transport.onError((error) => errors.push(error))
    const currentPeer = fixture.peers[0]

    await transport.join('chat-v3')
    currentPeer.emit('error', new Error('connect-error'))

    expect(errors.map((error) => error.message)).toEqual(['connect-error'])
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
    await vi.advanceTimersByTimeAsync(1000)

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
})
