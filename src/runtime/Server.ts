import { Remesh, type RemeshAction, type RemeshStore, type RemeshSubscribeOnlyEvent } from 'remesh'
import { nanoid } from 'nanoid'
import ConnectionDomain, { type ConnectionOperationSucceeded } from '@/domain/runtime/Connection'
import DeliveryDomain from '@/domain/runtime/Delivery'
import HistoryDomain from '@/domain/runtime/History'
import LifecycleDomain from '@/domain/runtime/Lifecycle'
import SessionDomain, { getChatRoomId, type SessionOperationSucceeded } from '@/domain/runtime/Session'
import WireDomain from '@/domain/runtime/Wire'
import WorldDomain, { getWorldRoomId } from '@/domain/runtime/World'
import {
  CommitCapabilityExtern,
  createCommitCapability,
  type CommitCapability
} from '@/domain/runtime/externs/CommitCapability'
import { ClockExtern, type Clock } from '@/domain/runtime/externs/Clock'
import { IdentityExtern } from '@/domain/runtime/externs/Identity'
import { PresenceStoreExtern, type PresenceStore } from '@/domain/runtime/externs/PresenceStore'
import { RoomTransportExtern, WireCodecExtern } from '@/domain/runtime/externs/RoomTransport'
import type { RoomTransport } from '@/runtime/RoomTransport'
import { MESSAGE_TYPE, NativeWireCodec, type TextMessage, type WireCodec } from '@/protocol'
import type { ChatSite, ChatUser } from '@/protocol'
import type { RuntimePageCall, RuntimeServer, RuntimeSnapshot, RuntimeTab } from '@/runtime/Contract'
import { PagePort, createPagePortImpl } from '@/runtime/PagePort'
import { createBoundedPresenceStore, createMemoryPresenceStore } from '@/runtime/PresenceStore'
import { canonicalNavigationUrl, isEligibleContentUrl, isSameNavigation } from '@/service/adapter/runtime/Navigation'

export const RUNTIME_PAGE_BINDINGS_KEY = 'WEB_CHAT_RUNTIME_PAGE_BINDINGS_V1'

export interface RuntimePageStorage {
  get: (key: string) => Promise<Record<string, unknown>>
  set: (items: Record<string, unknown>) => Promise<void>
}

export interface RuntimeTabsApi {
  get: (tabId: number) => Promise<RuntimeTab>
  sendMessage: (tabId: number, message: unknown) => Promise<unknown>
}

export interface RuntimeAdmission {
  tabs: RuntimeTabsApi
  storage: RuntimePageStorage
  /** Re-establishes only a surviving Page's callback registrations after a fresh Background. */
  rebindPage: (tabId: number, pageId: string) => Promise<void>
  /** Reconciles a surviving Background with a restarted Offscreen transport before Page ingress. */
  ensureTransport: () => Promise<void>
}

export interface ServerConfig {
  transport: RoomTransport
  clock?: Clock
  codec?: WireCodec
  presenceStore?: PresenceStore
  /** Omitted only by isolated domain/server tests. Production always supplies Browser admission. */
  admission?: RuntimeAdmission
}

interface PageBinding {
  /** Opaque allocation identity; tuple fields below are validation facts only. */
  id: string
  tabId: number
  pageId: string
  domain: string
  url: string
  sessionGeneration: number | null
  callbacks: Set<PageCallbackKind>
}

type PageCallbackKind = 'inbound' | 'session' | 'error' | 'history' | 'historyFeedback'

const requiredPageCallbacks: readonly PageCallbackKind[] = ['inbound', 'session', 'error', 'history', 'historyFeedback']

interface PersistedPageBindings {
  pages: Array<Pick<PageBinding, 'tabId' | 'pageId' | 'domain' | 'url'>>
}

const defaultClock: Clock = { now: () => Date.now() }
const serverDisposers = new WeakMap<RuntimeServer, () => void>()
interface ServerControl {
  restorePageBindings: () => Promise<void>
  removeTab: (tabId: number, url?: string) => Promise<void>
}
const serverControls = new WeakMap<RuntimeServer, ServerControl>()

