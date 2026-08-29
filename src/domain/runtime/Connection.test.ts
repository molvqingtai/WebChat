import { describe, expect, it, vi } from 'vitest'
import { Remesh } from 'remesh'
import ConnectionDomain from './Connection'
import DeliveryDomain from './Delivery'
import HistoryDomain from './History'
import LifecycleDomain from './Lifecycle'
import SessionDomain, { getChatRoomId } from './Session'
import WireDomain from './Wire'
import WorldDomain, { getWorldRoomId } from './World'
import { ClockExtern } from './externs/Clock'
import { IdentityExtern } from './externs/Identity'
import { PresenceStoreExtern } from './externs/PresenceStore'
import { RoomTransportExtern, WireCodecExtern } from './externs/RoomTransport'
import { createPagePortImpl, PagePort } from '@/runtime/PagePort'

const DOMAIN = 'https://chat.example.test'
const USER = { id: 'local-user', name: 'Local', avatar: '' }
const SITE = { origin: DOMAIN, title: 'Example' }

const deferred = <T>() => {
  let resolve!: (value: T) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((onResolve, onReject) => {
    resolve = onResolve
    reject = onReject
  })
  return { promise, resolve, reject }
}

const fixture = () => {
  let join = async (_roomId: string) => {}
  let decode = async (value: string): Promise<unknown> => JSON.parse(value)
  let messageListener: ((roomId: string, sourcePeerId: string, rawPayload: string) => void) | null = null
  const store = Remesh.store({
    externs: [
      ClockExtern.impl({ now: () => 1_000, sleep: async () => {} }),
      IdentityExtern.impl({ nextId: () => 'test-id' }),
      PresenceStoreExtern.impl({ load: async () => null, save: async () => {} }),
      RoomTransportExtern.impl({
        peerIdOf: () => 'local-peer',
        join: (roomId) => join(roomId),
        leave: () => {},
        retireRoomsForPreparation: async () => {},
        send: async () => {},
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
      }),
      WireCodecExtern.impl({ encode: async (value) => JSON.stringify(value), decode: (value) => decode(value) }),
      createPagePortImpl(new PagePort())
    ]
  })
  const lifecycleAction = LifecycleDomain()
  const wireAction = WireDomain()
  const deliveryAction = DeliveryDomain()
  const sessionAction = SessionDomain()
  const worldAction = WorldDomain({ sessionId: 'world-session' })
  const historyAction = HistoryDomain()
  const connectionAction = ConnectionDomain({ hostId: 'host-1', worldSessionId: 'world-session' })
  store.subscribeDomain(lifecycleAction)
  store.subscribeDomain(wireAction)
  store.subscribeDomain(deliveryAction)
  store.subscribeDomain(sessionAction)
  store.subscribeDomain(worldAction)
  store.subscribeDomain(historyAction)
  store.subscribeDomain(connectionAction)
  store.igniteDomain(lifecycleAction)
  store.igniteDomain(wireAction)
  store.igniteDomain(deliveryAction)
  store.igniteDomain(sessionAction)
  store.igniteDomain(worldAction)
  store.igniteDomain(historyAction)
  store.igniteDomain(connectionAction)

  return {
    store,
    connection: store.getDomain(connectionAction),
    session: store.getDomain(sessionAction),
    wire: store.getDomain(wireAction),
    world: store.getDomain(worldAction),
    setJoin: (next: typeof join) => {
      join = next
    },
    setDecode: (next: typeof decode) => {
      decode = next
    },
    receive: (roomId: string, sourcePeerId: string, value: unknown) => {
      messageListener?.(roomId, sourcePeerId, JSON.stringify(value))
    },
    discard: () => store.discard()
  }
}

const beginStage = (runtime: ReturnType<typeof fixture>, epoch = 'epoch-1') => {
  const attemptId = `attempt:${epoch}`
  const chatGeneration = runtime.store.query(runtime.wire.query.RoomGenerationQuery(getChatRoomId(DOMAIN)))
  const worldGeneration = runtime.store.query(runtime.wire.query.RoomGenerationQuery(getWorldRoomId()))
  runtime.store.send(
    runtime.session.command.PrepareEpochDomainCommand({
      attemptId,
      epoch,
      chatGeneration,
      domain: DOMAIN,
      roomId: getChatRoomId(DOMAIN),
      local: {
        sessionId: 'local-session',
        presenceId: 'local-presence',
        user: USER,
        site: SITE,
        joinedAt: 1
      }
    })
  )
  runtime.store.send(
    runtime.world.command.StageEpochDomainCommand({
      attemptId,
      epoch,
      worldGeneration,
      domain: DOMAIN,
      user: USER,
      site: SITE
    })
  )
  runtime.store.send(
    runtime.wire.command.PrepareRoomsCommand({
      epoch,
      requestId: `prepare:${epoch}`,
      roomIds: [getChatRoomId(DOMAIN), getWorldRoomId()]
    })
  )
  return { epoch, attemptId, chatGeneration, worldGeneration, domain: DOMAIN }
}

