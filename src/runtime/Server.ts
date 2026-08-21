import { Remesh, type RemeshAction, type RemeshStore, type RemeshSubscribeOnlyEvent } from 'remesh'
import { nanoid } from 'nanoid'
import ConnectionDomain, { type ConnectionOperationSucceeded } from '@/domain/runtime/Connection'
import DeliveryDomain from '@/domain/runtime/Delivery'
import HistoryDomain from '@/domain/runtime/History'
import LifecycleDomain from '@/domain/runtime/Lifecycle'
import SessionDomain, { getChatRoomId, type SessionOperationSucceeded } from '@/domain/runtime/Session'
import WireDomain from '@/domain/runtime/Wire'
import WorldDomain, { getWorldRoomId } from '@/domain/runtime/World'
import { CommitCapabilityExtern } from '@/domain/runtime/externs/CommitCapability'
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
  rebindPage: (tabId: number, pageId: string, rebindId: string) => Promise<{ rebindId: string }>
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
  /** Immutable registration identity; browser tuple fields below are validation data only. */
  readonly id: string
  readonly revision: number
  readonly slot: BindingSlot
  tabId: number
  pageId: string
  domain: string
  url: string
  sessionGeneration: number | null
  rebind: PresencePhysical | null
  members: Set<PresenceMember>
  capabilities: Set<string>
}

/** A browser tuple only locates a slot; the captured head object owns authority. */
interface BindingSlot {
  nextRevision: number
  head: PageBinding | PresencePhysical | null
}

type LogicalTerminal = 'success' | 'null' | { error: Error }
type PhysicalTerminal = 'success' | 'failure' | 'cancelled'
const PRESENCE_RECOVERY_TIMEOUT_MS = 10000

interface PresenceMember {
  readonly id: string
  readonly action: PresenceAction
  readonly binding: PageBinding | null
  observed: boolean
  retired: boolean
}

interface PresencePhysical {
  readonly id: string
  readonly cohort: PresenceRecovery
  binding: PageBinding | null
  readonly rebindTarget: Pick<PageBinding, 'tabId' | 'pageId' | 'domain' | 'url'> | null
  readonly slot: BindingSlot | null
  readonly revision: number | null
  requestId: string | null
  readonly rooms: { roomId: string; generation: number }[]
  issued: boolean
  disposeObserver: (() => void) | null
  callbackPending: boolean
  readinessPending: boolean
  terminal: PhysicalTerminal | null
  decremented: boolean
}

interface PresenceAction {
  readonly id: string
  readonly domain: string
  cohort: PresenceRecovery | null
  member: PresenceMember | null
  cleanupGate: PresenceRecovery | null
  physical: PresencePhysical | null
  operationId: string | null
  commitCapabilityId: string | null
  automaticJoinPending: boolean
  terminal: LogicalTerminal | null
  commit: 'not-started' | 'committing' | 'committed'
}

interface PresenceRecovery {
  readonly id: string
  readonly domain: string
  phase: 'open' | 'closed'
  /** C is the sole logical terminal for every member admitted before it closes. */
  terminal: LogicalTerminal | null
  readonly actions: Set<PresenceAction>
  readonly members: Set<PresenceMember>
  readonly physical: Set<PresencePhysical>
  callbacks: number
  readiness: number
  automaticJoins: number
  readonly promise: Promise<void>
  readonly resolve: () => void
  readonly successor: Promise<PresenceRecovery | null>
  readonly resolveSuccessor: (successor: PresenceRecovery | null) => void
  deadline: ReturnType<typeof globalThis.setTimeout> | null
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
  const commitCapabilities = new Map<
    string,
    {
      binding: PageBinding | null
      revision: number | null
      operationId: string
      state: 'live' | 'consumed' | 'revoked'
    }
  >()
  const commitCapability = {
    consume: (capabilityId: string) => {
      const capability = commitCapabilities.get(capabilityId)
      if (!capability || capability.state !== 'live') return false
      capability.state = 'consumed'
      capability.binding?.capabilities.delete(capabilityId)
      return true
    },
    revoke: (capabilityId: string) => {
      const capability = commitCapabilities.get(capabilityId)
      if (!capability || capability.state !== 'live') return
      capability.state = 'revoked'
      capability.binding?.capabilities.delete(capabilityId)
      commitCapabilities.delete(capabilityId)
    },
    consumed: (capabilityId: string | null) =>
      capabilityId !== null && commitCapabilities.get(capabilityId)?.state === 'consumed',
    release: (capabilityId: string | null) => {
      if (capabilityId !== null) commitCapabilities.delete(capabilityId)
    }
  }
  const connectionOptions = {
    hostId: nanoid(),
    worldSessionId
  }

