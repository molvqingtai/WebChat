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

const createFixture = () => {
  const attempts: Array<{ message: WorldRoomMessage; settle: ReturnType<typeof deferred<void>> }> = []
  const transport: RoomTransport = {
    peerId: 'local-peer',
    join: async () => {},
    leave: async () => {},
    send: async (roomId, payload) => {
      if (roomId !== getWorldRoomId()) return
      const settle = deferred<void>()
      attempts.push({ message: JSON.parse(payload) as WorldRoomMessage, settle })
      await settle.promise
    },
    onMessage: () => () => {},
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
  return {
    attempts,
    store,
    wire: store.getDomain(wireAction),
    world: store.getDomain(worldAction)
  }
}

describe('WorldDomain full-publication failure ownership', () => {
  it('does not fail a new stage when a superseded recovery publication rejects late', async () => {
    const domainA = 'https://a.example'
    const domainB = 'https://b.example'
    const { attempts, store, wire, world } = createFixture()
    let roomsJoined = false
    store.subscribeEvent(wire.event.RoomsJoinedEvent, () => {
      roomsJoined = true
    })
    store.send(wire.command.JoinRoomsCommand({ requestId: 'join-world', roomIds: [getWorldRoomId()] }))
    await vi.waitFor(() => expect(roomsJoined).toBe(true))

    let publishedA = false
    store.subscribeEvent(world.event.StagedPublishedEvent, ({ attemptId }) => {
      if (attemptId === 'attempt-a') publishedA = true
    })
    store.send(
      world.command.StageDomainCommand({
        attemptId: 'attempt-a',
        domain: domainA,
        user,
        site: { origin: domainA }
      })
    )
    store.send(world.command.PublishStagedCommand('attempt-a'))
    await vi.waitFor(() => expect(attempts).toHaveLength(1))
    attempts[0].settle.resolve()
    await vi.waitFor(() => expect(publishedA).toBe(true))
    store.send(world.command.CommitStagedCommand('attempt-a'))

    store.send(world.command.BeginRecoveryCommand('recovery-a'))
    store.send(world.command.PublishRecoveryCommand('recovery-a'))
    await vi.waitFor(() => expect(attempts).toHaveLength(2))
    expect(attempts[1].message.sites.map(({ origin }) => origin)).toEqual([domainA])

    store.send(world.command.AbortRecoveryCommand('recovery-a'))
    let stagedBFailed: Error | null = null
    let stagedBPublished = false
    store.subscribeEvent(world.event.StagedPublishFailedEvent, ({ attemptId, error }) => {
      if (attemptId === 'attempt-b') stagedBFailed = error
    })
    store.subscribeEvent(world.event.StagedPublishedEvent, ({ attemptId }) => {
      if (attemptId === 'attempt-b') stagedBPublished = true
    })
    store.send(
      world.command.StageDomainCommand({
        attemptId: 'attempt-b',
        domain: domainB,
        user,
        site: { origin: domainB }
      })
    )
    store.send(world.command.PublishStagedCommand('attempt-b'))
    attempts[1].settle.reject(new Error('superseded recovery publication failed late'))
    await vi.waitFor(() => expect(attempts).toHaveLength(3))

    expect(stagedBFailed).toBeNull()
    expect(attempts[2].message.sites.map(({ origin }) => origin).toSorted()).toEqual([domainA, domainB])
    attempts[2].settle.resolve()
    await vi.waitFor(() => expect(stagedBPublished).toBe(true))
    store.send(world.command.CommitStagedCommand('attempt-b'))

    expect(
      store
        .query(world.query.RegistrationsQuery())
        .map(({ domain }) => domain)
        .toSorted()
    ).toEqual([domainA, domainB])
    store.discard()
  })
})
