import { afterEach, describe, expect, it, vi } from 'vitest'
import { Remesh } from 'remesh'
import type { ChatMessageRecord } from '@/domain/Message'
import { JOIN_RETRY_MS, JOIN_TIMEOUT_MS, PEER_LEAVE_GRACE_MS } from '../Config'
import { IdentityExtern, RoomTransportExtern } from '../Externs'
import { createMemoryHub } from '../testing'
import RoomDomain from './Room'

const DOMAIN = 'https://example.com'
const site = { origin: DOMAIN }

const createPeer = (hub: ReturnType<typeof createMemoryHub>, name: string) => {
  const transport = hub.createTransport()
  let sequence = 0
  const store = Remesh.store({
    externs: [RoomTransportExtern.impl(transport), IdentityExtern.impl({ nextId: () => `${name}-${++sequence}` })]
  })
  store.igniteDomain(RoomDomain())
  const room = store.getDomain(RoomDomain())
  const user = { id: `user-${name}`, name, avatar: '' }
  const received: ChatMessageRecord[] = []
  store.subscribeEvent(room.event.MessageReceivedEvent, ({ record }) => received.push(record))
  return {
    transport,
    store,
    room,
    user,
    received,
    open: (next = user) => store.send(room.command.OpenCommand({ domain: DOMAIN, user: next, site })),
    state: () => store.query(room.query.RoomQuery(DOMAIN)),
    names: () => (store.query(room.query.RoomQuery(DOMAIN))?.peers ?? []).map((peer) => peer.user.name),
    send: (body: string) => {
      let record: ChatMessageRecord | undefined
      const subscription = store.subscribeEvent(room.event.MessageAllocatedEvent, (event) => {
        record = event.record
      })
      store.send(
        room.command.AllocateMessageCommand({
          domain: DOMAIN,
          requestId: 'r',
          command: { type: 'text', body, mentions: [] }
        })
      )
      subscription.unsubscribe()
      return record
    }
  }
}

afterEach(() => vi.useRealTimers())

