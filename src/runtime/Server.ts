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
import type { RecoveryBindingCapability, RoomTransport } from '@/runtime/RoomTransport'
import { MESSAGE_TYPE, NativeWireCodec, type TextMessage, type WireCodec } from '@/protocol'
import type { ChatSite, ChatUser } from '@/protocol'
import {
  STATE_CHANGED_MESSAGE_TYPE,
  type RuntimeErrorEvent,
  type RuntimePageCall,
  type RuntimeServer,
  type RuntimeSnapshot,
  type RuntimeTab
} from '@/runtime/Contract'
import { PagePort, createPagePortImpl } from '@/runtime/PagePort'
import { createBoundedPresenceStore, createMemoryPresenceStore } from '@/runtime/PresenceStore'
import { canonicalNavigationUrl, isEligibleContentUrl, isSameNavigation } from '@/service/adapter/runtime/Navigation'

export interface RuntimeTabsApi {
  get: (tabId: number) => Promise<RuntimeTab>
  query: (queryInfo: { url?: string | string[] }) => Promise<RuntimeTab[]>
  sendMessage: (tabId: number, message: unknown) => Promise<unknown>
}

export interface RuntimeAdmission {
  tabs: RuntimeTabsApi
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

type ReplacementFailureStage = 'room-hydrate' | 'world-hydrate' | 'room-precommit' | 'world-precommit'

/**
 * Test transports may provide a one-shot private failure hook for an otherwise total synchronous
 * owner transition. It is intentionally absent from RoomTransport and every production transport.
 */
interface ReplacementFailureTestTransport extends RoomTransport {
  takeReplacementFailure?: (stage: ReplacementFailureStage) => Error | undefined
}

/** Bounded current Runtime failure facts exposed in every projection. */
const MAX_RETAINED_FAILURES = 100

const defaultClock: Clock = { now: () => Date.now() }
const serverDisposers = new WeakMap<RuntimeServer, () => void>()
interface ServerControl {
  removeTab: (tabId: number, url?: string) => Promise<void>
  notifyTabs: () => void
  /** Private in-process current-state read; never exported over comctx. */
  readSnapshot: () => RuntimeSnapshot
}
const serverControls = new WeakMap<RuntimeServer, ServerControl>()

export const disposeServer = (server: RuntimeServer) => serverDisposers.get(server)?.()
export const removeServerTab = (server: RuntimeServer, tabId: number, url?: string) =>
  serverControls.get(server)?.removeTab(tabId, url) ?? Promise.resolve()
/** Best-effort content-free invalidation of every supported current tab; fire-and-forget. */
export const notifyServerTabs = (server: RuntimeServer) => serverControls.get(server)?.notifyTabs()
/** Private in-process current-state read for Background/tests; not part of the remote interface. */
export const readServerSnapshot = (server: RuntimeServer): RuntimeSnapshot => {
  const control = serverControls.get(server)
  if (!control) throw new Error('Logical Runtime server is unavailable')
  return control.readSnapshot()
}

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
  const wireDomain = store.getDomain(wireAction)
  const deliveryDomain = store.getDomain(deliveryAction)
  const sessionDomain = store.getDomain(sessionAction)
  const worldDomain = store.getDomain(worldAction)
  const historyDomain = store.getDomain(historyAction)
  const connectionDomain = store.getDomain(connectionAction)

  // A logical replacement can hydrate both owners before ordered ingress opens. This vault is
  // intentionally populated only from the owner terminals, never from transport recovery payloads.
  // It is private to this Server and is cleared once activation succeeds.
  interface RecoveryIntentVault {
    rooms: Map<
      string,
      {
        roomId: string
        sessionId: string
        presenceId: string
        user: ChatUser
        site: ChatSite
        joinedAt: number
        capability: RecoveryBindingCapability
      }
    >
    world?: {
      registrations: Array<{ domain: string; user: ChatUser; site: ChatSite }>
      capability: RecoveryBindingCapability
    }
  }
  let recoveryIntentVault: RecoveryIntentVault | undefined = { rooms: new Map() }
  const recoveryReceiptTriggers = [
    store.subscribeEvent(sessionDomain.event.RecoveryHydratedEvent, (receipt) => {
      const vault = recoveryIntentVault
      if (!vault) return
      const capability = config.transport.mintRecoveryBindingCapability?.(receipt.roomId)
      if (!capability) return
      vault.rooms.set(receipt.domain, {
        roomId: receipt.roomId,
        sessionId: receipt.local.sessionId,
        presenceId: receipt.local.presenceId,
        user: { ...receipt.local.user },
        site: { ...receipt.local.site },
        joinedAt: receipt.local.joinedAt,
        capability
      })
    }),
    store.subscribeEvent(worldDomain.event.RecoveryHydratedEvent, (receipt) => {
      const vault = recoveryIntentVault
      if (!vault) return
      const capability = config.transport.mintRecoveryBindingCapability?.(getWorldRoomId())
      if (!capability) return
      vault.world = {
        registrations: receipt.registrations.map(({ domain, user, site }) => ({
          domain,
          user: { ...user },
          site: { ...site }
        })),
        capability
      }
    })
  ]
  const recoveredWorld = config.transport.worldRecovery?.()
  const recoveredRooms = config.transport.roomRecovery?.()
  const recoveredSources = [
    ...(recoveredWorld?.members.length
      ? [
          {
            roomId: getWorldRoomId(),
            sources: recoveredWorld.members.map(({ sourcePeerId, sourceGeneration }) => ({
              sourcePeerId,
              generation: sourceGeneration
            }))
          }
        ]
      : []),
    ...(recoveredRooms?.rooms ?? []).map(({ roomId, sessions }) => ({
      roomId,
      sources: sessions.map(({ sourcePeerId, sourceGeneration }) => ({ sourcePeerId, generation: sourceGeneration }))
    }))
  ]
  if (recoveredSources.length > 0) store.send(wireDomain.command.RecoverTransportStateCommand(recoveredSources))
  if (recoveredRooms && recoveredRooms.rooms.length > 0) {
    store.send(sessionDomain.command.RecoverTransportStateCommand(recoveredRooms))
  }
  if (recoveredWorld) {
    store.send(
      worldDomain.command.RecoverTransportStateCommand({
        members: recoveredWorld.members.map(({ sourcePeerId }) => sourcePeerId),
        presences: recoveredWorld.presences.map(({ sourcePeerId, presence }) => ({ sourcePeerId, presence })),
        ...(recoveredWorld.local ? { registrations: recoveredWorld.local.registrations } : {})
      })
    )
  }
  // Recovered ROOM current state may be newer than durable history. Reconcile the latter before
  // ingress opens so an active runtime can never skip ended observations or a larger HLC seed.
  let recoveryReady: Promise<void> | undefined
  let recoveryFailure: Error | undefined
  let recoveryEpoch = 0
  const beginRecoveryEpoch = (activate: () => void | Promise<void>) => {
    const epoch = ++recoveryEpoch
    recoveryFailure = undefined
    const task = Promise.resolve()
      .then(activate)
      .then(
        () => {
          if (recoveryEpoch === epoch) recoveryReady = undefined
        },
        (error) => {
          const failure = error instanceof Error ? error : new Error('Transport recovery did not complete')
          if (recoveryEpoch === epoch) {
            recoveryFailure = failure
            recoveryReady = undefined
          }
          throw failure
        }
      )
    recoveryReady = task
    // Reads observe the exact rejected promise; this only prevents an unhandled diagnostic when
    // the Server is replaced before a caller reaches its stable fail-closed read.
    void task.catch(() => {})
    return task
  }
  const initialRecovery = beginRecoveryEpoch(() =>
    recoveredRooms && recoveredRooms.rooms.length > 0
      ? Promise.all(
          recoveredRooms.rooms.map(async (recovery) => {
            const record = (await presenceStore.load(recovery.domain)) ?? {
              domain: recovery.domain,
              lastJoinedAt: 0,
              observers: []
            }
            store.send(sessionDomain.command.ReconcileRecoveredPresenceCommand({ domain: recovery.domain, record }))
          })
        ).then(() => config.transport.activateIngress?.())
      : config.transport.activateIngress?.()
  )
  void initialRecovery.then(
    () => {
      recoveryIntentVault = undefined
    },
    () => {}
  )
  interface PresenceRecovery {
    attempts: number
    promise: Promise<void>
    resolve: () => void
  }

