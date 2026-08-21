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
import {
  CommitCapabilityExtern,
  createCommitAuthority,
  type CommitCapability
} from '@/domain/runtime/externs/CommitCapability'
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
  tabId: number
  pageId: string
  domain: string
  url: string
  sessionGeneration: number | null
}

/**
 * Envelope identity model (private, in-memory only):
 * - `A` action envelope: allocated by Server admission for one business RPC; captures the exact
 *   binding/cohort/member and owns the caller-visible logical terminal exactly once.
 * - `C` cohort: one open→closed episode per domain; freezes its member set at close; publishes
 *   its only logical deadline. It never marks members observed and never decrements anything.
 * - `M` member: enrollment of one eligible pre-close envelope; self-observes only from its own
 *   resumed stack.
 * Nothing below crosses the Page RPC boundary, peer protocol, storage, or any durable structure.
 */
const COHORT_DEADLINE_MS = 10_000

type EnvelopeKind = 'join' | 'reconnect' | 'leave' | 'allocate' | 'send'

interface ActionEnvelope {
  readonly id: string
  readonly kind: EnvelopeKind
  readonly binding: PageBinding | null
  cohort: DomainCohort | null
  member: CohortMember | null
  effectSealed: boolean
  settled: boolean
}

interface CohortMember {
  readonly id: string
  readonly envelope: ActionEnvelope
  observed: boolean
}

interface DomainCohort {
  readonly id: string
  readonly domain: string
  state: 'open' | 'closed'
  readonly members: Set<CohortMember>
  readonly closedPromise: Promise<void>
  readonly settledPromise: Promise<void>
  notifyClosed: () => void
  notifySettled: () => void
  timer: ReturnType<typeof setTimeout> | null
}

/** Test-only identity observation seam: emits the actual runtime object identities. */
export type ServerLifecycleObservation =
  | { readonly type: 'envelope'; readonly phase: 'allocated' | 'settled'; readonly envelope: ActionEnvelope }
  | { readonly type: 'cohort'; readonly phase: 'created' | 'closed' | 'cleared'; readonly cohort: DomainCohort }
  | { readonly type: 'member'; readonly phase: 'enrolled' | 'observed'; readonly member: CohortMember }
  | { readonly type: 'effect'; readonly phase: 'sealed'; readonly envelope: ActionEnvelope }
  | { readonly type: 'capability'; readonly phase: 'minted' | 'consumed' | 'revoked'; readonly capability: object }
  | {
      readonly type: 'physical'
      readonly phase: 'requested' | 'terminal'
      readonly requestId: string
      readonly record: PhysicalRequest
    }
  | { readonly type: 'readiness'; readonly phase: 'begin' | 'end'; readonly token: ReadinessToken }
  | { readonly type: 'binding'; readonly phase: 'installed' | 'removed'; readonly binding: PageBinding }
  | { readonly type: 'validation'; readonly phase: 'passed'; readonly binding: PageBinding }

interface PhysicalRequest {
  readonly requestId: string
  readonly domain: string | null
  readonly promise: Promise<void>
  readonly settle: () => void
}

interface ReadinessToken {
  readonly binding: PageBinding
  readonly domain: string
  readonly promise: Promise<void>
  readonly done: () => void
}

const serverObservers = new WeakMap<RuntimeServer, (observation: ServerLifecycleObservation) => void>()

