import { describe, expect, it, vi } from 'vitest'
import { Remesh } from 'remesh'
import ConnectionDomain from './Connection'
import DeliveryDomain from './Delivery'
import HistoryDomain from './History'
import LifecycleDomain from './Lifecycle'
import SessionDomain, { getChatRoomId } from './Session'
import WireDomain from './Wire'
import WorldDomain, { getWorldRoomId } from './World'
import { ClockExtern } from '@/domain/runtime/externs/Clock'
import { IdentityExtern } from '@/domain/runtime/externs/Identity'
import { PresenceStoreExtern } from '@/domain/runtime/externs/PresenceStore'
import { RoomTransportExtern, WireCodecExtern } from '@/domain/runtime/externs/RoomTransport'
import { PagePort, createPagePortImpl } from '@/runtime/PagePort'
import type { RoomTransport } from '@/runtime/RoomTransport'
import type { WireCodec } from '@/protocol'
import { MESSAGE_TYPE } from '@/protocol'

const DOMAIN = 'https://example.com'
const ROOM_ID = getChatRoomId(DOMAIN)
const WORLD_ROOM_ID = getWorldRoomId()
const USER = { id: 'local-user', name: 'Local', avatar: '' }
const SITE = { origin: DOMAIN, title: 'Example' }

const jsonCodec: WireCodec = {
  encode: async (value) => JSON.stringify(value),
  decode: async (payload) => JSON.parse(payload)
}

const deferred = <T = void>() => {
  let resolve!: (value: T) => void
  let reject!: (error: Error) => void
  const promise = new Promise<T>((onResolve, onReject) => {
    resolve = onResolve
    reject = onReject
  })
  return { promise, resolve, reject }
}

const createFixture = () => {
  const worldSendSettled = deferred()
  const sent: { roomId: string; payload: string; targetPeerIds?: string[] }[] = []
  const joined = new Set<string>()
  let messageListener: ((roomId: string, sourcePeerId: string, rawPayload: string) => void) | undefined
  let peerJoinListener: ((roomId: string, sourcePeerId: string) => void) | undefined
  let worldSendStarted = false
  let id = 0
  const transport: RoomTransport = {
    peerIdOf: () => 'local-peer',
    join: async (roomId) => {
      joined.add(roomId)
    },
    leave: (roomId) => {
      joined.delete(roomId)
    },
    send: async (roomId, payload, targetPeerIds) => {
      sent.push({
        roomId,
        payload,
        targetPeerIds: typeof targetPeerIds === 'string' ? [targetPeerIds] : targetPeerIds
      })
      if (roomId === WORLD_ROOM_ID) {
        worldSendStarted = true
        await worldSendSettled.promise
      }
    },
    onMessage: (callback) => {
      messageListener = callback
      return () => {
        messageListener = undefined
      }
    },
    onPeerJoin: (callback) => {
      peerJoinListener = callback
      return () => {
        peerJoinListener = undefined
      }
    },
    onPeerLeave: () => () => {},
    onRoomClose: () => () => {},
    onError: () => () => {},
    dispose: () => {}
  }
  const pagePort = new PagePort()
  const canceledSupplies: string[] = []
  const requestedSyncs: string[] = []
  pagePort.provideHistory('page-a', DOMAIN, (event) => {
    if (event.type === 'request') {
      requestedSyncs.push(event.request.syncId)
      return
    }
    canceledSupplies.push(event.supplyId)
    void pagePort.resolveHistorySupply('page-a', event.supplyId, { records: [], done: true })
  })

  const store = Remesh.store({
    externs: [
      ClockExtern.impl({ now: () => 1_800_000_000_000 }),
      IdentityExtern.impl({ nextId: () => `id-${++id}` }),
      PresenceStoreExtern.impl({ load: async () => null, save: async () => {} }),
      RoomTransportExtern.impl(transport),
      WireCodecExtern.impl(jsonCodec),
      createPagePortImpl(pagePort)
    ]
  })
  const lifecycleAction = LifecycleDomain()
  const wireAction = WireDomain()
  const deliveryAction = DeliveryDomain()
  const sessionAction = SessionDomain()
  const worldAction = WorldDomain({ sessionId: 'world-session' })
  const historyAction = HistoryDomain()
  const connectionAction = ConnectionDomain({ hostId: 'host-id', worldSessionId: 'world-session' })
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

  const lifecycle = store.getDomain(lifecycleAction)
  const session = store.getDomain(sessionAction)
  const history = store.getDomain(historyAction)
  const connection = store.getDomain(connectionAction)
  store.send(lifecycle.command.HostReadyCommand())
  store.send(lifecycle.command.AttachPageCommand({ domain: DOMAIN, pageId: 'page-a' }))
  store.send(
    session.command.HydratePresenceCommand({
      domain: DOMAIN,
      lastJoinedAt: 1_800_000_000_000,
      local: {
        presenceId: 'presence-local',
        userId: USER.id,
        joinedAt: 1_800_000_000_000,
        status: 'pending'
      },
      observers: []
    })
  )

  return {
    store,
    lifecycle,
    history,
    connection,
    sent,
    requestedSyncs,
    canceledSupplies,
    worldSendStarted: () => worldSendStarted,
    settleWorldSend: () => worldSendSettled.resolve(),
    receive: (roomId: string, sourcePeerId: string, message: unknown) => {
      if (!joined.has(roomId)) return
      messageListener?.(roomId, sourcePeerId, JSON.stringify(message))
    },
    peerJoin: (roomId: string, sourcePeerId: string) => {
      if (!joined.has(roomId)) return
      peerJoinListener?.(roomId, sourcePeerId)
    }
  }
}

describe('Connection provisional lifecycle fencing', () => {
  it('cancels deferred peer work and provisional History when the host is destroyed', async () => {
    const fixture = createFixture()
    const { store, lifecycle, history, connection } = fixture

    store.send(
      connection.command.JoinDomainCommand({
        operationId: 'attempt-1',
        domain: DOMAIN,
        user: USER,
        site: SITE
      })
    )
    await vi.waitFor(() => expect(fixture.worldSendStarted()).toBe(true))

    // This peer callback is deferred until the attempt is accepted. The History pull is an
    // independent provisional owner that must be cancelled by the same host-loss boundary.
    fixture.peerJoin(ROOM_ID, 'deferred-peer')
    fixture.receive(ROOM_ID, 'history-peer', {
      type: MESSAGE_TYPE.HISTORY_MESSAGES_PULL,
      syncId: 'provisional-host-loss',
      page: 0,
      messageIds: [],
      done: true
    })
    await vi.waitFor(() => expect(fixture.requestedSyncs).toEqual(['provisional-host-loss']))

    store.send(lifecycle.command.HostDestroyedCommand())
    fixture.settleWorldSend()

    await vi.waitFor(() => expect(store.query(connection.query.AttemptsQuery())).toEqual([]))
    await vi.waitFor(() => expect(fixture.canceledSupplies).toHaveLength(1))
    expect(store.query(history.query.ProviderAttemptsQuery())).toEqual([])
    expect(fixture.sent.filter((item) => item.targetPeerIds?.includes('deferred-peer'))).toEqual([])
    store.discard()
  })
})