  const presenceRecoveries = new Map<string, PresenceRecovery>()
  const pendingConnectionCancellations = new Set<() => void>()
  let disposed = false
  /** Ephemeral browser-fact record of the domain/navigation each current tab registered for. */
  const tabDomains = new Map<number, { domain: string; url: string }>()
  /** Bounded current failure facts; idempotent presentation state, never a delivery ledger. */
  const retainedFailures: RuntimeErrorEvent[] = []

  // ── Fire-and-forget state-changed notification ──────────────────────────────
  // Every trigger is a post-commit domain event; reads never schedule a notification.
  let notifyScheduled = false
  const notifyTabs = () => {
    const admission = config.admission
    if (!admission || notifyScheduled) return
    notifyScheduled = true
    // Microtask scheduling only coalesces content-free invalidation hints; it holds no payload,
    // business state, replay item, or cleanup dependency.
    queueMicrotask(() => {
      notifyScheduled = false
      void (async () => {
        try {
          const tabs = await admission.tabs.query({})
          for (const tab of tabs) {
            if (typeof tab.id !== 'number' || typeof tab.url !== 'string') continue
            const url = canonicalNavigationUrl(tab.url)
            if (!url || !isEligibleContentUrl(url)) continue
            void admission.tabs.sendMessage(tab.id, { type: STATE_CHANGED_MESSAGE_TYPE }).catch(() => {})
          }
        } catch (error) {
          console.error(error)
        }
      })()
    })
  }

  const notificationTriggers = [
    store.subscribeEvent(sessionDomain.event.RuntimeSessionChangedEvent, notifyTabs),
    store.subscribeEvent(worldDomain.event.PresenceChangedEvent, notifyTabs),
    store.subscribeEvent(lifecycleDomain.event.PageAttachedEvent, notifyTabs),
    store.subscribeEvent(lifecycleDomain.event.PageDetachedEvent, notifyTabs),
    store.subscribeEvent(lifecycleDomain.event.DomainActivatedEvent, notifyTabs),
    store.subscribeEvent(lifecycleDomain.event.DomainResumedEvent, notifyTabs),
    store.subscribeEvent(lifecycleDomain.event.DomainGraceStartedEvent, notifyTabs),
    store.subscribeEvent(lifecycleDomain.event.DomainReleasedEvent, notifyTabs),
    store.subscribeEvent(deliveryDomain.event.InboundAcceptedEvent, notifyTabs),
    store.subscribeEvent(deliveryDomain.event.InboundAckedEvent, notifyTabs),
    store.subscribeEvent(historyDomain.event.FeedbackChangedEvent, notifyTabs),
    store.subscribeEvent(historyDomain.event.SyncCompletedEvent, (completion) =>
      pagePort.historySyncCompleted(completion)
    ),
    store.subscribeEvent(connectionDomain.event.DualEpochCommittedEvent, notifyTabs),
    store.subscribeEvent(connectionDomain.event.ErrorEvent, ({ error, domain }) => {
      retainedFailures.push({
        eventId: nanoid(),
        message: error.message,
        subsystem: 'connection',
        operation: 'lifecycle',
        scope: domain
      })
      if (retainedFailures.length > MAX_RETAINED_FAILURES) {
        retainedFailures.splice(0, retainedFailures.length - MAX_RETAINED_FAILURES)
      }
      notifyTabs()
    })
  ]