describe('RoomDomain', () => {
  it('exchanges sessions when two peers meet', async () => {
    const hub = createMemoryHub()
    const alice = createPeer(hub, 'alice')
    const bob = createPeer(hub, 'bob')
    alice.open()
    await vi.waitFor(() => expect(alice.state()?.joined).toBe(true))
    bob.open()
    await vi.waitFor(() => {
      expect(alice.names()).toEqual(['bob'])
      expect(bob.names()).toEqual(['alice'])
    })
    // Sessions are targeted, never broadcast.
    expect(alice.transport.sent.every((frame) => frame.to === bob.transport.peerId)).toBe(true)
  })

  it('opening twice is a no-op and keeps the presence', async () => {
    const hub = createMemoryHub()
    const alice = createPeer(hub, 'alice')
    alice.open()
    await vi.waitFor(() => expect(alice.state()?.joined).toBe(true))
    const before = alice.state()
    alice.open()
    expect(alice.state()).toBe(before)
  })

  it('announces a profile change to connected peers', async () => {
    const hub = createMemoryHub()
    const alice = createPeer(hub, 'alice')
    const bob = createPeer(hub, 'bob')
    alice.open()
    bob.open()
    await vi.waitFor(() => expect(bob.names()).toEqual(['alice']))
    alice.open({ ...alice.user, name: 'alice2' })
    await vi.waitFor(() => expect(bob.names()).toEqual(['alice2']))
  })

  it('delivers a message only from a peer with a matching session', async () => {
    const hub = createMemoryHub()
    const alice = createPeer(hub, 'alice')
    const bob = createPeer(hub, 'bob')
    alice.open()
    bob.open()
    await vi.waitFor(() => expect(bob.names()).toEqual(['alice']))
    const record = alice.send('hello')!
    expect(record.message.userId).toBe(alice.user.id)
    const { NativeWireCodec } = await import('@/protocol')
    await alice.transport.send(alice.state()!.roomId, await NativeWireCodec.encode(record.message))
    await vi.waitFor(() => expect(bob.received.map((item) => item.id)).toEqual([record.id]))
    expect(bob.received[0]!.user).toEqual(alice.user)

    const forged = { ...record.message, id: 'forged', userId: 'someone-else' }
    await alice.transport.send(alice.state()!.roomId, await NativeWireCodec.encode(forged))
    await new Promise((resolve) => setTimeout(resolve, 50))
    expect(bob.received).toHaveLength(1)
  })

  it('orders locally allocated messages with the hybrid clock', async () => {
    const hub = createMemoryHub()
    const alice = createPeer(hub, 'alice')
    expect(alice.send('too early')).toBeUndefined()
    alice.open()
    await vi.waitFor(() => expect(alice.state()?.joined).toBe(true))
    const first = alice.send('a')!.message.hlc
    const second = alice.send('b')!.message.hlc
    expect(second.timestamp > first.timestamp || second.counter > first.counter).toBe(true)
  })

  it('keeps a departed presence for the grace period, then removes it', async () => {
    const hub = createMemoryHub()
    const alice = createPeer(hub, 'alice')
    const bob = createPeer(hub, 'bob')
    alice.open()
    bob.open()
    await vi.waitFor(() => expect(alice.names()).toEqual(['bob']))
    vi.useFakeTimers()
    bob.transport.leave(bob.state()!.roomId)
    await vi.advanceTimersByTimeAsync(PEER_LEAVE_GRACE_MS - 1)
    expect(alice.names()).toEqual(['bob'])
    await vi.advanceTimersByTimeAsync(2)
    expect(alice.names()).toEqual([])
  })

  it('a reconnect inside the grace keeps the presence and replaces the source', async () => {
    const hub = createMemoryHub()
    const alice = createPeer(hub, 'alice')
    const bob = createPeer(hub, 'bob')
    alice.open()
    bob.open()
    await vi.waitFor(() => expect(alice.names()).toEqual(['bob']))
    const presenceId = alice.state()!.peers[0]!.presenceId
    const changes = vi.fn()
    alice.store.subscribeEvent(alice.room.event.SessionsChangedEvent, changes)

    bob.store.send(bob.room.command.ReconnectCommand({ domain: DOMAIN, leaveFirst: true }))
    await vi.waitFor(() => expect(alice.state()!.peers.filter((peer) => !peer.leaving)).toHaveLength(1))
    expect(alice.state()!.peers).toHaveLength(1)
    expect(alice.state()!.peers[0]!.presenceId).toBe(presenceId)
    await vi.waitFor(() => expect(bob.state()!.peers.every((peer) => !peer.leaving)).toBe(true))
    expect(bob.names()).toEqual(['alice'])
  })

  it('rejoins when the transport closes the room', async () => {
    const hub = createMemoryHub()
    const alice = createPeer(hub, 'alice')
    alice.open()
    await vi.waitFor(() => expect(alice.state()?.joined).toBe(true))
    const { sessionId, presenceId } = alice.state()!
    alice.transport.close(alice.state()!.roomId)
    await vi.waitFor(() => expect(alice.state()?.connection).toBe(1))
    await vi.waitFor(() => expect(alice.state()?.joined).toBe(true))
    expect(alice.state()!.presenceId).toBe(presenceId)
    expect(alice.state()!.sessionId).not.toBe(sessionId)
  })

  it('reports one error on the third join timeout and keeps retrying silently', async () => {
    const hub = createMemoryHub()
    const alice = createPeer(hub, 'alice')
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'] })
    const errors: string[] = []
    alice.store.subscribeEvent(alice.room.event.ErrorEvent, (error) => errors.push(error.message))
    alice.transport.hangJoin = true
    alice.open()

    await vi.advanceTimersByTimeAsync(JOIN_TIMEOUT_MS + 1)
    expect(errors).toEqual([])
    await vi.advanceTimersByTimeAsync(JOIN_TIMEOUT_MS + JOIN_RETRY_MS)
    expect(errors).toEqual([])
    await vi.advanceTimersByTimeAsync(JOIN_TIMEOUT_MS + JOIN_RETRY_MS)
    expect(errors).toEqual(['Room join timeout'])

    // Later timeouts stay silent so the user is not re-toasted every cycle.
    await vi.advanceTimersByTimeAsync(JOIN_TIMEOUT_MS + JOIN_RETRY_MS)
    expect(errors).toEqual(['Room join timeout'])

    alice.transport.hangJoin = false
    await vi.advanceTimersByTimeAsync(JOIN_TIMEOUT_MS + JOIN_RETRY_MS)
    expect(alice.state()?.joined).toBe(true)
  })

  it('leaves the room on close', () => {
    const hub = createMemoryHub()
    const alice = createPeer(hub, 'alice')
    alice.open()
    alice.store.send(alice.room.command.CloseCommand(DOMAIN))
    expect(alice.state()).toBeNull()
  })
})
