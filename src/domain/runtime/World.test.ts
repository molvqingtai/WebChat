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

const user = { id: 'user-1', name: 'User', avatar: '' }

interface SendAttempt {
  targetPeerIds: string[] | undefined
  message: WorldRoomMessage
  settle: ReturnType<typeof deferred<void>>
}

const createFixture = (options?: { failNextEncode?: () => boolean }) => {
  const attempts: SendAttempt[] = []
  const joinedPeers: string[] = []
  const codec: WireCodec = {
    encode: async (value) => {
      if (options?.failNextEncode?.()) throw new Error('encode refused')
      return JSON.stringify(value)
    },
    decode: async (payload) => JSON.parse(payload)
  }
  let messageListener: ((roomId: string, sourcePeerId: string, rawPayload: string) => void) | null = null
  const transport: RoomTransport = {
    peerIdOf: () => 'local-peer',
    join: async () => {},
    leave: async () => {},
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
    // A normal publication is one room broadcast even when the room currently has no members.
    await vi.waitFor(() => expect(fixture.attempts).toHaveLength(1))
    expect(fixture.attempts[0].targetPeerIds).toBeUndefined()
    fixture.attempts[0].settle.resolve()
    await vi.waitFor(() => expect(published).toBe(true))
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
    expect(fixture.attempts[0].targetPeerIds).toBeUndefined()
    fixture.attempts[0].settle.reject(new Error('target one exploded'))
    await vi.waitFor(() => expect(published).toBe(true))

    expect(errors.map((error) => error.message)).toEqual(['target one exploded'])
    expect(fixture.attempts).toHaveLength(1)
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
    await vi.waitFor(() => expect(published).toEqual(['attempt-a']))
    fixture.store.send(fixture.world.command.CommitStagedCommand('attempt-a'))

    stage(fixture, 'attempt-b', 'https://b.example')
    await vi.waitFor(() => expect(fixture.attempts).toHaveLength(2))
    expect(fixture.attempts[1].message.sites.map(({ origin }) => origin).toSorted()).toEqual([
      'https://a.example',
      'https://b.example'
    ])

    // A release supersedes the in-flight revision: the old publication stops, the newest revision
    // publishes through the same owner as one fresh room broadcast.
    fixture.store.send(fixture.world.command.ReleaseDomainCommand('https://b.example'))
    // The superseded in-flight publication settles late; its stale completion cannot disturb the new revision.
    fixture.attempts[1].settle.resolve()
    await vi.waitFor(() => expect(fixture.attempts).toHaveLength(3))
    expect(fixture.attempts[2].message.sites.map(({ origin }) => origin)).toEqual(['https://a.example'])

    await settleAll()
    expect(fixture.attempts).toHaveLength(3)

    fixture.attempts[2].settle.resolve()
    await settleAll()

    expect(errors).toEqual([])
    expect(published).toEqual(['attempt-a'])
    expect(fixture.attempts).toHaveLength(3)
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

  it('does not re-attempt a release-current target that threw; it surfaces once and completes the release', async () => {
    const fixture = createFixture()
    await fixture.joinWorldRoom()
    fixture.emitRemotePresence('peer-1', 'https://one.example')
    await settleAll()
    const released: string[] = []
    const errors: Error[] = []
    fixture.store.subscribeEvent(fixture.world.event.DomainReleasedEvent, (runtimeDomain) =>
      released.push(runtimeDomain)
    )
    fixture.store.subscribeEvent(fixture.world.event.ErrorEvent, (error) => errors.push(error))

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

    // Release b: the publication continuation sends to the single remaining target `a` and that
    // provider call throws. The target is attempted exactly once: it is surfaced, not re-sent, and
    // the release continuation still completes so the domain close finishes.
    fixture.store.send(fixture.world.command.ReleaseDomainCommand('https://b.example'))
    await vi.waitFor(() => expect(fixture.attempts).toHaveLength(3))
    const before = fixture.attempts.length
    fixture.attempts[2].settle.reject(new Error('a exploded on release'))
    await settleAll()

    expect(errors.map((error) => error.message)).toEqual(['a exploded on release'])
    expect(released).toEqual(['https://b.example'])
    expect(fixture.attempts).toHaveLength(before)
    fixture.store.discard()
  })

  it('keeps a live release publication step on preflight failure and completes on a later success', async () => {
    let failEncode = false
    const fixture = createFixture({ failNextEncode: () => failEncode })
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

    // The release removes b's contribution and publishes the latest full presence (`a`). Its
    // publication preflight (encode) fails once: the step must be kept, surfaced, and retried at a
    // bounded cadence — never concluded prematurely with the latest presence unpublished.
    vi.useFakeTimers()
    failEncode = true
    fixture.store.send(fixture.world.command.ReleaseDomainCommand('https://b.example'))
    await settleAll()
    expect(released).toEqual([])
    const attemptsBefore = fixture.attempts.length

    failEncode = false
    await vi.advanceTimersByTimeAsync(1500)
    await settleAll()
    expect(fixture.attempts.length).toBeGreaterThan(attemptsBefore)
    fixture.attempts[fixture.attempts.length - 1].settle.resolve()
    await settleAll()
    expect(released).toEqual(['https://b.example'])
    vi.useRealTimers()
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
