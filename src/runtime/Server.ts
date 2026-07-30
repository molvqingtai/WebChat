import { Remesh, type RemeshAction, type RemeshStore } from 'remesh'
import { nanoid } from 'nanoid'
import ConnectionDomain, { type ConnectionOperationSucceeded } from '@/domain/runtime/Connection'
import DeliveryDomain from '@/domain/runtime/Delivery'
import HistoryDomain from '@/domain/runtime/History'
import LifecycleDomain from '@/domain/runtime/Lifecycle'
import SessionDomain, { getChatRoomId, type SessionOperationSucceeded } from '@/domain/runtime/Session'
import WireDomain from '@/domain/runtime/Wire'
import WorldDomain, { getWorldRoomId } from '@/domain/runtime/World'
import { ClockExtern, type Clock } from '@/domain/runtime/externs/Clock'
import { IdentityExtern } from '@/domain/runtime/externs/Identity'
import { PresenceStoreExtern, type PresenceStore } from '@/domain/runtime/externs/PresenceStore'
import { RoomTransportExtern, WireCodecExtern } from '@/domain/runtime/externs/RoomTransport'
import type { RoomTransport } from '@/runtime/RoomTransport'
import type { ReactionMessageRecord, TextMessageRecord } from '@/domain/Message'
import { NativeWireCodec, type WireCodec } from '@/protocol'
import type { RuntimeServer, RuntimeSnapshot } from '@/runtime/Contract'
import { MAX_HISTORY_SESSION_BYTES, MAX_HISTORY_SESSION_MESSAGES } from '@/constants/config'
import { PagePort, createPagePortImpl } from '@/runtime/PagePort'
import { createBoundedPresenceStore, createMemoryPresenceStore } from '@/runtime/PresenceStore'

export interface ServerConfig {
  transport: RoomTransport
  clock?: Clock
  codec?: WireCodec
  historySessionBytes?: number
  historySessionMessages?: number
  presenceStore?: PresenceStore
}

const defaultClock: Clock = { now: () => Date.now() }
const INTERRUPTED_RELEASE_COMPLETED = 'Runtime completed an interrupted presence release; join again to re-enter'
const serverDisposers = new WeakMap<RuntimeServer, () => void>()

export const disposeServer = (server: RuntimeServer) => serverDisposers.get(server)?.()