  /** The Offscreen owner retains only typed current Room identity, never messages or History. */
  const roomRecoveryTrigger = store.subscribeEvent(sessionDomain.event.RuntimeSessionChangedEvent, (event) => {
    const runtime = store.query(sessionDomain.query.DomainQuery(event.domain))
    if (!runtime || !config.transport.rememberRoomRecovery) return
    const sources = new Map(
      store
        .query(wireDomain.query.SourcesQuery(runtime.roomId))
        .map((source) => [source.sourcePeerId, source.generation])
    )
    void config.transport
      .rememberRoomRecovery({
        roomId: runtime.roomId,
        domain: runtime.domain,
        local: {
          sessionId: runtime.sessionId,
          presenceId: runtime.presenceId,
          user: runtime.user,
          site: runtime.site,
          joinedAt: runtime.joinedAt
        },
        sessions: runtime.sessions.flatMap((session) => {
          // Grace-preserved bindings can share a reusable peer id with the current physical
          // incarnation. Recovery carries only the exact admitted incarnation; never relabel a
          // retained old binding with the latest source generation.
          return sources.get(session.sourcePeerId) !== session.sourceGeneration
            ? []
            : [
                {
                  sourcePeerId: session.sourcePeerId,
                  sourceGeneration: session.sourceGeneration,
                  session: {
                    type: 'session',
                    sessionId: session.sessionId,
                    presenceId: session.presenceId,
                    user: session.user,
                    joinedAt: session.joinedAt
                  }
                }
              ]
        })
      })
      .catch(() => {})
  })

  const checkpointWorldRecovery = () => {
    if (!config.transport.rememberWorldRecovery) return
    const members = store.query(wireDomain.query.SourcesQuery(getWorldRoomId()))
    const sources = new Map(members.map((source) => [source.sourcePeerId, source.generation]))
    const presences = store.query(worldDomain.query.PresencesQuery()).flatMap(({ sourcePeerId, presence }) => {
      const sourceGeneration = sources.get(sourcePeerId)
      return sourceGeneration === undefined ? [] : [{ sourcePeerId, sourceGeneration, presence }]
    })
    void config.transport
      .rememberWorldRecovery({
        members: members.map(({ sourcePeerId, generation }) => ({ sourcePeerId, sourceGeneration: generation })),
        presences,
        ...(store.query(worldDomain.query.RegistrationsQuery()).length > 0
          ? {
              local: {
                peerId: config.transport.peerIdOf(getWorldRoomId()),
                registrations: store.query(worldDomain.query.RegistrationsQuery())
              }
            }
          : {})
      })
      .catch(() => {})
  }
  const worldRecoveryTrigger = store.subscribeEvent(
    worldDomain.event.TransportStateChangedEvent,
    checkpointWorldRecovery
  )
  const worldRegistrationRecoveryTrigger = store.subscribeEvent(
    worldDomain.event.DomainCommittedEvent,
    checkpointWorldRecovery
  )
  const worldReleaseRecoveryTrigger = store.subscribeEvent(
    worldDomain.event.DomainReleasedEvent,
    checkpointWorldRecovery
  )

  /**
   * Browser sender/tab facts are the sole caller identity. With production admission the current
   * tab is revalidated against the tabs API; isolated tests may supply or omit caller facts.
   */
  interface ManualRefresh {
    pending?: Promise<void>
    failure?: Error
  }
  const manualRefreshes = new Map<string, ManualRefresh>()
  let currentWorldRefresh: ManualRefresh | undefined
  const beginManualRefresh = (domain: string, pending: Promise<void>) => {
    const refresh: ManualRefresh = { pending }
    manualRefreshes.set(domain, refresh)
    currentWorldRefresh = refresh
    void pending.then(
      () => {
        if (manualRefreshes.get(domain) === refresh) manualRefreshes.delete(domain)
        if (currentWorldRefresh === refresh) currentWorldRefresh = undefined
      },
      (error) => {
        if (manualRefreshes.get(domain) === refresh) {
          refresh.pending = undefined
          refresh.failure = error instanceof Error ? error : new Error('AppButton replacement did not complete')
        }
      }
    )
    return refresh
  }
  const waitForManualRefreshes = async (domain?: string) => {
    for (;;) {
      const local = domain ? manualRefreshes.get(domain) : undefined
      const world = currentWorldRefresh
      const before = [...new Set([local, world].filter((refresh): refresh is ManualRefresh => Boolean(refresh)))]
      await Promise.allSettled(before.flatMap((refresh) => (refresh.pending ? [refresh.pending] : [])))

      const currentLocal = domain ? manualRefreshes.get(domain) : undefined
      const currentWorld = currentWorldRefresh
      if (currentLocal?.failure) throw currentLocal.failure
      if (currentWorld?.failure) throw currentWorld.failure
      if (currentLocal === local && currentWorld === world && !currentLocal?.pending && !currentWorld?.pending) {
        return
      }
    }
  }

  const requireCallerTab = async (
    payload: RuntimePageCall,
    domain?: string,
    options?: { allowRecoveryFailure?: boolean }
  ): Promise<number | null> => {
    if (!options?.allowRecoveryFailure) {
      if (recoveryFailure) throw recoveryFailure
      if (recoveryReady) await recoveryReady
      if (recoveryFailure) throw recoveryFailure
    }
    const caller = payload.caller?.tab
    const tabId = caller?.id
    if (typeof tabId !== 'number' || !Number.isSafeInteger(tabId) || tabId < 0) {
      if (!config.admission) return null
      throw new Error('Current Page browser caller is required')
    }
    if (!config.admission) return tabId
    await config.admission.ensureTransport()
    const current = await config.admission.tabs.get(tabId)
    const url = typeof current.url === 'string' ? canonicalNavigationUrl(current.url) : null
    if (
      current.id !== tabId ||
      !url ||
      !isEligibleContentUrl(url) ||
      (typeof caller?.url === 'string' && !isSameNavigation(url, caller.url)) ||
      (domain !== undefined && new URL(url).origin !== domain)
    ) {
      throw new Error('Browser tab navigation is no longer eligible')
    }
    return tabId
  }

