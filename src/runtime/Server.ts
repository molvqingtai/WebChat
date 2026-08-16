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
import { MESSAGE_TYPE, NativeWireCodec, type TextMessage, type WireCodec } from '@/protocol'
import type { ChatSite, ChatUser } from '@/protocol'
import type { RuntimeServer, RuntimeSnapshot } from '@/runtime/Contract'
import { PagePort, createPagePortImpl } from '@/runtime/PagePort'
import { createBoundedPresenceStore, createMemoryPresenceStore } from '@/runtime/PresenceStore'

export interface ServerConfig {
  transport: RoomTransport
  clock?: Clock
  codec?: WireCodec
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
  const connectionOptions = {
    hostId: nanoid(),
    worldSessionId
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
  const historyAction = HistoryDomain()
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
  const historyDomain = store.getDomain(historyAction)
  const connectionDomain = store.getDomain(connectionAction)
  store.send(lifecycleDomain.command.HostReadyCommand())

  interface PresenceRecovery {
    attempts: number
    promise: Promise<void>
    resolve: () => void
  }

  const presenceRecoveries = new Map<string, PresenceRecovery>()
  const pendingConnectionCancellations = new Set<() => void>()
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
      let settled = false
      const dispose = () => {
        success.unsubscribe()
        failure.unsubscribe()
        cancelled.unsubscribe()
        pendingConnectionCancellations.delete(cancelPending)
      }
      const cancelPending = () => {
        if (settled) return
        settled = true
        dispose()
        reject(operationCancelled())
      }
      const success = store.subscribeEvent(connectionDomain.event.OperationSucceededEvent, (result) => {
        if (result.operationId !== operationId || settled) return
        settled = true
        dispose()
        resolve(select(result))
      })
      const failure = store.subscribeEvent(connectionDomain.event.OperationFailedEvent, (result) => {
        if (result.operationId !== operationId || settled) return
        settled = true
        dispose()
        reject(result.error)
      })
      const cancelled = store.subscribeEvent(connectionDomain.event.OperationCancelledEvent, (result) => {
        if (result.operationId !== operationId || settled) return
        settled = true
        dispose()
        resolve(cancelledResult())
      })
      pendingConnectionCancellations.add(cancelPending)
      if (disposed) {
        cancelPending()
        return
      }
      try {
        store.send(command)
      } catch (error) {
        if (settled) return
        settled = true
        dispose()
        reject(error)
      }
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

  const runTextAcceptanceOperation = (operationId: string, command: RemeshAction): Promise<TextMessage> =>
    new Promise<TextMessage>((resolve, reject) => {
      const accepted = store.subscribeEvent(sessionDomain.event.TextMessageAcceptedEvent, (result) => {
        if (result.operationId !== operationId) return
        accepted.unsubscribe()
        failure.unsubscribe()
        resolve(result.message)
      })
      const failure = store.subscribeEvent(sessionDomain.event.OperationFailedEvent, (result) => {
        if (result.operationId !== operationId) return
        accepted.unsubscribe()
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

  /** One shared in-flight settlement per domain: overlapping release requests share it. */
  const inFlightReleases = new Map<string, Promise<void>>()

  /**
   * Manual-refresh destruction phase: destroys the complete current-domain connection aggregate,
   * awaits the cleared-observer persistence settlement, then awaits the domain's History work
   * physically settling. Returns the captured local identity for the replacement attempt.
   */
  // The active local logical identity captured at reset time; reused by a retry after a failed
  // reset persistence (the committed aggregate is already gone), and retired on full release.
  const refreshIdentity = new Map<string, { user: ChatUser; site: ChatSite }>()
  store.subscribeEvent(connectionDomain.event.ConnectionLeftEvent, (event) => {
    refreshIdentity.delete(event.domain)
  })
  /** One shared in-flight reset settlement per domain: concurrent refreshes join the same owner. */
  const inFlightResets = new Map<string, Promise<{ ok: boolean; user?: ChatUser; site?: ChatSite }>>()
  const performReset = async (domain: string, operationId: string) => {
    const runtime = store.query(sessionDomain.query.DomainQuery(domain))
    const retainedSeed = store.query(sessionDomain.query.RetainedLocalSeedQuery(domain))

    if (!runtime && !retainedSeed) {
      // Released domain with nothing to destroy: the canonical attempt is a no-op.
      return { ok: true, ...refreshIdentity.get(domain) }
    }
    if (runtime) refreshIdentity.set(domain, { user: runtime.user, site: runtime.site })
    // A retry after a failed persistence must re-honor the clear save even though the committed
    // aggregate is already gone; the destruction is idempotent and re-emits the correlated save.
    const persistence = new Promise<boolean>((resolve) => {
      const subscription = store.subscribeEvent(sessionDomain.event.PresencePersistenceSettledEvent, (event) => {
        if (event.requestId !== operationId) return
        subscription.unsubscribe()
        resolve(event.error === undefined)
      })
    })
    store.send(connectionDomain.command.DestroyDomainConnectionCommand({ domain, operationId }))
    const settled = await persistence
    if (!settled) return { ok: false }
    // Active History supplies/jobs physically settle through their abort callbacks; the
    // replacement may bind new History work only after every old owner is gone. Yielding on the
    // macrotask queue lets abort callbacks and timers run; no busy loop is introduced.
    while (!store.query(historyDomain.query.DomainCleanupSettledQuery(domain))) {
      await new Promise<void>((resolve) => setTimeout(resolve, 0))
    }
    return { ok: true, ...refreshIdentity.get(domain) }
  }
  const resetDomainConnection = (
    domain: string,
    operationId: string
  ): Promise<{ ok: boolean; user?: ChatUser; site?: ChatSite }> => {
    const existing = inFlightResets.get(domain)
    if (existing) return existing
    const task = performReset(domain, operationId)
    inFlightResets.set(domain, task)
    const releaseReset = () => {
      if (inFlightResets.get(domain) === task) inFlightResets.delete(domain)
    }
    void task.then(releaseReset, releaseReset)
    return task
  }

  const completeInterruptedRelease = (domain: string): Promise<void> => {
    // Idempotent completed release: no runtime, no join attempt, and no current fence.
    if (
      !store.query(sessionDomain.query.DomainQuery(domain)) &&
      !store.query(connectionDomain.query.AttemptsQuery()).some((item) => item.domain === domain) &&
      !store.query(sessionDomain.query.ReleasingDomainQuery(domain))
    ) {
      return Promise.resolve()
    }
    const inFlight = inFlightReleases.get(domain)
    if (inFlight) return inFlight
    const task = new Promise<void>((resolve, reject) => {
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
    inFlightReleases.set(domain, task)
    const releaseDeparture = () => {
      if (inFlightReleases.get(domain) === task) inFlightReleases.delete(domain)
    }
    void task.then(releaseDeparture, releaseDeparture)
    return task
  }

  /** One shared in-flight join settlement per domain: overlapping same-domain joins coalesce. */
  const inFlightJoins = new Map<string, Promise<Awaited<ReturnType<typeof snapshot>> | null>>()

  const joinChatRoomSettled = async (payload: Parameters<RuntimeServer['joinChatRoom']>[0]) => {
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
          // A lease observed after the release fence started never bypasses the shared release:
          // it waits for the one live release owner to close, then starts fresh through the loop.
          if (store.query(sessionDomain.query.ReleasingDomainQuery(payload.domain))) {
            await completeInterruptedRelease(payload.domain)
            continue
          }
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
  }

  /** One shared in-flight reconnect settlement per domain: a concurrent refresh joins the whole
   * operation (destruction through the replacement commit/failure/cancel) instead of running a
   * second destructive reset against an in-flight replacement. */
  const inFlightReconnects = new Map<string, Promise<undefined | null>>()
  const performReconnect = async (domain: string, operationId: string): Promise<undefined | null> => {
    // Phase 1: correlated destruction of the complete current-domain connection aggregate. The
    // cleared-observer persistence must settle and the domain's History work must physically
    // settle before the replacement may prepare; a persistence rejection fails the request
    // retryably without committing a mixed old/new snapshot.
    const reset = await resetDomainConnection(domain, operationId)
    if (!reset.ok) {
      return runConnectionOperation(
        operationId,
        connectionDomain.command.FailOperationCommand({
          operationId,
          error: new Error('Domain connection reset persistence failed')
        }),
        () => undefined,
        () => null
      )
    }
    // Phase 2: the canonical replacement attempt, seeded with the captured local identity.
    return runConnectionOperation(
      operationId,
      connectionDomain.command.ReconnectDomainCommand({
        operationId,
        domain,
        user: reset.user,
        site: reset.site
      }),
      () => undefined,
      () => null
    )
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
    joinChatRoom: (payload) => {
      // Overlapping same-domain joins observed while the domain's release is closing coalesce into
      // one shared settlement; fresh cold joins keep the existing newest-generation supersession.
      if (store.query(sessionDomain.query.ReleasingDomainQuery(payload.domain))) {
        const existing = inFlightJoins.get(payload.domain)
        if (existing) return existing
        const task = joinChatRoomSettled(payload)
        inFlightJoins.set(payload.domain, task)
        const releaseJoin = () => {
          if (inFlightJoins.get(payload.domain) === task) inFlightJoins.delete(payload.domain)
        }
        void task.then(releaseJoin, releaseJoin)
        return task
      }
      return joinChatRoomSettled(payload)
    },
    leaveChatRoom: async ({ domain }) => {
      // The leave resolves only after physical departure and rejects with the exact
      // DomainReleaseFailedEvent when the active-record cleanup write fails.
      await completeInterruptedRelease(domain)
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
      const command = sessionDomain.command.SendChatMessageCommand({ operationId, ...payload })
      if (payload.event.type === MESSAGE_TYPE.TEXT) {
        return runTextAcceptanceOperation(operationId, command)
      }
      await runSessionOperation(operationId, command, () => undefined)
      return payload.event
    },
    ackInbound: async (payload) => {
      store.send(deliveryDomain.command.AckInboundCommand(payload))
    },
    replayInbound: async (payload) => store.query(deliveryDomain.query.BufferedEventsQuery(payload)),
    reconnectDomain: (payload) => {
      const existing = inFlightReconnects.get(payload.domain)
      if (existing) return existing
      // An accepted ready-state activation also starts the independently fenced World replacement
      // alongside the Domain child: it is never awaited, never changes the Domain result or the
      // button/loading/completion/error UI, and coalesces into the one current World operation
      // (automatic recovery or a prior manual replacement). It fires only when the Domain refresh
      // itself is admissible (a committed runtime or retained seed); pre-ready Retry never reaches
      // here and starts no World replacement.
      if (
        store.query(sessionDomain.query.DomainQuery(payload.domain)) ||
        store.query(sessionDomain.query.RetainedLocalSeedQuery(payload.domain))
      ) {
        store.send(connectionDomain.command.RefreshWorldCommand())
      }
      const operationId = nanoid()
      const task = performReconnect(payload.domain, operationId)
      inFlightReconnects.set(payload.domain, task)
      const releaseReconnect = () => {
        if (inFlightReconnects.get(payload.domain) === task) inFlightReconnects.delete(payload.domain)
      }
      void task.then(releaseReconnect, releaseReconnect)
      return task
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
    ;[...pendingConnectionCancellations].forEach((cancel) => cancel())
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