export const createServer = (config: ServerConfig): RuntimeServer => {
  const clock = config.clock ?? defaultClock
  const pagePort = new PagePort()
  const presenceStore = config.presenceStore
    ? createBoundedPresenceStore(config.presenceStore)
    : createMemoryPresenceStore()
  const worldSessionId = nanoid()
  const historyOptions = {
    historySessionBytes: config.historySessionBytes ?? MAX_HISTORY_SESSION_BYTES,
    historySessionMessages: config.historySessionMessages ?? MAX_HISTORY_SESSION_MESSAGES
  }
  const connectionOptions = {
    hostId: nanoid(),
    worldSessionId,
    ...historyOptions
  }

  const store: RemeshStore = Remesh.store({
    externs: [
      ClockExtern.impl(clock),
      IdentityExtern.impl({ nextId: nanoid }),
      PresenceStoreExtern.impl(presenceStore),
      RoomTransportExtern.impl(config.transport),
      WireCodecExtern.impl(config.codec ?? NativeWireCodec),
      createPagePortImpl(pagePort)
    ]
  })
  const lifecycleAction = LifecycleDomain()
  const wireAction = WireDomain()
  const deliveryAction = DeliveryDomain()
  const sessionAction = SessionDomain()
  const worldAction = WorldDomain({ sessionId: worldSessionId })
  const historyAction = HistoryDomain(historyOptions)
  const connectionAction = ConnectionDomain(connectionOptions)
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

  const lifecycleDomain = store.getDomain(lifecycleAction)
  const deliveryDomain = store.getDomain(deliveryAction)
  const sessionDomain = store.getDomain(sessionAction)
  const worldDomain = store.getDomain(worldAction)
  const connectionDomain = store.getDomain(connectionAction)
  store.send(lifecycleDomain.command.HostReadyCommand())

  const snapshot = (): RuntimeSnapshot => store.query(connectionDomain.query.SnapshotQuery())
  const acquirePresence = async (domain: string, userId: string): Promise<'active' | 'finalizing' | 'settled'> => {
    if (store.query(sessionDomain.query.DomainQuery(domain))) {
      return store.query(sessionDomain.query.FinalizingPresenceQuery(domain)) ? 'finalizing' : 'active'
    }
    const stored = (await presenceStore.load(domain)) ?? { domain, lastJoinedAt: 0, observers: [] }
    const unsettledEnd = stored.pendingEnd ?? stored.inflightEnd
    const finalEnd = stored.settledEnd ?? unsettledEnd
    if (finalEnd && finalEnd.userId !== userId) {
      throw new Error('Runtime pending presence belongs to another user')
    }
    if (stored.settledEnd) {
      const { inflightEnd: _inflightEnd, pendingEnd: _pendingEnd, settledEnd: _settledEnd, ...record } = stored
      await presenceStore.save(record)
      store.send(sessionDomain.command.HydratePresenceCommand(record))
      return 'settled'
    }
    if (unsettledEnd) {
      store.send(sessionDomain.command.HydratePresenceCommand(stored))
      return 'finalizing'
    }
    const local =
      stored.local?.userId === userId
        ? stored.local
        : {
            presenceId: nanoid(),
            userId,
            joinedAt: Math.max(clock.now(), stored.lastJoinedAt + 1),
            status: 'pending' as const
          }
    const record = {
      ...stored,
      domain,
      lastJoinedAt: Math.max(stored.lastJoinedAt, local.joinedAt),
      local
    }
    await presenceStore.save(record)
    store.send(sessionDomain.command.HydratePresenceCommand(record))
    return 'active'
  }
  const pageBridges = [
    store.subscribeEvent(sessionDomain.event.RuntimeSessionChangedEvent, (event) => {
      const pageIds = store.query(lifecycleDomain.query.DomainLeaseQuery(event.domain))?.pageIds ?? []
      void pagePort.emitSessionEvent(pageIds, event)
    }),
    store.subscribeEvent(worldDomain.event.PresenceChangedEvent, (event) => {
      const committed = new Set(store.query(sessionDomain.query.DomainsQuery()).map((runtime) => runtime.domain))
      const pageIds = store
        .query(lifecycleDomain.query.DomainLeasesQuery())
        .filter((lease) => committed.has(lease.domain))
        .flatMap((lease) => lease.pageIds)
      void pagePort.emitWorldPresence(pageIds, event)
    }),
    store.subscribeEvent(connectionDomain.event.ErrorEvent, (error) => {
      const pageIds = store.query(lifecycleDomain.query.DomainLeasesQuery()).flatMap((lease) => lease.pageIds)
      void pagePort.emitError(pageIds, error)
    })
  ]

  const runConnectionOperation = <T>(
    operationId: string,
    command: RemeshAction,
    select: (result: ConnectionOperationSucceeded) => T,
    cancelledResult: () => T
  ): Promise<T> =>
    new Promise<T>((resolve, reject) => {
      const dispose = () => {
        success.unsubscribe()
        failure.unsubscribe()
        cancelled.unsubscribe()
      }
      const success = store.subscribeEvent(connectionDomain.event.OperationSucceededEvent, (result) => {
        if (result.operationId !== operationId) return
        dispose()
        resolve(select(result))
      })
      const failure = store.subscribeEvent(connectionDomain.event.OperationFailedEvent, (result) => {
        if (result.operationId !== operationId) return
        dispose()
        reject(result.error)
      })
      const cancelled = store.subscribeEvent(connectionDomain.event.OperationCancelledEvent, (result) => {
        if (result.operationId !== operationId) return
        dispose()
        resolve(cancelledResult())
      })
      store.send(command)
    })

  const runSessionOperation = <T>(
    operationId: string,
    command: RemeshAction,
    select: (result: SessionOperationSucceeded) => T
  ): Promise<T> =>
    new Promise<T>((resolve, reject) => {
      const success = store.subscribeEvent(sessionDomain.event.OperationSucceededEvent, (result) => {
        if (result.operationId !== operationId) return
        success.unsubscribe()
        failure.unsubscribe()
        resolve(select(result))
      })
      const failure = store.subscribeEvent(sessionDomain.event.OperationFailedEvent, (result) => {
        if (result.operationId !== operationId) return
        success.unsubscribe()
        failure.unsubscribe()
        reject(result.error)
      })
      store.send(command)
    })

  const completeInterruptedRelease = (domain: string): Promise<void> =>
    new Promise<void>((resolve, reject) => {
      const success = store.subscribeEvent(connectionDomain.event.ConnectionLeftEvent, (event) => {
        if (event.domain !== domain) return
        success.unsubscribe()
        failure.unsubscribe()
        resolve()
      })
      const failure = store.subscribeEvent(sessionDomain.event.DomainReleaseFailedEvent, (event) => {
        if (event.domain !== domain) return
        success.unsubscribe()
        failure.unsubscribe()
        reject(event.error)
      })
      store.send(connectionDomain.command.LeaveDomainCommand(domain))
    })

  const assertLivePresence = (domain: string) => {
    if (store.query(sessionDomain.query.FinalizingPresenceQuery(domain))) {
      throw new Error('Runtime presence is completing its final release')
    }
  }

  const server: RuntimeServer = {
    attachPage: async (payload) => {
      store.send(lifecycleDomain.command.AttachPageCommand(payload))
      return snapshot()
    },
    detachPage: async (payload) => {
      pagePort.removePage(payload.pageId)
      store.send(lifecycleDomain.command.DetachPageCommand(payload))
    },
    getSnapshot: async () => snapshot(),
    joinChatRoom: async (payload) => {
      const presenceState = await acquirePresence(payload.domain, payload.user.id)
      if (presenceState === 'settled') throw new Error(INTERRUPTED_RELEASE_COMPLETED)
      if (presenceState === 'active' || !store.query(sessionDomain.query.DomainQuery(payload.domain))) {
        const operationId = nanoid()
        const committed = await runConnectionOperation(
          operationId,
          connectionDomain.command.JoinDomainCommand({ operationId, ...payload }),
          () => true,
          () => false
        )
        if (!committed) return null
      }
      if (presenceState === 'finalizing') {
        await completeInterruptedRelease(payload.domain)
        throw new Error(INTERRUPTED_RELEASE_COMPLETED)
      }
      return snapshot()
    },
    leaveChatRoom: async ({ domain }) => {
      store.send(connectionDomain.command.LeaveDomainCommand(domain))
    },
    allocateTextMessage: async (payload) => {
      assertLivePresence(payload.domain)
      const operationId = nanoid()
      return runSessionOperation(
        operationId,
        sessionDomain.command.AllocateTextMessageCommand({ operationId, ...payload }),
        (result) => {
          if (result.record?.message.type !== 'text') throw new Error('Runtime returned an invalid text record')
          return result.record as TextMessageRecord
        }
      )
    },
    allocateReactionMessage: async (payload) => {
      assertLivePresence(payload.domain)
      const operationId = nanoid()
      return runSessionOperation(
        operationId,
        sessionDomain.command.AllocateReactionMessageCommand({ operationId, ...payload }),
        (result) => {
          if (result.record?.message.type !== 'reaction') throw new Error('Runtime returned an invalid reaction record')
          return result.record as ReactionMessageRecord
        }
      )
    },
    sendChatMessage: async (payload) => {
      assertLivePresence(payload.domain)
      const operationId = nanoid()
      await runSessionOperation(
        operationId,
        sessionDomain.command.SendChatMessageCommand({ operationId, ...payload }),
        () => undefined
      )
    },
    ackInbound: async (payload) => {
      store.send(deliveryDomain.command.AckInboundCommand(payload))
    },
    replayInbound: async (payload) => store.query(deliveryDomain.query.BufferedEventsQuery(payload)),
    reconnectDomain: async (payload) => {
      const operationId = nanoid()
      return runConnectionOperation(
        operationId,
        connectionDomain.command.ReconnectDomainCommand({ operationId, ...payload }),
        () => undefined,
        () => null
      )
    },
    onInbound: async (payload, callback) => pagePort.onInbound(payload.pageId, callback),
    onSessionEvent: async (payload, callback) => pagePort.onSessionEvent(payload.pageId, callback),
    onWorldPresence: async (payload, callback) => pagePort.onWorldPresence(payload.pageId, callback),
    onError: async (payload, callback) => pagePort.onError(payload.pageId, callback),
    provideHistory: async (payload, callback) => pagePort.provideHistory(payload.pageId, payload.domain, callback),
    resolveHistorySupply: async (payload) =>
      pagePort.resolveHistorySupply(payload.pageId, payload.supplyId, payload.result),
    rejectHistorySupply: async (payload) =>
      pagePort.rejectHistorySupply(payload.pageId, payload.supplyId, payload.reason)
  }

  serverDisposers.set(server, () => {
    pageBridges.forEach((subscription) => subscription.unsubscribe())
    try {
      store.discard()
    } finally {
      try {
        pagePort.dispose()
      } finally {
        try {
          config.transport.dispose()
        } finally {
          serverDisposers.delete(server)
        }
      }
    }
  })
  return server
}

export { getChatRoomId, getWorldRoomId }