  const snapshot = (callerTabId?: number | null): RuntimeSnapshot => {
    const base = store.query(connectionDomain.query.SnapshotQuery())
    return {
      ...base,
      domains: base.domains.map((domain) => ({
        ...domain,
        historyFeedback:
          typeof callerTabId === 'number' && pagePort.isHistoryProvider(callerTabId, domain.domain)
            ? domain.historyFeedback
            : []
      })),
      failures: [...retainedFailures]
    }
  }

  interface DualReplacementRoomIntent {
    sessionId: string
    presenceId: string
    user: ChatUser
    site: ChatSite
    joinedAt: number
  }
  interface DualReplacementSeed {
    domain: string
    hostId: string
    tabId: number | null
    documentUrl: string
    room: DualReplacementRoomIntent
    world: Array<{ domain: string; user: ChatUser; site: ChatSite }>
  }
  interface DualReplacementAttempt extends DualReplacementSeed {
    epoch: string
    invalidated: boolean
  }
  /**
   * A post-cut failure has no current World registrations to recapture. Keep the validated local
   * World intent as one fenced Runtime-private epoch so another still-active domain can recover it.
   */
  interface SharedWorldRecoveryEpoch {
    hostId: string
    sourceEpoch: string
    worldGeneration: number
    world: Array<{ domain: string; user: ChatUser; site: ChatSite }>
  }
  interface ReplacementReservation {
    domain: string
    hostId: string
    tabId: number | null
    documentUrl: string
    invalidated: boolean
  }
  interface ActiveReleaseBarrier {
    generation: number
    releases: Array<{ domain: string; generation: number }>
  }
  const replacementAttempts = new Map<string, DualReplacementAttempt>()
  // A reservation covers the pre-cut release barrier. It owns no recovered facts and exists
  // solely so detach/rebind can cancel the same explicit click before an attempt is captured.
  const replacementReservations = new Map<string, ReplacementReservation>()
  const cancelledReplacementReservations = new WeakSet<ReplacementReservation>()
  const cancelledReplacementAttempts = new WeakSet<DualReplacementAttempt>()
  const replacementSeeds = new Map<string, DualReplacementSeed>()
  let sharedWorldRecovery: SharedWorldRecoveryEpoch | undefined
  let currentWorldReplacement: DualReplacementAttempt | undefined
  let replacementSequence = 0
  const takeReplacementFailure = (stage: ReplacementFailureStage) => {
    const failure = (config.transport as ReplacementFailureTestTransport).takeReplacementFailure?.(stage)
    if (failure) throw failure
  }

