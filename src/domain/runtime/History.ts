import { Remesh, type RemeshCommandOutput } from 'remesh'
import { catchError, filter, from, map, mergeMap, Observable, of } from 'rxjs'
import DeliveryDomain from '@/domain/runtime/Delivery'
import SessionDomain, { observeHlc } from '@/domain/runtime/Session'
import WireDomain, { selectPeerIds, type WireFailureStage, type WireMessageEvent } from '@/domain/runtime/Wire'
import { ClockExtern } from '@/domain/runtime/externs/Clock'
import { PagePortExtern } from '@/domain/runtime/externs/PagePort'
import {
  HISTORY_REQUEST_TIMEOUT_MS,
  HISTORY_WINDOW_DAYS,
  MAX_PROVIDER_SUPPLY_CONCURRENCY,
  MAX_PROVIDER_SUPPLY_QUEUE_BYTES,
  MAX_PROVIDER_SUPPLY_QUEUE_JOBS
} from '@/constants/config'
import {
  MAX_HISTORY_RESPONSE_MESSAGES,
  MESSAGE_TYPE,
  type ChatMessage,
  type ChatUser,
  type HLC,
  type HistoryMessagesPull,
  type HistoryMessagesPush
} from '@/protocol'
import { WireCodecExtern } from '@/domain/runtime/externs/RoomTransport'
import { compareEventPosition, type ChatMessageRecord } from '@/domain/Message'
import type { HistorySupplyRequest, HistoryFeedbackEvent } from '@/runtime/Contract'
import { getTextByteSize } from '@/utils/getTextByteSize'

/** Complete identity of one directional attempt; late work must match every field. */
interface HistoryAttemptKey {
  sourcePeerId: string
  domain: string
  syncId: string
  syncToken: string
}

/** One admitted requester supply job: admission registers it dormant behind its source-local
 * predecessor and the shared active-slot pool; activation starts the physical pipeline only when
 * the same source has no active job and a global slot is free. The job stays counted through the
 * final send settlement (or terminal finish), so superseded work never overlaps the admitted
 * replacement across the selection/snapshot/encode/send/final-release pipeline. */
interface RequesterSupplyJob extends HistoryAttemptKey {
  /** Decoded metadata bytes of the admitted request, counted in the shared global pool. */
  queueBytes: number
  /** True while admitted but waiting for its source-local predecessor or a shared active slot. */
  dormant: boolean
  /** Live page-supply id (or the send-stage marker) recorded by the supplier effect so lifecycle
   * cleanup can cancel exact physical work instead of treating absence as terminal. */
  supplyId?: string
}

/** Per-provider response lane inside one domain synchronization: independent pagination,
 * failure, and completion; records merge across providers through delivery insert-if-absent. */
interface ProviderResponseState {
  expectedResponsePage: number
  /** Canonical position of the last applied response record, for cross-page recent-first continuity. */
  lastResponsePosition?: { hlc: HLC; id: string }
  awaitingBatchId?: string
  finalBatch: boolean
  responseDone: boolean
  /** Fingerprint of the last applied response page, so an identical replay is idempotent. */
  lastAppliedPageFingerprint?: string
  /** Bounded serial queue of valid response pages that arrived while a batch was pending. */
  pendingResponsePages: HistoryMessagesPush[]
  /** Page number of the next expected queued page (pages queue continuously, not only N+1). */
  queuedResponseTail: number
}

/** Outgoing requester: one domain synchronization sending targeted paged inventory requests to
 * the single triggering source peer and merging its response pages through the response lane. */
interface RequesterAttemptState extends HistoryAttemptKey {
  cutoff: number
  inventoryIds: string[]
  /** Pre-built inventory pages (real codec encoded < 256KiB each); sent in order. */
  inventoryPages: HistoryMessagesPull[]
  nextInventoryPage: number
  feedbackActive: boolean
  /** True once the loading UI has closed (the sole provider completed, failed, or departed, the
   *  timeout fired, or a manual dismiss). Loading-only: the requester keeps sending targeted
   *  inventory pages and merging late pages. */
  loadingSettled: boolean
  /** True once a real source replacement retires this outgoing owner; its inventory stops while
   *  its response collection keeps accepting valid late pages by request identity. */
  retired: boolean
  /** Per-provider response lanes keyed by the provider's sourcePeerId. */
  providers: Record<string, ProviderResponseState>
}

const newProviderResponseState = (): ProviderResponseState => ({
  expectedResponsePage: 0,
  finalBatch: false,
  responseDone: false,
  pendingResponsePages: [],
  queuedResponseTail: 0
})

/** Incoming provider: accumulated inventory, fixed record snapshot, outgoing response pages. */
interface ProviderAttemptState extends HistoryAttemptKey {
  cutoff: number
  inventory: Set<string>
  /** Raw inventory entries including duplicates (aggregate budget, not set size). */
  inventoryCount: number
  /** Aggregate canonical bytes of accepted inventory request pages. */
  inventoryBytes: number
  expectedRequestPage: number
  /** Fingerprint of the last applied inventory page, so an identical replay is idempotent. */
  lastAppliedRequestPageFingerprint?: string
  inventoryDone: boolean
  snapshot: ChatMessageRecord[]
  nextResponsePage: number
  responseDone: boolean
}

interface ProviderSupplyPayload extends HistoryAttemptKey {
  queueBytes: number
  /** True only after the complete inventory arrived; only ready attempts run the supplier. */
  ready: boolean
  /** Live page-supply id recorded by the supplier effect so cleanup can cancel it. */
  supplyId?: string
}

type HistoryDirection = 'provider' | 'requester'

interface HistorySyncBinding {
  syncId: string
  terminal: boolean
}

type ProviderSupplyJobState = ProviderSupplyPayload

interface ProviderSupplySuccessorState extends ProviderAttemptState {
  queueBytes: number
}

interface PendingInventorySend extends HistoryAttemptKey {
  type: 'inventory'
  requestId: string
  messageIds: string[]
  done: boolean
}

interface PendingProviderSend extends HistoryAttemptKey {
  type: 'provider'
  requestId: string
  records: ChatMessageRecord[]
  remaining: ChatMessageRecord[]
  terminal: boolean
  done: boolean
}

type PendingWireSend = PendingInventorySend | PendingProviderSend

interface FeedbackOwnerState extends HistoryAttemptKey {}

const replaceBy = <T>(items: T[], predicate: (item: T) => boolean, next: T): T[] =>
  items.some(predicate) ? items.map((item) => (predicate(item) ? next : item)) : [...items, next]
const removeBy = <T>(items: T[], predicate: (item: T) => boolean): T[] => items.filter((item) => !predicate(item))
const historyCutoff = (now: number) => now - HISTORY_WINDOW_DAYS * 24 * 60 * 60 * 1000
const token = (prefix: string, counter: number) => `${prefix}:${counter.toString(36)}`
const feedbackOwnerId = (key: HistoryAttemptKey) =>
  `history:${key.domain}:${key.sourcePeerId}:${key.syncId}:${key.syncToken}`
/** Maximum length of the bounded serial response-page queue for one requester attempt. */
const MAX_PENDING_RESPONSE_PAGES = 64

const makeRecord = (message: ChatMessage, user: ChatUser, receivedAt: number): ChatMessageRecord => ({
  type: 'chat-message',
  id: message.id,
  message,
  user,
  receivedAt
})

const usersForRecords = (records: ChatMessageRecord[]): ChatUser[] => {
  const snapshots = records.reduce<{ user: ChatUser; message: ChatMessage }[]>((acc, record) => {
    const index = acc.findIndex((item) => item.user.id === record.user.id)
    if (index === -1) {
      acc.push({ user: record.user, message: record.message })
      return acc
    }
    if (compareEventPosition(acc[index].message, record.message) < 0) {
      acc[index] = { user: record.user, message: record.message }
    }
    return acc
  }, [])
  return snapshots.map(({ user }) => user)
}

const matchesSync = (item: HistoryAttemptKey, key: HistoryAttemptKey) =>
  item.sourcePeerId === key.sourcePeerId &&
  item.domain === key.domain &&
  item.syncId === key.syncId &&
  item.syncToken === key.syncToken

/** One source-local slot key: supplier work stays serial per source, isolated across domains. */
const sourceJobKey = (key: HistoryAttemptKey) => `${key.domain}|${key.sourcePeerId}`

/** Non-dormant requester jobs currently occupying the shared supplier-to-send active slots. */
const countActiveRequesterJobs = (jobs: RequesterSupplyJob[]) => jobs.filter((item) => !item.dormant).length