const stage = async (runtime: ReturnType<typeof fixture>, epoch = 'epoch-1') => {
  const payload = beginStage(runtime, epoch)
  await vi.waitFor(() => expect(runtime.store.query(runtime.wire.query.PreparedRouteQuery(epoch))?.ready).toBe(true))
  return payload
}

describe('ConnectionDomain dual epoch shared gate', () => {
  it('keeps old terminals and readable current state empty until its one shared terminal', async () => {
    const runtime = fixture()
    const sessionCommitted: unknown[] = []
    const worldCommitted: unknown[] = []
    const roomsJoined: unknown[] = []
    const sharedReads: unknown[] = []
    const sessionObserverReads: unknown[] = []
    const worldObserverReads: unknown[] = []
    runtime.store.subscribeEvent(runtime.session.event.DomainCommittedEvent, (event) => sessionCommitted.push(event))
    runtime.store.subscribeEvent(runtime.world.event.DomainCommittedEvent, (event) => worldCommitted.push(event))
    runtime.store.subscribeEvent(runtime.wire.event.RoomsJoinedEvent, (event) => roomsJoined.push(event))
    runtime.store.subscribeQuery(runtime.session.query.DomainQuery(DOMAIN), (session) => {
      if (!session) return
      sessionObserverReads.push({
        registrations: runtime.store.query(runtime.world.query.RegistrationsQuery()),
        trustedRooms: runtime.store.query(runtime.wire.query.TrustedRoomsQuery())
      })
    })
    runtime.store.subscribeQuery(runtime.world.query.RegistrationsQuery(), (registrations) => {
      if (registrations.length === 0) return
      worldObserverReads.push({
        session: runtime.store.query(runtime.session.query.DomainQuery(DOMAIN)),
        trustedRooms: runtime.store.query(runtime.wire.query.TrustedRoomsQuery())
      })
    })
    runtime.store.subscribeEvent(runtime.connection.event.DualEpochCommittedEvent, () => {
      sharedReads.push({
        session: runtime.store.query(runtime.session.query.DomainQuery(DOMAIN)),
        registrations: runtime.store.query(runtime.world.query.RegistrationsQuery()),
        joined: runtime.store.query(runtime.world.query.JoinedQuery()),
        trustedRooms: runtime.store.query(runtime.wire.query.TrustedRoomsQuery()),
        snapshot: runtime.store.query(runtime.connection.query.SnapshotQuery()),
        gate: runtime.store.query(runtime.connection.query.DualEpochGateQuery())
      })
    })

    const payload = await stage(runtime)

    expect(sessionCommitted).toEqual([])
    expect(worldCommitted).toEqual([])
    expect(roomsJoined).toEqual([])
    expect(sessionObserverReads).toEqual([])
    expect(worldObserverReads).toEqual([])
    expect(runtime.store.query(runtime.session.query.DomainsQuery())).toEqual([])
    expect(runtime.store.query(runtime.world.query.RegistrationsQuery())).toEqual([])
    expect(runtime.store.query(runtime.world.query.JoinedQuery())).toBe(false)
    expect(runtime.store.query(runtime.wire.query.TrustedRoomsQuery())).toEqual([])
    expect(runtime.store.query(runtime.connection.query.SnapshotQuery())).toMatchObject({
      domains: [],
      world: { joined: false }
    })

    runtime.store.send(runtime.connection.command.CommitDualEpochCommand(payload))

    await vi.waitFor(() => expect(sessionObserverReads).toHaveLength(1))
    await vi.waitFor(() => expect(worldObserverReads).toHaveLength(1))

    expect(sessionObserverReads).toEqual([
      {
        registrations: [expect.objectContaining({ domain: DOMAIN })],
        trustedRooms: expect.arrayContaining([getChatRoomId(DOMAIN), getWorldRoomId()])
      }
    ])
    expect(worldObserverReads).toEqual([
      {
        session: expect.objectContaining({ domain: DOMAIN }),
        trustedRooms: expect.arrayContaining([getChatRoomId(DOMAIN), getWorldRoomId()])
      }
    ])
    expect(sessionCommitted).toEqual([])
    expect(worldCommitted).toEqual([])
    expect(roomsJoined).toEqual([])
    expect(sharedReads).toEqual([
      expect.objectContaining({
        session: expect.objectContaining({ domain: DOMAIN, roomId: getChatRoomId(DOMAIN) }),
        registrations: [expect.objectContaining({ domain: DOMAIN, user: USER, site: SITE })],
        joined: true,
        trustedRooms: expect.arrayContaining([getChatRoomId(DOMAIN), getWorldRoomId()]),
        snapshot: expect.objectContaining({
          domains: [],
          world: expect.objectContaining({ joined: true })
        }),
        gate: expect.objectContaining(payload)
      })
    ])
    expect(runtime.store.query(runtime.connection.query.DualEpochGateQuery())).toMatchObject(payload)
    runtime.discard()
  })

  it.each(['session', 'world', 'wire', 'generation'] as const)(
    'aborts every staged owner before install when %s is no longer valid',
    async (invalid) => {
      const runtime = fixture()
      const payload = await stage(runtime)
      const shared: unknown[] = []
      const oldEvents: unknown[] = []
      runtime.store.subscribeEvent(runtime.connection.event.DualEpochCommittedEvent, (event) => shared.push(event))
      runtime.store.subscribeEvent(runtime.session.event.DomainCommittedEvent, (event) => oldEvents.push(event))
      runtime.store.subscribeEvent(runtime.world.event.DomainCommittedEvent, (event) => oldEvents.push(event))
      runtime.store.subscribeEvent(runtime.wire.event.RoomsJoinedEvent, (event) => oldEvents.push(event))

      if (invalid === 'session') {
        runtime.store.send(runtime.session.command.AbortEpochCommand(payload))
      } else if (invalid === 'world') {
        runtime.store.send(runtime.world.command.AbortEpochCommand(payload))
      } else if (invalid === 'wire') {
        const route = runtime.store.query(runtime.wire.query.PreparedRouteQuery(payload.epoch))
        expect(route).not.toBeNull()
        runtime.store.send(
          runtime.wire.command.AbortEpochPreparedRoomsCommand({ epoch: payload.epoch, rooms: route!.rooms })
        )
      } else {
        runtime.store.send(
          runtime.wire.command.LeaveRoomCommand({ roomId: getChatRoomId(DOMAIN), preservePending: false })
        )
      }

      runtime.store.send(runtime.connection.command.CommitDualEpochCommand(payload))

      expect(shared).toEqual([])
      expect(oldEvents).toEqual([])
      expect(runtime.store.query(runtime.session.query.DomainsQuery())).toEqual([])
      expect(runtime.store.query(runtime.session.query.PreparedSessionQuery(payload.attemptId))).toBeNull()
      expect(runtime.store.query(runtime.world.query.RegistrationsQuery())).toEqual([])
      expect(runtime.store.query(runtime.world.query.EpochStagedRegistrationQuery(payload))).toBeNull()
      expect(runtime.store.query(runtime.world.query.JoinedQuery())).toBe(false)
      expect(runtime.store.query(runtime.wire.query.PreparedRouteQuery(payload.epoch))).toBeNull()
      expect(runtime.store.query(runtime.wire.query.TrustedRoomsQuery())).toEqual([])
      runtime.discard()
    }
  )

  it('keeps all three installed current states byte-stable when the same committed epoch re-enters', async () => {
    const runtime = fixture()
    const payload = await stage(runtime)
    const shared: unknown[] = []
    runtime.store.subscribeEvent(runtime.connection.event.DualEpochCommittedEvent, (event) => shared.push(event))

    runtime.store.send(runtime.connection.command.CommitDualEpochCommand(payload))
    const before = JSON.stringify({
      session: runtime.store.query(runtime.session.query.DomainQuery(DOMAIN)),
      world: runtime.store.query(runtime.world.query.RegistrationsQuery()),
      trusted: runtime.store.query(runtime.wire.query.TrustedRoomsQuery())
    })
    const sessionWrites: string[] = []
    const worldWrites: string[] = []
    const wireWrites: string[] = []
    runtime.store.subscribeQuery(runtime.session.query.DomainQuery(DOMAIN), (value) =>
      sessionWrites.push(JSON.stringify(value))
    )
    runtime.store.subscribeQuery(runtime.world.query.RegistrationsQuery(), (value) =>
      worldWrites.push(JSON.stringify(value))
    )
    runtime.store.subscribeQuery(runtime.wire.query.TrustedRoomsQuery(), (value) =>
      wireWrites.push(JSON.stringify(value))
    )

    runtime.store.send(runtime.connection.command.CommitDualEpochCommand(payload))
    await Promise.resolve()

    expect(shared).toEqual([{ epoch: payload.epoch, domain: DOMAIN }])
    expect(
      JSON.stringify({
        session: runtime.store.query(runtime.session.query.DomainQuery(DOMAIN)),
        world: runtime.store.query(runtime.world.query.RegistrationsQuery()),
        trusted: runtime.store.query(runtime.wire.query.TrustedRoomsQuery())
      })
    ).toBe(before)
    expect(sessionWrites).toEqual([])
    expect(worldWrites).toEqual([])
    expect(wireWrites).toEqual([])
    runtime.discard()
  })

  it('aborts before install when the private Wire prepare has not completed its physical joins', async () => {
    const runtime = fixture()
    let releaseJoin!: () => void
    const joinGate = new Promise<void>((resolve) => {
      releaseJoin = resolve
    })
    runtime.setJoin(async () => joinGate)
    const shared: unknown[] = []
    const roomsJoined: unknown[] = []
    runtime.store.subscribeEvent(runtime.connection.event.DualEpochCommittedEvent, (event) => shared.push(event))
    runtime.store.subscribeEvent(runtime.wire.event.RoomsJoinedEvent, (event) => roomsJoined.push(event))

    const payload = beginStage(runtime)
    await vi.waitFor(() =>
      expect(runtime.store.query(runtime.wire.query.PreparedRouteQuery(payload.epoch))).not.toBeNull()
    )
    expect(runtime.store.query(runtime.wire.query.PreparedRouteQuery(payload.epoch))?.ready).toBe(false)

    runtime.store.send(runtime.connection.command.CommitDualEpochCommand(payload))

    expect(shared).toEqual([])
    expect(roomsJoined).toEqual([])
    expect(runtime.store.query(runtime.session.query.DomainsQuery())).toEqual([])
    expect(runtime.store.query(runtime.world.query.RegistrationsQuery())).toEqual([])
    expect(runtime.store.query(runtime.wire.query.TrustedRoomsQuery())).toEqual([])
    expect(runtime.store.query(runtime.session.query.PreparedSessionQuery(payload.attemptId))).toBeNull()
    expect(runtime.store.query(runtime.world.query.EpochStagedRegistrationQuery(payload))).toBeNull()
    expect(runtime.store.query(runtime.wire.query.PreparedRouteQuery(payload.epoch))).toBeNull()

    releaseJoin()
    await Promise.resolve()
    expect(roomsJoined).toEqual([])
    runtime.discard()
  })

  it('drops an old decoded World frame after abort instead of letting it cross the shared gate', async () => {
    const runtime = fixture()
    const decoded = deferred<unknown>()
    let decodeStarted = false
    const preparedMessages: unknown[] = []
    const currentMessages: unknown[] = []
    runtime.setDecode(async () => {
      decodeStarted = true
      return decoded.promise
    })
    runtime.store.subscribeEvent(runtime.wire.event.PreparedMessageAcceptedEvent, (event) =>
      preparedMessages.push(event)
    )
    runtime.store.subscribeEvent(runtime.wire.event.MessageAcceptedEvent, (event) => currentMessages.push(event))
    const payload = await stage(runtime)

    runtime.receive(getWorldRoomId(), 'remote-peer', {
      sessionId: 'remote-session',
      user: { id: 'remote-user', name: 'Remote', avatar: '' },
      sites: [{ origin: 'https://remote.example.test' }]
    })
    await vi.waitFor(() => expect(decodeStarted).toBe(true))

    runtime.store.send(runtime.connection.command.AbortDualEpochCommand(payload))
    decoded.resolve({
      sessionId: 'remote-session',
      user: { id: 'remote-user', name: 'Remote', avatar: '' },
      sites: [{ origin: 'https://remote.example.test' }]
    })
    await vi.waitFor(() => expect(runtime.store.query(runtime.wire.query.DecodeQueuesQuery())).toEqual([]))

    expect(preparedMessages).toEqual([])
    expect(currentMessages).toEqual([])
    expect(runtime.store.query(runtime.world.query.StagedPresencesQuery(payload.epoch))).toEqual([])
    expect(runtime.store.query(runtime.world.query.PresencesQuery())).toEqual([])
    expect(runtime.store.query(runtime.session.query.DomainsQuery())).toEqual([])
    runtime.discard()
  })

  it('silently cuts both current owners once, retaining only local successor intent', async () => {
    const runtime = fixture()
    const current = await stage(runtime, 'current')
    runtime.store.send(runtime.connection.command.CommitDualEpochCommand(current))
    runtime.store.send(
      runtime.wire.command.AdmitSourceCommand({ roomId: getWorldRoomId(), sourcePeerId: 'remote-peer' })
    )
    runtime.receive(getWorldRoomId(), 'remote-peer', {
      sessionId: 'remote-session',
      user: { id: 'remote-user', name: 'Remote', avatar: '' },
      sites: [{ origin: 'https://remote.example.test' }]
    })
    await vi.waitFor(() => expect(runtime.store.query(runtime.world.query.PresencesQuery())).toHaveLength(1))
    const oldEvents: unknown[] = []
    runtime.store.subscribeEvent(runtime.session.event.DomainCommittedEvent, (event) => oldEvents.push(event))
    runtime.store.subscribeEvent(runtime.world.event.DomainCommittedEvent, (event) => oldEvents.push(event))
    runtime.store.subscribeEvent(runtime.wire.event.RoomsJoinedEvent, (event) => oldEvents.push(event))
    const cut = {
      epoch: 'cut-1',
      domain: DOMAIN,
      attemptId: 'attempt:cut-1',
      chatGeneration: 1,
      worldGeneration: 1
    }

    runtime.store.send(runtime.connection.command.BeginDualEpochReplacementCommand(cut))

    expect(oldEvents).toEqual([])
    expect(runtime.store.query(runtime.connection.query.DualEpochCutQuery())).toEqual(cut)
    expect(runtime.store.query(runtime.session.query.DomainQuery(DOMAIN))).toBeNull()
    expect(runtime.store.query(runtime.session.query.RetainedLocalSeedQuery(DOMAIN))).toBe(true)
    expect(runtime.store.query(runtime.world.query.RegistrationsQuery())).toEqual([])
    expect(runtime.store.query(runtime.world.query.PresencesQuery())).toEqual([])
    expect(runtime.store.query(runtime.world.query.JoinedQuery())).toBe(false)
    expect(runtime.store.query(runtime.world.query.EpochRetainedRegistrationsQuery(cut.epoch))).toEqual([
      expect.objectContaining({ domain: DOMAIN, user: USER, site: SITE })
    ])
    expect(runtime.store.query(runtime.wire.query.TrustedRoomsQuery())).toEqual([])
    expect(runtime.store.query(runtime.wire.query.SourcesQuery(getWorldRoomId()))).toEqual([])
    expect(runtime.store.query(runtime.wire.query.RoomGenerationQuery(getChatRoomId(DOMAIN)))).toBe(1)
    expect(runtime.store.query(runtime.wire.query.RoomGenerationQuery(getWorldRoomId()))).toBe(1)
    expect(runtime.store.query(runtime.connection.query.SnapshotQuery())).toMatchObject({
      domains: [],
      world: { joined: false, presences: [] }
    })

    const afterFirstCut = JSON.stringify({
      session: runtime.store.query(runtime.session.query.DomainsQuery()),
      world: runtime.store.query(runtime.world.query.RegistrationsQuery()),
      trusted: runtime.store.query(runtime.wire.query.TrustedRoomsQuery()),
      chatGeneration: runtime.store.query(runtime.wire.query.RoomGenerationQuery(getChatRoomId(DOMAIN))),
      worldGeneration: runtime.store.query(runtime.wire.query.RoomGenerationQuery(getWorldRoomId())),
      cut: runtime.store.query(runtime.connection.query.DualEpochCutQuery())
    })
    runtime.store.send(
      runtime.connection.command.BeginDualEpochReplacementCommand({
        ...cut,
        chatGeneration: cut.chatGeneration + 1,
        worldGeneration: cut.worldGeneration + 1
      })
    )
    expect(
      JSON.stringify({
        session: runtime.store.query(runtime.session.query.DomainsQuery()),
        world: runtime.store.query(runtime.world.query.RegistrationsQuery()),
        trusted: runtime.store.query(runtime.wire.query.TrustedRoomsQuery()),
        chatGeneration: runtime.store.query(runtime.wire.query.RoomGenerationQuery(getChatRoomId(DOMAIN))),
        worldGeneration: runtime.store.query(runtime.wire.query.RoomGenerationQuery(getWorldRoomId())),
        cut: runtime.store.query(runtime.connection.query.DualEpochCutQuery())
      })
    ).toBe(afterFirstCut)
    runtime.discard()
  })

  it('rejects a decoded old-generation frame after the silent current-owner cut', async () => {
    const runtime = fixture()
    const current = await stage(runtime, 'current')
    runtime.store.send(runtime.connection.command.CommitDualEpochCommand(current))
    const decoded = deferred<unknown>()
    let decodeStarted = false
    runtime.setDecode(async () => {
      decodeStarted = true
      return decoded.promise
    })
    runtime.receive(getWorldRoomId(), 'remote-peer', {
      sessionId: 'remote-session',
      user: { id: 'remote-user', name: 'Remote', avatar: '' },
      sites: [{ origin: 'https://remote.example.test' }]
    })
    await vi.waitFor(() => expect(decodeStarted).toBe(true))

    runtime.store.send(
      runtime.connection.command.BeginDualEpochReplacementCommand({
        epoch: 'cut-1',
        domain: DOMAIN,
        attemptId: 'attempt:cut-1',
        chatGeneration: 1,
        worldGeneration: 1
      })
    )
    decoded.resolve({
      sessionId: 'remote-session',
      user: { id: 'remote-user', name: 'Remote', avatar: '' },
      sites: [{ origin: 'https://remote.example.test' }]
    })
    await vi.waitFor(() => expect(runtime.store.query(runtime.wire.query.DecodeQueuesQuery())).toEqual([]))

    expect(runtime.store.query(runtime.world.query.PresencesQuery())).toEqual([])
    expect(runtime.store.query(runtime.world.query.StagedPresencesQuery('cut-1'))).toEqual([])
    expect(runtime.store.query(runtime.wire.query.SourcesQuery(getWorldRoomId()))).toEqual([])
    runtime.discard()
  })

  it.each(['missing Chat', 'missing World', 'swapped Chat and World'] as const)(
    'rejects a %s generation before any private cut',
    async (invalid) => {
      const runtime = fixture()
      const current = await stage(runtime, 'current')
      runtime.store.send(runtime.connection.command.CommitDualEpochCommand(current))
      runtime.store.send(
        runtime.wire.command.LeaveRoomCommand({ roomId: getChatRoomId(DOMAIN), preservePending: false })
      )
      runtime.store.send(runtime.wire.command.LeaveRoomCommand({ roomId: getWorldRoomId(), preservePending: false }))
      runtime.store.send(runtime.wire.command.LeaveRoomCommand({ roomId: getWorldRoomId(), preservePending: false }))
      const expected = {
        epoch: `invalid:${invalid}`,
        domain: DOMAIN,
        attemptId: `attempt:invalid:${invalid}`,
        chatGeneration: runtime.store.query(runtime.wire.query.RoomGenerationQuery(getChatRoomId(DOMAIN))) + 1,
        worldGeneration: runtime.store.query(runtime.wire.query.RoomGenerationQuery(getWorldRoomId())) + 1
      }
      expect(expected.chatGeneration).not.toBe(expected.worldGeneration)
      const payload =
        invalid === 'missing Chat'
          ? ({ ...expected, chatGeneration: undefined } as unknown as typeof expected)
          : invalid === 'missing World'
            ? ({ ...expected, worldGeneration: undefined } as unknown as typeof expected)
            : {
                ...expected,
                chatGeneration: expected.worldGeneration,
                worldGeneration: expected.chatGeneration
              }

      runtime.store.send(runtime.connection.command.BeginDualEpochReplacementCommand(payload))

      expect(runtime.store.query(runtime.connection.query.DualEpochCutQuery())).toBeNull()
      expect(runtime.store.query(runtime.session.query.DomainQuery(DOMAIN))).not.toBeNull()
      expect(runtime.store.query(runtime.world.query.RegistrationsQuery())).toHaveLength(1)
      runtime.discard()
    }
  )
})