  const cloneRoomIntent = (room: DualReplacementRoomIntent): DualReplacementRoomIntent => ({
    sessionId: room.sessionId,
    presenceId: room.presenceId,
    user: { ...room.user },
    site: { ...room.site },
    joinedAt: room.joinedAt
  })
  const cloneSeed = (seed: DualReplacementSeed): DualReplacementSeed => ({
    domain: seed.domain,
    hostId: seed.hostId,
    tabId: seed.tabId,
    documentUrl: seed.documentUrl,
    room: cloneRoomIntent(seed.room),
    world: seed.world.map((registration) => ({
      domain: registration.domain,
      user: { ...registration.user },
      site: { ...registration.site }
    }))
  })
  const cloneWorldIntent = (world: SharedWorldRecoveryEpoch['world']) =>
    world.map((registration) => ({
      domain: registration.domain,
      user: { ...registration.user },
      site: { ...registration.site }
    }))
  const callerDocumentUrl = (payload: RuntimePageCall, tabId: number | null) => {
    const callerUrl = payload.caller?.tab?.url
    if (typeof callerUrl === 'string') return canonicalNavigationUrl(callerUrl) ?? callerUrl
    return tabId === null ? '' : (tabDomains.get(tabId)?.url ?? '')
  }
  const seedMatchesCaller = (seed: DualReplacementSeed, tabId: number | null, documentUrl: string) =>
    seed.hostId === connectionOptions.hostId && seed.tabId === tabId && seed.documentUrl === documentUrl
  const captureReplacementSeed = (
    domain: string,
    tabId: number | null,
    documentUrl: string
  ): DualReplacementSeed | null => {
    const room = store.query(sessionDomain.query.DomainQuery(domain))
    const world = store.query(worldDomain.query.RegistrationsQuery())
    if (!room || !world.some((registration) => registration.domain === domain)) return null
    return {
      domain,
      hostId: connectionOptions.hostId,
      tabId,
      documentUrl,
      room: {
        sessionId: room.sessionId,
        presenceId: room.presenceId,
        user: { ...room.user },
        site: { ...room.site },
        joinedAt: room.joinedAt
      },
      world: world.map((registration) => ({
        domain: registration.domain,
        user: { ...registration.user },
        site: { ...registration.site }
      }))
    }
  }
  const captureSharedWorldRecoverySeed = (
    recovery: SharedWorldRecoveryEpoch,
    domain: string,
    tabId: number | null,
    documentUrl: string
  ): DualReplacementSeed => {
    if (recovery.hostId !== connectionOptions.hostId) {
      throw new Error('Shared World recovery epoch is no longer bound to this host')
    }
    if (store.query(wireDomain.query.RoomGenerationQuery(getWorldRoomId())) !== recovery.worldGeneration) {
      throw new Error('Shared World recovery epoch is no longer current')
    }
    if (!recovery.world.some((registration) => registration.domain === domain)) {
      throw new Error('Current domain is not eligible for the shared World recovery epoch')
    }
    const room = store.query(sessionDomain.query.DomainQuery(domain))
    if (!room) throw new Error('Current domain no longer has a local ROOM owner for shared World recovery')
    return {
      domain,
      hostId: connectionOptions.hostId,
      tabId,
      documentUrl,
      room: {
        sessionId: room.sessionId,
        presenceId: room.presenceId,
        user: { ...room.user },
        site: { ...room.site },
        joinedAt: room.joinedAt
      },
      world: cloneWorldIntent(recovery.world)
    }
  }
  const captureActiveReleaseBarrier = (): ActiveReleaseBarrier => ({
    generation: store.query(sessionDomain.query.ReleaseGenerationQuery()),
    releases: store
      .query(sessionDomain.query.LiveReleasesQuery())
      .map((release) => ({ domain: release.domain, generation: release.generation }))
  })
  const assertReleaseBarrierCurrent = (barrier: ActiveReleaseBarrier) => {
    if (store.query(sessionDomain.query.ReleaseGenerationQuery()) !== barrier.generation) {
      throw new Error('Runtime release lifecycle changed before the dual replacement cut')
    }
  }
  const invalidateReplacementForTab = (tabId: number) => {
    for (const [domain, attempt] of replacementAttempts) {
      if (attempt.tabId !== tabId) continue
      attempt.invalidated = true
      cancelledReplacementAttempts.add(attempt)
      replacementSeeds.delete(domain)
    }
    for (const [domain, reservation] of replacementReservations) {
      if (reservation.tabId !== tabId) continue
      reservation.invalidated = true
      cancelledReplacementReservations.add(reservation)
      replacementSeeds.delete(domain)
    }
    for (const [domain, seed] of replacementSeeds) {
      if (seed.tabId === tabId) replacementSeeds.delete(domain)
    }
    // A shared World epoch contains facts captured under the prior tab topology. It cannot be
    // retargeted after any participating Page is detached or navigated.
    sharedWorldRecovery = undefined
  }
  const invalidateReplacementForDomain = (domain: string) => {
    const attempt = replacementAttempts.get(domain)
    if (attempt) {
      attempt.invalidated = true
      cancelledReplacementAttempts.add(attempt)
    }
    const reservation = replacementReservations.get(domain)
    if (reservation) {
      reservation.invalidated = true
      cancelledReplacementReservations.add(reservation)
    }
    replacementSeeds.delete(domain)
    if (sharedWorldRecovery?.world.some((registration) => registration.domain === domain)) {
      sharedWorldRecovery = undefined
    }
  }
  const clearReplacementSeed = (domain: string) => replacementSeeds.delete(domain)
  const assertReplacementCurrent = async (attempt: DualReplacementAttempt, payload: RuntimePageCall): Promise<void> => {
    if (
      disposed ||
      attempt.invalidated ||
      replacementAttempts.get(attempt.domain) !== attempt ||
      currentWorldReplacement !== attempt ||
      attempt.hostId !== connectionOptions.hostId
    ) {
      if (disposed) cancelledReplacementAttempts.add(attempt)
      throw operationCancelled()
    }
    const tabId = await requireCallerTab(payload, attempt.domain, { allowRecoveryFailure: true })
    if (tabId !== attempt.tabId || callerDocumentUrl(payload, tabId) !== attempt.documentUrl) {
      throw new Error('AppButton caller binding is no longer current')
    }
    if (tabId !== null && tabDomains.get(tabId)?.domain !== attempt.domain) {
      throw new Error('AppButton document binding is no longer current')
    }
  }
  const assertReplacementReservationCurrent = async (
    reservation: ReplacementReservation,
    payload: RuntimePageCall
  ): Promise<void> => {
    if (
      disposed ||
      reservation.invalidated ||
      replacementReservations.get(reservation.domain) !== reservation ||
      reservation.hostId !== connectionOptions.hostId
    ) {
      if (disposed) cancelledReplacementReservations.add(reservation)
      throw operationCancelled()
    }
    const tabId = await requireCallerTab(payload, reservation.domain, { allowRecoveryFailure: true })
    if (tabId !== reservation.tabId || callerDocumentUrl(payload, tabId) !== reservation.documentUrl) {
      throw new Error('AppButton caller binding is no longer current')
    }
    // A fresh no-op click after that tab's detach has no active binding to protect. An existing
    // reservation from before detach is still invalidated above; only a conflicting current tab
    // registration must reject this pre-capture release wait.
    if (tabId !== null && tabDomains.has(tabId) && tabDomains.get(tabId)?.domain !== reservation.domain) {
      throw new Error('AppButton document binding is no longer current')
    }
  }
  const waitForPreparedRooms = (payload: { epoch: string; requestId: string; roomIds: string[] }): Promise<void> =>
    new Promise<void>((resolve, reject) => {
      let settled = false
      const finish = (error?: Error) => {
        if (settled) return
        settled = true
        prepared.unsubscribe()
        failed.unsubscribe()
        if (error) reject(error)
        else resolve()
      }
      const prepared = store.subscribeEvent(wireDomain.event.RoomsPreparedEvent, (event) => {
        if (event.epoch === payload.epoch && event.requestId === payload.requestId) finish()
      })
      const failed = store.subscribeEvent(wireDomain.event.RoomsJoinFailedEvent, (event) => {
        if (event.requestId === payload.requestId) finish(event.error)
      })
      store.send(wireDomain.command.PrepareRoomsCommand(payload))
    })

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