/** Test-only: subscribes to the Server's exact lifecycle object identities. No production caller. */
export const observeServerLifecycleForTest = (
  server: RuntimeServer,
  observer: (observation: ServerLifecycleObservation) => void
) => {
  serverObservers.set(server, observer)
}

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
  const commitAuthority = createCommitAuthority()
  const connectionOptions = {
    hostId: nanoid(),
    worldSessionId
  }

  const store: RemeshStore = Remesh.store({
    externs: [
      ClockExtern.impl(clock),
      CommitCapabilityExtern.impl(commitAuthority),
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
  const domainCohorts = new Map<string, DomainCohort>()
  const pendingConnectionCancellations = new Set<() => void>()
  let disposed = false

  const emit = (observation: ServerLifecycleObservation) => {
    try {
      serverObservers.get(server)?.(observation)
    } catch (error) {
      console.error(error)
    }
  }

  /** P registry: every exact `Wire.JoinRoomsRequestedEvent(Q)` observed from arming time, keyed by Q. */
  const physicalRequests = new Map<string, PhysicalRequest>()
  /** Exact-B readiness owners per domain: registration/attach work decrements only on completion or exact-B retirement. */
  const domainReadiness = new Map<string, Set<ReadinessToken>>()
  const bindingReadiness = new Map<PageBinding, Set<ReadinessToken>>()

  const pendingPhysicalFor = (domain: string) =>
    [...physicalRequests.values()].filter((record) => record.domain === domain)
  const readinessFor = (domain: string) => domainReadiness.get(domain) ?? new Set<ReadinessToken>()

  /** Cleanup conjunction: read-only; true only when every retained exact owner of the domain stopped. */
  const cleanupConjunction = (cohort: DomainCohort) =>
    [...cohort.members].every((member) => member.observed) &&
    pendingPhysicalFor(cohort.domain).length === 0 &&
    readinessFor(cohort.domain).size === 0

  const evaluateCohort = (cohort: DomainCohort) => {
    if (domainCohorts.get(cohort.domain) !== cohort) return
    if (cohort.state === 'open') {
      // The cohort's deadline is due the moment no bounded work remains; the wall-clock deadline
      // exists only to close hung stacks. Close publishes open→closed exactly once and freezes members.
      if (!cleanupConjunction(cohort)) return
      cohort.state = 'closed'
      if (cohort.timer) {
        clearTimeout(cohort.timer)
        cohort.timer = null
      }
      emit({ type: 'cohort', phase: 'closed', cohort })
      cohort.notifyClosed()
    }
    // Atomic closed → cleared removal under the full conjunction.
    if (cohort.state === 'closed' && cleanupConjunction(cohort)) {
      domainCohorts.delete(cohort.domain)
      if (cohort.timer) {
        clearTimeout(cohort.timer)
        cohort.timer = null
      }
      emit({ type: 'cohort', phase: 'cleared', cohort })
      cohort.notifySettled()
    }
  }

  const createCohort = (domain: string) => {
    let notifyClosed = () => {}
    let notifySettled = () => {}
    const cohort: DomainCohort = {
      id: nanoid(),
      domain,
      state: 'open',
      members: new Set(),
      closedPromise: new Promise<void>((resolve) => {
        notifyClosed = resolve
      }),
      settledPromise: new Promise<void>((resolve) => {
        notifySettled = resolve
      }),
      notifyClosed: () => notifyClosed(),
      notifySettled: () => notifySettled(),
      // C's deadline is the only Server-side logical deadline: a provider load/save or stack that
      // never settles can never hold the episode open past it.
      timer: setTimeout(() => {
        if (domainCohorts.get(domain) !== cohort || cohort.state !== 'open') return
        cohort.state = 'closed'
        cohort.timer = null
        emit({ type: 'cohort', phase: 'closed', cohort })
        cohort.notifyClosed()
        evaluateCohort(cohort)
      }, COHORT_DEADLINE_MS)
    }
    ;(cohort.timer as { unref?: () => void } | null)?.unref?.()
    domainCohorts.set(domain, cohort)
    emit({ type: 'cohort', phase: 'created', cohort })
    return cohort
  }

  /** M enrolls only while its cohort is open; the member set freezes at close. */
  const enrollMember = (cohort: DomainCohort, envelope: ActionEnvelope) => {
    if (cohort.state !== 'open') return null
    const member: CohortMember = { id: nanoid(), envelope, observed: false }
    cohort.members.add(member)
    envelope.cohort = cohort
    envelope.member = member
    emit({ type: 'member', phase: 'enrolled', member })
    return member
  }

  /** M self-observes only from its own resumed stack; idempotent; never touches siblings. */
  const observeMember = (member: CohortMember | null) => {
    if (!member || member.observed) return
    member.observed = true
    emit({ type: 'member', phase: 'observed', member })
    const cohort = member.envelope.cohort
    if (cohort) evaluateCohort(cohort)
  }

  const allocateEnvelope = (kind: EnvelopeKind, binding: PageBinding | null): ActionEnvelope => {
    const envelope: ActionEnvelope = {
      id: nanoid(),
      kind,
      binding,
      cohort: null,
      member: null,
      effectSealed: false,
      settled: false
    }
    emit({ type: 'envelope', phase: 'allocated', envelope })
    return envelope
  }

  const settleEnvelope = (envelope: ActionEnvelope) => {
    if (envelope.settled) return
    envelope.settled = true
    emit({ type: 'envelope', phase: 'settled', envelope })
  }

  /** D: sealed immediately before the one real effect; the result maps to A exactly once. */
  const sealEffect = (envelope: ActionEnvelope) => {
    envelope.effectSealed = true
    emit({ type: 'effect', phase: 'sealed', envelope })
  }

  const trackReadiness = (binding: PageBinding, domain: string) => {
    let done = () => {}
    const token: ReadinessToken = {
      binding,
      domain,
      promise: new Promise<void>((resolve) => {
        done = resolve
      }),
      done: () => done()
    }
    let byDomain = domainReadiness.get(domain)
    if (!byDomain) {
      byDomain = new Set()
      domainReadiness.set(domain, byDomain)
    }
    byDomain.add(token)
    let byBinding = bindingReadiness.get(binding)
    if (!byBinding) {
      byBinding = new Set()
      bindingReadiness.set(binding, byBinding)
    }
    byBinding.add(token)
    emit({ type: 'readiness', phase: 'begin', token })
    let ended = false
    return () => {
      if (ended) return
      ended = true
      domainReadiness.get(domain)?.delete(token)
      bindingReadiness.get(binding)?.delete(token)
      emit({ type: 'readiness', phase: 'end', token })
      token.done()
      const cohort = domainCohorts.get(domain)
      if (cohort) evaluateCohort(cohort)
    }
  }

  /** Exact-B retirement decrements all of its outstanding readiness owners, then immediately
   * re-evaluates each affected cohort so a satisfied cleanup conjunction wakes its waiters. */
  const retireBindingReadiness = (binding: PageBinding) => {
    const domains = new Set<string>()
    // Copy first: the loop mutates the iterated set (exact-B retirement decrements each token).
    // oxlint-disable-next-line no-useless-spread
    for (const token of [...(bindingReadiness.get(binding) ?? [])]) {
      domainReadiness.get(token.domain)?.delete(token)
      bindingReadiness.get(binding)?.delete(token)
      domains.add(token.domain)
      emit({ type: 'readiness', phase: 'end', token })
      token.done()
    }
    for (const domain of domains) {
      const cohort = domainCohorts.get(domain)
      if (cohort) evaluateCohort(cohort)
    }
  }

  /** The exact-B attach/readiness work completed (its final validation passed): every outstanding
   * readiness owner of this exact binding decrements, and affected cohorts re-evaluate at once. */
  const settleBindingReadiness = (binding: PageBinding) => {
    const domains = new Set<string>()
    // oxlint-disable-next-line no-useless-spread
    for (const token of [...(bindingReadiness.get(binding) ?? [])]) {
      domainReadiness.get(token.domain)?.delete(token)
      bindingReadiness.get(binding)?.delete(token)
      domains.add(token.domain)
      emit({ type: 'readiness', phase: 'end', token })
      token.done()
    }
    for (const domain of domains) {
      const cohort = domainCohorts.get(domain)
      if (cohort) evaluateCohort(cohort)
    }
  }

  const pageBindings = new Map<string, PageBinding>()
  const tabBindings = new Map<number, PageBinding>()
  const rebindHints = new Map<number, PersistedPageBindings['pages'][number]>()
  let bindingPersistTail: Promise<void> = Promise.resolve()

  const isCurrentBinding = (binding: PageBinding) =>
    pageBindings.get(binding.pageId) === binding && tabBindings.get(binding.tabId) === binding

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
    pageBindings.delete(binding.pageId)
    tabBindings.delete(binding.tabId)
    // Exact binding invalidation revokes only this binding's live unconsumed capabilities; a
    // consumed K is authoritative and survives. Its outstanding readiness owners retire with it.
    commitAuthority.revokeBinding(binding)
    retireBindingReadiness(binding)
    pagePort.removePage(binding.pageId)
    emit({ type: 'binding', phase: 'removed', binding })
    store.send(lifecycleDomain.command.DetachPageCommand({ domain: binding.domain, pageId: binding.pageId }))
    await persistPageBindings()
  }

  const requirePageBinding = async (payload: RuntimePageCall, requireSessionCallback: boolean) => {
    const admission = config.admission
    if (!admission) return null
    const pageId = payload.pageId
    const callerTabId = payload.caller?.tab?.id
    if (!pageId || typeof callerTabId !== 'number' || !Number.isSafeInteger(callerTabId) || callerTabId < 0) {
      throw new Error('Current Page browser caller is required')
    }
    // Capture the exact binding object BEFORE any await. Every check below re-validates this same
    // object identity; a same-tuple successor installed while this call is suspended is never
    // adopted by re-resolving the stable tuple.
    const binding = pageBindings.get(pageId)
    if (!binding || binding.tabId !== callerTabId || payload.runtimeHostId !== snapshot().hostId) {
      throw new Error('Runtime Page binding is no longer current')
    }
    await admission.ensureTransport()
    if (pageBindings.get(pageId) !== binding) {
      throw new Error('Runtime Page binding is no longer current')
    }
    if (requireSessionCallback) {
      if (
        binding.sessionGeneration === null ||
        !pagePort.isSessionEventActive(binding.pageId, binding.sessionGeneration)
      ) {
        throw new Error('Runtime Page session callback is not active')
      }
    }
    if (!(await browserBindingCurrent(binding)) || !isCurrentBinding(binding)) {
      await removeBinding(binding)
      throw new Error('Browser tab navigation is no longer current')
    }
    if (
      requireSessionCallback &&
      (binding.sessionGeneration === null || !pagePort.isSessionEventActive(binding.pageId, binding.sessionGeneration))
    ) {
      throw new Error('Runtime Page session callback is no longer current')
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
      tabId: tabId!,
      pageId: payload.pageId,
      domain: payload.domain,
      url,
      sessionGeneration: null
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
    emit({ type: 'binding', phase: 'installed', binding })
    store.send(lifecycleDomain.command.AttachPageCommand({ domain: binding.domain, pageId: binding.pageId }))
    await persistPageBindings()
  }

  const operationCancelled = () => new DOMException('Runtime presence is completing its final release', 'AbortError')

  const waitForLivePresence = async (domain: string) => {
    if (disposed) throw operationCancelled()
    const cohort = domainCohorts.get(domain)
    if (!cohort) {
      if (store.query(sessionDomain.query.FinalizingPresenceQuery(domain))) throw operationCancelled()
      return
    }
    // Business admission waits for the full cleanup conjunction of the domain's live cohort:
    // every member self-observed, every issued Q terminal, and every exact-B readiness owner done.
    await cohort.settledPromise
    if (
      disposed ||
      store.query(sessionDomain.query.FinalizingPresenceQuery(domain)) ||
      !store.query(sessionDomain.query.DomainQuery(domain))
    ) {
      throw operationCancelled()
    }
  }

  const snapshot = (): RuntimeSnapshot => store.query(connectionDomain.query.SnapshotQuery())

  /**
   * Envelope P observation: armed globally before any Connection join/reconnect/recovery dispatch.
   * Every exact `Wire.JoinRoomsRequestedEvent(Q)` — Server-issued or automatic-recovery — creates
   * exactly one P, attributed to its exact domain, settling exactly once at its matching
   * `RoomsJoined`/`RoomsJoinFailed` terminal. A request never issued creates no P.
   */
  const domainForRooms = (rooms: { roomId: string }[]): string | null => {
    const candidates = new Set<string>()
    for (const binding of pageBindings.values()) candidates.add(binding.domain)
    for (const runtime of store.query(sessionDomain.query.DomainsQuery())) candidates.add(runtime.domain)
    for (const attempt of store.query(connectionDomain.query.AttemptsQuery())) candidates.add(attempt.domain)
    for (const domain of domainCohorts.keys()) candidates.add(domain)
    for (const record of physicalRequests.values()) if (record.domain) candidates.add(record.domain)
    for (const { roomId } of rooms) {
      for (const domain of candidates) {
        if (getChatRoomId(domain) === roomId) return domain
      }
    }
    return null
  }
  store.subscribeEvent(wireDomain.event.JoinRoomsRequestedEvent, (event) => {
    if (physicalRequests.has(event.requestId)) return
    let settle = () => {}
    const record: PhysicalRequest = {
      requestId: event.requestId,
      domain: domainForRooms(event.rooms),
      promise: new Promise<void>((resolve) => {
        settle = resolve
      }),
      settle: () => settle()
    }
    physicalRequests.set(event.requestId, record)
    emit({ type: 'physical', phase: 'requested', requestId: event.requestId, record })
  })
  const settlePhysicalRequest = (requestId: string) => {
    const record = physicalRequests.get(requestId)
    if (!record) return
    physicalRequests.delete(requestId)
    emit({ type: 'physical', phase: 'terminal', requestId, record })
    record.settle()
    if (record.domain) {
      const cohort = domainCohorts.get(record.domain)
      if (cohort) evaluateCohort(cohort)
    }
  }
  store.subscribeEvent(wireDomain.event.RoomsJoinedEvent, (event) => settlePhysicalRequest(event.requestId))
  store.subscribeEvent(wireDomain.event.RoomsJoinFailedEvent, (event) => settlePhysicalRequest(event.requestId))

  /** Cleanup conjunction term: every issued P of the domain must reach its exact terminal first. */
  const drainPhysical = async (domain: string) => {
    let pending = pendingPhysicalFor(domain)
    while (pending.length > 0) {
      await Promise.all(pending.map((entry) => entry.promise))
      pending = pendingPhysicalFor(domain)
    }
  }
  /** Cleanup conjunction term: every outstanding exact-B readiness owner of the domain completes. */
  const drainReadiness = async (domain: string) => {
    let pending = [...readinessFor(domain)]
    while (pending.length > 0) {
      await Promise.all(pending.map((token) => token.promise))
      pending = [...readinessFor(domain)]
    }
  }

  const acquirePresence = async (
    domain: string,
    userId: string,
    fence?: () => void,
    deadline?: Promise<void>
  ): Promise<'active' | 'acquired' | 'finalizing'> => {
    // The cohort deadline bounds the only unbounded waits in the stack: a provider load/save that
    // never settles. Its close is the one logical terminal here; every physical join keeps its own
    // existing Connection timeout terminal.
    const bounded = <T>(task: Promise<T>): Promise<T> =>
      deadline ? Promise.race([task, deadline.then(() => Promise.reject(operationCancelled()))]) : task
    if (store.query(sessionDomain.query.DomainQuery(domain))) {
      return store.query(sessionDomain.query.FinalizingPresenceQuery(domain)) ? 'finalizing' : 'active'
    }
    // No durable end journal: a rejoin always acquires the durable local lease or a fresh one and
    // hydrates the current generation. An in-memory release fenced the domain only for this generation.
    const stored = (await bounded(presenceStore.load(domain))) ?? { domain, lastJoinedAt: 0, observers: [] }
    // Envelope fence: after every await and before the first durable effect, the captured exact
    // binding must still be current. A superseded/invalidated caller performs zero save/hydrate.
    fence?.()
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
    await bounded(presenceStore.save(record))
    fence?.()
    store.send(sessionDomain.command.HydratePresenceCommand(record))
    return 'acquired'
  }
  const acquireCurrentPresence = async (
    domain: string,
    userId: string,
    fence?: () => void,
    deadline?: Promise<void>
  ): Promise<'active' | 'acquired' | 'finalizing'> => {
    while (!disposed) {
      const acquired = await acquirePresence(domain, userId, fence, deadline)
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
  const performReset = async (domain: string, operationId: string, capability?: CommitCapability) => {
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
    store.send(connectionDomain.command.DestroyDomainConnectionCommand({ domain, operationId, capability }))
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
    operationId: string,
    capability?: CommitCapability
  ): Promise<{ ok: boolean; user?: ChatUser; site?: ChatSite }> => {
    const existing = inFlightResets.get(domain)
    if (existing) return existing
    const task = performReset(domain, operationId, capability)
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
    // Cleanup conjunction: the release completes only after every issued P of the domain reached
    // its exact Wire terminal and every outstanding exact-B readiness owner of the domain
    // completed, so no successor can be admitted ahead of pending physical or registration work.
    const settled = task.then(async () => {
      await drainPhysical(domain)
      await drainReadiness(domain)
    })
    inFlightReleases.set(domain, settled)
    const releaseDeparture = () => {
      if (inFlightReleases.get(domain) === settled) inFlightReleases.delete(domain)
    }
    void settled.then(releaseDeparture, releaseDeparture)
    return settled
  }

  /** Server admission fact: the complete exact-B readiness conjunction (active Session callback,
   * ChatRoom's four sibling registrations incl. its History supply, and World attach registration). */
  const requireFullReadiness = (binding: PageBinding | null) => {
    if (!binding) return
    const missing: string[] = []
    if (
      binding.sessionGeneration === null ||
      !pagePort.isSessionEventActive(binding.pageId, binding.sessionGeneration)
    ) {
      missing.push('session')
    }
    const readiness = pagePort.callbackReadiness(binding.pageId)
    if (!readiness.inbound) missing.push('inbound')
    if (!readiness.error) missing.push('error')
    if (!readiness.historyFeedback) missing.push('history-feedback')
    if (readiness.historyDomain !== binding.domain) missing.push('history')
    if (!readiness.worldPresence) missing.push('world')
    if (missing.length > 0) {
      throw new Error(`Runtime Page readiness is incomplete: ${missing.join(', ')}`)
    }
  }

  /** One shared in-flight join settlement per domain: overlapping same-domain joins coalesce. */
  const inFlightJoins = new Map<string, Promise<Awaited<ReturnType<typeof snapshot>> | null>>()

  const joinChatRoomSettled = async (
    payload: Parameters<RuntimeServer['joinChatRoom']>[0],
    revalidate?: () => Promise<void>,
    fence?: () => void,
    binding?: PageBinding | null
  ) => {
    // Typed ChatUser/ChatSite values pass through unchanged; the application-to-protocol
    // mapping already happened before the value was narrowed to the schema-owned type.
    const envelope = allocateEnvelope('join', binding ?? null)
    // A fresh successor enters only after a closed cohort's full cleanup conjunction cleared.
    let cohort = domainCohorts.get(payload.domain)
    if (cohort && cohort.state === 'closed') {
      await cohort.settledPromise
      cohort = domainCohorts.get(payload.domain)
    }
    if (!cohort) cohort = createCohort(payload.domain)
    const member = enrollMember(cohort, envelope)
    const activeCohort = cohort
    // Envelope fence: after every await and before any durable effect, the captured cohort must
    // still be open; a closed cohort settles this stack's own A per contract with zero effects.
    const cohortFence = () => {
      if (activeCohort.state === 'closed') throw operationCancelled()
    }
    const envelopeFence = () => {
      fence?.()
      cohortFence()
    }
    // Every unbounded wait inside the acquisition loop except the physical join itself is raced
    // against the cohort deadline: a hung provider load/save or a hung admission check settles
    // this A with the structured null instead of waiting forever. The physical join keeps its own
    // existing Connection timeout terminal, so a real raw Error always wins over the deadline.
    const raceDeadline = <T>(task: Promise<T>): Promise<T> =>
      Promise.race([task, activeCohort.closedPromise.then(() => Promise.reject(operationCancelled()))])
    const boundedRevalidate = revalidate ? () => raceDeadline(revalidate()) : undefined
    const work = (async (): Promise<Awaited<ReturnType<typeof snapshot>> | null> => {
      // Cleanup conjunction at admission: when no live Connection attempt owns the domain's
      // physical work, a (re)join may begin durable acquisition only after every previously issued
      // P of this exact domain reached its Wire terminal — regardless of which path (grace
      // release, explicit leave, abort, or automatic recovery) issued the old work. A live attempt
      // instead keeps the existing newest-generation supersession rule: the fresh join supersedes
      // it directly.
      if (!store.query(connectionDomain.query.AttemptsQuery()).some((item) => item.domain === payload.domain)) {
        await drainPhysical(payload.domain)
        cohortFence()
      }
      const connect = () => {
        const operationId = nanoid()
        // Envelope K: minted for this exact binding/operation and consumed synchronously at the
        // first irreversible boundary (the join dispatch itself). P observation is armed globally
        // before dispatch so an issued Q can never be missed, including automatic-recovery Qs.
        const capability = commitAuthority.mint({
          operationId,
          domain: payload.domain,
          kind: 'join',
          binding: binding ?? null,
          // Final linearization: every irreversible commit of this operation must synchronously
          // re-prove its captured cohort is still open. A closed cohort authorizes no commit.
          commitFence: () => activeCohort.state !== 'closed'
        })
        emit({ type: 'capability', phase: 'minted', capability })
        if (!commitAuthority.consume(capability)) throw operationCancelled()
        emit({ type: 'capability', phase: 'consumed', capability })
        sealEffect(envelope)
        return runConnectionOperation(
          operationId,
          connectionDomain.command.JoinDomainCommand({ operationId, ...payload, capability }),
          () => true,
          () => false
        )
      }
      while (true) {
        if (boundedRevalidate) await boundedRevalidate()
        cohortFence()
        const presenceState = await acquireCurrentPresence(
          payload.domain,
          payload.user.id,
          envelopeFence,
          activeCohort.closedPromise
        )
        if (boundedRevalidate) await boundedRevalidate()
        cohortFence()
        if (presenceState === 'finalizing') {
          // A lease observed after the release fence started never bypasses the shared release:
          // it waits for the one live release owner to close, then starts fresh through the loop.
          if (store.query(sessionDomain.query.ReleasingDomainQuery(payload.domain))) {
            await completeInterruptedRelease(payload.domain)
            envelopeFence()
            continue
          }
          if (!store.query(sessionDomain.query.DomainQuery(payload.domain))) {
            if (boundedRevalidate) await boundedRevalidate()
            cohortFence()
            if (!(await connect())) return null
            continue
          }
          await completeInterruptedRelease(payload.domain)
          envelopeFence()
          continue
        }
        if (store.query(sessionDomain.query.FinalizingPresenceQuery(payload.domain))) {
          await completeInterruptedRelease(payload.domain)
          envelopeFence()
          continue
        }
        if (presenceState === 'active' && !store.query(sessionDomain.query.DomainQuery(payload.domain))) {
          continue
        }
        if (boundedRevalidate) await boundedRevalidate()
        envelopeFence()
        if (!(await connect())) return null
        // The committed snapshot is the sole terminal: once the envelope's effect sealed and the
        // operation committed, no later cohort/binding event may rewrite it back to null.
        return snapshot()
      }
    })()
    // C's deadline is the sole logical terminal for a stack whose provider load/save never
    // settles: its close surfaces here as the structured cancellation, this resumed stack records
    // its own M observed, and its A settles with the structured null. A late-resuming continuation
    // hits the fences above and performs zero save/hydrate/connect/commit.
    try {
      return await work
    } catch (error) {
      if (
        !disposed &&
        activeCohort.state === 'closed' &&
        error instanceof DOMException &&
        error.name === 'AbortError'
      ) {
        return null
      }
      throw error
    } finally {
      settleEnvelope(envelope)
      observeMember(member)
    }
  }

  /** One shared in-flight reconnect settlement per domain: a concurrent refresh joins the whole
   * operation (destruction through the replacement commit/failure/cancel) instead of running a
   * second destructive reset against an in-flight replacement. */
  const inFlightReconnects = new Map<string, Promise<undefined | null>>()
  const performReconnect = async (
    domain: string,
    operationId: string,
    binding?: PageBinding | null
  ): Promise<undefined | null> => {
    const envelope = allocateEnvelope('reconnect', binding ?? null)
    let cohort = domainCohorts.get(domain)
    if (cohort && cohort.state === 'closed') {
      await cohort.settledPromise
      cohort = domainCohorts.get(domain)
    }
    if (!cohort) cohort = createCohort(domain)
    const member = enrollMember(cohort, envelope)
    const activeCohort = cohort
    // Envelope K: consumed synchronously BEFORE the first irreversible reset/destruction, so only
    // this exact operation can perform the reset and only its consumed capability can commit the
    // later replacement. P observation is global and armed before any dispatch, exactly like an
    // initial join.
    const capability = commitAuthority.mint({
      operationId,
      domain,
      kind: 'reconnect',
      binding: binding ?? null,
      // The same final linearization as an initial join: a closed captured cohort authorizes no
      // reset destruction and no replacement commit.
      commitFence: () => activeCohort.state !== 'closed'
    })
    emit({ type: 'capability', phase: 'minted', capability })
    if (!commitAuthority.consume(capability)) throw operationCancelled()
    emit({ type: 'capability', phase: 'consumed', capability })
    try {
      // Phase 1: correlated destruction of the complete current-domain connection aggregate. The
      // cleared-observer persistence must settle and the domain's History work must physically
      // settle before the replacement may prepare; a persistence rejection fails the request
      // retryably without committing a mixed old/new snapshot.
      const reset = await resetDomainConnection(domain, operationId, capability)
      if (activeCohort.state === 'closed') return null
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
      sealEffect(envelope)
      return await runConnectionOperation(
        operationId,
        connectionDomain.command.ReconnectDomainCommand({
          operationId,
          domain,
          user: reset.user,
          site: reset.site,
          capability
        }),
        () => undefined,
        () => null
      )
    } finally {
      settleEnvelope(envelope)
      observeMember(member)
    }
  }

  /** Exact-identity fence captured by an envelope: the suspended continuation may continue only
   * while its exact binding object is still the current one. Throws the structured cancellation. */
  const bindingFence = (binding: PageBinding | null) => () => {
    if (disposed) throw operationCancelled()
    if (binding && !isCurrentBinding(binding)) throw operationCancelled()
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
    getSnapshot: async (payload) => {
      // Bound call: captures the exact current binding object before any await and re-validates
      // that same object after every suspension — a same-tuple successor is never adopted.
      // `validateReadiness` additionally requires the complete exact-B readiness conjunction and
      // settles that exact binding's outstanding attach/readiness owners: it is the final
      // Server-side term of the Page's unique ready publication.
      if (payload?.pageId) {
        const binding = await requirePageBinding(payload, payload.validateReadiness === true)
        if (payload.validateReadiness === true) requireFullReadiness(binding)
        if (binding) {
          emit({ type: 'validation', phase: 'passed', binding })
          if (payload.validateReadiness === true) settleBindingReadiness(binding)
        }
      }
      return snapshot()
    },
    joinChatRoom: (payload) => {
      const settle = (revalidate?: () => Promise<void>, fence?: () => void, binding?: PageBinding | null) => {
        // Overlapping same-domain joins observed while the domain's release is closing coalesce into
        // one shared settlement; fresh cold joins keep the existing newest-generation supersession.
        if (store.query(sessionDomain.query.ReleasingDomainQuery(payload.domain))) {
          const existing = inFlightJoins.get(payload.domain)
          if (existing) return existing
          const task = joinChatRoomSettled(payload, revalidate, fence, binding)
          inFlightJoins.set(payload.domain, task)
          const releaseJoin = () => {
            if (inFlightJoins.get(payload.domain) === task) inFlightJoins.delete(payload.domain)
          }
          void task.then(releaseJoin, releaseJoin)
          return task
        }
        return joinChatRoomSettled(payload, revalidate, fence, binding)
      }
      if (!config.admission) return settle()
      return (async () => {
        const binding = await requirePageBinding(payload, true)
        // The committed snapshot is the sole terminal: once the envelope settles, no post-effect
        // binding revalidation may rewrite a completed success into failure.
        return settle(() => revalidateBinding(binding, payload), bindingFence(binding), binding)
      })()
    },
    leaveChatRoom: (payload) => {
      // Keep isolated Server/domain tests on the original direct timing. Production takes the
      // admitted branch below, where a caller can never release a successor binding.
      if (!config.admission) return completeInterruptedRelease(payload.domain)
      return (async () => {
        const binding = await requirePageBinding(payload, true)
        await revalidateBinding(binding, payload)
        // D-equivalent: the single shared release owner. The leave resolves only after physical
        // departure and rejects with the exact DomainReleaseFailedEvent when the active-record
        // cleanup write fails. The settled release is the sole terminal; no post-effect
        // revalidation may rewrite it.
        const envelope = allocateEnvelope('leave', binding)
        try {
          sealEffect(envelope)
          await completeInterruptedRelease(payload.domain)
        } finally {
          settleEnvelope(envelope)
        }
      })()
    },
    allocateTextMessage: async (payload) => {
      const binding = await requirePageBinding(payload, true)
      await revalidateBinding(binding, payload)
      // Business admission requires the complete exact-B readiness fact, not Session alone.
      requireFullReadiness(binding)
      const envelope = allocateEnvelope('allocate', binding)
      try {
        await waitForLivePresence(payload.domain)
        await revalidateBinding(binding, payload)
        const operationId = nanoid()
        sealEffect(envelope)
        return await runAllocationOperation(
          operationId,
          sessionDomain.command.AllocateTextMessageCommand({ operationId, ...payload }),
          sessionDomain.event.TextMessageAllocatedEvent
        )
      } finally {
        settleEnvelope(envelope)
      }
    },
    allocateReactionMessage: async (payload) => {
      const binding = await requirePageBinding(payload, true)
      await revalidateBinding(binding, payload)
      requireFullReadiness(binding)
      const envelope = allocateEnvelope('allocate', binding)
      try {
        await waitForLivePresence(payload.domain)
        await revalidateBinding(binding, payload)
        const operationId = nanoid()
        sealEffect(envelope)
        return await runAllocationOperation(
          operationId,
          sessionDomain.command.AllocateReactionMessageCommand({ operationId, ...payload }),
          sessionDomain.event.ReactionMessageAllocatedEvent
        )
      } finally {
        settleEnvelope(envelope)
      }
    },
    sendChatMessage: async (payload) => {
      const binding = await requirePageBinding(payload, true)
      await revalidateBinding(binding, payload)
      requireFullReadiness(binding)
      const envelope = allocateEnvelope('send', binding)
      try {
        await waitForLivePresence(payload.domain)
        await revalidateBinding(binding, payload)
        const operationId = nanoid()
        const command = sessionDomain.command.SendChatMessageCommand({ operationId, ...payload })
        sealEffect(envelope)
        if (payload.event.type === MESSAGE_TYPE.TEXT) {
          return await runTextAcceptanceOperation(operationId, command)
        }
        await runSessionOperation(operationId, command, () => undefined)
        return payload.event
      } finally {
        settleEnvelope(envelope)
      }
    },
    ackInbound: async (payload) => {
      const binding = await requirePageBinding(payload, true)
      await revalidateBinding(binding, payload)
      store.send(deliveryDomain.command.AckInboundCommand(payload))
    },
    replayInbound: async (payload) => {
      const binding = await requirePageBinding(payload, true)
      // Replay is part of the exact-B attach work: its owner also ends only at the final
      // validation, on failure, or on exact-B retirement.
      const endReadiness = binding ? trackReadiness(binding, binding.domain) : undefined
      try {
        return store.query(deliveryDomain.query.BufferedEventsQuery(payload))
      } catch (error) {
        endReadiness?.()
        throw error
      }
    },
    reconnectDomain: async (payload) => {
      const binding = await requirePageBinding(payload, true)
      await revalidateBinding(binding, payload)
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
      const task = performReconnect(payload.domain, operationId, binding)
      inFlightReconnects.set(payload.domain, task)
      const releaseReconnect = () => {
        if (inFlightReconnects.get(payload.domain) === task) inFlightReconnects.delete(payload.domain)
      }
      void task.then(releaseReconnect, releaseReconnect)
      // The reconnect settlement is the sole terminal; no post-effect binding revalidation may
      // rewrite it.
      return task
    },
    onInbound: async (payload, callback) => {
      const binding = await requirePageBinding(payload, false)
      // The readiness owner outlives this RPC: it ends only when the exact-B attach work completes
      // (final validation), when this registration itself fails, or on exact-B retirement.
      const endReadiness = binding ? trackReadiness(binding, binding.domain) : undefined
      try {
        pagePort.onInbound(payload.pageId, callback)
      } catch (error) {
        endReadiness?.()
        throw error
      }
    },
    onSessionEvent: async (payload, callback) => {
      const binding = await requirePageBinding(payload, false)
      // An outstanding exact-B registration owner: release/cohort cleanup waits for this exact
      // work; it decrements only on its own completion or exact-B retirement.
      const endReadiness = binding ? trackReadiness(binding, binding.domain) : undefined
      try {
        const generation = pagePort.beginSessionEvent(payload.pageId, callback)
        if (binding) binding.sessionGeneration = null
        const lease = store
          .query(lifecycleDomain.query.DomainLeasesQuery())
          .find((candidate) => candidate.pageIds.includes(payload.pageId))
        if (!lease) {
          pagePort.cancelSessionEvent(payload.pageId, generation)
          endReadiness?.()
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
            // The registration was not established: its owner ends here rather than at validation.
            pagePort.cancelSessionEvent(payload.pageId, generation)
            endReadiness?.()
          } else if (binding) {
            binding.sessionGeneration = generation
          }
        } catch (error) {
          pagePort.cancelSessionEvent(payload.pageId, generation)
          endReadiness?.()
          if (binding) await removeBinding(binding)
          throw error
        }
      } catch (error) {
        endReadiness?.()
        throw error
      }
    },
    onWorldPresence: async (payload, callback) => {
      const binding = await requirePageBinding(payload, false)
      const endReadiness = binding ? trackReadiness(binding, binding.domain) : undefined
      try {
        pagePort.onWorldPresence(payload.pageId, callback)
      } catch (error) {
        endReadiness?.()
        throw error
      }
    },
    onError: async (payload, callback) => {
      const binding = await requirePageBinding(payload, false)
      const endReadiness = binding ? trackReadiness(binding, binding.domain) : undefined
      try {
        pagePort.onError(payload.pageId, callback)
      } catch (error) {
        endReadiness?.()
        throw error
      }
    },
    onHistoryFeedback: async (payload, callback) => {
      const binding = await requirePageBinding(payload, false)
      const endReadiness = binding ? trackReadiness(binding, binding.domain) : undefined
      try {
        pagePort.onHistoryFeedback(payload.pageId, callback)
      } catch (error) {
        endReadiness?.()
        throw error
      }
    },
    provideHistory: async (payload, callback) => {
      const binding = await requirePageBinding(payload, false)
      const endReadiness = binding ? trackReadiness(binding, binding.domain) : undefined
      try {
        pagePort.provideHistory(payload.pageId, payload.domain, callback)
      } catch (error) {
        endReadiness?.()
        throw error
      }
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
    for (const cohort of domainCohorts.values()) {
      if (cohort.timer) clearTimeout(cohort.timer)
      cohort.notifyClosed()
      cohort.notifySettled()
    }
    domainCohorts.clear()
    for (const record of physicalRequests.values()) record.settle()
    physicalRequests.clear()
    for (const tokens of domainReadiness.values()) {
      for (const token of tokens) token.done()
    }
    domainReadiness.clear()
    bindingReadiness.clear()
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