export const disposeServer = (server: RuntimeServer) => serverDisposers.get(server)?.()
export const restoreServerPageBindings = (server: RuntimeServer) =>
  serverControls.get(server)?.restorePageBindings() ?? Promise.resolve()
export const removeServerTab = (server: RuntimeServer, tabId: number, url?: string) =>
  serverControls.get(server)?.removeTab(tabId, url) ?? Promise.resolve()

export const createServer = (config: ServerConfig): RuntimeServer => {
  const clock = config.clock ?? defaultClock
  const pagePort = new PagePort()
  const presenceStore = config.presenceStore
    ? createBoundedPresenceStore(config.presenceStore)
    : createMemoryPresenceStore()
  const worldSessionId = nanoid()
  const commitCapabilities = new Map<string, CommitCapability>()
  const capabilityBindings = new Map<string, PageBinding | null>()
  const connectionOptions = {
    hostId: nanoid(),
    worldSessionId
  }

  const store: RemeshStore = Remesh.store({
    externs: [
      ClockExtern.impl(clock),
      IdentityExtern.impl({ nextId: nanoid }),
      PresenceStoreExtern.impl(presenceStore),
      CommitCapabilityExtern.impl({ get: (operationId) => commitCapabilities.get(operationId) }),
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
  const wireDomain = store.getDomain(wireAction)
  const deliveryDomain = store.getDomain(deliveryAction)
  const sessionDomain = store.getDomain(sessionAction)
  const worldDomain = store.getDomain(worldAction)
  const historyDomain = store.getDomain(historyAction)
  const connectionDomain = store.getDomain(connectionAction)
  interface PresenceCohort {
    /** The existing lifecycle release deadline has closed this cohort. */
    closed: true
    cleanup: Promise<void>
  }

  interface PhysicalOperation {
    requestId: string
    terminal: 'pending' | 'success' | 'failure'
    settled: Promise<void>
    resolve: () => void
  }

  const presenceCohorts = new Map<string, PresenceCohort>()
  const pendingPhysicalOperations = new Map<string, Set<PhysicalOperation>>()
  const pendingConnectionCancellations = new Set<() => void>()
  let disposed = false
  const pageBindings = new Map<string, PageBinding>()
  const tabBindings = new Map<number, PageBinding>()
  const rebindHints = new Map<number, PersistedPageBindings['pages'][number]>()
  let bindingPersistTail: Promise<void> = Promise.resolve()

  const isCurrentBinding = (binding: PageBinding) =>
    pageBindings.get(binding.pageId) === binding && tabBindings.get(binding.tabId) === binding

  const bindingReady = (binding: PageBinding) =>
    binding.sessionGeneration !== null &&
    pagePort.isSessionEventActive(binding.pageId, binding.sessionGeneration) &&
    requiredPageCallbacks.every((kind) => binding.callbacks.has(kind))

  const revokeLiveCapabilities = (binding: PageBinding) => {
    capabilityBindings.forEach((candidate, operationId) => {
      if (candidate === binding) commitCapabilities.get(operationId)?.revoke()
    })
  }

  const persistPageBindings = async () => {
    if (!config.admission) return
    const persist = () => {
      const pages = [
        ...pageBindings.values().map(({ tabId, pageId, domain, url }) => ({ tabId, pageId, domain, url })),
        ...[...rebindHints.values()].filter(({ tabId }) => !tabBindings.has(tabId))
      ].sort((left, right) => left.tabId - right.tabId)
      return config.admission!.storage.set({ [RUNTIME_PAGE_BINDINGS_KEY]: { pages } satisfies PersistedPageBindings })
    }
    bindingPersistTail = bindingPersistTail.then(persist, persist)
    await bindingPersistTail
  }

  const browserBindingCurrent = async (binding: PageBinding) => {
    const admission = config.admission
    if (!admission) return true
    const tab = await admission.tabs.get(binding.tabId)
    const url = typeof tab.url === 'string' ? canonicalNavigationUrl(tab.url) : null
    return (
      tab.id === binding.tabId &&
      url !== null &&
      isEligibleContentUrl(url) &&
      new URL(url).origin === binding.domain &&
      isSameNavigation(url, binding.url)
    )
  }

  const removeBinding = async (binding: PageBinding) => {
    if (!isCurrentBinding(binding)) return
    revokeLiveCapabilities(binding)
    pageBindings.delete(binding.pageId)
    tabBindings.delete(binding.tabId)
    pagePort.removePage(binding.pageId)
    store.send(lifecycleDomain.command.DetachPageCommand({ domain: binding.domain, pageId: binding.pageId }))
    await persistPageBindings()
  }

  const requirePageBinding = async (payload: RuntimePageCall, requireSessionCallback: boolean) => {
    const admission = config.admission
    if (!admission) return null
    await admission.ensureTransport()
    const pageId = payload.pageId
    const callerTabId = payload.caller?.tab?.id
    if (!pageId || typeof callerTabId !== 'number' || !Number.isSafeInteger(callerTabId) || callerTabId < 0) {
      throw new Error('Current Page browser caller is required')
    }
    const binding = pageBindings.get(pageId)
    if (!binding || binding.tabId !== callerTabId || payload.runtimeHostId !== snapshot().hostId) {
      throw new Error('Runtime Page binding is no longer current')
    }
    if (requireSessionCallback) {
      if (
        binding.sessionGeneration === null ||
        !pagePort.isSessionEventActive(binding.pageId, binding.sessionGeneration)
      ) {
        throw new Error('Runtime Page session callback is not active')
      }
      if (!requiredPageCallbacks.every((kind) => binding.callbacks.has(kind))) {
        throw new Error('Runtime Page callbacks are not active')
      }
    }
    if (!(await browserBindingCurrent(binding)) || !isCurrentBinding(binding)) {
      await removeBinding(binding)
      throw new Error('Browser tab navigation is no longer current')
    }
    if (requireSessionCallback && !bindingReady(binding)) {
      throw new Error('Runtime Page callbacks are no longer current')
    }
    return binding
  }

  const requireAttachBinding = async (payload: { domain: string; pageId: string } & RuntimePageCall) => {
    const admission = config.admission
    if (!admission) return null
    await admission.ensureTransport()
    const callerTab = payload.caller?.tab
    const tabId = callerTab?.id
    const claimedUrl = callerTab?.url
    if (!Number.isSafeInteger(tabId) || tabId! < 0 || typeof claimedUrl !== 'string') {
      throw new Error('Trusted browser tab metadata is required')
    }
    const current = await admission.tabs.get(tabId!)
    const url = typeof current.url === 'string' ? canonicalNavigationUrl(current.url) : null
    if (
      current.id !== tabId ||
      !url ||
      !isEligibleContentUrl(url) ||
      !isSameNavigation(url, claimedUrl) ||
      new URL(url).origin !== payload.domain
    ) {
      throw new Error('Browser tab navigation is no longer eligible')
    }
    return {
      id: nanoid(),
      tabId: tabId!,
      pageId: payload.pageId,
      domain: payload.domain,
      url,
      sessionGeneration: null,
      callbacks: new Set<PageCallbackKind>()
    }
  }

  const revalidateBinding = async (binding: PageBinding | null, payload: RuntimePageCall, requireSession = true) => {
    if (!binding) return
    if ((await requirePageBinding(payload, requireSession)) !== binding) {
      throw new Error('Runtime Page binding was superseded')
    }
  }

  const installBinding = async (binding: PageBinding) => {
    const previousPage = pageBindings.get(binding.pageId)
    const previousTab = tabBindings.get(binding.tabId)
    if (previousPage) await removeBinding(previousPage)
    if (previousTab && previousTab !== previousPage) await removeBinding(previousTab)
    rebindHints.delete(binding.tabId)
    pageBindings.set(binding.pageId, binding)
    tabBindings.set(binding.tabId, binding)
    store.send(lifecycleDomain.command.AttachPageCommand({ domain: binding.domain, pageId: binding.pageId }))
    await persistPageBindings()
  }

  const operationCancelled = () => new DOMException('Runtime presence is completing its final release', 'AbortError')

  const waitForPhysicalOperations = async (domain: string): Promise<void> => {
    while (true) {
      const pending = pendingPhysicalOperations.get(domain)
      if (!pending?.size) return
      await Promise.all([...pending].map((physical) => physical.settled))
    }
  }

  const waitForLivePresence = async (domain: string) => {
    if (disposed) throw operationCancelled()
    const cohort = presenceCohorts.get(domain)
    if (!cohort) {
      if (store.query(sessionDomain.query.FinalizingPresenceQuery(domain))) throw operationCancelled()
      return
    }
    // A post-close caller waits as its own live continuation.  The cohort never
    // owns this caller's terminal and cannot synthesize an old member outcome.
    await cohort.cleanup
    if (
      disposed ||
      store.query(sessionDomain.query.FinalizingPresenceQuery(domain)) ||
      !store.query(sessionDomain.query.DomainQuery(domain))
    ) {
      throw operationCancelled()
    }
  }

  /** A successor waits for the closed cohort as its own live continuation. */
  const waitForClosedCohort = async (domain: string) => {
    if (disposed) throw operationCancelled()
    const cohort = presenceCohorts.get(domain)
    if (cohort) await cohort.cleanup
    if (disposed) throw operationCancelled()
  }

  const snapshot = (): RuntimeSnapshot => store.query(connectionDomain.query.SnapshotQuery())
  const acquirePresence = async (domain: string, userId: string): Promise<'active' | 'acquired' | 'finalizing'> => {
    if (!store.query(lifecycleDomain.query.DomainLeaseQuery(domain))) return 'finalizing'
    if (store.query(sessionDomain.query.DomainQuery(domain))) {
      return store.query(sessionDomain.query.FinalizingPresenceQuery(domain)) ? 'finalizing' : 'active'
    }
    // No durable end journal: a rejoin always acquires the durable local lease or a fresh one and
    // hydrates the current generation. An in-memory release fenced the domain only for this generation.
    const stored = (await presenceStore.load(domain)) ?? { domain, lastJoinedAt: 0, observers: [] }
    if (!store.query(lifecycleDomain.query.DomainLeaseQuery(domain))) return 'finalizing'
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
    if (!store.query(lifecycleDomain.query.DomainLeaseQuery(domain))) return 'finalizing'
    store.send(sessionDomain.command.HydratePresenceCommand(record))
    return 'acquired'
  }
  const acquireCurrentPresence = async (
    domain: string,
    userId: string
  ): Promise<'active' | 'acquired' | 'finalizing'> => {
    while (!disposed) {
      const acquired = await acquirePresence(domain, userId)
      if (acquired === 'finalizing' || store.query(sessionDomain.query.FinalizingPresenceQuery(domain))) {
        return 'finalizing'
      }
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

  /**
   * Wire exposes physical completion independently from Connection's logical
   * result.  A cancellation therefore leaves this observer alive until the
   * exact issued Q reaches its own terminal.
   */
  const physicalObservers = new Set<() => void>()
  const observeConnectionPhysical = (operationId: string, domain: string) => {
    const expectedRequestId = `connection:join:${operationId}`
    const pending = new Map<string, PhysicalOperation>()
    let logicalTerminal = false
    let released = false
    const dispose = () => {
      if (released) return
      released = true
      requested.unsubscribe()
      succeeded.unsubscribe()
      failed.unsubscribe()
      physicalObservers.delete(dispose)
    }
    const releaseIfTerminal = () => {
      if (logicalTerminal && pending.size === 0) dispose()
    }
    const settle = (requestId: string, terminal: Exclude<PhysicalOperation['terminal'], 'pending'>) => {
      const physical = pending.get(requestId)
      if (!physical || physical.terminal !== 'pending') return
      physical.terminal = terminal
      pending.delete(requestId)
      const byDomain = pendingPhysicalOperations.get(domain)
      byDomain?.delete(physical)
      if (byDomain?.size === 0) pendingPhysicalOperations.delete(domain)
      physical.resolve()
      releaseIfTerminal()
    }
    const requested = store.subscribeEvent(wireDomain.event.JoinRoomsRequestedEvent, (event) => {
      if (event.requestId !== expectedRequestId || pending.has(event.requestId)) return
      let resolve!: () => void
      const physical: PhysicalOperation = {
        requestId: event.requestId,
        terminal: 'pending',
        settled: new Promise<void>((onResolve) => {
          resolve = onResolve
        }),
        resolve
      }
      pending.set(event.requestId, physical)
      const byDomain = pendingPhysicalOperations.get(domain) ?? new Set<PhysicalOperation>()
      byDomain.add(physical)
      pendingPhysicalOperations.set(domain, byDomain)
    })
    const succeeded = store.subscribeEvent(wireDomain.event.RoomsJoinedEvent, (event) =>
      settle(event.requestId, 'success')
    )
    const failed = store.subscribeEvent(wireDomain.event.RoomsJoinFailedEvent, (event) =>
      settle(event.requestId, 'failure')
    )
    physicalObservers.add(dispose)
    return {
      terminal: () => {
        logicalTerminal = true
        releaseIfTerminal()
      }
    }
  }

  const runConnectionExecution = <T>(
    operationId: string,
    domain: string,
    command: RemeshAction,
    select: (result: ConnectionOperationSucceeded) => T,
    cancelledResult: () => T
  ) => {
    const physical = observeConnectionPhysical(operationId, domain)
    const task = runConnectionOperation(operationId, command, select, cancelledResult)
    void task.then(physical.terminal, physical.terminal)
    return task
  }

  const admitConnection = (operationId: string, binding: PageBinding | null) => {
    const capability = createCommitCapability(operationId)
    commitCapabilities.set(operationId, capability)
    capabilityBindings.set(operationId, binding)
    const release = () => {
      capabilityBindings.delete(operationId)
      commitCapabilities.delete(operationId)
    }
    return { capability, release }
  }

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
    const departure = new Promise<void>((resolve, reject) => {
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
    const task = departure.then(() => waitForPhysicalOperations(domain))
    // Lifecycle has already closed the existing grace deadline.  This cohort
    // publishes only that closed fact; it never settles a caller or fabricates
    // completion for an old physical operation.
    const cohort: PresenceCohort = { closed: true, cleanup: task }
    presenceCohorts.set(domain, cohort)
    inFlightReleases.set(domain, task)
    const releaseDeparture = () => {
      if (inFlightReleases.get(domain) === task) inFlightReleases.delete(domain)
      if (presenceCohorts.get(domain) === cohort) presenceCohorts.delete(domain)
    }
    void task.then(releaseDeparture, () => {
      if (inFlightReleases.get(domain) === task) inFlightReleases.delete(domain)
      // A failed physical release remains a closed quarantine; a successor may
      // not treat the rejection as cleanup or start a new ordinary action.
    })
    return task
  }

  /** One shared in-flight join settlement per domain: overlapping same-domain joins coalesce. */
  const inFlightJoins = new Map<string, Promise<Awaited<ReturnType<typeof snapshot>> | null>>()

  const joinChatRoomSettled = async (
    payload: Parameters<RuntimeServer['joinChatRoom']>[0],
    revalidate?: () => Promise<void>,
    binding: PageBinding | null = null
  ) => {
    // Typed ChatUser/ChatSite values pass through unchanged; the application-to-protocol
    // mapping already happened before the value was narrowed to the schema-owned type.
    const connect = async () => {
      if (revalidate) await revalidate()
      const operationId = nanoid()
      const admission = admitConnection(operationId, binding)
      if (!admission.capability.consume()) {
        admission.release()
        return false
      }
      try {
        return await runConnectionExecution(
          operationId,
          payload.domain,
          connectionDomain.command.JoinDomainCommand({ operationId, ...payload }),
          () => true,
          () => false
        )
      } finally {
        admission.release()
      }
    }
    while (true) {
      // This is before load/save/hydrate, so a post-close successor has no
      // durable or Connection effect until the old exact P/M cleanup is done.
      await waitForClosedCohort(payload.domain)
      if (!store.query(lifecycleDomain.query.DomainLeaseQuery(payload.domain))) return null
      if (revalidate) await revalidate()
      const presenceState = await acquireCurrentPresence(payload.domain, payload.user.id)
      if (revalidate) await revalidate()
      if (presenceState === 'finalizing') {
        if (!store.query(lifecycleDomain.query.DomainLeaseQuery(payload.domain))) return null
        // A lease observed after the release fence started never bypasses the shared release:
        // it waits for the one live release owner to close, then starts fresh through the loop.
        if (store.query(sessionDomain.query.ReleasingDomainQuery(payload.domain))) {
          await completeInterruptedRelease(payload.domain)
          continue
        }
        if (!store.query(sessionDomain.query.DomainQuery(payload.domain))) {
          if (revalidate) await revalidate()
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
      if (revalidate) await revalidate()
      if (!(await connect())) return null
      return snapshot()
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
      return runConnectionExecution(
        operationId,
        domain,
        connectionDomain.command.FailOperationCommand({
          operationId,
          error: new Error('Domain connection reset persistence failed')
        }),
        () => undefined,
        () => null
      )
    }
    // Phase 2: the canonical replacement attempt, seeded with the captured local identity.
    return runConnectionExecution(
      operationId,
      domain,
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
      const binding = await requireAttachBinding(payload)
      if (binding) await installBinding(binding)
      else store.send(lifecycleDomain.command.AttachPageCommand(payload))
      return snapshot()
    },
    detachPage: async (payload) => {
      const binding = await requirePageBinding(payload, false)
      if (binding) await removeBinding(binding)
      else {
        pagePort.removePage(payload.pageId)
        store.send(lifecycleDomain.command.DetachPageCommand(payload))
      }
    },
    getSnapshot: async () => snapshot(),
    joinChatRoom: (payload) => {
      const settle = (revalidate?: () => Promise<void>, binding: PageBinding | null = null) => {
        // Overlapping same-domain joins observed while the domain's release is closing coalesce into
        // one shared settlement; fresh cold joins keep the existing newest-generation supersession.
        if (store.query(sessionDomain.query.ReleasingDomainQuery(payload.domain))) {
          const existing = inFlightJoins.get(payload.domain)
          if (existing) return existing
          const task = joinChatRoomSettled(payload, revalidate, binding)
          inFlightJoins.set(payload.domain, task)
          const releaseJoin = () => {
            if (inFlightJoins.get(payload.domain) === task) inFlightJoins.delete(payload.domain)
          }
          void task.then(releaseJoin, releaseJoin)
          return task
        }
        return joinChatRoomSettled(payload, revalidate, binding)
      }
      if (!config.admission) return settle()
      return (async () => {
        const binding = await requirePageBinding(payload, true)
        return settle(() => revalidateBinding(binding, payload), binding)
      })()
    },
    leaveChatRoom: (payload) => {
      // Keep isolated Server/domain tests on the original direct timing. Production takes the
      // admitted branch below, where a caller can never release a successor binding.
      if (!config.admission) return completeInterruptedRelease(payload.domain)
      return (async () => {
        const binding = await requirePageBinding(payload, true)
        await revalidateBinding(binding, payload)
        // The leave resolves only after physical departure and rejects with the exact
        // DomainReleaseFailedEvent when the active-record cleanup write fails.
        await completeInterruptedRelease(payload.domain)
        await revalidateBinding(binding, payload)
      })()
    },
    allocateTextMessage: async (payload) => {
      const binding = await requirePageBinding(payload, true)
      await revalidateBinding(binding, payload)
      await waitForLivePresence(payload.domain)
      await revalidateBinding(binding, payload)
      const operationId = nanoid()
      return runAllocationOperation(
        operationId,
        sessionDomain.command.AllocateTextMessageCommand({ operationId, ...payload }),
        sessionDomain.event.TextMessageAllocatedEvent
      )
    },
    allocateReactionMessage: async (payload) => {
      const binding = await requirePageBinding(payload, true)
      await revalidateBinding(binding, payload)
      await waitForLivePresence(payload.domain)
      await revalidateBinding(binding, payload)
      const operationId = nanoid()
      return runAllocationOperation(
        operationId,
        sessionDomain.command.AllocateReactionMessageCommand({ operationId, ...payload }),
        sessionDomain.event.ReactionMessageAllocatedEvent
      )
    },
    sendChatMessage: async (payload) => {
      const binding = await requirePageBinding(payload, true)
      await revalidateBinding(binding, payload)
      await waitForLivePresence(payload.domain)
      await revalidateBinding(binding, payload)
      const operationId = nanoid()
      const command = sessionDomain.command.SendChatMessageCommand({ operationId, ...payload })
      if (payload.event.type === MESSAGE_TYPE.TEXT) {
        return runTextAcceptanceOperation(operationId, command)
      }
      await runSessionOperation(operationId, command, () => undefined)
      return payload.event
    },
    ackInbound: async (payload) => {
      const binding = await requirePageBinding(payload, true)
      await revalidateBinding(binding, payload)
      store.send(deliveryDomain.command.AckInboundCommand(payload))
    },
    replayInbound: async (payload) => {
      await requirePageBinding(payload, true)
      return store.query(deliveryDomain.query.BufferedEventsQuery(payload))
    },
    reconnectDomain: async (payload) => {
      const binding = await requirePageBinding(payload, true)
      await revalidateBinding(binding, payload)
      const existing = inFlightReconnects.get(payload.domain)
      if (existing) return existing
      const operationId = nanoid()
      const admission = admitConnection(operationId, binding)
      // K is consumed synchronously before either the Domain reset or its World companion can
      // start. Replacement after this point cannot rewrite this operation's real terminal.
      if (!admission.capability.consume()) {
        admission.release()
        return null
      }
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
      const task = performReconnect(payload.domain, operationId)
      inFlightReconnects.set(payload.domain, task)
      const releaseReconnect = () => {
        if (inFlightReconnects.get(payload.domain) === task) inFlightReconnects.delete(payload.domain)
      }
      void task.then(releaseReconnect, releaseReconnect)
      try {
        return await task
      } finally {
        admission.release()
      }
    },
    onInbound: async (payload, callback) => {
      const binding = await requirePageBinding(payload, false)
      pagePort.onInbound(payload.pageId, callback)
      binding?.callbacks.add('inbound')
    },
    onSessionEvent: async (payload, callback) => {
      const binding = await requirePageBinding(payload, false)
      const generation = pagePort.beginSessionEvent(payload.pageId, callback)
      if (binding) binding.sessionGeneration = null
      const lease = store
        .query(lifecycleDomain.query.DomainLeasesQuery())
        .find((candidate) => candidate.pageIds.includes(payload.pageId))
      if (!lease) {
        pagePort.cancelSessionEvent(payload.pageId, generation)
        return
      }
      const runtime = snapshot().domains.find((candidate) => candidate.domain === lease.domain)
      try {
        await callback({
          type: 'snapshot',
          domain: lease.domain,
          snapshot: {
            ...(runtime?.localSession ? { localSession: runtime.localSession } : {}),
            sessions: runtime?.sessions ?? []
          },
          provenance: 'refresh'
        })
        const current = store
          .query(lifecycleDomain.query.DomainLeasesQuery())
          .find((candidate) => candidate.domain === lease.domain)
        const currentBinding = await requirePageBinding(payload, false).catch(() => null)
        if (
          !current?.pageIds.includes(payload.pageId) ||
          currentBinding !== binding ||
          !(await pagePort.activateSessionEvent(payload.pageId, generation))
        ) {
          pagePort.cancelSessionEvent(payload.pageId, generation)
        } else if (binding) {
          binding.sessionGeneration = generation
          binding.callbacks.add('session')
        }
      } catch (error) {
        pagePort.cancelSessionEvent(payload.pageId, generation)
        if (binding) await removeBinding(binding)
        throw error
      }
    },
    onWorldPresence: async (payload, callback) => {
      await requirePageBinding(payload, false)
      pagePort.onWorldPresence(payload.pageId, callback)
    },
    onError: async (payload, callback) => {
      const binding = await requirePageBinding(payload, false)
      pagePort.onError(payload.pageId, callback)
      binding?.callbacks.add('error')
    },
    onHistoryFeedback: async (payload, callback) => {
      const binding = await requirePageBinding(payload, false)
      pagePort.onHistoryFeedback(payload.pageId, callback)
      binding?.callbacks.add('historyFeedback')
    },
    provideHistory: async (payload, callback) => {
      const binding = await requirePageBinding(payload, false)
      pagePort.provideHistory(payload.pageId, payload.domain, callback)
      binding?.callbacks.add('history')
    },
    resolveHistorySupply: async (payload) => {
      await requirePageBinding(payload, true)
      pagePort.resolveHistorySupply(payload.pageId, payload.supplyId, payload.result)
    },
    rejectHistorySupply: async (payload) => {
      await requirePageBinding(payload, true)
      pagePort.rejectHistorySupply(payload.pageId, payload.supplyId, payload.reason)
    }
  }

  const restorePageBindings = async () => {
    const admission = config.admission
    if (!admission) return
    const stored = (await admission.storage.get(RUNTIME_PAGE_BINDINGS_KEY))[RUNTIME_PAGE_BINDINGS_KEY]
    const candidates =
      stored && typeof stored === 'object' && !Array.isArray(stored)
        ? (stored as Partial<PersistedPageBindings>).pages
        : undefined
    if (!Array.isArray(candidates)) return
    const restored: PersistedPageBindings['pages'] = []
    const seenTabs = new Set<number>()
    rebindHints.clear()
    for (const candidate of candidates) {
      if (
        !candidate ||
        !Number.isSafeInteger(candidate.tabId) ||
        candidate.tabId < 0 ||
        typeof candidate.pageId !== 'string' ||
        typeof candidate.domain !== 'string' ||
        typeof candidate.url !== 'string' ||
        seenTabs.has(candidate.tabId)
      ) {
        continue
      }
      try {
        const tab = await admission.tabs.get(candidate.tabId)
        const url = typeof tab.url === 'string' ? canonicalNavigationUrl(tab.url) : null
        if (
          tab.id !== candidate.tabId ||
          !url ||
          !isEligibleContentUrl(url) ||
          new URL(url).origin !== candidate.domain ||
          !isSameNavigation(url, candidate.url)
        ) {
          continue
        }
        seenTabs.add(candidate.tabId)
        const hint = { ...candidate, url }
        restored.push(hint)
        if (!tabBindings.has(candidate.tabId)) rebindHints.set(candidate.tabId, hint)
      } catch {
        // Browser truth is unavailable for this hint. It is never promoted into a Runtime binding.
      }
    }
    await persistPageBindings()
    await Promise.all(
      [...rebindHints.values()].map(({ tabId, pageId }) =>
        admission.rebindPage(tabId, pageId).catch((error) => {
          console.error(error)
        })
      )
    )
  }

  const removeTab = async (tabId: number, url?: string) => {
    const binding = tabBindings.get(tabId)
    if (binding) {
      if (url && isSameNavigation(url, binding.url)) return
      await removeBinding(binding)
      return
    }
    if (!rebindHints.delete(tabId)) return
    await persistPageBindings()
  }

  serverControls.set(server, { restorePageBindings, removeTab })
  serverDisposers.set(server, () => {
    disposed = true
    presenceCohorts.clear()
    physicalObservers.forEach((dispose) => dispose())
    commitCapabilities.forEach((capability) => capability.revoke())
    commitCapabilities.clear()
    capabilityBindings.clear()
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
          serverControls.delete(server)
        }
      }
    }
  })
  return server
}

export { getChatRoomId, getWorldRoomId }