  const runDualReplacement = async (
    attempt: DualReplacementAttempt,
    payload: RuntimePageCall,
    releaseBarrier: ActiveReleaseBarrier
  ): Promise<undefined> => {
    const chatRoomId = getChatRoomId(attempt.domain)
    const worldRoomId = getWorldRoomId()
    let cut = false
    let gate:
      | {
          epoch: string
          domain: string
          attemptId: string
          chatGeneration: number
          worldGeneration: number
        }
      | undefined
    try {
      assertReleaseBarrierCurrent(releaseBarrier)
      // This is the only physical destruction step. It resolves after each local routing owner
      // is gone and its provider-specific leave/close terminal has settled.
      await config.transport.retireRoomsForPreparation([worldRoomId, chatRoomId])
      await assertReplacementCurrent(attempt, payload)
      assertReleaseBarrierCurrent(releaseBarrier)

      const replacementGate = {
        epoch: attempt.epoch,
        domain: attempt.domain,
        attemptId: `manual:${attempt.epoch}`,
        chatGeneration: store.query(wireDomain.query.RoomGenerationQuery(chatRoomId)) + 1,
        worldGeneration: store.query(wireDomain.query.RoomGenerationQuery(worldRoomId)) + 1
      }
      gate = replacementGate
      store.send(connectionDomain.command.BeginDualEpochReplacementCommand(replacementGate))
      if (store.query(connectionDomain.query.DualEpochCutQuery())?.epoch !== replacementGate.epoch) {
        throw new Error('Dual replacement current-owner cut was rejected')
      }
      cut = true

      store.send(
        sessionDomain.command.PrepareEpochDomainCommand({
          attemptId: replacementGate.attemptId,
          epoch: replacementGate.epoch,
          chatGeneration: replacementGate.chatGeneration,
          domain: replacementGate.domain,
          roomId: chatRoomId,
          // The retained intent owns the local presence/user/site, while every explicit physical
          // replacement gets one fresh SESSION incarnation just like the ordinary reconnect path.
          local: { ...cloneRoomIntent(attempt.room), sessionId: nanoid() }
        })
      )
      if (!store.query(sessionDomain.query.PreparedSessionQuery(replacementGate.attemptId))) {
        throw new Error('ROOM local intent failed to prepare')
      }
      takeReplacementFailure('room-hydrate')
      for (const registration of attempt.world) {
        store.send(
          worldDomain.command.StageEpochDomainCommand({
            attemptId: replacementGate.attemptId,
            epoch: replacementGate.epoch,
            worldGeneration: replacementGate.worldGeneration,
            domain: registration.domain,
            user: { ...registration.user },
            site: { ...registration.site }
          })
        )
      }
      if (!store.query(worldDomain.query.EpochStagedRegistrationQuery(replacementGate))) {
        throw new Error('World local intent failed to prepare')
      }
      takeReplacementFailure('world-hydrate')

      await waitForPreparedRooms({
        epoch: replacementGate.epoch,
        requestId: `manual:prepare:${replacementGate.epoch}`,
        roomIds: [chatRoomId, worldRoomId]
      })
      await assertReplacementCurrent(attempt, payload)
      const route = store.query(wireDomain.query.PreparedRouteQuery(replacementGate.epoch))
      if (
        !route?.ready ||
        !route.rooms.some((room) => room.roomId === chatRoomId && room.generation === replacementGate.chatGeneration) ||
        !route.rooms.some((room) => room.roomId === worldRoomId && room.generation === replacementGate.worldGeneration)
      ) {
        throw new Error('Dual replacement prepared route is no longer current')
      }
      // Ordered recovery ingress may await decode/owner acceptance, so it belongs before the
      // synchronous commit. The prepared Wire route keeps every accepted frame private here.
      await config.transport.activateIngress?.()
      await assertReplacementCurrent(attempt, payload)
      takeReplacementFailure('room-precommit')
      takeReplacementFailure('world-precommit')

      store.send(connectionDomain.command.CommitDualEpochCommand(replacementGate))
      if (store.query(connectionDomain.query.DualEpochGateQuery())?.epoch !== replacementGate.epoch) {
        throw new Error('Dual replacement commit was rejected')
      }
      replacementSeeds.delete(attempt.domain)
      if (sharedWorldRecovery) {
        sharedWorldRecovery.world.forEach(({ domain }) => replacementSeeds.delete(domain))
        sharedWorldRecovery = undefined
      }
      recoveryFailure = undefined
      recoveryReady = undefined
      // Public hints begin only after the shared terminal. The initial local state is already
      // complete, while outbound presence/session catch-up remains ordinary post-commit work.
      const committedRoom = store.query(sessionDomain.query.DomainQuery(attempt.domain))
      if (committedRoom) {
        for (const source of store.query(wireDomain.query.SourcesQuery(chatRoomId))) {
          store.send(
            wireDomain.command.SendMessageCommand({
              requestId: `manual:session:${attempt.epoch}:${source.sourcePeerId}`,
              roomId: chatRoomId,
              targetPeerIds: [source.sourcePeerId],
              message: {
                type: MESSAGE_TYPE.SESSION,
                sessionId: committedRoom.sessionId,
                presenceId: committedRoom.presenceId,
                joinedAt: committedRoom.joinedAt,
                user: committedRoom.user
              }
            })
          )
        }
      }
      store.send(worldDomain.command.PublishCurrentCommand({ requestId: `manual:world:${attempt.epoch}` }))
      notifyTabs()
      return undefined
    } catch (reason) {
      const error = reason instanceof Error ? reason : new Error('Dual replacement failed')
      if (gate) store.send(connectionDomain.command.AbortDualEpochCommand(gate))
      if (cut && currentWorldReplacement === attempt) {
        try {
          await config.transport.retireRoomsForPreparation([worldRoomId, chatRoomId])
        } catch {
          // The original prepare/activation failure is the only user-visible failure. A stale
          // successor cannot publish because abort removed every logical staged owner first.
        }
      }
      if (
        !attempt.invalidated &&
        replacementAttempts.get(attempt.domain) === attempt &&
        currentWorldReplacement === attempt &&
        attempt.hostId === connectionOptions.hostId
      ) {
        // A retry seed is local-only and bound to the exact caller/document/host. It is rebuilt
        // from the captured values, never from staged or remote state.
        replacementSeeds.set(attempt.domain, cloneSeed(attempt))
        if (cut && gate) {
          sharedWorldRecovery = {
            hostId: attempt.hostId,
            sourceEpoch: attempt.epoch,
            worldGeneration: gate.worldGeneration,
            world: cloneWorldIntent(attempt.world)
          }
        }
      }
      throw error
    } finally {
      if (replacementAttempts.get(attempt.domain) === attempt) replacementAttempts.delete(attempt.domain)
      if (currentWorldReplacement === attempt) currentWorldReplacement = undefined
    }
  }

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

