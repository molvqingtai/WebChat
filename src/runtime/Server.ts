import { Remesh, type RemeshAction, type RemeshStore, type RemeshSubscribeOnlyEvent } from 'remesh'
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

  interface PresenceRecovery {
    attempts: number
    promise: Promise<void>
    resolve: () => void
  }

  const presenceRecoveries = new Map<string, PresenceRecovery>()
  let disposed = false

  const beginPresenceRecovery = (domain: string) => {
    const current = presenceRecoveries.get(domain)
    if (current) {
      current.attempts += 1
      return current
    }
    let resolve = () => {}
    const promise = new Promise<void>((onResolve) => {
      resolve = onResolve
    })
    const recovery = { attempts: 1, promise, resolve }
    presenceRecoveries.set(domain, recovery)
    return recovery
  }

  const finishPresenceRecovery = (domain: string, recovery: PresenceRecovery, succeeded: boolean) => {
    if (presenceRecoveries.get(domain) !== recovery) return
    recovery.attempts -= 1
    if (!succeeded && recovery.attempts > 0) return
    presenceRecoveries.delete(domain)
    recovery.resolve()
  }

  const operationCancelled = () => new DOMException('Runtime presence is completing its final release', 'AbortError')

  const waitForLivePresence = async (domain: string) => {
    if (disposed) throw operationCancelled()
    const recovery = presenceRecoveries.get(domain)
    if (!recovery) {
      if (store.query(sessionDomain.query.FinalizingPresenceQuery(domain))) throw operationCancelled()
      return
    }
    await recovery.promise
    if (
      disposed ||
      store.query(sessionDomain.query.FinalizingPresenceQuery(domain)) ||
      !store.query(sessionDomain.query.DomainQuery(domain))
    ) {
      throw operationCancelled()
    }
  }

  const snapshot = (): RuntimeSnapshot => store.query(connectionDomain.query.SnapshotQuery())
  const acquirePresence = async (domain: string, userId: string): Promise<'active' | 'acquired' | 'finalizing'> => {
    if (store.query(sessionDomain.query.DomainQuery(domain))) {
      return store.query(sessionDomain.query.FinalizingPresenceQuery(domain)) ? 'finalizing' : 'active'
    }
    // No durable end journal: a rejoin always acquires the durable local lease or a fresh one and
    // hydrates the current generation. An in-memory release fenced the domain only for this generation.
    const stored = (await presenceStore.load(domain)) ?? { domain, lastJoinedAt: 0, observers: [] }
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
    return 'acquired'
  }
  const acquireCurrentPresence = async (
    domain: string,
    userId: string
  ): Promise<'active' | 'acquired' | 'finalizing'> => {
    while (!disposed) {
      const acquired = await acquirePresence(domain, userId)
      if (store.query(sessionDomain.query.FinalizingPresenceQuery(domain))) return 'finalizing'
      if (store.query(sessionDomain.query.DomainQuery(domain))) return 'active'
      if (acquired === 'acquired') return 'acquired'
    }
    throw operationCancelled()
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
    store.subscribeEvent(connectionDomain.event.ErrorEvent, ({ error, domain }) => {
      const leases = store.query(lifecycleDomain.query.DomainLeasesQuery())
      const pageIds = domain
        ? (leases.find((lease) => lease.domain === domain)?.pageIds ?? [])
        : leases.flatMap((lease) => lease.pageIds)
      if (pageIds.length === 0) {
        console.error('[WebChat] Runtime failure without a current affected page:', error)
        return
      }
      void pagePort.emitError(pageIds, {
        eventId: nanoid(),
        message: error.message,
        subsystem: 'connection',
        operation: 'lifecycle',
        scope: domain
      })
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

  /** Typed allocation runner: the exact record variant is carried by a typed success event. */
  const runAllocationOperation = <TRecord>(
    operationId: string,
    command: RemeshAction,
    successEvent: RemeshSubscribeOnlyEvent<
      [{ operationId: string; record: TRecord }],
      { operationId: string; record: TRecord }
    >
  ): Promise<TRecord> =>
    new Promise<TRecord>((resolve, reject) => {
      const success = store.subscribeEvent(successEvent, (result) => {
        if (result.operationId !== operationId) return
        success.unsubscribe()
        failure.unsubscribe()
        resolve(result.record)
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
      // Typed ChatUser/ChatSite values pass through unchanged; the application-to-protocol
      // mapping already happened before the value was narrowed to the schema-owned type.
      const recovery = beginPresenceRecovery(payload.domain)
      let recovered = false
      try {
        const connect = () => {
          const operationId = nanoid()
          return runConnectionOperation(
            operationId,
            connectionDomain.command.JoinDomainCommand({ operationId, ...payload }),
            () => true,
            () => false
          )
        }
        while (true) {
          const presenceState = await acquireCurrentPresence(payload.domain, payload.user.id)
          if (presenceState === 'finalizing') {
            if (!store.query(sessionDomain.query.DomainQuery(payload.domain))) {
              if (!(await connect())) return null
              continue
            }
            await completeInterruptedRelease(payload.domain)
            continue
          }
          if (store.query(sessionDomain.query.FinalizingPresenceQuery(payload.domain))) {
            await completeInterruptedRelease(payload.domain)
            continue
          }
          if (presenceState === 'active' && !store.query(sessionDomain.query.DomainQuery(payload.domain))) {
            continue
          }
          if (!(await connect())) return null
          recovered = true
          return snapshot()
        }
      } finally {
        finishPresenceRecovery(payload.domain, recovery, recovered)
      }
    },
    leaveChatRoom: async ({ domain }) => {
      store.send(connectionDomain.command.LeaveDomainCommand(domain))
    },
    allocateTextMessage: async (payload) => {
      await waitForLivePresence(payload.domain)
      const operationId = nanoid()
      return runAllocationOperation(
        operationId,
        sessionDomain.command.AllocateTextMessageCommand({ operationId, ...payload }),
        sessionDomain.event.TextMessageAllocatedEvent
      )
    },
    allocateReactionMessage: async (payload) => {
      await waitForLivePresence(payload.domain)
      const operationId = nanoid()
      return runAllocationOperation(
        operationId,
        sessionDomain.command.AllocateReactionMessageCommand({ operationId, ...payload }),
        sessionDomain.event.ReactionMessageAllocatedEvent
      )
    },
    sendChatMessage: async (payload) => {
      await waitForLivePresence(payload.domain)
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
    onHistoryFeedback: async (payload, callback) => pagePort.onHistoryFeedback(payload.pageId, callback),
    provideHistory: async (payload, callback) => pagePort.provideHistory(payload.pageId, payload.domain, callback),
    resolveHistorySupply: async (payload) =>
      pagePort.resolveHistorySupply(payload.pageId, payload.supplyId, payload.result),
    rejectHistorySupply: async (payload) =>
      pagePort.rejectHistorySupply(payload.pageId, payload.supplyId, payload.reason)
  }

  serverDisposers.set(server, () => {
    disposed = true
    presenceRecoveries.forEach((recovery) => recovery.resolve())
    presenceRecoveries.clear()
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
