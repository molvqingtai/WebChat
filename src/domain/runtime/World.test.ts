import { Remesh } from 'remesh'
import { describe, expect, it, vi } from 'vitest'
import WireDomain from '@/domain/runtime/Wire'
import WorldDomain, { getWorldRoomId } from '@/domain/runtime/World'
import { RoomTransportExtern, WireCodecExtern } from '@/domain/runtime/externs/RoomTransport'
import type { RoomTransport } from '@/runtime/RoomTransport'
import type { WireCodec, WorldRoomMessage } from '@/protocol'

const deferred = <T>() => {
  let resolve!: (value: T | PromiseLike<T>) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((onResolve, onReject) => {
    resolve = onResolve
    reject = onReject
  })
  return { promise, resolve, reject }
}

const codec: WireCodec = {
  encode: async (value) => JSON.stringify(value),
  decode: async (payload) => JSON.parse(payload)
}

const user = { id: 'user-1', name: 'User', avatar: '' }

interface SendAttempt {
  targetPeerIds: string[] | undefined
  message: WorldRoomMessage
  settle: ReturnType<typeof deferred<void>>
}

const createFixture = () => {
  const attempts: SendAttempt[] = []
  const joinedPeers: string[] = []
  let messageListener: ((roomId: string, sourcePeerId: string, rawPayload: string) => void) | null = null
  const transport: RoomTransport = {
    peerId: 'local-peer',
    join: async () => {},
    leave: async () => {},
    peers: () => [...joinedPeers],
    send: async (roomId, payload, targetPeerIds) => {
      if (roomId !== getWorldRoomId()) return
      const settle = deferred<void>()
      attempts.push({
        targetPeerIds: typeof targetPeerIds === 'string' ? [targetPeerIds] : targetPeerIds,
        message: JSON.parse(payload) as WorldRoomMessage,
        settle
      })
      await settle.promise
    },
    onMessage: (callback) => {
      messageListener = callback
      return () => {
        messageListener = null
      }
    },
    onPeerJoin: () => () => {},
    onPeerLeave: () => () => {},
    onRoomClose: () => () => {},
    onError: () => () => {},
    dispose: () => {}
  }
  const store = Remesh.store({
    externs: [RoomTransportExtern.impl(transport), WireCodecExtern.impl(codec)]
  })
  const wireAction = WireDomain()
  const worldAction = WorldDomain({ sessionId: 'world-session' })
  store.subscribeDomain(wireAction)
  store.subscribeDomain(worldAction)
  store.igniteDomain(wireAction)
  store.igniteDomain(worldAction)
  const fixture = {
    attempts,
    store,
    wire: store.getDomain(wireAction),
    world: store.getDomain(worldAction),
    joinWorldRoom: async () => {
      let roomsJoined = false
      store.subscribeEvent(fixture.wire.event.RoomsJoinedEvent, () => {
        roomsJoined = true
      })
      store.send(fixture.wire.command.JoinRoomsCommand({ requestId: 'join-world', roomIds: [getWorldRoomId()] }))
      await vi.waitFor(() => expect(roomsJoined).toBe(true))
    },
    emitRemotePresence: (sourcePeerId: string, origin: string) => {
      const presence: WorldRoomMessage = {
        sessionId: `session-${sourcePeerId}`,
        user: { id: `user-${sourcePeerId}`, name: sourcePeerId, avatar: '' },
        sites: [{ origin }]
      }
      if (!joinedPeers.includes(sourcePeerId)) joinedPeers.push(sourcePeerId)
      messageListener?.(getWorldRoomId(), sourcePeerId, JSON.stringify(presence))
    }
  }
  return fixture
}

const stage = (fixture: ReturnType<typeof createFixture>, attemptId: string, origin: string) => {
  fixture.store.send(
    fixture.world.command.StageDomainCommand({
      attemptId,
      domain: origin,
      user,
      site: { origin }
    })
  )
  fixture.store.send(fixture.world.command.PublishStagedCommand(attemptId))
}

const settleAll = async () => {
  for (let index = 0; index < 20; index += 1) await Promise.resolve()
}