  /**
   * A manual dual replacement must never cut over an unrelated explicit release. Snapshot the
   * currently live local release generation, await exactly that set through the ordinary release
   * owner, then fence a later release before any replacement intent is captured or cut.
   */
  const awaitActiveReleaseBarrier = async (
    barrier: ActiveReleaseBarrier,
    reservation: ReplacementReservation,
    payload: RuntimePageCall
  ): Promise<void> => {
    // A pre-existing retry seed may have captured a releasing domain's World registration. It
    // cannot cross the release boundary; success must rebuild from current local owners.
    clearReplacementSeed(reservation.domain)
    sharedWorldRecovery = undefined
    await Promise.all(barrier.releases.map(({ domain }) => completeInterruptedRelease(domain)))
    await assertReplacementReservationCurrent(reservation, payload)
    assertReleaseBarrierCurrent(barrier)
  }

  const runReservedDualReplacement = async (
    reservation: ReplacementReservation,
    payload: RuntimePageCall
  ): Promise<undefined | null> => {
    let attempt: DualReplacementAttempt | undefined
    try {
      const releaseBarrier = captureActiveReleaseBarrier()
      if (releaseBarrier.releases.length > 0) {
        await awaitActiveReleaseBarrier(releaseBarrier, reservation, payload)
      }
      await assertReplacementReservationCurrent(reservation, payload)
      const retained = replacementSeeds.get(reservation.domain)
      if (retained && !seedMatchesCaller(retained, reservation.tabId, reservation.documentUrl)) {
        throw new Error('Dual replacement retry seed does not match this caller binding')
      }

      // A release barrier always discards any pre-wait seed. Its successful terminal must be
      // followed by a new, current-owner-only capture so a departed domain cannot re-enter World.
      const shared = releaseBarrier.releases.length === 0 ? sharedWorldRecovery : undefined
      if (shared && shared.hostId !== connectionOptions.hostId) {
        throw new Error('Shared World recovery epoch is no longer bound to this host')
      }
      const captured =
        releaseBarrier.releases.length > 0
          ? captureReplacementSeed(reservation.domain, reservation.tabId, reservation.documentUrl)
          : retained
            ? cloneSeed(retained)
            : shared
              ? captureSharedWorldRecoverySeed(shared, reservation.domain, reservation.tabId, reservation.documentUrl)
              : captureReplacementSeed(reservation.domain, reservation.tabId, reservation.documentUrl)
      if (!captured) return undefined
      if (
        releaseBarrier.releases.some((release) =>
          captured.world.some((registration) => registration.domain === release.domain)
        )
      ) {
        throw new Error('Released domain remained in the replacement World intent')
      }

      assertReleaseBarrierCurrent(releaseBarrier)

      // Only a same-binding retained seed is consumed. A release-barrier retry was already
      // invalidated above and is replaced by this freshly captured local-only intent on failure.
      if (retained && releaseBarrier.releases.length === 0) replacementSeeds.delete(reservation.domain)
      if (shared) {
        if (sharedWorldRecovery !== shared) throw new Error('Shared World recovery epoch was superseded')
        sharedWorldRecovery = undefined
      }
      const sequence = replacementSequence + 1
      replacementSequence = sequence
      attempt = {
        ...cloneSeed(captured),
        epoch: `manual:${reservation.domain}:${sequence}`,
        invalidated: false
      }
      if (currentWorldReplacement && currentWorldReplacement !== attempt) {
        currentWorldReplacement.invalidated = true
      }
      currentWorldReplacement = attempt
      replacementReservations.delete(reservation.domain)
      replacementAttempts.set(reservation.domain, attempt)
      return await runDualReplacement(attempt, payload, releaseBarrier)
    } catch (error) {
      // Cancellation is owned by this exact reservation/attempt, never inferred from an error message.
      if (
        cancelledReplacementReservations.has(reservation) ||
        (attempt !== undefined && cancelledReplacementAttempts.has(attempt))
      ) {
        return null
      }
      throw error
    } finally {
      if (replacementReservations.get(reservation.domain) === reservation) {
        replacementReservations.delete(reservation.domain)
      }
    }
  }

  /** One shared in-flight join settlement per domain: overlapping same-domain joins coalesce. */
  const inFlightJoins = new Map<string, Promise<RuntimeSnapshot | null>>()

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
  const refreshWorldAndWait = () => {
    return new Promise<void>((resolve, reject) => {
      let requestId: string | undefined
      let terminal: { requestId: string; error?: Error } | undefined
      let settled = false
      const settle = (error?: Error) => {
        if (settled) return
        settled = true
        completed.unsubscribe()
        aborted.unsubscribe()
        if (error) reject(error)
        else resolve()
      }
      const completed = store.subscribeEvent(connectionDomain.event.WorldRecoveryCompletedEvent, (event) => {
        if (!requestId) {
          terminal = { requestId: event.requestId }
          return
        }
        if (event.requestId === requestId) settle()
      })
      const aborted = store.subscribeEvent(connectionDomain.event.WorldRecoveryAbortedEvent, (event) => {
        if (!requestId) {
          terminal = { requestId: event.requestId, error: event.error }
          return
        }
        if (event.requestId === requestId) settle(event.error)
      })
      store.send(connectionDomain.command.RefreshWorldCommand())
      requestId = store.query(connectionDomain.query.WorldRecoveryAttemptQuery())?.requestId
      if (terminal && terminal.requestId === requestId) return settle(terminal.error)
      // RefreshWorldCommand can legitimately find no remaining demand. There is then no physical
      // replacement to wait for; otherwise the matching owner terminal resolves this operation.
      if (!requestId) settle()
    })
  }
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

  const detachTab = async (tabId: number) => {
    invalidateReplacementForTab(tabId)
    const entry = tabDomains.get(tabId)
    if (!entry) return
    tabDomains.delete(tabId)
    pagePort.removePage(tabId)
    store.send(lifecycleDomain.command.DetachPageCommand({ domain: entry.domain, tabId }))
  }