  const store: RemeshStore = Remesh.store({
    externs: [
      ClockExtern.impl(clock),
      IdentityExtern.impl({ nextId: nanoid }),
      CommitCapabilityExtern.impl(commitCapability),
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
  const presenceRecoveries = new Map<string, PresenceRecovery>()
  /** A completed C remains observable until a fresh C replaces it, so a waiting business call
   * continues into the successor lifecycle instead of sampling an empty domain between cohorts. */
  const completedPresenceRecoveries = new Map<string, PresenceRecovery>()
  const pendingConnectionCancellations = new Set<() => void>()
  let disposed = false
  const pageBindings = new Map<string, PageBinding>()
  const tabBindings = new Map<number, PageBinding>()
  const bindingSlots = new Map<string, BindingSlot>()
  const rebindHints = new Map<number, PersistedPageBindings['pages'][number]>()
  const rebindOperations = new Map<string, PresencePhysical>()
  let bindingPersistTail: Promise<void> = Promise.resolve()

  const slotKey = (tabId: number, pageId: string) => `${tabId}\u0000${pageId}`
  const bindingSlot = (tabId: number, pageId: string) => {
    const key = slotKey(tabId, pageId)
    const current = bindingSlots.get(key)
    if (current) return current
    const slot: BindingSlot = { nextRevision: 1, head: null }
    bindingSlots.set(key, slot)
    return slot
  }
  const releaseSlot = (owner: PageBinding | PresencePhysical) => {
    if (owner.slot?.head === owner) owner.slot.head = null
  }
  const isCurrentBinding = (binding: PageBinding) =>
    binding.slot.head === binding &&
    pageBindings.get(binding.pageId) === binding &&
    tabBindings.get(binding.tabId) === binding

  const mintCommitCapability = (binding: PageBinding | null, operationId: string) => {
    if (!binding) return undefined
    if (!isCurrentBinding(binding)) throw new Error('Runtime Page binding is no longer current')
    const capabilityId = nanoid()
    commitCapabilities.set(capabilityId, { binding, revision: binding.revision, operationId, state: 'live' })
    binding.capabilities.add(capabilityId)
    return capabilityId
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
    if (pageBindings.get(binding.pageId) !== binding && tabBindings.get(binding.tabId) !== binding) return
    if (pageBindings.get(binding.pageId) === binding) pageBindings.delete(binding.pageId)
    if (tabBindings.get(binding.tabId) === binding) tabBindings.delete(binding.tabId)
    ;[...binding.capabilities].forEach((capabilityId) => commitCapability.revoke(capabilityId))
    releaseSlot(binding)
    binding.members.forEach((member) => {
      member.retired = true
      finishPresenceRecovery(member.action.cohort)
    })
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
    if (
      !binding ||
      binding.tabId !== callerTabId ||
      payload.runtimeHostId !== snapshot().hostId ||
      payload.bindingId !== binding.id ||
      payload.bindingRevision !== binding.revision ||
      !isCurrentBinding(binding)
    ) {
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
    if (!payload.bindingId) throw new Error('Runtime Page binding identity is required')
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
    const rebind = payload.rebindId ? (rebindOperations.get(payload.rebindId) ?? null) : null
    if (
      payload.rebindId &&
      (!rebind ||
        rebind.terminal ||
        !rebind.rebindTarget ||
        rebind.rebindTarget.tabId !== tabId ||
        rebind.rebindTarget.pageId !== payload.pageId ||
        rebind.rebindTarget.domain !== payload.domain ||
        !isSameNavigation(rebind.rebindTarget.url, url))
    ) {
      throw new Error('Runtime Page rebind is no longer current')
    }
    const slot = bindingSlot(tabId!, payload.pageId)
    let revision: number
    if (rebind) {
      if (rebind.slot !== slot || slot.head !== rebind || rebind.revision === null) {
        throw new Error('Runtime Page rebind was superseded')
      }
      revision = rebind.revision
    } else {
      revision = slot.nextRevision++
    }
    const binding: PageBinding = {
      id: payload.bindingId,
      revision,
      slot,
      tabId: tabId!,
      pageId: payload.pageId,
      domain: payload.domain,
      url,
      sessionGeneration: null,
      rebind,
      members: new Set<PresenceMember>(),
      capabilities: new Set<string>()
    }
    return binding
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
    if (binding.rebind && binding.slot.head !== binding.rebind) return false
    if (previousPage) await removeBinding(previousPage)
    if (previousTab && previousTab !== previousPage) await removeBinding(previousTab)
    if (binding.rebind && binding.slot.head !== binding.rebind) return false
    // Replacement first revokes and retires its captured predecessor. Only then may B2 become
    // the slot head, so a same-turn Connection completion sees revoke-or-consume, never a tuple.
    binding.slot.head = binding
    rebindHints.delete(binding.tabId)
    pageBindings.set(binding.pageId, binding)
    tabBindings.set(binding.tabId, binding)
    if (binding.rebind) binding.rebind.binding = binding
    store.send(lifecycleDomain.command.AttachPageCommand({ domain: binding.domain, pageId: binding.pageId }))
    await persistPageBindings()
    return isCurrentBinding(binding)
  }

  const createPresenceRecovery = (domain: string) => {
    let resolve = () => {}
    const promise = new Promise<void>((onResolve) => {
      resolve = onResolve
    })
    let resolveSuccessor = (_successor: PresenceRecovery | null) => {}
    const successor = new Promise<PresenceRecovery | null>((onResolve) => {
      resolveSuccessor = onResolve
    })
    const recovery: PresenceRecovery = {
      id: nanoid(),
      domain,
      phase: 'open',
      terminal: null,
      actions: new Set(),
      members: new Set(),
      physical: new Set(),
      callbacks: 0,
      readiness: 0,
      automaticJoins: 0,
      promise,
      resolve,
      successor,
      resolveSuccessor,
      deadline: null
    }
    const previous = completedPresenceRecoveries.get(domain)
    if (previous) {
      completedPresenceRecoveries.delete(domain)
      previous.resolveSuccessor(recovery)
    }
    presenceRecoveries.set(domain, recovery)
    recovery.deadline = globalThis.setTimeout(() => {
      settlePresenceRecoveryTerminal(recovery, { error: new Error('Physical room join timed out') })
    }, PRESENCE_RECOVERY_TIMEOUT_MS)
    return recovery
  }

  const currentPresenceRecovery = (domain: string) => presenceRecoveries.get(domain) ?? createPresenceRecovery(domain)

  const finishPresenceRecovery = (recovery: PresenceRecovery | null) => {
    if (!recovery || presenceRecoveries.get(recovery.domain) !== recovery) return
    const physicalSettled = [...recovery.physical].every((physical) => physical.terminal && physical.decremented)
    const callbacksSettled = recovery.callbacks === 0 && recovery.readiness === 0 && recovery.automaticJoins === 0
    const complete =
      recovery.terminal !== null &&
      [...recovery.members].every((member) => member.observed || member.retired) &&
      physicalSettled &&
      callbacksSettled
    if (!complete) return
    presenceRecoveries.delete(recovery.domain)
    if (recovery.deadline !== null) {
      globalThis.clearTimeout(recovery.deadline)
      recovery.deadline = null
    }
    completedPresenceRecoveries.set(recovery.domain, recovery)
    recovery.resolve()
  }

  const enrollAction = (action: PresenceAction, recovery: PresenceRecovery, binding: PageBinding | null) => {
    action.cohort = recovery
    recovery.actions.add(action)
    action.automaticJoinPending = true
    recovery.automaticJoins += 1
    const member: PresenceMember = {
      id: nanoid(),
      action,
      binding,
      observed: false,
      retired: false
    }
    action.member = member
    recovery.members.add(member)
    binding?.members.add(member)
  }

  const beginPresenceAction = (domain: string, binding: PageBinding | null): PresenceAction => {
    const action: PresenceAction = {
      id: nanoid(),
      domain,
      cohort: null,
      member: null,
      cleanupGate: null,
      physical: null,
      operationId: null,
      commitCapabilityId: null,
      automaticJoinPending: false,
      terminal: null,
      commit: 'not-started'
    }
    const current = presenceRecoveries.get(domain)
    if (current?.phase === 'closed') {
      action.cleanupGate = current ?? null
      return action
    }
    enrollAction(action, current ?? createPresenceRecovery(domain), binding)
    return action
  }

  const admitPresenceAction = async (action: PresenceAction, binding: PageBinding | null) => {
    const gate = action.cleanupGate
    if (!gate) return
    await gate.promise
    action.cleanupGate = null
    enrollAction(action, currentPresenceRecovery(action.domain), binding)
  }

  const beginPresencePhysical = (
    recovery: PresenceRecovery,
    binding: PageBinding | null,
    rebindTarget: PresencePhysical['rebindTarget'] = null,
    includesReadiness = false,
    slot: BindingSlot | null = null,
    revision: number | null = null,
    rooms: { roomId: string; generation: number }[] = []
  ): PresencePhysical => {
    const physical: PresencePhysical = {
      id: nanoid(),
      cohort: recovery,
      binding,
      rebindTarget,
      slot,
      revision,
      requestId: null,
      rooms,
      issued: false,
      disposeObserver: null,
      callbackPending: includesReadiness,
      readinessPending: includesReadiness,
      terminal: null,
      decremented: false
    }
    recovery.physical.add(physical)
    if (includesReadiness) {
      recovery.callbacks += 1
      recovery.readiness += 1
    }
    return physical
  }

  const settlePresencePhysical = (physical: PresencePhysical, terminal: PhysicalTerminal) => {
    if (physical.terminal) return
    physical.terminal = terminal
    physical.decremented = true
    physical.disposeObserver?.()
    physical.disposeObserver = null
    if (physical.callbackPending) {
      physical.callbackPending = false
      physical.cohort.callbacks -= 1
    }
    if (physical.readinessPending) {
      physical.readinessPending = false
      physical.cohort.readiness -= 1
    }
    finishPresenceRecovery(physical.cohort)
  }

  const observeConnectionPhysical = (
    recovery: PresenceRecovery,
    binding: PageBinding | null,
    action: PresenceAction,
    operationId: string
  ) => {
    const requestId = `connection:join:${operationId}`
    let physical: PresencePhysical | null = null
    const isExactRooms = (physical: PresencePhysical, rooms: { roomId: string; generation: number }[]) =>
      rooms.length === physical.rooms.length &&
      rooms.every(
        (room, index) =>
          room.roomId === physical.rooms[index]?.roomId && room.generation === physical.rooms[index]?.generation
      )
    const dispose = () => {
      requested.unsubscribe()
      joined.unsubscribe()
      failed.unsubscribe()
    }
    const requested = store.subscribeEvent(wireDomain.event.JoinRoomsRequestedEvent, (event) => {
      if (event.requestId !== requestId || physical) return
      // P exists only after this exact request entered Wire with its captured room generations.
      physical = beginPresencePhysical(recovery, binding, null, false, null, null, event.rooms)
      physical.requestId = requestId
      physical.issued = true
      physical.disposeObserver = dispose
      action.physical = physical
    })
    const joined = store.subscribeEvent(wireDomain.event.RoomsJoinedEvent, (event) => {
      const current = physical
      if (!current || event.requestId !== requestId || !isExactRooms(current, event.rooms)) return
      settlePresencePhysical(current, 'success')
    })
    const failed = store.subscribeEvent(wireDomain.event.RoomsJoinFailedEvent, (event) => {
      const current = physical
      if (!current || event.requestId !== requestId || !event.rooms || !isExactRooms(current, event.rooms)) return
      settlePresencePhysical(current, 'failure')
    })
    // Before Q admission there is no P. Logical preflight failure may release only these
    // observers, never manufacture or decrement a physical operation.
    return () => {
      if (!physical) dispose()
    }
  }

  const markPresenceActionTerminal = (action: PresenceAction, terminal: LogicalTerminal) => {
    if (action.terminal) return
    action.terminal = terminal
    if (action.member) action.member.observed = true
    const recovery = action.cohort
    if (recovery && action.automaticJoinPending) {
      action.automaticJoinPending = false
      recovery.automaticJoins -= 1
    }
    finishPresenceRecovery(recovery)
  }

  /** C closes every pre-close stack together. Only a Connection commit that already consumed K
   * may continue independently, because that irreversible commit is its own authority. */
  function settlePresenceRecoveryTerminal(recovery: PresenceRecovery, terminal: LogicalTerminal) {
    if (recovery.terminal !== null) return
    recovery.terminal = terminal
    recovery.phase = 'closed'
    if (recovery.deadline !== null) {
      globalThis.clearTimeout(recovery.deadline)
      recovery.deadline = null
    }
    for (const action of recovery.actions) {
      if (action.commit === 'committing' && terminal !== 'success') continue
      markPresenceActionTerminal(action, terminal)
      // Once C has a terminal, only the operation that already consumed K may keep its
      // irreversible commit. Every other issued operation is still governed by C, including
      // a sibling closed by another member's authoritative success.
      if (action.operationId !== null && action.commit === 'not-started') {
        if (action.commitCapabilityId !== null) commitCapability.revoke(action.commitCapabilityId)
        store.send(
          connectionDomain.command.AbortOperationCommand({
            operationId: action.operationId,
            error: terminal === 'success' || terminal === 'null' ? operationCancelled() : terminal.error
          })
        )
      }
    }
    finishPresenceRecovery(recovery)
  }

  const settlePresenceAction = (action: PresenceAction, terminal: LogicalTerminal, closeRecovery = true) => {
    const recovery = action.cohort
    if (action.commit === 'committing') terminal = 'success'
    if (recovery?.terminal === null && closeRecovery) settlePresenceRecoveryTerminal(recovery, terminal)
    markPresenceActionTerminal(action, recovery?.terminal ?? terminal)
    if (
      recovery?.terminal === null &&
      !closeRecovery &&
      [...recovery.actions].every((candidate) => candidate.terminal !== null)
    ) {
      settlePresenceRecoveryTerminal(recovery, terminal)
    }
  }

  const presenceActionTerminal = (action: PresenceAction) => action.terminal ?? action.cohort?.terminal ?? null

  const operationCancelled = () => new DOMException('Runtime presence is completing its final release', 'AbortError')

  const waitForLivePresence = async (domain: string) => {
    while (!disposed) {
      const recovery = presenceRecoveries.get(domain) ?? completedPresenceRecoveries.get(domain)
      if (!recovery) {
        if (
          store.query(sessionDomain.query.FinalizingPresenceQuery(domain)) ||
          !store.query(sessionDomain.query.DomainQuery(domain))
        ) {
          throw operationCancelled()
        }
        return
      }
      await recovery.promise
      const terminal = recovery.terminal
      if (terminal === 'null') throw operationCancelled()
      if (terminal && terminal !== 'success') throw terminal.error
      if (store.query(sessionDomain.query.FinalizingPresenceQuery(domain))) throw operationCancelled()
      if (store.query(sessionDomain.query.DomainQuery(domain))) return
      const successor = await recovery.successor
      if (!successor) throw operationCancelled()
    }
    throw operationCancelled()
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
    cancelledResult: () => T,
    onSuccess?: () => void
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
        onSuccess?.()
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

  const joinChatRoomSettled = async (
    payload: Parameters<RuntimeServer['joinChatRoom']>[0],
    binding: PageBinding | null,
    revalidate?: () => Promise<void>
  ) => {
    // Typed ChatUser/ChatSite values pass through unchanged; the application-to-protocol
    // mapping already happened before the value was narrowed to the schema-owned type.
    const action = beginPresenceAction(payload.domain, binding)
    try {
      await admitPresenceAction(action, binding)
      const settled = (): RuntimeSnapshot | null | undefined => {
        const terminal = presenceActionTerminal(action)
        if (!terminal) return undefined
        settlePresenceAction(action, terminal)
        if (terminal === 'success') {
          if (commitCapability.consumed(action.commitCapabilityId)) {
            action.commit = 'committed'
            commitCapability.release(action.commitCapabilityId)
          }
          return snapshot()
        }
        if (terminal === 'null') return null
        throw terminal.error
      }
      const connect = async () => {
        const recovery = action.cohort
        if (!recovery) throw new Error('Runtime presence action has no recovery owner')
        const operationId = nanoid()
        const commitCapabilityId = mintCommitCapability(binding, operationId)
        action.operationId = operationId
        action.commitCapabilityId = commitCapabilityId ?? null
        const stopObserving = observeConnectionPhysical(recovery, binding, action, operationId)
        try {
          const connected = await runConnectionOperation(
            operationId,
            connectionDomain.command.JoinDomainCommand({
              operationId,
              ...payload,
              commitCapabilityId,
              serverDeadline: true
            }),
            () => true,
            () => false,
            () => {
              action.commit = 'committing'
              settlePresenceRecoveryTerminal(recovery, 'success')
            }
          )
          // OperationCancelled/timeout only settle the logical A. If the exact Q was issued,
          // the retained observer waits for Wire's physical terminal before C can clean up.
          stopObserving()
          return connected
        } catch (error) {
          stopObserving()
          const terminal = presenceActionTerminal(action)
          if (terminal === 'success') return true
          if (terminal === 'null') return false
          if (terminal) throw terminal.error
          throw error
        }
      }
      while (true) {
        const terminal = settled()
        if (terminal !== undefined) return terminal
        if (revalidate) await revalidate()
        const presenceState = await acquireCurrentPresence(payload.domain, payload.user.id)
        const afterAcquire = settled()
        if (afterAcquire !== undefined) return afterAcquire
        if (revalidate) await revalidate()
        if (presenceState === 'finalizing') {
          // A lease observed after the release fence started never bypasses the shared release:
          // it waits for the one live release owner to close, then starts fresh through the loop.
          if (store.query(sessionDomain.query.ReleasingDomainQuery(payload.domain))) {
            await completeInterruptedRelease(payload.domain)
            continue
          }
          if (!store.query(sessionDomain.query.DomainQuery(payload.domain))) {
            if (revalidate) await revalidate()
            if (!(await connect())) {
              settlePresenceAction(action, 'null', false)
              return null
            }
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
        if (!(await connect())) {
          settlePresenceAction(action, 'null', false)
          return null
        }
        action.commit = 'committed'
        settlePresenceAction(action, 'success')
        commitCapability.release(action.commitCapabilityId)
        return snapshot()
      }
    } catch (error) {
      settlePresenceAction(action, { error: error instanceof Error ? error : new Error(String(error)) })
      commitCapability.release(action.commitCapabilityId)
      throw error
    }
  }

  /** Finalizing leases share one fresh, post-release admission per domain. */
  const inFlightJoins = new Map<string, Promise<Awaited<ReturnType<typeof snapshot>> | null>>()
  const joinChatRoomCoalesced = (
    payload: Parameters<RuntimeServer['joinChatRoom']>[0],
    binding: PageBinding | null,
    revalidate?: () => Promise<void>
  ) => {
    if (!store.query(sessionDomain.query.ReleasingDomainQuery(payload.domain))) {
      return joinChatRoomSettled(payload, binding, revalidate)
    }
    const existing = inFlightJoins.get(payload.domain)
    if (existing) return existing
    const task = joinChatRoomSettled(payload, binding, revalidate)
    inFlightJoins.set(payload.domain, task)
    const release = () => {
      if (inFlightJoins.get(payload.domain) === task) inFlightJoins.delete(payload.domain)
    }
    void task.then(release, release)
    return task
  }

  /** One shared in-flight reconnect settlement per domain: a concurrent refresh joins the whole
   * operation (destruction through the replacement commit/failure/cancel) instead of running a
   * second destructive reset against an in-flight replacement. */
  const inFlightReconnects = new Map<string, Promise<undefined | null>>()
  const performReconnect = async (
    domain: string,
    operationId: string,
    commitCapabilityId: string | undefined,
    onSuccess: () => void
  ): Promise<undefined | null> => {
    // Phase 1: correlated destruction of the complete current-domain connection aggregate. The
    // cleared-observer persistence must settle and the domain's History work must physically
    // settle before the replacement may prepare; a persistence rejection fails the request
    // retryably without committing a mixed old/new snapshot.
    const reset = await resetDomainConnection(domain, operationId)
    if (!reset.ok) {
      if (commitCapabilityId) commitCapability.revoke(commitCapabilityId)
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
        site: reset.site,
        commitCapabilityId,
        serverDeadline: true
      }),
      () => undefined,
      () => null,
      onSuccess
    )
  }

  const server: RuntimeServer = {
    attachPage: async (payload) => {
      const binding = await requireAttachBinding(payload)
      if (binding) {
        if (!(await installBinding(binding))) throw new Error('Runtime Page binding was superseded during installation')
      } else {
        store.send(lifecycleDomain.command.AttachPageCommand(payload))
      }
      return binding ? { ...snapshot(), bindingRevision: binding.revision } : snapshot()
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
      if (!config.admission) return joinChatRoomCoalesced(payload, null)
      return (async () => {
        const binding = await requirePageBinding(payload, true)
        return joinChatRoomCoalesced(payload, binding, () => revalidateBinding(binding, payload))
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
      const result = await runAllocationOperation(
        operationId,
        sessionDomain.command.AllocateTextMessageCommand({ operationId, ...payload }),
        sessionDomain.event.TextMessageAllocatedEvent
      )
      await revalidateBinding(binding, payload)
      if (!store.query(sessionDomain.query.DomainQuery(payload.domain))) throw operationCancelled()
      return result
    },
    allocateReactionMessage: async (payload) => {
      const binding = await requirePageBinding(payload, true)
      await revalidateBinding(binding, payload)
      await waitForLivePresence(payload.domain)
      await revalidateBinding(binding, payload)
      const operationId = nanoid()
      const result = await runAllocationOperation(
        operationId,
        sessionDomain.command.AllocateReactionMessageCommand({ operationId, ...payload }),
        sessionDomain.event.ReactionMessageAllocatedEvent
      )
      await revalidateBinding(binding, payload)
      if (!store.query(sessionDomain.query.DomainQuery(payload.domain))) throw operationCancelled()
      return result
    },
    sendChatMessage: async (payload) => {
      const binding = await requirePageBinding(payload, true)
      await revalidateBinding(binding, payload)
      await waitForLivePresence(payload.domain)
      await revalidateBinding(binding, payload)
      const operationId = nanoid()
      const command = sessionDomain.command.SendChatMessageCommand({ operationId, ...payload })
      const result =
        payload.event.type === MESSAGE_TYPE.TEXT
          ? await runTextAcceptanceOperation(operationId, command)
          : await runSessionOperation(operationId, command, () => payload.event)
      await revalidateBinding(binding, payload)
      if (!store.query(sessionDomain.query.DomainQuery(payload.domain))) throw operationCancelled()
      return result
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
      const action = beginPresenceAction(payload.domain, binding)
      try {
        await admitPresenceAction(action, binding)
        const terminal = presenceActionTerminal(action)
        if (terminal === 'success') return undefined
        if (terminal === 'null') return null
        if (terminal) throw terminal.error
        const existing = inFlightReconnects.get(payload.domain)
        if (existing) {
          const result = await existing
          settlePresenceAction(action, result === null ? 'null' : 'success')
          return result
        }
        // An accepted ready-state activation also starts the independently fenced World replacement
        // alongside the Domain child: it is never awaited, never changes the Domain result or the
        // button/loading/completion/error UI, and coalesces into the one current World operation.
        if (
          store.query(sessionDomain.query.DomainQuery(payload.domain)) ||
          store.query(sessionDomain.query.RetainedLocalSeedQuery(payload.domain))
        ) {
          store.send(connectionDomain.command.RefreshWorldCommand())
        }
        const operationId = nanoid()
        const commitCapabilityId = mintCommitCapability(binding, operationId)
        action.operationId = operationId
        action.commitCapabilityId = commitCapabilityId ?? null
        const recovery = action.cohort
        if (!recovery) throw new Error('Runtime reconnect action has no recovery owner')
        const task = performReconnect(payload.domain, operationId, commitCapabilityId, () => {
          action.commit = 'committing'
          settlePresenceRecoveryTerminal(recovery, 'success')
        })
        inFlightReconnects.set(payload.domain, task)
        const releaseReconnect = () => {
          if (inFlightReconnects.get(payload.domain) === task) inFlightReconnects.delete(payload.domain)
        }
        void task.then(releaseReconnect, releaseReconnect)
        const result = await task
        if (result === null) {
          settlePresenceAction(action, 'null', false)
          return null
        }
        if (!commitCapability.consumed(action.commitCapabilityId)) await revalidateBinding(binding, payload)
        action.commit = 'committed'
        settlePresenceAction(action, 'success')
        commitCapability.release(action.commitCapabilityId)
        return undefined
      } catch (error) {
        settlePresenceAction(action, { error: error instanceof Error ? error : new Error(String(error)) })
        commitCapability.release(action.commitCapabilityId)
        throw error
      }
    },
    onInbound: async (payload, callback) => {
      await requirePageBinding(payload, false)
      pagePort.onInbound(payload.pageId, callback)
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
      await requirePageBinding(payload, false)
      pagePort.onError(payload.pageId, callback)
    },
    onHistoryFeedback: async (payload, callback) => {
      await requirePageBinding(payload, false)
      pagePort.onHistoryFeedback(payload.pageId, callback)
    },
    provideHistory: async (payload, callback) => {
      await requirePageBinding(payload, false)
      pagePort.provideHistory(payload.pageId, payload.domain, callback)
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
      [...rebindHints.values()].map(async (hint) => {
        const recovery = currentPresenceRecovery(hint.domain)
        const slot = bindingSlot(hint.tabId, hint.pageId)
        const revision = slot.nextRevision++
        const physical = beginPresencePhysical(recovery, null, hint, true, slot, revision)
        slot.head = physical
        rebindOperations.set(physical.id, physical)
        try {
          const outcome = await admission.rebindPage(hint.tabId, hint.pageId, physical.id)
          if (outcome.rebindId !== physical.id) throw new Error('Runtime Page rebind response is no longer current')
          settlePresencePhysical(physical, 'success')
        } catch (error) {
          settlePresencePhysical(physical, 'failure')
          releaseSlot(physical)
          if (physical.binding) await removeBinding(physical.binding)
          console.error(error)
        } finally {
          rebindOperations.delete(physical.id)
        }
      })
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
          serverControls.delete(server)
        }
      }
    }
  })
  return server
}

export { getChatRoomId, getWorldRoomId }