describe('WorldDomain single per-target publication iterator', () => {
  it('settles immediately without any send when no remote presence target exists', async () => {
    const fixture = createFixture()
    await fixture.joinWorldRoom()
    let published = false
    fixture.store.subscribeEvent(fixture.world.event.StagedPublishedEvent, () => {
      published = true
    })

    stage(fixture, 'attempt-a', 'https://a.example')
    await vi.waitFor(() => expect(published).toBe(true))

    expect(fixture.attempts).toEqual([])
    fixture.store.discard()
  })

  it('attempts every frozen target exactly once, surfaces a throwing target, and still settles', async () => {
    const fixture = createFixture()
    await fixture.joinWorldRoom()
    fixture.emitRemotePresence('peer-1', 'https://one.example')
    fixture.emitRemotePresence('peer-2', 'https://two.example')
    await settleAll()
    const errors: Error[] = []
    let published = false
    fixture.store.subscribeEvent(fixture.world.event.ErrorEvent, (error) => errors.push(error))
    fixture.store.subscribeEvent(fixture.world.event.StagedPublishedEvent, () => {
      published = true
    })

    stage(fixture, 'attempt-a', 'https://a.example')
    await vi.waitFor(() => expect(fixture.attempts).toHaveLength(1))
    expect(fixture.attempts[0].targetPeerIds).toEqual(['peer-1'])
    fixture.attempts[0].settle.reject(new Error('target one exploded'))
    await vi.waitFor(() => expect(fixture.attempts).toHaveLength(2))
    expect(fixture.attempts[1].targetPeerIds).toEqual(['peer-2'])
    fixture.attempts[1].settle.resolve()
    await vi.waitFor(() => expect(published).toBe(true))

    expect(errors.map((error) => error.message)).toEqual(['target one exploded'])
    expect(fixture.attempts).toHaveLength(2)
    fixture.store.discard()
  })

  it('stops a superseded revision without retrying its targets and settles the latest revision', async () => {
    const fixture = createFixture()
    await fixture.joinWorldRoom()
    fixture.emitRemotePresence('peer-1', 'https://one.example')
    fixture.emitRemotePresence('peer-2', 'https://two.example')
    await settleAll()
    const errors: Error[] = []
    const published: string[] = []
    fixture.store.subscribeEvent(fixture.world.event.ErrorEvent, (error) => errors.push(error))
    fixture.store.subscribeEvent(fixture.world.event.StagedPublishedEvent, ({ attemptId }) => published.push(attemptId))

    stage(fixture, 'attempt-a', 'https://a.example')
    await vi.waitFor(() => expect(fixture.attempts).toHaveLength(1))
    fixture.attempts[0].settle.resolve()
    await vi.waitFor(() => expect(fixture.attempts).toHaveLength(2))
    fixture.attempts[1].settle.resolve()
    await vi.waitFor(() => expect(published).toEqual(['attempt-a']))
    fixture.store.send(fixture.world.command.CommitStagedCommand('attempt-a'))

    stage(fixture, 'attempt-b', 'https://b.example')
    await vi.waitFor(() => expect(fixture.attempts).toHaveLength(3))
    expect(fixture.attempts[2].message.sites.map(({ origin }) => origin).toSorted()).toEqual([
      'https://a.example',
      'https://b.example'
    ])

    // A release supersedes the in-flight revision: the old iterator stops, the newest revision
    // publishes through the same owner without re-sending the superseded revision's targets.
    fixture.store.send(fixture.world.command.ReleaseDomainCommand('https://b.example'))
    // The superseded in-flight target settles late; its stale completion cannot disturb the new revision.
    fixture.attempts[2].settle.resolve()
    await vi.waitFor(() => expect(fixture.attempts).toHaveLength(4))
    expect(fixture.attempts[3].message.sites.map(({ origin }) => origin)).toEqual(['https://a.example'])

    await settleAll()
    expect(fixture.attempts).toHaveLength(4)

    fixture.attempts[3].settle.resolve()
    await vi.waitFor(() => expect(fixture.attempts).toHaveLength(5))
    expect(fixture.attempts[4].message.sites.map(({ origin }) => origin)).toEqual(['https://a.example'])
    fixture.attempts[4].settle.resolve()
    await settleAll()

    expect(errors).toEqual([])
    expect(published).toEqual(['attempt-a'])
    expect(fixture.attempts).toHaveLength(5)
    fixture.store.discard()
  })

  it('does not complete a domain release until its latest World continuation settles', async () => {
    const fixture = createFixture()
    await fixture.joinWorldRoom()
    fixture.emitRemotePresence('peer-1', 'https://one.example')
    await settleAll()
    const released: string[] = []
    fixture.store.subscribeEvent(fixture.world.event.DomainReleasedEvent, (runtimeDomain) =>
      released.push(runtimeDomain)
    )

    stage(fixture, 'attempt-a', 'https://a.example')
    await vi.waitFor(() => expect(fixture.attempts).toHaveLength(1))
    fixture.attempts[0].settle.resolve()
    await settleAll()
    fixture.store.send(fixture.world.command.CommitStagedCommand('attempt-a'))

    stage(fixture, 'attempt-b', 'https://b.example')
    await vi.waitFor(() => expect(fixture.attempts).toHaveLength(2))
    fixture.attempts[1].settle.resolve()
    await settleAll()
    fixture.store.send(fixture.world.command.CommitStagedCommand('attempt-b'))

    fixture.store.send(fixture.world.command.ReleaseDomainCommand('https://b.example'))
    await vi.waitFor(() => expect(fixture.attempts).toHaveLength(3))
    expect(fixture.attempts[2].message.sites.map((site) => site.origin)).toEqual(['https://a.example'])
    expect(released).toEqual([])

    fixture.attempts[2].settle.resolve()
    await vi.waitFor(() => expect(released).toEqual(['https://b.example']))
    fixture.store.discard()
  })

  it('cancels the iterator quietly when the World Room owner is lost mid-iteration', async () => {
    const fixture = createFixture()
    await fixture.joinWorldRoom()
    fixture.emitRemotePresence('peer-1', 'https://one.example')
    await settleAll()
    const errors: Error[] = []
    fixture.store.subscribeEvent(fixture.world.event.ErrorEvent, (error) => errors.push(error))

    stage(fixture, 'attempt-a', 'https://a.example')
    await vi.waitFor(() => expect(fixture.attempts).toHaveLength(1))

    fixture.store.send(fixture.wire.command.LeaveRoomCommand({ roomId: getWorldRoomId(), preservePending: false }))
    await settleAll()

    expect(errors).toEqual([])
    expect(fixture.attempts).toHaveLength(1)
    fixture.store.discard()
  })
})