  const server: RuntimeServer = {
    attachPage: async (payload) => {
      const tabId = await requireCallerTab(payload, payload.domain)
      await waitForManualRefreshes(payload.domain)
      if (tabId !== null) {
        const existing = tabDomains.get(tabId)
        if (existing && existing.domain !== payload.domain) await detachTab(tabId)
        const current = config.admission ? await config.admission.tabs.get(tabId) : null
        const url = current?.url ?? payload.caller?.tab?.url ?? ''
        tabDomains.set(tabId, { domain: payload.domain, url: canonicalNavigationUrl(url) ?? url })
        store.send(lifecycleDomain.command.AttachPageCommand({ domain: payload.domain, tabId }))
      }
      return snapshot(tabId)
    },
    getSnapshot: async (payload) => {
      if (!payload) throw new Error('Caller-bearing snapshot request is required')
      const tabId = await requireCallerTab(payload)
      await waitForManualRefreshes(tabId === null ? undefined : tabDomains.get(tabId)?.domain)
      return snapshot(tabId)
    },
    joinChatRoom: async (payload) => {
      await requireCallerTab(payload, payload.domain)
      await config.transport.requireRoomRecovery?.(getChatRoomId(payload.domain), payload.domain)
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
    leaveChatRoom: async (payload) => {
      await requireCallerTab(payload, payload.domain)
      const replacement = inFlightReconnects.get(payload.domain)
      invalidateReplacementForDomain(payload.domain)
      // A same-domain explicit leave owns the lifecycle after it cancels the private replacement.
      // Its only terminal is the ordinary release below, not the cancelled AppButton attempt.
      if (replacement) await replacement.catch(() => undefined)
      // The leave resolves only after physical departure and rejects with the exact
      // DomainReleaseFailedEvent when the active-record cleanup write fails.
      await completeInterruptedRelease(payload.domain)
    },
    allocateTextMessage: async (payload) => {
      await requireCallerTab(payload, payload.domain)
      await waitForLivePresence(payload.domain)
      const operationId = nanoid()
      return runAllocationOperation(
        operationId,
        sessionDomain.command.AllocateTextMessageCommand({ operationId, ...payload }),
        sessionDomain.event.TextMessageAllocatedEvent
      )
    },
    allocateReactionMessage: async (payload) => {
      await requireCallerTab(payload, payload.domain)
      await waitForLivePresence(payload.domain)
      const operationId = nanoid()
      return runAllocationOperation(
        operationId,
        sessionDomain.command.AllocateReactionMessageCommand({ operationId, ...payload }),
        sessionDomain.event.ReactionMessageAllocatedEvent
      )
    },
    sendChatMessage: async (payload) => {
      await requireCallerTab(payload, payload.domain)
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
      await requireCallerTab(payload, payload.domain)
      store.send(deliveryDomain.command.AckInboundCommand(payload))
    },
    reconnectDomain: async (payload) => {
      // A prior recovery epoch can be fail-closed for readers, but an explicit AppButton is the
      // only authorized way to start a new ROOM+World attempt. It must not be trapped behind the
      // previous rejected promise.
      const tabId = await requireCallerTab(payload, payload.domain, { allowRecoveryFailure: true })
      const existing = inFlightReconnects.get(payload.domain)
      if (existing) return existing
      const documentUrl = callerDocumentUrl(payload, tabId)
      const reservation: ReplacementReservation = {
        domain: payload.domain,
        hostId: connectionOptions.hostId,
        tabId,
        documentUrl,
        invalidated: false
      }
      replacementReservations.set(payload.domain, reservation)
      let resolveTask!: (value: undefined | null) => void
      let rejectTask!: (reason?: unknown) => void
      const task = new Promise<undefined | null>((resolve, reject) => {
        resolveTask = resolve
        rejectTask = reject
      })
      // Both current-state surfaces close before the first physical await. They reopen only when
      // the shared terminal succeeds; failure remains fail-closed until another explicit click.
      beginManualRefresh(
        payload.domain,
        task.then(() => {})
      )
      inFlightReconnects.set(payload.domain, task)
      const releaseReconnect = () => {
        if (inFlightReconnects.get(payload.domain) === task) inFlightReconnects.delete(payload.domain)
      }
      void runReservedDualReplacement(reservation, payload).then(resolveTask, rejectTask)
      void task.then(
        () => {
          releaseReconnect()
        },
        () => releaseReconnect()
      )
      return task
    },
    provideHistory: async (payload, callback) => {
      const tabId = await requireCallerTab(payload, payload.domain)
      if (tabId === null) throw new Error('Current Page browser caller is required')
      pagePort.provideHistory(tabId, payload.domain, callback)
    },
    resolveHistorySupply: async (payload) => {
      const tabId = await requireCallerTab(payload)
      if (tabId === null) throw new Error('Current Page browser caller is required')
      pagePort.resolveHistorySupply(tabId, payload.supplyId, payload.result)
    },
    rejectHistorySupply: async (payload) => {
      const tabId = await requireCallerTab(payload)
      if (tabId === null) throw new Error('Current Page browser caller is required')
      pagePort.rejectHistorySupply(tabId, payload.supplyId, payload.reason)
    }
  }

  const removeTab = async (tabId: number, url?: string) => {
    const entry = tabDomains.get(tabId)
    if (!entry) return
    if (url && isSameNavigation(url, entry.url)) return
    await detachTab(tabId)
  }

  serverControls.set(server, { removeTab, notifyTabs, readSnapshot: () => snapshot() })
  serverDisposers.set(server, () => {
    disposed = true
    presenceRecoveries.forEach((recovery) => recovery.resolve())
    presenceRecoveries.clear()
    ;[...pendingConnectionCancellations].forEach((cancel) => cancel())
    notificationTriggers.forEach((subscription) => subscription.unsubscribe())
    recoveryReceiptTriggers.forEach((subscription) => subscription.unsubscribe())
    roomRecoveryTrigger.unsubscribe()
    worldRecoveryTrigger.unsubscribe()
    worldRegistrationRecoveryTrigger.unsubscribe()
    worldReleaseRecoveryTrigger.unsubscribe()
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