const HistoryDomain = Remesh.domain({
  name: 'HistoryDomain',
  impl: (domain) => {
    const clock = domain.getExtern(ClockExtern)
    const pagePort = domain.getExtern(PagePortExtern)
    const codec = domain.getExtern(WireCodecExtern)
    const wireDomain = domain.getDomain(WireDomain())
    const deliveryDomain = domain.getDomain(DeliveryDomain())
    const sessionDomain = domain.getDomain(SessionDomain())

    const TokenState = domain.state<number>({ name: 'History.TokenState', default: 0 })
    const RequesterAttemptsState = domain.state<RequesterAttemptState[]>({
      name: 'History.RequesterAttemptsState',
      default: []
    })
    const ProviderAttemptsState = domain.state<ProviderAttemptState[]>({
      name: 'History.ProviderAttemptsState',
      default: []
    })
    const ProviderSupplyJobsState = domain.state<ProviderSupplyJobState[]>({
      name: 'History.ProviderSupplyJobsState',
      default: []
    })
    const ProviderSupplySuccessorsState = domain.state<ProviderSupplySuccessorState[]>({
      name: 'History.ProviderSupplySuccessorsState',
      default: []
    })
    const PendingWireSendsState = domain.state<PendingWireSend[]>({
      name: 'History.PendingWireSendsState',
      default: []
    })
    const ActiveSuppliesState = domain.state<ProviderSupplyPayload[]>({
      name: 'History.ActiveSuppliesState',
      default: []
    })
    const WaitingSuppliesState = domain.state<ProviderSupplyPayload[]>({
      name: 'History.WaitingSuppliesState',
      default: []
    })
    // Admitted requester supply jobs (dormant successors included): each entry stays counted in
    // the shared global pool from admission through its final send settlement or terminal finish.
    const RequesterSupplyJobsState = domain.state<RequesterSupplyJob[]>({
      name: 'History.RequesterSupplyJobsState',
      default: []
    })
    // Connection-bound synchronization binding: one syncId per (source, domain, direction) per
    // connection incarnation. The first valid request page zero (provider) or connection
    // acceptance (requester) binds the sole syncId; completion, cancellation, or failure retains
    // the bound id plus one terminal bit, so neither the same nor a different syncId can restart
    // History on that connection. Source replacement or domain release clears the complete
    // binding; a later connection starts one independent synchronization with a fresh id. The
    // state is constant-size per direction (one record), never peer-controlled growth.
    const HistorySyncBindingsState = domain.state<Map<string, HistorySyncBinding>>({
      name: 'History.HistorySyncBindingsState',
      default: new Map()
    })
    const bindingKeyFor = (payload: { sourcePeerId: string; domain: string; direction: HistoryDirection }) =>
      `${payload.sourcePeerId}\u0000${payload.domain}\u0000${payload.direction}`
    const FeedbackOwnersState = domain.state<FeedbackOwnerState[]>({
      name: 'History.FeedbackOwnersState',
      default: []
    })

    const RequesterAttemptsQuery = domain.query({
      name: 'History.RequesterAttemptsQuery',
      impl: ({ get }) => get(RequesterAttemptsState())
    })
    const ProviderAttemptsQuery = domain.query({
      name: 'History.ProviderAttemptsQuery',
      impl: ({ get }) => get(ProviderAttemptsState())
    })
    const ProviderSupplyJobsQuery = domain.query({
      name: 'History.ProviderSupplyJobsQuery',
      impl: ({ get }) => get(ProviderSupplyJobsState())
    })

    const SyncStartedEvent = domain.event<HistoryAttemptKey>({ name: 'History.SyncStartedEvent' })
    const RequesterSupplyStartedEvent = domain.event<HistoryAttemptKey>({
      name: 'History.RequesterSupplyStartedEvent'
    })
    const CancelRequesterSuppliesEvent = domain.event<string[]>({ name: 'History.CancelRequesterSuppliesEvent' })
    const SyncCompletedEvent = domain.event<{ domain: string; sourcePeerId: string }>({
      name: 'History.SyncCompletedEvent'
    })
    const ProviderSupplyRequestedEvent = domain.event<ProviderSupplyPayload>({
      name: 'History.ProviderSupplyRequestedEvent'
    })
    const HistoryTimeoutArmedEvent = domain.event<HistoryAttemptKey>({ name: 'History.TimeoutArmedEvent' })
    const ProviderTimeoutArmedEvent = domain.event<HistoryAttemptKey>({ name: 'History.ProviderTimeoutArmedEvent' })
    const DeadPagesEvent = domain.event<string[]>({ name: 'History.DeadPagesEvent' })
    const ErrorEvent = domain.event<{ error: Error; domain?: string }>({ name: 'History.ErrorEvent' })
    const StartRequestedEvent = domain.event<{ domain: string; sourcePeerId: string }>({
      name: 'History.StartRequestedEvent'
    })
    const FinishRequestedEvent = domain.event<{ domain: string; syncId: string; providerId: string }>({
      name: 'History.FinishRequestedEvent'
    })
    const FinishCurrentRequestedEvent = domain.event<HistoryAttemptKey>({
      name: 'History.FinishCurrentRequestedEvent'
    })
    const FeedbackChangedEvent = domain.event<HistoryFeedbackEvent>({ name: 'History.FeedbackChangedEvent' })

    const nextTokens = (get: (action: ReturnType<typeof TokenState>) => number, count: number) => {
      const start = get(TokenState()) + 1
      return { next: start + count - 1, values: Array.from({ length: count }, (_, index) => start + index) }
    }

    const feedbackOwner = (key: HistoryAttemptKey): FeedbackOwnerState => ({
      sourcePeerId: key.sourcePeerId,
      domain: key.domain,
      syncId: key.syncId,
      syncToken: key.syncToken
    })
    const feedbackMatches = (item: FeedbackOwnerState, key: HistoryAttemptKey) =>
      item.sourcePeerId === key.sourcePeerId &&
      item.domain === key.domain &&
      item.syncId === key.syncId &&
      item.syncToken === key.syncToken
    const activateFeedback = (
      get: (action: ReturnType<typeof FeedbackOwnersState>) => FeedbackOwnerState[],
      key: HistoryAttemptKey
    ) =>
      get(FeedbackOwnersState()).some((item) => feedbackMatches(item, key))
        ? null
        : [
            FeedbackOwnersState().new([...get(FeedbackOwnersState()), feedbackOwner(key)]),
            FeedbackChangedEvent({ domain: key.domain, ownerId: feedbackOwnerId(key), type: 'loading' })
          ]
    const dismissFeedback = (
      get: (action: ReturnType<typeof FeedbackOwnersState>) => FeedbackOwnerState[],
      key: HistoryAttemptKey
    ) =>
      get(FeedbackOwnersState()).some((item) => feedbackMatches(item, key))
        ? [
            FeedbackOwnersState().new(removeBy(get(FeedbackOwnersState()), (item) => feedbackMatches(item, key))),
            FeedbackChangedEvent({ domain: key.domain, ownerId: feedbackOwnerId(key), type: 'dismiss' })
          ]
        : null

    // ── Requester lifecycle ─────────────────────────────────────────────────────

    const StartRequesterCommand = domain.command({
      name: 'History.StartRequesterCommand',
      impl: ({ get }, payload: { domain: string; sourcePeerId: string }) => {
        const runtime = get(sessionDomain.query.DomainQuery(payload.domain))
        if (!runtime?.sessions.some((session) => session.sourcePeerId === payload.sourcePeerId)) return null
        // Exactly one outgoing synchronization per connection incarnation: any existing requester
        // binding marks this incarnation as already started, so a repeated session or a late
        // trigger is inert. Only the real replacement lifecycle (which clears the binding) admits
        // a fresh requester; a retained collection then survives solely to merge late pages.
        const requesterBinding = get(HistorySyncBindingsState()).get(
          bindingKeyFor({ sourcePeerId: payload.sourcePeerId, domain: payload.domain, direction: 'requester' })
        )
        if (requesterBinding) return null
        const requesters = get(RequesterAttemptsState())
        const allocated = nextTokens(get, 2)
        const state: RequesterAttemptState = {
          sourcePeerId: payload.sourcePeerId,
          domain: payload.domain,
          syncId: token('sync', allocated.values[0]),
          syncToken: token('request', allocated.values[1]),
          cutoff: historyCutoff(clock.now()),
          inventoryIds: [],
          inventoryPages: [],
          nextInventoryPage: 0,
          feedbackActive: false,
          providers: {},
          loadingSettled: false,
          retired: false
        }
        return [
          TokenState().new(allocated.next),
          BindSyncIdCommand({
            sourcePeerId: payload.sourcePeerId,
            domain: payload.domain,
            direction: 'requester',
            syncId: state.syncId
          }),
          RequesterAttemptsState().new([...requesters, state]),
          HistoryTimeoutArmedEvent(state),
          SyncStartedEvent(state)
        ]
      }
    })

    // Loading closure, idempotent: the synchronization completes (loading dismissed + completion
    // event) exactly once while the requester persists to accept and merge valid late pages. It
    // never deletes the request or terminalizes response collection.
    const SettleLoadingCommand = domain.command({
      name: 'History.SettleLoadingCommand',
      impl: ({ get }, key: HistoryAttemptKey) => {
        const requesters = get(RequesterAttemptsState())
        const current = requesters.find((item) => matchesSync(item, key))
        if (!current || current.loadingSettled) return null
        // Loading-only settlement: the UI closes exactly once while the requester keeps
        // sending targeted inventory pages and merging valid late pages; only a real source replacement
        // retires the outgoing work.
        const settled: RequesterAttemptState = { ...current, loadingSettled: true }
        return [
          RequesterAttemptsState().new(replaceBy(requesters, (item) => matchesSync(item, current), settled)),
          ...(dismissFeedback(get, current) ?? []),
          SyncCompletedEvent({ domain: key.domain, sourcePeerId: key.sourcePeerId })
        ]
      }
    })

    const FinishRequesterCommand = domain.command({
      name: 'History.FinishRequesterCommand',
      impl: ({ get }, payload: { domain: string; syncId: string; providerId: string }) => {
        const requesters = get(RequesterAttemptsState())
        const current = requesters.find((item) => item.domain === payload.domain && item.syncId === payload.syncId)
        if (!current) return null
        // Singleton scope: this requester's sole provider is its own triggering source, so only
        // that source's finish closes the loading (SettleLoadingCommand is itself idempotent).
        // Loading closure never deletes or terminalizes the request: the requester persists so a
        // valid late associated page still merges.
        if (payload.providerId !== current.sourcePeerId) return null
        return SettleLoadingCommand(current)
      }
    })

    const FinishCurrentRequesterCommand = domain.command({
      name: 'History.FinishCurrentRequesterCommand',
      impl: ({ get }, payload: HistoryAttemptKey) => {
        // Every no-send terminal exit converges here and releases the admitted supply job; a fully
        // sent inventory instead releases at its final send settlement.
        const current = get(RequesterAttemptsState()).find((item) => matchesSync(item, payload))
        return [
          ReleaseRequesterSupplyJobCommand(payload),
          ...(current
            ? [
                FinishRequestedEvent({
                  domain: payload.domain,
                  syncId: payload.syncId,
                  providerId: payload.sourcePeerId
                })
              ]
            : [])
        ]
      }
    })

    // Removes every provider-owned scheduling entry (active/waiting/dormant/job) for one
    // domain+source and releases the matching active slots, so lifecycle cleanup never leaves a
    // waiting placeholder or leaks a concurrency slot.
    const RecordActiveSupplyIdCommand = domain.command({
      name: 'History.RecordActiveSupplyIdCommand',
      impl: ({ get }, payload: { key: HistoryAttemptKey; supplyId: string }) => {
        const active = get(ActiveSuppliesState())
        if (!active.some((item) => matchesSync(item, payload.key))) return null
        return ActiveSuppliesState().new(
          active.map((item) => (matchesSync(item, payload.key) ? { ...item, supplyId: payload.supplyId } : item))
        )
      }
    })

    const CancelActiveSupplyCommand = domain.command({
      name: 'History.CancelActiveSupplyCommand',
      impl: (_context, payload: { key: HistoryAttemptKey; supplyId: string }) => {
        void pagePort.cancelHistorySupply(payload.supplyId)
        return null
      }
    })

    // Marks the active entry's supply settled by clearing its recorded supplyId. The slot
    // accounting stays until the slot is released; the cleared id distinguishes a settled supply
    // (immediate release allowed) from a live one (release deferred to physical settlement).
    const ClearActiveSupplyIdCommand = domain.command({
      name: 'History.ClearActiveSupplyIdCommand',
      impl: ({ get }, payload: { key: HistoryAttemptKey }) => {
        const active = get(ActiveSuppliesState())
        if (!active.some((item) => matchesSync(item, payload.key))) return null
        return ActiveSuppliesState().new(
          active.map((item) => (matchesSync(item, payload.key) ? { ...item, supplyId: undefined } : item))
        )
      }
    })

    const BindSyncIdCommand = domain.command({
      name: 'History.BindSyncIdCommand',
      impl: (
        { get },
        payload: { sourcePeerId: string; domain: string; direction: HistoryDirection; syncId: string }
      ) => {
        const bindings = get(HistorySyncBindingsState())
        const key = bindingKeyFor(payload)
        const current = bindings.get(key)
        // The first valid page zero (or connection acceptance) binds the sole id; a later
        // different id can never replace it, and a repeated bind is idempotent.
        if (current) return null
        const updated = new Map(bindings)
        updated.set(key, { syncId: payload.syncId, terminal: false })
        return HistorySyncBindingsState().new(updated)
      }
    })

    const TerminateSyncBindingCommand = domain.command({
      name: 'History.TerminateSyncBindingCommand',
      impl: (
        { get },
        payload: { sourcePeerId: string; domain: string; direction: HistoryDirection; syncId: string }
      ) => {
        const bindings = get(HistorySyncBindingsState())
        const key = bindingKeyFor(payload)
        const current = bindings.get(key)
        // Only the complete bound identity may terminalize its binding: late work from an old
        // incarnation (whose binding was cleared and re-bound) must not kill the replacement's
        // synchronization, and an already-terminal binding stays terminal.
        if (!current || current.syncId !== payload.syncId || current.terminal) return null
        const updated = new Map(bindings)
        updated.set(key, { ...current, terminal: true })
        return HistorySyncBindingsState().new(updated)
      }
    })

    const ClearSyncBindingsCommand = domain.command({
      name: 'History.ClearSyncBindingsCommand',
      impl: ({ get }, payload: { sourcePeerId: string; domain: string }) => {
        const bindings = get(HistorySyncBindingsState())
        const prefix = `${payload.sourcePeerId}\u0000${payload.domain}\u0000`
        const updated = new Map([...bindings].filter(([key]) => !key.startsWith(prefix)))
        return HistorySyncBindingsState().new(updated)
      }
    })

    const ClearDomainSyncBindingsCommand = domain.command({
      name: 'History.ClearDomainSyncBindingsCommand',
      impl: ({ get }, runtimeDomain: string) => {
        const bindings = get(HistorySyncBindingsState())
        const providerSuffix = `\u0000${runtimeDomain}\u0000provider`
        const requesterSuffix = `\u0000${runtimeDomain}\u0000requester`
        const updated = new Map(
          [...bindings].filter(([key]) => !key.endsWith(providerSuffix) && !key.endsWith(requesterSuffix))
        )
        return HistorySyncBindingsState().new(updated)
      }
    })

    // True only when every domain-owned History connection fact (requester/provider attempts,
    // successors, active/waiting supplies, admitted requester/provider jobs, and feedback owners)
    // has physically settled. Manual refresh waits on this before the replacement may bind new
    // History work.
    const DomainCleanupSettledQuery = domain.query({
      name: 'History.DomainCleanupSettledQuery',
      impl: ({ get }, runtimeDomain: string) =>
        !get(RequesterAttemptsState()).some((item) => item.domain === runtimeDomain) &&
        !get(ProviderAttemptsState()).some((item) => item.domain === runtimeDomain) &&
        !get(ProviderSupplySuccessorsState()).some((item) => item.domain === runtimeDomain) &&
        !get(ActiveSuppliesState()).some((item) => item.domain === runtimeDomain) &&
        !get(WaitingSuppliesState()).some((item) => item.domain === runtimeDomain) &&
        !get(ProviderSupplyJobsState()).some((item) => item.domain === runtimeDomain) &&
        !get(RequesterSupplyJobsState()).some((item) => item.domain === runtimeDomain) &&
        !get(FeedbackOwnersState()).some((item) => item.domain === runtimeDomain)
    })

    const CleanupProviderSlotsCommand = domain.command({
      name: 'History.CleanupProviderSlotsCommand',
      impl: ({ get }, payload: { domain: string; sourcePeerId: string }) => {
        const providers = get(ProviderAttemptsState())
        const successors = get(ProviderSupplySuccessorsState())
        const active = get(ActiveSuppliesState())
        const waiting = get(WaitingSuppliesState())
        const jobs = get(ProviderSupplyJobsState())
        // Dormant successors, waiting projections, and provider state are removed immediately.
        // Started active supplies stay in place (slot + accounting) and their live supplyId is
        // cancelled so the physical query aborts and settles promptly; the late-settlement path
        // then releases the slot exactly once. A fresh same-source request is still routed as a
        // dormant successor while an unsettled active entry for that source exists.
        // Canonical jobs are partitioned by actual active ownership: partial and waiting jobs
        // (which have no physical settlement callback to release them) are removed immediately so
        // the admission pool is not artificially saturated until the unrelated attempt timer;
        // only jobs whose key still occupies an active slot stay counted until that slot settles.
        const retainedJobs = jobs.filter((job) =>
          job.sourcePeerId === payload.sourcePeerId && job.domain === payload.domain
            ? active.some((item) => matchesSync(item, job))
            : true
        )
        const cancelled = active
          .filter((item) => item.sourcePeerId === payload.sourcePeerId && item.domain === payload.domain)
          .filter((item) => item.supplyId !== undefined)
          .map((item) => CancelActiveSupplyCommand({ key: item, supplyId: item.supplyId! }))
        // The connection binding (bound id + terminal bit) is cleared by the caller of cleanup
        // (session reset / peer removal / domain release), which ends the old connection's
        // synchronization entirely; a later connection starts one independent synchronization.
        return [
          ProviderAttemptsState().new(
            providers.filter((item) => item.sourcePeerId !== payload.sourcePeerId || item.domain !== payload.domain)
          ),
          ProviderSupplySuccessorsState().new(
            successors.filter((item) => item.sourcePeerId !== payload.sourcePeerId || item.domain !== payload.domain)
          ),
          WaitingSuppliesState().new(
            waiting.filter((item) => item.sourcePeerId !== payload.sourcePeerId || item.domain !== payload.domain)
          ),
          ProviderSupplyJobsState().new(retainedJobs),
          ...cancelled
        ]
      }
    })

    const ResetHistoryForSessionCommand = domain.command({
      name: 'History.ResetHistoryForSessionCommand',
      impl: ({ get }, payload: { domain: string; sourcePeerId: string }) => {
        const requesters = get(RequesterAttemptsState())
        const owners = get(FeedbackOwnersState())
        const dismissedOwners = owners.filter(
          (item) => item.sourcePeerId === payload.sourcePeerId && item.domain === payload.domain
        )
        // Source replacement clears the old connection's protocol bindings for the source+domain
        // and retires the old outgoing owner into a retained collection keyed by request identity:
        // its valid late pages still merge, while the replacement connection starts a fresh request.
        const retained = requesters.map((item) =>
          item.sourcePeerId === payload.sourcePeerId && item.domain === payload.domain && !item.retired
            ? { ...item, retired: true, loadingSettled: true }
            : item
        )
        const retiredRequesters = requesters.filter(
          (item) => item.sourcePeerId === payload.sourcePeerId && item.domain === payload.domain && !item.retired
        )
        const jobs = get(RequesterSupplyJobsState())
        // Job-aware retirement: a dormant successor is removed without starting (its dependency on
        // the unsettled predecessor is preserved by admission order, never by the removed job); a
        // live page supply is cancelled on one awaited settlement path so its own terminal finish
        // releases the job after physical settlement; a send-stage job keeps its in-flight send
        // and releases only at that wire settlement, so the replacement never starts over
        // still-active old physical work.
        const dormantTokens = new Set(
          retiredRequesters
            .map((item) => jobs.find((job) => matchesSync(job, item)))
            .filter((job) => job?.dormant)
            .map((job) => job!.syncToken)
        )
        const cancelSupplyIds = retiredRequesters.flatMap((item) => {
          const job = jobs.find((candidate) => matchesSync(candidate, item))
          return job && !job.dormant && job.supplyId && job.supplyId !== 'send' ? [job.supplyId] : []
        })
        return [
          ...(retained.some((item, index) => item !== requesters[index])
            ? [RequesterAttemptsState().new(retained)]
            : []),
          ...(dormantTokens.size > 0
            ? [RequesterSupplyJobsState().new(removeBy(jobs, (item) => dormantTokens.has(item.syncToken)))]
            : []),
          ...(cancelSupplyIds.length > 0 ? [CancelRequesterSuppliesEvent(cancelSupplyIds)] : []),
          ClearSyncBindingsCommand(payload),
          CleanupProviderSlotsCommand(payload),
          ...dismissedOwners.flatMap((item) => dismissFeedback(get, item) ?? []),
          StartRequestedEvent(payload)
        ]
      }
    })

    // ── Requester supply admission (one shared pool with provider work) ──────

    // Activates dormant requester jobs in admission order while their source slot and one shared
    // global active slot are free. Provider active entries and non-dormant requester jobs occupy
    // the same bound; a source slot holds at most one active requester job.
    const PromoteRequesterSuppliesCommand = domain.command({
      name: 'History.PromoteRequesterSuppliesCommand',
      impl: ({ get }) => {
        const jobs = get(RequesterSupplyJobsState())
        const freeSlots =
          MAX_PROVIDER_SUPPLY_CONCURRENCY - get(ActiveSuppliesState()).length - countActiveRequesterJobs(jobs)
        if (freeSlots <= 0) return null
        const activeSources = new Set(jobs.filter((item) => !item.dormant).map(sourceJobKey))
        const eligible: RequesterSupplyJob[] = []
        // A dormant job stays waiting while its own source predecessor is active or every shared
        // slot is taken; break bounds the promotion to the free slots and the scan order is the
        // admission order.
        for (const job of jobs) {
          if (eligible.length >= freeSlots) break
          if (!job.dormant || activeSources.has(sourceJobKey(job))) continue
          activeSources.add(sourceJobKey(job))
          eligible.push(job)
        }
        if (eligible.length === 0) return null
        const activated = new Set(eligible.map((item) => item.syncToken))
        return [
          RequesterSupplyJobsState().new(
            jobs.map((item) => (activated.has(item.syncToken) ? { ...item, dormant: false } : item))
          ),
          ...eligible.map(RequesterSupplyStartedEvent)
        ]
      }
    })

    // Admits one requester supply job into the shared global pool as a dormant successor of its
    // source slot; excess admitted work cancels the exact requester source-locally, and the job
    // starts physical work only when promotion activates it.
    const AdmitRequesterSupplyCommand = domain.command({
      name: 'History.AdmitRequesterSupplyCommand',
      impl: ({ get }, key: HistoryAttemptKey) => {
        const current = get(RequesterAttemptsState()).find((item) => matchesSync(item, key))
        if (!current || current.retired || current.inventoryPages.length > 0) return null
        const jobs = get(RequesterSupplyJobsState())
        if (jobs.some((item) => matchesSync(item, key))) return null
        const queueBytes = getTextByteSize(
          JSON.stringify({ domain: key.domain, syncId: key.syncId, cutoff: current.cutoff, mode: 'inventory' })
        )
        const providerJobs = get(ProviderSupplyJobsState())
        const successors = get(ProviderSupplySuccessorsState())
        const admittedBytes = [...providerJobs, ...successors, ...jobs].reduce(
          (total, item) => total + item.queueBytes,
          0
        )
        if (
          providerJobs.length + successors.length + jobs.length + 1 > MAX_PROVIDER_SUPPLY_QUEUE_JOBS ||
          admittedBytes + queueBytes > MAX_PROVIDER_SUPPLY_QUEUE_BYTES
        ) {
          // Excess admitted work cancels source-locally without reconnecting the room.
          return [FinishCurrentRequestedEvent(key)]
        }
        return [
          RequesterSupplyJobsState().new([...jobs, { ...key, queueBytes, dormant: true }]),
          PromoteRequesterSuppliesCommand()
        ]
      }
    })

    // Releases one admitted requester job at its true terminal stage (final send settlement,
    // terminal finish, or lifecycle cancellation), then shares any freed slot with one ready
    // provider waiter (preserving provider scheduling semantics) and eligible dormant requesters.
    const ReleaseRequesterSupplyJobCommand = domain.command({
      name: 'History.ReleaseRequesterSupplyJobCommand',
      impl: ({ get }, key: HistoryAttemptKey) => {
        const jobs = get(RequesterSupplyJobsState())
        if (!jobs.some((item) => matchesSync(item, key))) return null
        const remaining = removeBy(jobs, (item) => matchesSync(item, key))
        const waiting = get(WaitingSuppliesState())
        const active = get(ActiveSuppliesState())
        const slotFree = MAX_PROVIDER_SUPPLY_CONCURRENCY - active.length - countActiveRequesterJobs(remaining) > 0
        const next = slotFree ? waiting.find((item) => item.ready) : undefined
        return [
          RequesterSupplyJobsState().new(remaining),
          ...(next
            ? [
                ActiveSuppliesState().new([...active, next]),
                WaitingSuppliesState().new(waiting.filter((item) => item !== next)),
                ProviderSupplyRequestedEvent(next)
              ]
            : []),
          PromoteRequesterSuppliesCommand()
        ]
      }
    })

    // Records the live page-supply id (or the send-stage marker) on the admitted requester job so
    // lifecycle cleanup cancels exact physical work; the id stays until the job's terminal release.
    const RecordRequesterSupplyIdCommand = domain.command({
      name: 'History.RecordRequesterSupplyIdCommand',
      impl: ({ get }, payload: { key: HistoryAttemptKey; supplyId: string }) => {
        const jobs = get(RequesterSupplyJobsState())
        if (!jobs.some((item) => matchesSync(item, payload.key))) return null
        return RequesterSupplyJobsState().new(
          jobs.map((item) => (matchesSync(item, payload.key) ? { ...item, supplyId: payload.supplyId } : item))
        )
      }
    })

    // ── Requester inventory output (pages pre-built with the real codec) ───────

    const QueueInventoryPageCommand = domain.command({
      name: 'History.QueueInventoryPageCommand',
      impl: ({ get }, payload: RequesterAttemptState) => {
        const runtime = get(sessionDomain.query.DomainQuery(payload.domain))
        if (!runtime) return FinishCurrentRequestedEvent(payload)
        // A retired (superseded) requester never queues replacement inventory output: its response
        // collection still merges late pages, but the outgoing lane belongs to the replacement. The
        // admitted job releases here since no send will drive its settlement.
        const current = get(RequesterAttemptsState()).find((item) => matchesSync(item, payload))
        if (!current || current.retired) return ReleaseRequesterSupplyJobCommand(payload)
        const page = current.inventoryPages[current.nextInventoryPage]
        if (!page) return FinishCurrentRequestedEvent(payload)
        // Singleton scope: the sole physical target is the triggering source itself. The
        // Wire-peer intersection only excludes the local peer; a departed source yields an empty
        // target and the attempt finishes locally with no fallback target.
        const targetPeerIds = selectPeerIds([current.sourcePeerId], get(wireDomain.query.PeerIdQuery(runtime.roomId)))
        if (targetPeerIds.length === 0) return FinishCurrentRequestedEvent(payload)
        const requestId = `history:inventory:${payload.syncToken}:${current.nextInventoryPage}`
        return [
          PendingWireSendsState().new([
            ...removeBy(get(PendingWireSendsState()), (item) => item.requestId === requestId),
            {
              ...payload,
              type: 'inventory' as const,
              requestId,
              messageIds: page.messageIds,
              done: page.done
            }
          ]),
          wireDomain.command.SendMessageCommand({
            requestId,
            roomId: runtime.roomId,
            targetPeerIds,
            message: page
          })
        ]
      }
    })

    const ContinueRequesterInventoryCommand = domain.command({
      name: 'History.ContinueRequesterInventoryCommand',
      impl: ({ get }, requestId: string) => {
        const pending = get(PendingWireSendsState())
        const found = pending.find((item) => item.requestId === requestId && item.type === 'inventory')
        if (!found) return null
        const current = found as PendingInventorySend
        const requesters = get(RequesterAttemptsState())
        const attempt = requesters.find((item) => matchesSync(item, current))
        // Only a retired requester (real source replacement) stops sending targeted inventory; a
        // loading-settled one keeps sending so remaining providers still receive the request. The
        // settled send is consumed here and the admitted job releases at this true terminal stage
        // (or at the final done page's settlement) instead of being revoked mid-flight.
        if (!attempt || attempt.retired) {
          return [
            PendingWireSendsState().new(removeBy(pending, (item) => item.requestId === requestId)),
            ReleaseRequesterSupplyJobCommand(current)
          ]
        }
        const next: RequesterAttemptState = {
          ...attempt,
          nextInventoryPage: attempt.nextInventoryPage + 1
        }
        return [
          PendingWireSendsState().new(removeBy(pending, (item) => item.requestId === requestId)),
          RequesterAttemptsState().new(replaceBy(requesters, (item) => matchesSync(item, attempt), next)),
          ...(current.done ? [ReleaseRequesterSupplyJobCommand(current)] : [QueueInventoryPageCommand(next)])
        ]
      }
    })

    // ── Provider inventory input ────────────────────────────────────────────────

    const HandleInventoryPageCommand = domain.command({
      name: 'History.HandleInventoryPageCommand',
      impl: ({ get }, payload: WireMessageEvent & { message: HistoryMessagesPull }) => {
        const binding = get(
          sessionDomain.query.BindingQuery({ roomId: payload.roomId, sourcePeerId: payload.sourcePeerId })
        )
        if (!binding) return null
        // One synchronization per connection incarnation and direction: after the direction is
        // terminal, neither the same nor a different syncId may start History again on this
        // connection; while active, only the bound syncId progresses and a different id is inert
        // (it can never replace the bound id).
        const syncBinding = get(HistorySyncBindingsState()).get(
          bindingKeyFor({ sourcePeerId: payload.sourcePeerId, domain: binding.domain, direction: 'provider' })
        )
        if (syncBinding?.terminal) {
          return wireDomain.command.DropProtocolCommand({
            sourcePeerId: payload.sourcePeerId,
            reason: 'history sync already terminal for this connection'
          })
        }
        if (syncBinding && syncBinding.syncId !== payload.message.syncId) {
          return wireDomain.command.DropProtocolCommand({
            sourcePeerId: payload.sourcePeerId,
            reason: 'history sync identity does not match the connection binding'
          })
        }

        const providers = get(ProviderAttemptsState())
        const current = providers.find(
          (item) => item.sourcePeerId === payload.sourcePeerId && item.domain === binding.domain
        )
        const successors = get(ProviderSupplySuccessorsState())
        // A replacement request must become one dormant successor while ANY unsettled same-source
        // work exists (provider state OR an active supply entry), even after logical provider State
        // was invalidated by cleanup; it may start only after the old physical settlement releases.
        const unsettledActive = get(ActiveSuppliesState()).some(
          (item) => item.sourcePeerId === payload.sourcePeerId && item.domain === binding.domain
        )
        const successor = successors.find(
          (item) => item.sourcePeerId === payload.sourcePeerId && item.domain === binding.domain
        )
        const queueBytes = getTextByteSize(JSON.stringify(payload.message))

        // A replacement syncId while the old attempt is still supplying occupies one dormant
        // source-local successor; it runs nothing concurrently and promotes only after old settlement.
        // The successor applies the exact same request-page state machine as a current provider:
        // fingerprint replay idempotency, changed/gap/post-done cancellation, raw budgets,
        // inventoryDone, and a page-zero attempt timeout under its complete token.
        const activeSync = get(ActiveSuppliesState()).find(
          (item) => item.sourcePeerId === payload.sourcePeerId && item.domain === binding.domain
        )?.syncId
        if ((current || unsettledActive) && (current?.syncId ?? activeSync) !== payload.message.syncId) {
          if (successor && successor.syncId !== payload.message.syncId) return null
          const jobs = get(ProviderSupplyJobsState())
          // Upsert-aware admission: the successor's cumulative bytes are subtracted before the
          // check validates others + newCumulative (old + incoming page); an update at exactly 32
          // entries is allowed (only a NEW identity is bounded by the 32-job cap).
          const existingBytes = successor?.queueBytes ?? 0
          const hasExisting = Boolean(successor)
          const requesterJobs = get(RequesterSupplyJobsState())
          const admittedBytes = [...jobs, ...successors, ...requesterJobs].reduce(
            (total, item) => total + item.queueBytes,
            0
          )
          const nextCount = hasExisting
            ? jobs.length + successors.length + requesterJobs.length
            : jobs.length + successors.length + requesterJobs.length + 1
          const newCumulativeBytes = existingBytes + queueBytes
          if (
            nextCount > MAX_PROVIDER_SUPPLY_QUEUE_JOBS ||
            admittedBytes - existingBytes + newCumulativeBytes > MAX_PROVIDER_SUPPLY_QUEUE_BYTES
          ) {
            // Budget overflow terminates the existing dormant successor under its complete
            // identity (and still records the protocol-drop diagnostic); its canonical admission
            // state is released without touching other sources, and a later smaller page at the
            // same number cannot revive it.
            return [
              wireDomain.command.DropProtocolCommand({
                sourcePeerId: payload.sourcePeerId,
                reason: 'history provider queue limit reached'
              }),
              ...(successor
                ? [
                    CancelSuccessorCommand({
                      sourcePeerId: successor.sourcePeerId,
                      domain: successor.domain,
                      syncId: successor.syncId,
                      syncToken: successor.syncToken
                    })
                  ]
                : [])
            ]
          }
          const allocated = nextTokens(get, 1)
          const key: HistoryAttemptKey = {
            sourcePeerId: payload.sourcePeerId,
            domain: binding.domain,
            syncId: payload.message.syncId,
            syncToken: successor?.syncToken ?? token('provider', allocated.values[0])
          }
          const base = successor ?? {
            ...key,
            cutoff: historyCutoff(clock.now()),
            inventory: new Set<string>(),
            inventoryCount: 0,
            inventoryBytes: 0,
            expectedRequestPage: 0,
            inventoryDone: false,
            snapshot: [],
            nextResponsePage: 0,
            responseDone: false,
            queueBytes
          }
          const expectedPage = base.expectedRequestPage
          // Identical replay of the last applied page is idempotent; changed replay, gap,
          // out-of-order, empty non-final, or post-done input cancels and removes the
          // successor attempt under its complete token.
          if (payload.message.page === expectedPage - 1 && base.lastAppliedRequestPageFingerprint) {
            if (base.lastAppliedRequestPageFingerprint === JSON.stringify(payload.message)) {
              return [TokenState().new(allocated.next)]
            }
            return CancelSuccessorCommand(key)
          }
          if (
            payload.message.page !== expectedPage ||
            base.inventoryDone ||
            (payload.message.messageIds.length === 0 && !payload.message.done)
          ) {
            return CancelSuccessorCommand(key)
          }
          const inventory = new Set([...base.inventory, ...payload.message.messageIds])
          const inventoryCount = base.inventoryCount + payload.message.messageIds.length
          const inventoryBytes = base.inventoryBytes + queueBytes
          const nextSuccessor: ProviderSupplySuccessorState = {
            ...base,
            inventory,
            inventoryCount,
            inventoryBytes,
            // Canonical admission metadata accumulates with the inventory on every accepted page.
            queueBytes: inventoryBytes,
            expectedRequestPage: expectedPage + 1,
            lastAppliedRequestPageFingerprint: JSON.stringify(payload.message),
            inventoryDone: base.inventoryDone || payload.message.done
          }
          return [
            TokenState().new(allocated.next),
            ProviderSupplySuccessorsState().new(
              successor
                ? replaceBy(
                    successors,
                    (item) => item.sourcePeerId === payload.sourcePeerId && item.domain === binding.domain,
                    nextSuccessor
                  )
                : [...successors, nextSuccessor]
            ),
            // The successor attempt timeout is armed from page zero, not only after done. The
            // first valid successor page zero is the new connection's sole provider syncId and
            // binds it for the source+domain+provider direction.
            ...(successor
              ? []
              : [
                  BindSyncIdCommand({
                    sourcePeerId: payload.sourcePeerId,
                    domain: binding.domain,
                    direction: 'provider',
                    syncId: payload.message.syncId
                  }),
                  ProviderTimeoutArmedEvent(key)
                ])
          ]
        }

        // A delayed old inventory page carrying the SAME syncId as an unsettled active owner (after
        // cleanup removed logical provider State) must be idempotently ignored or rejected against
        // the old complete owner, never admitted as a new token/job beside the running query.
        if (!current && unsettledActive && activeSync === payload.message.syncId) {
          return null
        }
        const expectedPage = current?.expectedRequestPage ?? 0
        // Identical replay of the last applied inventory page is idempotent; changed replay, gap,
        // out-of-order, empty non-final, or post-done input cancels the attempt.
        if (payload.message.page === expectedPage - 1 && current) {
          if (current.lastAppliedRequestPageFingerprint === JSON.stringify(payload.message)) return null
          return CancelProviderAttemptCommand({
            sourcePeerId: payload.sourcePeerId,
            domain: binding.domain,
            syncId: current.syncId,
            syncToken: current.syncToken
          })
        }
        if (payload.message.page !== expectedPage) {
          return CancelProviderAttemptCommand({
            sourcePeerId: payload.sourcePeerId,
            domain: binding.domain,
            syncId: current?.syncId ?? payload.message.syncId,
            syncToken: current?.syncToken ?? ''
          })
        }
        if (current?.inventoryDone || (payload.message.messageIds.length === 0 && !payload.message.done)) {
          return CancelProviderAttemptCommand({
            sourcePeerId: payload.sourcePeerId,
            domain: binding.domain,
            syncId: current?.syncId ?? payload.message.syncId,
            syncToken: current?.syncToken ?? ''
          })
        }
        const jobs = get(ProviderSupplyJobsState())
        // Upsert-aware admission: the existing provider job is found by the COMPLETE sync identity,
        // its old cumulative bytes are subtracted, and the check validates others + newCumulative
        // (old + incoming page). An update at exactly 32 entries is allowed (only a NEW identity is
        // bounded by the 32-job cap).
        const currentKey = current ?? {
          sourcePeerId: payload.sourcePeerId,
          domain: binding.domain,
          syncId: payload.message.syncId,
          syncToken: token('provider', 0)
        }
        const existingJob = jobs.find(
          (item) =>
            item.sourcePeerId === currentKey.sourcePeerId &&
            item.domain === currentKey.domain &&
            item.syncId === currentKey.syncId &&
            item.syncToken === currentKey.syncToken
        )
        const existingBytes = existingJob?.queueBytes ?? 0
        const hasExisting = Boolean(existingJob)
        const requesterJobs = get(RequesterSupplyJobsState())
        const admittedBytes = [...jobs, ...successors, ...requesterJobs].reduce(
          (total, item) => total + item.queueBytes,
          0
        )
        const nextCount = hasExisting
          ? jobs.length + successors.length + requesterJobs.length
          : jobs.length + successors.length + requesterJobs.length + 1
        // newCumulativeBytes = existing cumulative (if any) + this page's bytes.
        const newCumulativeBytes = existingBytes + queueBytes
        if (
          nextCount > MAX_PROVIDER_SUPPLY_QUEUE_JOBS ||
          admittedBytes - existingBytes + newCumulativeBytes > MAX_PROVIDER_SUPPLY_QUEUE_BYTES
        ) {
          // Budget overflow terminates the matching provider attempt under its complete identity
          // (and still records the protocol-drop diagnostic); its canonical admission state is
          // released without touching other sources, and a later smaller page at the same number
          // cannot revive the terminated attempt.
          return [
            wireDomain.command.DropProtocolCommand({
              sourcePeerId: payload.sourcePeerId,
              reason: 'history provider queue limit reached'
            }),
            CancelProviderAttemptCommand(currentKey)
          ]
        }
        const allocated = nextTokens(get, 1)
        const key: HistoryAttemptKey = {
          sourcePeerId: payload.sourcePeerId,
          domain: binding.domain,
          syncId: payload.message.syncId,
          syncToken: current?.syncToken ?? token('provider', allocated.values[0])
        }
        const inventory = new Set([...(current?.inventory ?? []), ...payload.message.messageIds])
        const inventoryCount = (current?.inventoryCount ?? 0) + payload.message.messageIds.length
        const inventoryBytes = (current?.inventoryBytes ?? 0) + queueBytes
        const next: ProviderAttemptState = current
          ? {
              ...current,
              inventory,
              inventoryCount,
              inventoryBytes,
              expectedRequestPage: expectedPage + 1,
              lastAppliedRequestPageFingerprint: JSON.stringify(payload.message),
              inventoryDone: current.inventoryDone || payload.message.done
            }
          : {
              ...key,
              cutoff: historyCutoff(clock.now()),
              inventory,
              inventoryCount,
              inventoryBytes,
              expectedRequestPage: expectedPage + 1,
              lastAppliedRequestPageFingerprint: JSON.stringify(payload.message),
              inventoryDone: payload.message.done,
              snapshot: [],
              nextResponsePage: 0,
              responseDone: false
            }
        return [
          TokenState().new(allocated.next),
          ProviderAttemptsState().new(
            replaceBy(
              providers,
              (item) => item.sourcePeerId === payload.sourcePeerId && item.domain === binding.domain,
              next
            )
          ),
          // One canonical admission record is upserted on every accepted page: its cumulative
          // metadata bytes are updated, and it transitions to ready exactly once on the final page.
          // The attempt timeout is armed from page zero. The first valid page zero binds this
          // connection's sole provider syncId for the source+domain+provider direction.
          ...(current
            ? []
            : [
                BindSyncIdCommand({
                  sourcePeerId: payload.sourcePeerId,
                  domain: binding.domain,
                  direction: 'provider',
                  syncId: payload.message.syncId
                }),
                ProviderTimeoutArmedEvent(key)
              ]),
          AdmitProviderSupplyCommand({
            ...key,
            queueBytes: next.inventoryBytes,
            ready: next.inventoryDone
          })
        ]
      }
    })

    const ScheduleProviderSupplyCommand = domain.command({
      name: 'History.ScheduleProviderSupplyCommand',
      impl: ({ get }, request: ProviderSupplyPayload) => {
        const active = get(ActiveSuppliesState())
        const waiting = get(WaitingSuppliesState())
        if (active.some((item) => matchesSync(item, request))) return null
        // The shared supplier-to-send bound: provider active entries and non-dormant requester
        // jobs occupy the same four slots.
        if (
          active.length + countActiveRequesterJobs(get(RequesterSupplyJobsState())) >=
          MAX_PROVIDER_SUPPLY_CONCURRENCY
        ) {
          if (waiting.some((item) => matchesSync(item, request))) return null
          return WaitingSuppliesState().new([...waiting, request])
        }
        return [ActiveSuppliesState().new([...active, request]), ProviderSupplyRequestedEvent(request)]
      }
    })

    const AdmitProviderSupplyCommand = domain.command({
      name: 'History.AdmitProviderSupplyCommand',
      impl: ({ get }, request: ProviderSupplyPayload) => {
        // One canonical admission owner per attempt: the job record is upserted (cumulative metadata
        // bytes replaced) on every accepted page; active/waiting are scheduling projections of the
        // same record, never separate admission-count owners. 32 jobs / 8KiB bound the pool.
        const jobs = get(ProviderSupplyJobsState())
        const existing = jobs.find((item) => matchesSync(item, request))
        const nextJobs = existing
          ? replaceBy(jobs, (item) => matchesSync(item, request), { ...existing, ...request })
          : [...jobs, { ...request }]
        if (existing && !request.ready && existing.ready) {
          // A ready attempt must never regress; only an accounting update is allowed.
          return [ProviderSupplyJobsState().new(nextJobs)]
        }
        const admitted = nextJobs
        const requesterJobs = get(RequesterSupplyJobsState())
        if (
          admitted.length + requesterJobs.length > MAX_PROVIDER_SUPPLY_QUEUE_JOBS ||
          admitted.reduce((total, item) => total + item.queueBytes, 0) +
            requesterJobs.reduce((total, item) => total + item.queueBytes, 0) >
            MAX_PROVIDER_SUPPLY_QUEUE_BYTES
        ) {
          return null
        }
        if (!request.ready) {
          return [ProviderSupplyJobsState().new(nextJobs)]
        }
        // Transition to ready: schedule the supplier when a slot is free, else queue the projection.
        const active = get(ActiveSuppliesState())
        const waiting = get(WaitingSuppliesState())
        if (
          active.length + countActiveRequesterJobs(get(RequesterSupplyJobsState())) >=
          MAX_PROVIDER_SUPPLY_CONCURRENCY
        ) {
          if (waiting.some((item) => matchesSync(item, request))) {
            return [ProviderSupplyJobsState().new(nextJobs)]
          }
          return [ProviderSupplyJobsState().new(nextJobs), WaitingSuppliesState().new([...waiting, request])]
        }
        if (active.some((item) => matchesSync(item, request))) {
          return [ProviderSupplyJobsState().new(nextJobs)]
        }
        return [
          ProviderSupplyJobsState().new(nextJobs),
          ActiveSuppliesState().new([...active, request]),
          ProviderSupplyRequestedEvent(request)
        ]
      }
    })

    const ReleaseProviderSupplySlotCommand = domain.command({
      name: 'History.ReleaseProviderSupplySlotCommand',
      impl: ({ get }, key: HistoryAttemptKey) => {
        const activeList = get(ActiveSuppliesState())
        // A slot is released only when the exact key actually occupies one; otherwise no waiter
        // may be promoted (the global concurrency cap must never be exceeded).
        const wasActive = activeList.some((item) => matchesSync(item, key))
        const active = wasActive ? removeBy(activeList, (item) => matchesSync(item, key)) : activeList
        const waiting = get(WaitingSuppliesState())
        const next = wasActive ? waiting.find((item) => item.ready) : undefined
        // A freed shared slot then activates eligible dormant requester jobs (a taken slot makes
        // that promotion a no-op).
        return [
          ActiveSuppliesState().new(next ? [...active, next] : active),
          WaitingSuppliesState().new(next ? waiting.filter((item) => item !== next) : waiting),
          ...(next ? [ProviderSupplyRequestedEvent(next)] : []),
          PromoteRequesterSuppliesCommand()
        ]
      }
    })

    const CancelSuccessorCommand = domain.command({
      name: 'History.CancelSuccessorCommand',
      impl: ({ get }, key: HistoryAttemptKey) => {
        const successors = get(ProviderSupplySuccessorsState())
        if (!successors.some((item) => matchesSync(item, key))) return null
        // The successor's synchronization is terminal for its connection direction.
        return [
          TerminateSyncBindingCommand({
            sourcePeerId: key.sourcePeerId,
            domain: key.domain,
            direction: 'provider',
            syncId: key.syncId
          }),
          ProviderSupplySuccessorsState().new(removeBy(successors, (item) => matchesSync(item, key)))
        ]
      }
    })

    const CancelProviderAttemptCommand = domain.command({
      name: 'History.CancelProviderAttemptCommand',
      impl: ({ get }, key: HistoryAttemptKey) => {
        const providers = get(ProviderAttemptsState())
        const owners = get(FeedbackOwnersState())
        const current = providers.find((item) => matchesSync(item, key))
        const ownerActive = owners.some((item) => feedbackMatches(item, key))
        const successors = get(ProviderSupplySuccessorsState())
        const successor = successors.find(
          (item) => item.sourcePeerId === key.sourcePeerId && item.domain === key.domain
        )
        const jobs = get(ProviderSupplyJobsState())
        const active = get(ActiveSuppliesState())
        const waiting = get(WaitingSuppliesState())
        const hasSlotAccounting =
          jobs.some((item) => matchesSync(item, key)) ||
          active.some((item) => matchesSync(item, key)) ||
          waiting.some((item) => matchesSync(item, key))
        if (!current && !ownerActive && !successor && !hasSlotAccounting) {
          // Invalid input without an admitted job has no bound synchronization to terminalize;
          // the direction stays unbound until a first valid page zero binds its sole id.
          return null
        }
        // Completion, cancellation, and failure retain the bound syncId plus one terminal bit:
        // neither the same nor a different syncId can restart History on this connection.
        const terminate = TerminateSyncBindingCommand({
          sourcePeerId: key.sourcePeerId,
          domain: key.domain,
          direction: 'provider',
          syncId: key.syncId
        })
        const liveActive = active.find((item) => matchesSync(item, key))
        if (!current) {
          // While the physical supply is still live (recorded supplyId not yet cleared by its
          // settlement), the slot accounting and any dormant successor stay in place: release and
          // promotion happen only at the late-settlement boundary after physical exit.
          if (liveActive?.supplyId) {
            return [terminate, CancelActiveSupplyCommand({ key, supplyId: liveActive.supplyId })]
          }
          // Late supplier settlement after cleanup: release the slot accounting exactly once so no
          // active/waiting slot leaks, even when the provider state is already gone. A dormant
          // successor (same source, different syncId) is atomically transferred: it becomes the
          // current provider with its canonical job, preserving its exact inventory/ready state
          // and cumulative metadata; supplier work is scheduled only when its inventory is
          // complete, and later inventory pages continue the transferred attempt. Its attempt
          // deadline was already armed at page-zero admission and is transferred, not re-armed.
          const validSuccessor = successor && successor.syncId !== key.syncId ? successor : null
          if (validSuccessor) {
            const ready = validSuccessor.inventoryDone
            return [
              terminate,
              ProviderAttemptsState().new([...providers, { ...validSuccessor }]),
              ProviderSupplySuccessorsState().new(
                removeBy(
                  get(ProviderSupplySuccessorsState()),
                  (item) => item.sourcePeerId === key.sourcePeerId && item.domain === key.domain
                )
              ),
              ProviderSupplyJobsState().new([
                ...removeBy(jobs, (item) => matchesSync(item, key)),
                {
                  sourcePeerId: validSuccessor.sourcePeerId,
                  domain: validSuccessor.domain,
                  syncId: validSuccessor.syncId,
                  syncToken: validSuccessor.syncToken,
                  queueBytes: validSuccessor.inventoryBytes,
                  ready
                }
              ]),
              ...(ready
                ? [
                    ScheduleProviderSupplyCommand({
                      sourcePeerId: validSuccessor.sourcePeerId,
                      domain: validSuccessor.domain,
                      syncId: validSuccessor.syncId,
                      syncToken: validSuccessor.syncToken,
                      queueBytes: validSuccessor.inventoryBytes,
                      ready: true
                    })
                  ]
                : []),
              ...(hasSlotAccounting ? [ReleaseProviderSupplySlotCommand(key)] : [])
            ]
          }
          return [
            terminate,
            ProviderSupplySuccessorsState().new(
              removeBy(
                get(ProviderSupplySuccessorsState()),
                (item) => item.sourcePeerId === key.sourcePeerId && item.domain === key.domain
              )
            ),
            ProviderSupplyJobsState().new(removeBy(jobs, (item) => matchesSync(item, key))),
            ...(hasSlotAccounting ? [ReleaseProviderSupplySlotCommand(key)] : [])
          ]
        }
        // A started current provider with a still-live supply must not release its slot or
        // schedule its successor before the physical query/projection chain confirms exit: cancel
        // the live supplyId, remove the provider state, and keep the canonical job, the active
        // slot accounting, and any dormant successor until the late-settlement boundary transfers
        // them (the effect re-checks the attempt after physical settlement).
        if (liveActive?.supplyId) {
          return [
            terminate,
            CancelActiveSupplyCommand({ key, supplyId: liveActive.supplyId }),
            ProviderAttemptsState().new(removeBy(providers, (item) => matchesSync(item, key))),
            ...(dismissFeedback(get, key) ?? [])
          ]
        }
        const successorJob: ProviderSupplyJobState = successor
          ? {
              sourcePeerId: successor.sourcePeerId,
              domain: successor.domain,
              syncId: successor.syncId,
              syncToken: successor.syncToken,
              queueBytes: successor.inventoryBytes,
              ready: successor.inventoryDone
            }
          : (null as unknown as ProviderSupplyJobState)
        const promotion = successor
          ? [
              // One atomic job-state transition: the old job is removed and the transferred
              // successor's canonical job is installed in the same update, preserving its exact
              // inventory/ready state; supplier work is scheduled only when its inventory is
              // complete. The successor's attempt deadline stays the page-zero-armed one.
              ProviderAttemptsState().new([...removeBy(providers, (item) => matchesSync(item, key)), { ...successor }]),
              ProviderSupplySuccessorsState().new(
                removeBy(
                  get(ProviderSupplySuccessorsState()),
                  (item) => item.sourcePeerId === key.sourcePeerId && item.domain === key.domain
                )
              ),
              ProviderSupplyJobsState().new([
                ...removeBy(get(ProviderSupplyJobsState()), (item) => matchesSync(item, key)),
                successorJob
              ])
            ]
          : [
              ProviderAttemptsState().new(removeBy(providers, (item) => matchesSync(item, key))),
              ProviderSupplySuccessorsState().new(
                removeBy(
                  get(ProviderSupplySuccessorsState()),
                  (item) => item.sourcePeerId === key.sourcePeerId && item.domain === key.domain
                )
              ),
              ProviderSupplyJobsState().new(removeBy(get(ProviderSupplyJobsState()), (item) => matchesSync(item, key)))
            ]
        // The transferred successor is scheduled (active or waiting) only once complete.
        const schedule =
          successor && successor.inventoryDone
            ? [
                ScheduleProviderSupplyCommand({
                  sourcePeerId: successor.sourcePeerId,
                  domain: successor.domain,
                  syncId: successor.syncId,
                  syncToken: successor.syncToken,
                  queueBytes: successor.inventoryBytes,
                  ready: true
                })
              ]
            : []
        // A slot is released only when the exact key actually occupied one; a canceled partial or
        // waiting key is removed from waiting independently so canceled work never starts and the
        // active pool never exceeds its cap.
        const waitingRemoval = liveActive
          ? []
          : [WaitingSuppliesState().new(waiting.filter((item) => !matchesSync(item, key)))]
        return [
          terminate,
          ...promotion,
          ...schedule,
          ...waitingRemoval,
          ...(dismissFeedback(get, key) ?? []),
          ...(liveActive ? [ReleaseProviderSupplySlotCommand(key)] : [])
        ]
      }
    })

    // ── Provider snapshot + response output ─────────────────────────────────────

    const QueueProviderResponseCommand = domain.command({
      name: 'History.QueueProviderResponseCommand',
      impl: (
        { get },
        payload: HistoryAttemptKey & {
          records: ChatMessageRecord[]
          remaining: ChatMessageRecord[]
          terminal: boolean
        }
      ) => {
        const runtime = get(sessionDomain.query.DomainQuery(payload.domain))
        if (!runtime) return CancelProviderAttemptCommand(payload)
        const providers = get(ProviderAttemptsState())
        const current = providers.find((item) => matchesSync(item, payload))
        if (!current) return null
        const slice = payload.records.slice(0, MAX_HISTORY_RESPONSE_MESSAGES)
        // Page from one combined ordered work list: the retained tail is never dropped.
        const tail = [...payload.records.slice(MAX_HISTORY_RESPONSE_MESSAGES), ...payload.remaining]
        const pageDone = payload.terminal && tail.length === 0
        const response: HistoryMessagesPush = {
          type: MESSAGE_TYPE.HISTORY_MESSAGES_PUSH,
          syncId: payload.syncId,
          page: current.nextResponsePage,
          users: usersForRecords(slice),
          messages: slice.map((record) => record.message),
          done: pageDone
        }
        const requestId = `history:provider:${payload.syncToken}:${current.nextResponsePage}`
        const pending: PendingProviderSend = {
          ...payload,
          type: 'provider',
          requestId,
          records: slice,
          remaining: tail,
          terminal: payload.terminal,
          done: pageDone
        }
        return [
          PendingWireSendsState().new([
            ...removeBy(get(PendingWireSendsState()), (item) => item.type === 'provider' && matchesSync(item, payload)),
            pending
          ]),
          wireDomain.command.SendMessageCommand({
            requestId,
            roomId: runtime.roomId,
            targetPeerIds: [payload.sourcePeerId],
            message: response
          })
        ]
      }
    })

    const CompleteProviderResponseCommand = domain.command({
      name: 'History.CompleteProviderResponseCommand',
      impl: ({ get }, requestId: string) => {
        const pending = get(PendingWireSendsState())
        const found = pending.find((item) => item.requestId === requestId && item.type === 'provider')
        if (!found) return null
        const current = found as PendingProviderSend
        const providers = get(ProviderAttemptsState())
        const attempt = providers.find((item) => matchesSync(item, current))
        const clear = PendingWireSendsState().new(removeBy(pending, (item) => item.requestId === requestId))
        if (!attempt) {
          // The response send settled but the attempt was logically invalidated (cleanup/cancel)
          // while the send was invoked: the send settlement still releases the retained slot and
          // canonical job exactly once.
          return [clear, ClearActiveSupplyIdCommand({ key: current }), CancelProviderAttemptCommand(current)]
        }
        const next: ProviderAttemptState = {
          ...attempt,
          nextResponsePage: attempt.nextResponsePage + 1,
          responseDone: current.done
        }
        return [
          clear,
          ProviderAttemptsState().new(replaceBy(providers, (item) => matchesSync(item, attempt), next)),
          ...(current.remaining.length > 0
            ? [
                QueueProviderResponseCommand({
                  ...current,
                  records: current.remaining,
                  remaining: [],
                  terminal: current.terminal
                })
              ]
            : current.terminal
              ? [
                  // The final send settled: clear the stage marker and release the slot exactly
                  // once (the cancellation path then releases/promotes immediately).
                  ClearActiveSupplyIdCommand({ key: current }),
                  CancelProviderAttemptCommand(current)
                ]
              : [])
        ]
      }
    })

    const FailWireSendCommand = domain.command({
      name: 'History.FailWireSendCommand',
      impl: ({ get }, payload: { requestId: string; error: Error; stage?: WireFailureStage }) => {
        const pending = get(PendingWireSendsState())
        const current = pending.find((item) => item.requestId === payload.requestId)
        if (!current) return null
        const clear = PendingWireSendsState().new(removeBy(pending, (item) => item.requestId === payload.requestId))
        if (current.type === 'inventory') {
          return [
            clear,
            ErrorEvent({ error: payload.error, domain: current.domain }),
            FinishCurrentRequestedEvent(current)
          ]
        }
        if (payload.stage === 'preflight') {
          // The oversized record moves to the front of the retained tail and keeps paginating; the
          // page is never truncated to a false terminal. If no sendable record remains (including a
          // single unencodable leading record with a retained tail), cancel the attempt immediately
          // instead of emitting an empty non-final page that would loop until timeout.
          const dropped = current.records[current.records.length - 1]
          const shrunk = current.records.slice(0, -1)
          if (shrunk.length === 0) {
            return [
              clear,
              ErrorEvent({ error: payload.error, domain: current.domain }),
              ClearActiveSupplyIdCommand({ key: current }),
              CancelProviderAttemptCommand(current)
            ]
          }
          return [
            clear,
            QueueProviderResponseCommand({
              ...current,
              records: shrunk,
              remaining: [dropped, ...current.remaining],
              terminal: current.terminal
            })
          ]
        }
        return [
          clear,
          ErrorEvent({ error: payload.error, domain: current.domain }),
          ClearActiveSupplyIdCommand({ key: current }),
          CancelProviderAttemptCommand(current)
        ]
      }
    })

    // ── Requester response input (bounded serial queue + replay controls) ──────

    const prepareResponsePage = (
      current: RequesterAttemptState,
      provider: ProviderResponseState,
      payload: WireMessageEvent & { message: HistoryMessagesPush }
    ):
      | {
          ok: false
          action: ReturnType<typeof FinishRequestedEvent> | ReturnType<typeof wireDomain.command.DropProtocolCommand>
        }
      | { ok: true; page: HistoryMessagesPush } => {
      if (provider.responseDone) {
        return {
          ok: false,
          action: FinishRequestedEvent({
            domain: current.domain,
            syncId: current.syncId,
            providerId: payload.sourcePeerId
          })
        }
      }
      const ordered = payload.message.messages.every(
        (event, index) => index === 0 || compareEventPosition(payload.message.messages[index - 1], event) > 0
      )
      if (!ordered) {
        return {
          ok: false,
          action: wireDomain.command.DropProtocolCommand({
            sourcePeerId: payload.sourcePeerId,
            reason: 'history response is not strictly recent-first'
          })
        }
      }
      if (payload.message.messages.length > 0 && provider.lastResponsePosition) {
        const newest = payload.message.messages[0]
        if (compareEventPosition(provider.lastResponsePosition, newest) <= 0) {
          return {
            ok: false,
            action: wireDomain.command.DropProtocolCommand({
              sourcePeerId: payload.sourcePeerId,
              reason: 'history response is not strictly recent-first across pages'
            })
          }
        }
      }
      return { ok: true, page: payload.message }
    }

    const ApplyResponsePageCommand = domain.command({
      name: 'History.ApplyResponsePageCommand',
      impl: ({ get }, payload: WireMessageEvent & { message: HistoryMessagesPush }) => {
        // A valid response page is accepted by its domain request identity regardless of the
        // provider's current connection state: offline, generation replacement, or a closed
        // loading never drops a valid associated page.
        const domain = get(sessionDomain.query.RoomDomainQuery(payload.roomId))
        if (!domain) return null
        const requesterBinding = get(HistorySyncBindingsState()).get(
          bindingKeyFor({ sourcePeerId: payload.sourcePeerId, domain, direction: 'requester' })
        )
        if (requesterBinding?.terminal) {
          return wireDomain.command.DropProtocolCommand({
            sourcePeerId: payload.sourcePeerId,
            reason: 'history sync already terminal for this connection'
          })
        }

        const requesters = get(RequesterAttemptsState())
        const current = requesters.find((item) => item.domain === domain && item.syncId === payload.message.syncId)
        if (!current) return null
        // The sync id is not a bearer credential: only the source peer that owns this requester may
        // create or advance its response lane. A different peer using the exact id must be inert,
        // including no delivery, lane, feedback, or finish mutation.
        if (current.sourcePeerId !== payload.sourcePeerId) return null
        const binding = { domain }
        const provider = current.providers[payload.sourcePeerId] ?? newProviderResponseState()
        const withProvider = (lane: ProviderResponseState): RequesterAttemptState => ({
          ...current,
          providers: { ...current.providers, [payload.sourcePeerId]: lane }
        })
        if (provider.awaitingBatchId) {
          // While a batch is pending: replay fingerprint matching runs FIRST, so an identical replay
          // of the accepted page or of any queued page (including a queued terminal page) is
          // idempotent and a changed replay cancels. Only then does the terminal fence reject any
          // post-done or post-queued-terminal page, and valid continuous pages (N+1, N+2, ...) join
          // the bounded serial queue in order.
          const fingerprint = JSON.stringify(payload.message)
          const queued = provider.pendingResponsePages
          const queuedMatch = queued.find((item) => item.page === payload.message.page)
          if (queuedMatch) {
            return JSON.stringify(queuedMatch) === fingerprint
              ? null
              : FinishRequestedEvent({
                  domain: current.domain,
                  syncId: current.syncId,
                  providerId: payload.sourcePeerId
                })
          }
          if (payload.message.page === provider.expectedResponsePage - 1) {
            return provider.lastAppliedPageFingerprint === fingerprint
              ? null
              : FinishRequestedEvent({
                  domain: current.domain,
                  syncId: current.syncId,
                  providerId: payload.sourcePeerId
                })
          }
          if (provider.responseDone || queued.some((item) => item.done)) {
            return FinishRequestedEvent({
              domain: current.domain,
              syncId: current.syncId,
              providerId: payload.sourcePeerId
            })
          }
          if (payload.message.page === provider.queuedResponseTail) {
            if (queued.length >= MAX_PENDING_RESPONSE_PAGES) {
              return FinishRequestedEvent({
                domain: current.domain,
                syncId: current.syncId,
                providerId: payload.sourcePeerId
              })
            }
            return RequesterAttemptsState().new(
              replaceBy(
                requesters,
                (item) => matchesSync(item, current),
                withProvider({
                  ...provider,
                  pendingResponsePages: [...queued, payload.message],
                  queuedResponseTail: provider.queuedResponseTail + 1
                })
              )
            )
          }
          return FinishRequestedEvent({
            domain: current.domain,
            syncId: current.syncId,
            providerId: payload.sourcePeerId
          })
        }
        if (payload.message.page !== provider.expectedResponsePage) {
          // Identical replay of the last applied page is idempotent; anything else (gap,
          // out-of-order, changed replay) cancels the attempt.
          const fingerprint = JSON.stringify(payload.message)
          if (
            payload.message.page === provider.expectedResponsePage - 1 &&
            provider.lastAppliedPageFingerprint === fingerprint
          ) {
            return null
          }
          return FinishRequestedEvent({
            domain: current.domain,
            syncId: current.syncId,
            providerId: payload.sourcePeerId
          })
        }
        const prepared = prepareResponsePage(current, provider, payload)
        if (!prepared.ok) return prepared.action
        const page = prepared.page
        const expectedHlc = get(sessionDomain.query.HlcQuery())
        let hlc = expectedHlc
        const records: ChatMessageRecord[] = []
        // before any record is built, and observeHlc threads ordered per-item clock state
        for (const event of page.messages) {
          if (event.hlc.timestamp < current.cutoff) {
            return FinishRequestedEvent({
              domain: current.domain,
              syncId: current.syncId,
              providerId: payload.sourcePeerId
            })
          }
          const user =
            page.users.find((candidate) => candidate.id === event.userId) ??
            ({ id: event.userId, name: event.userId, avatar: '' } satisfies ChatUser)
          const observed = observeHlc(hlc, event.hlc, clock.now())
          if (!observed) continue
          hlc = observed
          records.push(makeRecord(event, user, clock.now()))
        }
        const allocated = nextTokens(get, 1)
        const batchId = token('batch', allocated.values[0])
        const oldest = records.length > 0 ? records[records.length - 1].message : undefined
        const next: RequesterAttemptState = withProvider({
          ...provider,
          expectedResponsePage: provider.expectedResponsePage + 1,
          lastResponsePosition: oldest ? { hlc: oldest.hlc, id: oldest.id } : provider.lastResponsePosition,
          awaitingBatchId: batchId,
          finalBatch: page.done,
          responseDone: page.done,
          lastAppliedPageFingerprint: JSON.stringify(page),
          queuedResponseTail: Math.max(provider.queuedResponseTail, provider.expectedResponsePage + 1)
        })
        return [
          TokenState().new(allocated.next),
          sessionDomain.command.UpdateHlcCommand({ expected: expectedHlc, next: hlc }),
          RequesterAttemptsState().new(replaceBy(requesters, (item) => matchesSync(item, current), next)),
          deliveryDomain.command.AcceptInboundBatchCommand({
            domain: binding.domain,
            records,
            source: 'history',
            batchId
          })
        ]
      }
    })

    const ContinueRequesterBatchCommand = domain.command({
      name: 'History.ContinueRequesterBatchCommand',
      impl: ({ get }, payload: { domain: string; batchId: string; inserted: boolean }) => {
        const requesters = get(RequesterAttemptsState())
        const current = requesters.find(
          (item) =>
            item.domain === payload.domain &&
            Object.values(item.providers).some((lane) => lane.awaitingBatchId === payload.batchId)
        )
        if (!current) return null
        const providerEntry = Object.entries(current.providers).find(
          ([, lane]) => lane.awaitingBatchId === payload.batchId
        )
        if (!providerEntry) return null
        const [providerId, lane] = providerEntry
        const withLane = (nextLane: ProviderResponseState): RequesterAttemptState => ({
          ...current,
          providers: { ...current.providers, [providerId]: nextLane }
        })
        const activation = payload.inserted && !current.feedbackActive
        const queued = lane.pendingResponsePages[0]
        const nextLane: ProviderResponseState = {
          ...lane,
          awaitingBatchId: undefined,
          pendingResponsePages: queued ? lane.pendingResponsePages.slice(1) : [],
          queuedResponseTail: queued ? lane.queuedResponseTail : lane.queuedResponseTail
        }
        const next: RequesterAttemptState = {
          ...withLane(nextLane),
          feedbackActive: current.feedbackActive || payload.inserted
        }
        const output: RemeshCommandOutput[] = [
          RequesterAttemptsState().new(replaceBy(requesters, (item) => matchesSync(item, current), next)),
          ...(activation ? (activateFeedback(get, current) ?? []) : []),
          ...(lane.finalBatch
            ? [FinishRequestedEvent({ domain: current.domain, syncId: current.syncId, providerId })]
            : [])
        ]
        if (!lane.finalBatch && queued) {
          // Dequeue must re-validate the page number: a stale or duplicated queued page that no
          // longer matches the expected page cancels the lane instead of being applied.
          if (queued.page !== nextLane.expectedResponsePage) {
            output.push(FinishRequestedEvent({ domain: current.domain, syncId: current.syncId, providerId }))
            return output
          }
          const prepared = prepareResponsePage(next, nextLane, {
            roomId: '',
            sourcePeerId: providerId,
            message: queued
          })
          if (!prepared.ok) {
            output.push(prepared.action)
          } else {
            const page = prepared.page
            const expectedHlc = get(sessionDomain.query.HlcQuery())
            let hlc = expectedHlc
            const records: ChatMessageRecord[] = []
            // and continue skips events observeHlc rejects while threading ordered clock state
            for (const event of page.messages) {
              if (event.hlc.timestamp < next.cutoff) {
                output.push(FinishRequestedEvent({ domain: current.domain, syncId: current.syncId, providerId }))
                break
              }
              const user =
                page.users.find((candidate) => candidate.id === event.userId) ??
                ({ id: event.userId, name: event.userId, avatar: '' } satisfies ChatUser)
              const observed = observeHlc(hlc, event.hlc, clock.now())
              if (!observed) continue
              hlc = observed
              records.push(makeRecord(event, user, clock.now()))
            }
            if (records.length === page.messages.length) {
              const allocated = nextTokens(get, 1)
              const batchId = token('batch', allocated.values[0])
              const oldest = records.length > 0 ? records[records.length - 1].message : undefined
              const appliedLane: ProviderResponseState = {
                ...nextLane,
                expectedResponsePage: nextLane.expectedResponsePage + 1,
                lastResponsePosition: oldest ? { hlc: oldest.hlc, id: oldest.id } : nextLane.lastResponsePosition,
                awaitingBatchId: batchId,
                finalBatch: page.done,
                responseDone: page.done,
                lastAppliedPageFingerprint: JSON.stringify(page)
              }
              const applied: RequesterAttemptState = {
                ...next,
                providers: { ...next.providers, [providerId]: appliedLane }
              }
              output.push(
                TokenState().new(allocated.next),
                sessionDomain.command.UpdateHlcCommand({ expected: expectedHlc, next: hlc }),
                RequesterAttemptsState().new(replaceBy(requesters, (item) => matchesSync(item, current), applied)),
                deliveryDomain.command.AcceptInboundBatchCommand({
                  domain: current.domain,
                  records,
                  source: 'history',
                  batchId
                })
              )
            }
          }
        }
        return output
      }
    })

    const DiscardRequesterBatchCommand = domain.command({
      name: 'History.DiscardRequesterBatchCommand',
      impl: ({ get }, payload: { domain: string; batchId: string }) => {
        const current = get(RequesterAttemptsState()).find(
          (item) =>
            item.domain === payload.domain &&
            Object.values(item.providers).some((lane) => lane.awaitingBatchId === payload.batchId)
        )
        const providerEntry =
          current && Object.entries(current.providers).find(([, lane]) => lane.awaitingBatchId === payload.batchId)
        return current && providerEntry
          ? FinishRequestedEvent({ domain: current.domain, syncId: current.syncId, providerId: providerEntry[0] })
          : null
      }
    })

    const RemovePeerCommand = domain.command({
      name: 'History.RemovePeerCommand',
      impl: ({ get }, payload: { domain: string; sourcePeerId: string }) => {
        const requesters = get(RequesterAttemptsState())
        const owners = get(FeedbackOwnersState())
        // A departing provider closes the loading of EVERY active requester it owns — under
        // singleton scope that is exactly the requester whose triggering source is the departing
        // peer: it does not terminalize the lane, clear accepted queued pages, or make a later
        // otherwise valid associated page ineligible.
        const affected = requesters.filter(
          (item) => item.domain === payload.domain && !item.retired && item.sourcePeerId === payload.sourcePeerId
        )
        return [
          ...affected.filter((item) => !item.loadingSettled).map((item) => SettleLoadingCommand(item)),
          CleanupProviderSlotsCommand(payload),
          ClearSyncBindingsCommand(payload),
          ...owners
            .filter((item) => item.sourcePeerId === payload.sourcePeerId && item.domain === payload.domain)
            .flatMap((item) => dismissFeedback(get, item) ?? [])
        ]
      }
    })

    const ReleaseDomainCommand = domain.command({
      name: 'History.ReleaseDomainCommand',
      impl: ({ get }, runtimeDomain: string) => {
        const providerSources = get(ProviderAttemptsState())
          .filter((item) => item.domain === runtimeDomain)
          .map((item) => ({ domain: runtimeDomain, sourcePeerId: item.sourcePeerId }))
        const successorSources = get(ProviderSupplySuccessorsState())
          .filter((item) => item.domain === runtimeDomain)
          .map((item) => ({ domain: runtimeDomain, sourcePeerId: item.sourcePeerId }))
        const uniqueSources = [
          ...new Map([...providerSources, ...successorSources].map((item) => [item.sourcePeerId, item])).values()
        ]
        const owners = get(FeedbackOwnersState()).filter((item) => item.domain === runtimeDomain)
        // Job-aware release: a dormant successor is removed without starting; a live page supply
        // is cancelled on one awaited settlement path so its own terminal finish releases the job
        // after physical settlement (the cleanup wait observes this); a send-stage job keeps its
        // job and pending send — the invoked wire send still settles through the real
        // transport.send() Promise and only that settlement releases it, never the logical leave.
        const jobs = get(RequesterSupplyJobsState())
        const domainJobs = jobs.filter((item) => item.domain === runtimeDomain)
        const dormantTokens = new Set(domainJobs.filter((item) => item.dormant).map((item) => item.syncToken))
        const cancelSupplyIds = domainJobs.flatMap((item) =>
          !item.dormant && item.supplyId && item.supplyId !== 'send' ? [item.supplyId] : []
        )
        // Domain release unconditionally releases the requester state: the domain is being torn
        // down, so a later fresh synchronization may bind again. Loading settlement is the only
        // non-destructive path; release is not.
        return [
          RequesterAttemptsState().new(
            removeBy(get(RequesterAttemptsState()), (item) => item.domain === runtimeDomain)
          ),
          ...(dormantTokens.size > 0
            ? [RequesterSupplyJobsState().new(removeBy(jobs, (item) => dormantTokens.has(item.syncToken)))]
            : []),
          ...(cancelSupplyIds.length > 0 ? [CancelRequesterSuppliesEvent(cancelSupplyIds)] : []),
          ...uniqueSources.map(CleanupProviderSlotsCommand),
          ClearDomainSyncBindingsCommand(runtimeDomain),
          ...owners.flatMap((item) => dismissFeedback(get, item) ?? [])
        ]
      }
    })

    const withHistoryTimeout = <T>(
      promise: Promise<T>,
      timeoutMs: number,
      onTimeout: () => void | Promise<void> = () => {}
    ): Promise<T> =>
      new Promise<T>((resolve, reject) => {
        const timerId = globalThis.setTimeout(() => {
          let cancellation: void | Promise<void>
          try {
            cancellation = onTimeout()
          } catch (error) {
            reject(error)
            return
          }
          void Promise.resolve(cancellation).then(() => reject(new Error('History supplier timed out')), reject)
        }, timeoutMs)
        promise.then(
          (value) => {
            globalThis.clearTimeout(timerId)
            resolve(value)
          },
          (error) => {
            globalThis.clearTimeout(timerId)
            reject(error)
          }
        )
      })

    domain.effect({
      name: 'History.StartEffect',
      impl: ({ fromEvent }) => fromEvent(StartRequestedEvent).pipe(map(StartRequesterCommand))
    })
    domain.effect({
      name: 'History.FinishEffect',
      impl: ({ fromEvent }) => fromEvent(FinishRequestedEvent).pipe(map(FinishRequesterCommand))
    })
    domain.effect({
      name: 'History.FinishCurrentEffect',
      impl: ({ fromEvent }) => fromEvent(FinishCurrentRequestedEvent).pipe(map(FinishCurrentRequesterCommand))
    })
    domain.effect({
      name: 'History.RequesterSupplyAdmissionEffect',
      impl: ({ fromEvent }) => fromEvent(SyncStartedEvent).pipe(map(AdmitRequesterSupplyCommand))
    })
    domain.effect({
      name: 'History.CancelRequesterSuppliesEffect',
      impl: ({ fromEvent }) =>
        fromEvent(CancelRequesterSuppliesEvent).pipe(
          mergeMap((supplyIds) =>
            // One awaited settlement path: every referenced page supply confirms its physical exit
            // with the same ordering, error, and lifecycle behavior as the retired/released
            // owners; no cancellation Promise is discarded. Each owner's own terminal stage still
            // releases its job independently.
            from(Promise.all(supplyIds.map((supplyId) => pagePort.cancelHistorySupply(supplyId)))).pipe(
              map(() => []),
              catchError(() => of([]))
            )
          )
        )
    })
    domain.effect({
      name: 'History.RequesterInventorySupplyEffect',
      impl: ({ fromEvent, get }) =>
        fromEvent(RequesterSupplyStartedEvent).pipe(
          mergeMap((key) => {
            const failedPageIds: string[] = []
            // The send-stage marker: while the inventory output (encode/send) is still invoked,
            // the admitted job retains its shared slot; the job is released exactly at the final
            // send settlement (or a terminal finish), never at this closure's return.
            const sendStageMarker: RemeshCommandOutput = RecordRequesterSupplyIdCommand({ key, supplyId: 'send' })
            const finishEarly = (): RemeshCommandOutput[] => [
              ...(failedPageIds.length > 0 ? [DeadPagesEvent(failedPageIds)] : []),
              FinishCurrentRequestedEvent(key)
            ]
            // One explicit serial selection loop: record the live supply id immediately before
            // each query, await the physical settlement, then continue; no nested stream control.
            const selection = async function* (): AsyncGenerator<RemeshCommandOutput[]> {
              const current = get(RequesterAttemptsState()).find((item) => matchesSync(item, key))
              if (!current || current.retired || current.inventoryPages.length > 0) {
                // Admitted but superseded or cleaned before starting: release the shared slot
                // without running any physical work.
                yield [ReleaseRequesterSupplyJobCommand(key)]
                return
              }
              const pageIds = pagePort.historyPageIds(key.domain)
              const supplyRequest = {
                domain: key.domain,
                syncId: key.syncId,
                cutoff: current.cutoff,
                mode: 'inventory' as const
              }
              let supplied: Awaited<ReturnType<typeof pagePort.supplyHistory>> | null = null
              const supplyDeadline = clock.now() + HISTORY_REQUEST_TIMEOUT_MS
              // fail over after each ordered physical settlement
              for (const pageId of pageIds) {
                const remainingMs = supplyDeadline - clock.now()
                if (remainingMs <= 0) break
                const supplyId = `inventory:${key.syncToken}:${failedPageIds.length}`
                // Record the live supply id as the physical owner immediately before the query.
                yield [RecordRequesterSupplyIdCommand({ key, supplyId })]
                try {
                  const requestWithId: HistorySupplyRequest = { ...supplyRequest, supplyId }
                  const result = await withHistoryTimeout(
                    pagePort.supplyHistory(pageId, requestWithId),
                    Math.min(HISTORY_REQUEST_TIMEOUT_MS / 2, remainingMs),
                    () => pagePort.cancelHistorySupply(supplyId)
                  )
                  if (result) {
                    supplied = result
                    break
                  }
                  // Re-check the complete live attempt after every settlement before selecting
                  // another page: a cleanup-invalidated or retired requester stops the old loop.
                  if (!get(RequesterAttemptsState()).some((item) => matchesSync(item, key) && !item.retired)) {
                    yield finishEarly()
                    return
                  }
                } catch {
                  // PagePort removes the page itself on a genuine supply rejection or a synchronous
                  // provider throw; a healthy page that hit its boundary (per-page timeout) keeps
                  // its registration. After every settlement, attempt liveness classifies the
                  // rejection: a cleanup-invalidated requester terminates the old loop, while a
                  // still-current attempt fails over to the next page after physical settlement.
                  if (!pagePort.historyPageIds(key.domain).includes(pageId)) {
                    failedPageIds.push(pageId)
                  }
                  if (!get(RequesterAttemptsState()).some((item) => matchesSync(item, key) && !item.retired)) {
                    yield finishEarly()
                    return
                  }
                }
              }
              const attempt = get(RequesterAttemptsState()).find((item) => matchesSync(item, key))
              if (!supplied || !attempt || attempt.retired) {
                yield finishEarly()
                return
              }
              const inventoryIds = supplied.records
                .filter((record) => record.message.hlc.timestamp >= attempt.cutoff)
                .map((record) => record.message.id)
              // Build inventory pages with the REAL production codec so every page is strictly below
              // the final 256KiB encoded frame. NativeWireCodec throws on an oversized frame, so the
              // throw closes the current bucket; only a single ID that cannot form a valid page by
              // itself cancels the attempt locally.
              const pages: HistoryMessagesPull[] = []
              let bucket: string[] = []
              const encodeFrame = async (messageIds: string[], done: boolean) => {
                const frame = {
                  type: MESSAGE_TYPE.HISTORY_MESSAGES_PULL,
                  syncId: key.syncId,
                  page: pages.length,
                  messageIds,
                  done
                }
                // The codec's uniform encoded-frame bound is the only representation check: a
                // rejection closes the current bucket.
                await codec.encode(frame)
                return frame
              }
              // with throw-closes-bucket semantics and no bulk primitive
              for (const id of inventoryIds) {
                const candidate = [...bucket, id]
                let fits = true
                try {
                  await encodeFrame(candidate, false)
                } catch {
                  fits = false
                }
                if (!fits) {
                  if (bucket.length === 0) {
                    // A single opaque ID cannot form a valid page: cancel locally, never loop.
                    yield finishEarly()
                    return
                  }
                  pages.push({
                    type: MESSAGE_TYPE.HISTORY_MESSAGES_PULL,
                    syncId: key.syncId,
                    page: pages.length,
                    messageIds: bucket,
                    done: false
                  })
                  try {
                    await encodeFrame([id], false)
                  } catch {
                    yield finishEarly()
                    return
                  }
                  bucket = [id]
                } else {
                  bucket = candidate
                }
              }
              pages.push({
                type: MESSAGE_TYPE.HISTORY_MESSAGES_PULL,
                syncId: key.syncId,
                page: pages.length,
                messageIds: bucket,
                done: true
              })
              // Revalidate the complete live request identity after the last await: a replacement
              // admitted during the asynchronous encoding retires the live copy, and this older
              // closure must never overwrite that retirement or re-queue the superseded inventory.
              // The queued update derives only from the live object.
              const live = get(RequesterAttemptsState()).find((item) => matchesSync(item, key))
              if (!live || live.retired) {
                yield finishEarly()
                return
              }
              const next: RequesterAttemptState = { ...live, inventoryIds, inventoryPages: pages }
              yield [
                sendStageMarker,
                ...(failedPageIds.length > 0 ? [DeadPagesEvent(failedPageIds)] : []),
                RequesterAttemptsState().new(
                  replaceBy(get(RequesterAttemptsState()), (item) => matchesSync(item, live), next)
                ),
                QueueInventoryPageCommand(next) as RemeshCommandOutput
              ]
            }
            return from(selection()).pipe(catchError(() => of(finishEarly())))
          })
        ) as unknown as Observable<never>
    })
    domain.effect({
      name: 'History.WireInventoryEffect',
      impl: ({ fromEvent }) =>
        fromEvent(wireDomain.event.MessageAcceptedEvent).pipe(
          filter(
            (event): event is WireMessageEvent & { message: HistoryMessagesPull } =>
              'type' in event.message && event.message.type === MESSAGE_TYPE.HISTORY_MESSAGES_PULL
          ),
          map(HandleInventoryPageCommand)
        )
    })
    domain.effect({
      name: 'History.WireResponseEffect',
      impl: ({ fromEvent }) =>
        fromEvent(wireDomain.event.MessageAcceptedEvent).pipe(
          filter(
            (event): event is WireMessageEvent & { message: HistoryMessagesPush } =>
              'type' in event.message && event.message.type === MESSAGE_TYPE.HISTORY_MESSAGES_PUSH
          ),
          map(ApplyResponsePageCommand)
        )
    })
    domain.effect({
      name: 'History.WireSendSuccessEffect',
      impl: ({ fromEvent, get }) =>
        fromEvent(wireDomain.event.MessageSentEvent).pipe(
          map(({ requestId }) => {
            const pending = get(PendingWireSendsState()).find((item) => item.requestId === requestId)
            if (!pending) return []
            return pending.type === 'inventory'
              ? ContinueRequesterInventoryCommand(requestId)
              : CompleteProviderResponseCommand(requestId)
          })
        )
    })
    domain.effect({
      name: 'History.WireSendFailureEffect',
      impl: ({ fromEvent }) => fromEvent(wireDomain.event.MessageSendFailedEvent).pipe(map(FailWireSendCommand))
    })
    domain.effect({
      name: 'History.RequestTimeoutEffect',
      impl: ({ fromEvent }) =>
        fromEvent(HistoryTimeoutArmedEvent).pipe(
          mergeMap(
            (payload) =>
              new Observable<HistoryAttemptKey>((observer) => {
                const timerId = globalThis.setTimeout(() => {
                  observer.next(payload)
                  observer.complete()
                }, HISTORY_REQUEST_TIMEOUT_MS)
                return () => globalThis.clearTimeout(timerId)
              })
          ),
          // The request timeout closes the loading once; the requester keeps accepting and
          // merging every provider's valid late pages. The command guards and is idempotent.
          map(SettleLoadingCommand)
        )
    })
    domain.effect({
      name: 'History.ProviderSupplyEffect',
      impl: ({ fromEvent, get }) =>
        fromEvent(ProviderSupplyRequestedEvent).pipe(
          mergeMap((request) => {
            const failedPageIds: string[] = []
            const key: HistoryAttemptKey = {
              sourcePeerId: request.sourcePeerId,
              domain: request.domain,
              syncId: request.syncId,
              syncToken: request.syncToken
            }
            const supplyIdFor = (attempt: number) => `supply:${request.syncToken}:${attempt}`
            const recordCommand = (supplyId: string) => RecordActiveSupplyIdCommand({ key, supplyId })
            // The end-to-end physical stage marker: while the response pipeline (encode/send) is
            // still invoked, the active entry stays live so cleanup and cancellation retain the
            // slot; the marker is cleared exactly when the send settles (success or failure).
            const sendStageMarker: RemeshCommandOutput = RecordActiveSupplyIdCommand({ key, supplyId: 'send' })
            const settledMarker: RemeshCommandOutput = ClearActiveSupplyIdCommand({ key })
            const cancelOutcome = (): RemeshCommandOutput[] => [
              settledMarker,
              ...(failedPageIds.length > 0 ? [DeadPagesEvent(failedPageIds)] : []),
              CancelProviderAttemptCommand(request)
            ]
            const successOutcome = (
              supplied: NonNullable<Awaited<ReturnType<typeof pagePort.supplyHistory>>>
            ): RemeshCommandOutput[] => {
              const attempt = get(ProviderAttemptsState()).find((item) => matchesSync(item, request))
              if (!attempt) return cancelOutcome()
              const known = attempt.inventory
              // Only pre-cutoff records and already-known IDs are skipped; no cumulative session
              // budget applies beyond each page's public per-frame and per-page limits.
              const eligible = supplied.records.filter(
                (record) => !known.has(record.message.id) && record.message.hlc.timestamp >= attempt.cutoff
              )
              const nextProvider: ProviderAttemptState = {
                ...attempt,
                snapshot: eligible
              }
              return [
                sendStageMarker,
                ...(failedPageIds.length > 0 ? [DeadPagesEvent(failedPageIds)] : []),
                ProviderAttemptsState().new(
                  replaceBy(get(ProviderAttemptsState()), (item) => matchesSync(item, attempt), nextProvider)
                ),
                QueueProviderResponseCommand({
                  ...request,
                  records: eligible,
                  remaining: [],
                  terminal: true
                }) as RemeshCommandOutput
              ]
            }
            type PageOutcome =
              | { type: 'success'; supplied: NonNullable<Awaited<ReturnType<typeof pagePort.supplyHistory>>> }
              | { type: 'detached' }
              | { type: 'failed' }
              | { type: 'timedOut' }
              | { type: 'cancelled' }
            // One explicit serial selection loop: record the live supply id immediately before
            // each query, await the physical settlement, classify the result, and yield one
            // terminal action batch (or fail over to the next page). No nested stream control.
            const selection = async function* (): AsyncGenerator<RemeshCommandOutput[]> {
              const currentProvider = get(ProviderAttemptsState()).find((item) => matchesSync(item, request))
              if (!currentProvider) {
                yield cancelOutcome()
                return
              }
              const pageIds = pagePort.historyPageIds(request.domain)
              const supplyDeadline = clock.now() + HISTORY_REQUEST_TIMEOUT_MS
              const supplyRequest = {
                domain: request.domain,
                syncId: request.syncId,
                cutoff: currentProvider.cutoff,
                mode: 'provider' as const
              }
              // remaining ordered page selections immediately
              for (const pageId of pageIds) {
                // Re-check the complete live attempt before selecting another page: a
                // cleanup-invalidated attempt stops the old pipeline without starting a query.
                if (!get(ProviderAttemptsState()).some((item) => matchesSync(item, request))) {
                  yield cancelOutcome()
                  return
                }
                const remainingMs = supplyDeadline - clock.now()
                if (remainingMs <= 0) {
                  yield cancelOutcome()
                  return
                }
                const supplyId = supplyIdFor(failedPageIds.length)
                // Record the live supply id as the physical owner immediately before the query.
                yield [recordCommand(supplyId)]
                let outcome: PageOutcome
                try {
                  const result = await withHistoryTimeout(
                    pagePort.supplyHistory(pageId, { ...supplyRequest, supplyId }),
                    Math.min(HISTORY_REQUEST_TIMEOUT_MS / 2, remainingMs),
                    () => pagePort.cancelHistorySupply(supplyId)
                  )
                  outcome = result ? { type: 'success', supplied: result } : { type: 'detached' }
                } catch {
                  // PagePort removes the page itself on a genuine rejection or synchronous provider
                  // throw; a healthy page that hit its boundary stays registered. After physical
                  // settlement, attempt liveness classifies the rejection: lifecycle cancellation
                  // terminates, a still-current attempt fails over to the next page.
                  if (!pagePort.historyPageIds(request.domain).includes(pageId)) {
                    failedPageIds.push(pageId)
                    outcome = { type: 'failed' }
                  } else if (!get(ProviderAttemptsState()).some((item) => matchesSync(item, request))) {
                    outcome = { type: 'cancelled' }
                  } else {
                    outcome = { type: 'timedOut' }
                  }
                }
                if (outcome.type === 'success') {
                  yield successOutcome(outcome.supplied)
                  return
                }
                if (outcome.type === 'cancelled') {
                  yield cancelOutcome()
                  return
                }
                // detached / failed / timedOut: fail over to the next page after settlement.
              }
              // Exhaustion epilogue: empty, all-detached, or all-genuinely-failed selection
              // publishes the accumulated dead pages and cancels/releases the exact attempt
              // immediately (no dependence on the unrelated attempt timer).
              yield cancelOutcome()
            }
            return from(selection()).pipe(catchError(() => of(cancelOutcome())))
          }, MAX_PROVIDER_SUPPLY_CONCURRENCY)
        ) as unknown as Observable<never>
    })
    domain.effect({
      name: 'History.ProviderTimeoutEffect',
      impl: ({ fromEvent }) =>
        fromEvent(ProviderTimeoutArmedEvent).pipe(
          mergeMap(
            (payload) =>
              new Observable<HistoryAttemptKey>((observer) => {
                const timerId = globalThis.setTimeout(() => {
                  observer.next(payload)
                  observer.complete()
                }, HISTORY_REQUEST_TIMEOUT_MS)
                return () => globalThis.clearTimeout(timerId)
              })
          ),
          map(CancelProviderAttemptCommand)
        )
    })
    domain.effect({
      name: 'History.BatchAckEffect',
      impl: ({ fromEvent }) =>
        fromEvent(deliveryDomain.event.HistoryBatchAckedEvent).pipe(
          map(({ domain, batchId, inserted }) => ContinueRequesterBatchCommand({ domain, batchId, inserted }))
        )
    })
    domain.effect({
      name: 'History.BatchDiscardEffect',
      impl: ({ fromEvent }) =>
        fromEvent(deliveryDomain.event.InboundBatchDiscardedEvent).pipe(map(DiscardRequesterBatchCommand))
    })
    domain.effect({
      name: 'History.FeedbackProjectEffect',
      impl: ({ fromEvent }) =>
        fromEvent(FeedbackChangedEvent).pipe(
          map((event) => {
            void pagePort.emitHistoryFeedback(pagePort.historyPageIds(event.domain), event)
            return null
          })
        )
    })

    return {
      query: { RequesterAttemptsQuery, ProviderAttemptsQuery, ProviderSupplyJobsQuery, DomainCleanupSettledQuery },
      command: {
        StartRequesterCommand,
        ResetHistoryForSessionCommand,
        FinishRequesterCommand,
        RemovePeerCommand,
        ReleaseDomainCommand,
        HandleInventoryPageCommand,
        QueueInventoryPageCommand
      },
      event: {
        SyncStartedEvent,
        SyncCompletedEvent,
        DeadPagesEvent,
        ErrorEvent
      }
    }
  }
})

export default HistoryDomain
