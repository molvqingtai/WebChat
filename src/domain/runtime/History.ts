import { Remesh, type RemeshCommandOutput } from 'remesh'
import { catchError, defer, filter, map, mergeMap, Observable } from 'rxjs'
import DeliveryDomain from '@/domain/runtime/Delivery'
import SessionDomain, { observeHlc } from '@/domain/runtime/Session'
import WireDomain, { type WireFailureStage, type WireMessageEvent } from '@/domain/runtime/Wire'
import { ClockExtern } from '@/domain/runtime/externs/Clock'
import { PagePortExtern } from '@/domain/runtime/externs/PagePort'
import {
  HISTORY_REQUEST_TIMEOUT_MS,
  HISTORY_WINDOW_DAYS,
  MAX_HISTORY_SESSION_BYTES,
  MAX_HISTORY_SESSION_MESSAGES,
  MAX_PROVIDER_SUPPLY_CONCURRENCY,
  MAX_PROVIDER_SUPPLY_QUEUE_BYTES,
  MAX_PROVIDER_SUPPLY_QUEUE_JOBS
} from '@/constants/config'
import {
  MAX_HISTORY_RESPONSE_MESSAGES,
  MESSAGE_TYPE,
  isChatRoomMessageSemanticallyValid,
  isMessageWithinLimit,
  isUserWithinLimit,
  type ChatMessage,
  type ChatUser,
  type HLC,
  type HistoryMessagesRequest,
  type HistoryMessagesResponse
} from '@/protocol'
import { WireCodecExtern } from '@/domain/runtime/externs/RoomTransport'
import { compareEventPosition, type ChatMessageRecord } from '@/domain/Message'
import type { HistorySupplyRequest, HistoryFeedbackEvent } from '@/runtime/Contract'
import { getTextByteSize } from '@/utils/getTextByteSize'

export interface HistoryOptions {
  [key: string]: number | undefined
  historySessionBytes?: number
  historySessionMessages?: number
}

/** Complete identity of one directional attempt; late work must match every field. */
interface HistoryAttemptKey {
  sourcePeerId: string
  domain: string
  syncId: string
  syncToken: string
}

/** Outgoing requester: fixed ID snapshot, paged inventory, incoming response pages. */
interface RequesterAttemptState extends HistoryAttemptKey {
  cutoff: number
  inventoryIds: string[]
  /** Pre-built inventory pages (real codec encoded < 64KiB each); sent in order. */
  inventoryPages: HistoryMessagesRequest[]
  nextInventoryPage: number
  expectedResponsePage: number
  responseBytes: number
  responseCount: number
  /** Canonical position of the last applied response record, for cross-page recent-first continuity. */
  lastResponsePosition?: { hlc: HLC; id: string }
  awaitingBatchId?: string
  finalBatch: boolean
  responseDone: boolean
  /** Fingerprint of the last applied response page, so an identical replay is idempotent. */
  lastAppliedPageFingerprint?: string
  /** Bounded serial queue of valid response pages that arrived while a batch was pending. */
  pendingResponsePages: HistoryMessagesResponse[]
  /** Page number of the next expected queued page (pages queue continuously, not only N+1). */
  queuedResponseTail: number
  feedbackActive: boolean
}

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
  responseBytes: number
  responseCount: number
  responseDone: boolean
}

interface ProviderSupplyPayload extends HistoryAttemptKey {
  queueBytes: number
  /** True only after the complete inventory arrived; only ready attempts run the supplier. */
  ready: boolean
}

type ProviderSupplyJobState = ProviderSupplyPayload

interface ProviderSupplySuccessorState extends ProviderAttemptState {
  queueBytes: number
}

interface PendingInventorySend extends HistoryAttemptKey {
  kind: 'inventory'
  requestId: string
  messageIds: string[]
  done: boolean
}

interface PendingProviderSend extends HistoryAttemptKey {
  kind: 'provider'
  requestId: string
  records: { record: ChatMessageRecord; bytes: number }[]
  remaining: { record: ChatMessageRecord; bytes: number }[]
  terminal: boolean
  done: boolean
}

type PendingWireSend = PendingInventorySend | PendingProviderSend

interface FeedbackOwnerState extends HistoryAttemptKey {}

const replaceBy = <T>(items: T[], predicate: (item: T) => boolean, next: T): T[] =>
  items.some(predicate) ? items.map((item) => (predicate(item) ? next : item)) : [...items, next]
const removeBy = <T>(items: T[], predicate: (item: T) => boolean): T[] => items.filter((item) => !predicate(item))
const historyCutoff = (now: number) => now - HISTORY_WINDOW_DAYS * 24 * 60 * 60 * 1000
const token = (kind: string, counter: number) => `${kind}:${counter.toString(36)}`
const feedbackOwnerId = (key: HistoryAttemptKey) =>
  `history:${key.domain}:${key.sourcePeerId}:${key.syncId}:${key.syncToken}`
/** Maximum length of the bounded serial response-page queue for one requester attempt. */
const MAX_PENDING_RESPONSE_PAGES = 64

const makeRecord = (message: ChatMessage, user: ChatUser, receivedAt: number): ChatMessageRecord => {
  if (user.id !== message.userId) throw new Error('Chat record user does not match its message')
  return { type: 'chat-message', id: message.id, message, user, receivedAt }
}

const usersForRecords = (records: ChatMessageRecord[]): ChatUser[] => {
  const snapshots: { user: ChatUser; message: ChatMessage }[] = []
  records.forEach((record) => {
    const index = snapshots.findIndex((item) => item.user.id === record.user.id)
    if (index === -1) snapshots.push({ user: record.user, message: record.message })
    else if (compareEventPosition(snapshots[index].message, record.message) < 0) {
      snapshots[index] = { user: record.user, message: record.message }
    }
  })
  return snapshots.map(({ user }) => user)
}

const matchesSync = (item: HistoryAttemptKey, key: HistoryAttemptKey) =>
  item.sourcePeerId === key.sourcePeerId &&
  item.domain === key.domain &&
  item.syncId === key.syncId &&
  item.syncToken === key.syncToken

const sameSourceDomain = (item: HistoryAttemptKey, key: HistoryAttemptKey) =>
  item.sourcePeerId === key.sourcePeerId && item.domain === key.domain

const HistoryDomain = Remesh.domain({
  name: 'HistoryDomain',
  impl: (domain, options: HistoryOptions = {}) => {
    const clock = domain.getExtern(ClockExtern)
    const pagePort = domain.getExtern(PagePortExtern)
    const codec = domain.getExtern(WireCodecExtern)
    const wireDomain = domain.getDomain(WireDomain())
    const deliveryDomain = domain.getDomain(DeliveryDomain())
    const sessionDomain = domain.getDomain(SessionDomain())
    const historySessionBytes = options.historySessionBytes ?? MAX_HISTORY_SESSION_BYTES
    const historySessionMessages = options.historySessionMessages ?? MAX_HISTORY_SESSION_MESSAGES

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
    const FinishRequestedEvent = domain.event<{ domain: string; sourcePeerId: string }>({
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
            FeedbackChangedEvent({ domain: key.domain, ownerId: feedbackOwnerId(key), kind: 'loading' })
          ]
    const dismissFeedback = (
      get: (action: ReturnType<typeof FeedbackOwnersState>) => FeedbackOwnerState[],
      key: HistoryAttemptKey
    ) =>
      get(FeedbackOwnersState()).some((item) => feedbackMatches(item, key))
        ? [
            FeedbackOwnersState().new(removeBy(get(FeedbackOwnersState()), (item) => feedbackMatches(item, key))),
            FeedbackChangedEvent({ domain: key.domain, ownerId: feedbackOwnerId(key), kind: 'dismiss' })
          ]
        : null

    // ── Requester lifecycle ─────────────────────────────────────────────────────

    const StartRequesterCommand = domain.command({
      name: 'History.StartRequesterCommand',
      impl: ({ get }, payload: { domain: string; sourcePeerId: string }) => {
        const runtime = get(sessionDomain.query.DomainQuery(payload.domain))
        if (!runtime?.sessions.some((session) => session.sourcePeerId === payload.sourcePeerId)) return null
        // One requester attempt per domain + source: a source in two domains runs two independent attempts.
        const requesters = get(RequesterAttemptsState())
        if (requesters.some((item) => sameSourceDomain(item, { ...payload, syncId: '', syncToken: '' }))) return null
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
          expectedResponsePage: 0,
          responseBytes: 0,
          responseCount: 0,
          finalBatch: false,
          responseDone: false,
          pendingResponsePages: [],
          queuedResponseTail: 0,
          feedbackActive: false
        }
        return [
          TokenState().new(allocated.next),
          RequesterAttemptsState().new([...requesters, state]),
          HistoryTimeoutArmedEvent(state),
          SyncStartedEvent(state)
        ]
      }
    })

    const FinishRequesterCommand = domain.command({
      name: 'History.FinishRequesterCommand',
      impl: ({ get }, payload: { domain: string; sourcePeerId: string }) => {
        const requesters = get(RequesterAttemptsState())
        const current = requesters.find(
          (item) => item.sourcePeerId === payload.sourcePeerId && item.domain === payload.domain
        )
        if (!current) return null
        return [
          RequesterAttemptsState().new(
            removeBy(requesters, (item) => item.sourcePeerId === payload.sourcePeerId && item.domain === payload.domain)
          ),
          PendingWireSendsState().new(
            removeBy(
              get(PendingWireSendsState()),
              (item) =>
                item.sourcePeerId === payload.sourcePeerId &&
                item.domain === payload.domain &&
                item.kind === 'inventory'
            )
          ),
          ...(dismissFeedback(get, current) ?? []),
          SyncCompletedEvent(payload)
        ]
      }
    })

    const FinishCurrentRequesterCommand = domain.command({
      name: 'History.FinishCurrentRequesterCommand',
      impl: ({ get }, payload: HistoryAttemptKey) => {
        const current = get(RequesterAttemptsState()).find((item) => matchesSync(item, payload))
        return current ? FinishRequestedEvent({ domain: payload.domain, sourcePeerId: payload.sourcePeerId }) : null
      }
    })

    const ResetHistoryForSessionCommand = domain.command({
      name: 'History.ResetHistoryForSessionCommand',
      impl: ({ get }, payload: { domain: string; sourcePeerId: string }) => {
        const requesters = get(RequesterAttemptsState())
        const providers = get(ProviderAttemptsState())
        const successors = get(ProviderSupplySuccessorsState())
        const jobs = get(ProviderSupplyJobsState())
        const owners = get(FeedbackOwnersState())
        const dismissedOwners = owners.filter(
          (item) => item.sourcePeerId === payload.sourcePeerId && item.domain === payload.domain
        )
        return [
          RequesterAttemptsState().new(
            requesters.filter((item) => item.sourcePeerId !== payload.sourcePeerId || item.domain !== payload.domain)
          ),
          ProviderAttemptsState().new(
            providers.filter((item) => item.sourcePeerId !== payload.sourcePeerId || item.domain !== payload.domain)
          ),
          ProviderSupplySuccessorsState().new(
            successors.filter((item) => item.sourcePeerId !== payload.sourcePeerId || item.domain !== payload.domain)
          ),
          ProviderSupplyJobsState().new(
            jobs.filter((item) => item.sourcePeerId !== payload.sourcePeerId || item.domain !== payload.domain)
          ),
          ...dismissedOwners.flatMap((item) => dismissFeedback(get, item) ?? []),
          StartRequestedEvent(payload)
        ]
      }
    })

    // ── Requester inventory output (pages pre-built with the real codec) ───────

    const QueueInventoryPageCommand = domain.command({
      name: 'History.QueueInventoryPageCommand',
      impl: ({ get }, payload: RequesterAttemptState) => {
        const runtime = get(sessionDomain.query.DomainQuery(payload.domain))
        if (!runtime) return FinishCurrentRequestedEvent(payload)
        const current = get(RequesterAttemptsState()).find((item) => matchesSync(item, payload))
        if (!current) return null
        const page = current.inventoryPages[current.nextInventoryPage]
        if (!page) return FinishCurrentRequestedEvent(payload)
        const requestId = `history:inventory:${payload.syncToken}:${current.nextInventoryPage}`
        return [
          PendingWireSendsState().new([
            ...removeBy(get(PendingWireSendsState()), (item) => item.requestId === requestId),
            {
              ...payload,
              kind: 'inventory' as const,
              requestId,
              messageIds: page.messageIds,
              done: page.done
            }
          ]),
          wireDomain.command.SendMessageCommand({
            requestId,
            roomId: runtime.roomId,
            targetPeerIds: [payload.sourcePeerId],
            message: page
          })
        ]
      }
    })

    const ContinueRequesterInventoryCommand = domain.command({
      name: 'History.ContinueRequesterInventoryCommand',
      impl: ({ get }, requestId: string) => {
        const pending = get(PendingWireSendsState())
        const found = pending.find((item) => item.requestId === requestId && item.kind === 'inventory')
        if (!found) return null
        const current = found as PendingInventorySend
        const requesters = get(RequesterAttemptsState())
        const attempt = requesters.find((item) => matchesSync(item, current))
        if (!attempt) return null
        const next: RequesterAttemptState = {
          ...attempt,
          nextInventoryPage: attempt.nextInventoryPage + 1
        }
        return [
          PendingWireSendsState().new(removeBy(pending, (item) => item.requestId === requestId)),
          RequesterAttemptsState().new(replaceBy(requesters, (item) => matchesSync(item, attempt), next)),
          ...(current.done ? [] : [QueueInventoryPageCommand(next)])
        ]
      }
    })

    // ── Provider inventory input ────────────────────────────────────────────────

    const HandleInventoryPageCommand = domain.command({
      name: 'History.HandleInventoryPageCommand',
      impl: ({ get }, payload: WireMessageEvent & { message: HistoryMessagesRequest }) => {
        const binding = get(
          sessionDomain.query.BindingQuery({ roomId: payload.roomId, sourcePeerId: payload.sourcePeerId })
        )
        if (!binding) return null
        if (!isChatRoomMessageSemanticallyValid(payload.message, clock.now())) {
          return wireDomain.command.DropProtocolCommand({
            sourcePeerId: payload.sourcePeerId,
            reason: 'invalid Chat message semantics'
          })
        }
        const providers = get(ProviderAttemptsState())
        const current = providers.find(
          (item) => item.sourcePeerId === payload.sourcePeerId && item.domain === binding.domain
        )
        const successors = get(ProviderSupplySuccessorsState())
        const successor = successors.find(
          (item) => item.sourcePeerId === payload.sourcePeerId && item.domain === binding.domain
        )
        const queueBytes = getTextByteSize(JSON.stringify(payload.message))

        // A replacement syncId while the old attempt is still supplying occupies one dormant
        // source-local successor; it runs nothing concurrently and promotes only after old settlement.
        // The successor applies the exact same request-page state machine as a current provider:
        // fingerprint replay idempotency, changed/gap/post-done cancellation, raw budgets,
        // inventoryDone, and a page-zero attempt timeout under its complete token.
        if (current && current.syncId !== payload.message.syncId) {
          if (successor && successor.syncId !== payload.message.syncId) return null
          const jobs = get(ProviderSupplyJobsState())
          const admittedBytes = [...jobs, ...successors].reduce((total, item) => total + item.queueBytes, 0)
          if (
            jobs.length + successors.length >= MAX_PROVIDER_SUPPLY_QUEUE_JOBS ||
            queueBytes > MAX_PROVIDER_SUPPLY_QUEUE_BYTES - admittedBytes
          ) {
            return wireDomain.command.DropProtocolCommand({
              sourcePeerId: payload.sourcePeerId,
              reason: 'history provider queue limit reached'
            })
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
            responseBytes: 0,
            responseCount: 0,
            responseDone: false,
            queueBytes
          }
          const expectedPage = base.expectedRequestPage
          // Identical replay of the last applied page is idempotent; changed replay, gap,
          // out-of-order, empty non-final, or post-done input cancels the successor attempt.
          if (payload.message.page === expectedPage - 1 && base.lastAppliedRequestPageFingerprint) {
            if (base.lastAppliedRequestPageFingerprint === JSON.stringify(payload.message)) {
              return [TokenState().new(allocated.next)]
            }
            return null
          }
          if (
            payload.message.page !== expectedPage ||
            base.inventoryDone ||
            (payload.message.messageIds.length === 0 && !payload.message.done)
          ) {
            return null
          }
          const inventory = new Set([...base.inventory, ...payload.message.messageIds])
          const inventoryCount = base.inventoryCount + payload.message.messageIds.length
          const inventoryBytes = base.inventoryBytes + queueBytes
          if (inventoryCount > historySessionMessages || inventoryBytes > historySessionBytes) return null
          const nextSuccessor: ProviderSupplySuccessorState = {
            ...base,
            inventory,
            inventoryCount,
            inventoryBytes,
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
            // The successor attempt timeout is armed from page zero, not only after done.
            ...(successor ? [] : [ProviderTimeoutArmedEvent(key)])
          ]
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
        const admittedBytes = [...jobs, ...successors].reduce((total, item) => total + item.queueBytes, 0)
        if (
          jobs.length + successors.length >= MAX_PROVIDER_SUPPLY_QUEUE_JOBS ||
          queueBytes > MAX_PROVIDER_SUPPLY_QUEUE_BYTES - admittedBytes
        ) {
          return wireDomain.command.DropProtocolCommand({
            sourcePeerId: payload.sourcePeerId,
            reason: 'history provider queue limit reached'
          })
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
        if (inventoryCount > historySessionMessages || inventoryBytes > historySessionBytes) {
          return CancelProviderAttemptCommand(key)
        }
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
              responseBytes: 0,
              responseCount: 0,
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
          // The attempt timeout is armed from page zero, and the job is admitted from page zero so
          // partial attempts count toward the 32-job/8KiB pool; the supplier request is issued only
          // after the complete inventory arrives (done), but admission holds the attempt now.
          ...(current
            ? []
            : [ProviderTimeoutArmedEvent(key), AdmitProviderSupplyCommand({ ...key, queueBytes, ready: false })]),
          ...(payload.message.done && !current ? [AdmitProviderSupplyCommand({ ...key, queueBytes, ready: true })] : [])
        ]
      }
    })

    const AdmitProviderSupplyCommand = domain.command({
      name: 'History.AdmitProviderSupplyCommand',
      impl: ({ get }, request: ProviderSupplyPayload) => {
        // One admission owner covers active + waiting + dormant jobs: never exceed 32 admitted
        // requests or 8KiB of decoded metadata (four active are enforced by the active slot).
        const active = get(ActiveSuppliesState())
        const waiting = get(WaitingSuppliesState())
        const jobs = get(ProviderSupplyJobsState())
        const admitted = [...active, ...waiting, ...jobs]
        if (
          admitted.length >= MAX_PROVIDER_SUPPLY_QUEUE_JOBS ||
          admitted.reduce((total, item) => total + item.queueBytes, 0) + request.queueBytes >
            MAX_PROVIDER_SUPPLY_QUEUE_BYTES
        ) {
          return null
        }
        const job = { ...request }
        if (active.length >= MAX_PROVIDER_SUPPLY_CONCURRENCY || !request.ready) {
          return [
            ProviderSupplyJobsState().new([...jobs, job]),
            ...(request.ready ? [WaitingSuppliesState().new([...waiting, request])] : [])
          ]
        }
        return [
          ProviderSupplyJobsState().new([...jobs, job]),
          ActiveSuppliesState().new([...active, request]),
          ProviderSupplyRequestedEvent(request)
        ]
      }
    })

    const ReleaseProviderSupplySlotCommand = domain.command({
      name: 'History.ReleaseProviderSupplySlotCommand',
      impl: ({ get }, key: HistoryAttemptKey) => {
        const active = removeBy(get(ActiveSuppliesState()), (item) => matchesSync(item, key))
        const waiting = get(WaitingSuppliesState())
        const next = waiting.find((item) => item.ready)
        return [
          ActiveSuppliesState().new(next ? [...active, next] : active),
          WaitingSuppliesState().new(next ? waiting.filter((item) => item !== next) : waiting),
          ...(next ? [ProviderSupplyRequestedEvent(next)] : [])
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
        if (!current && !ownerActive && !successor && !hasSlotAccounting) return null
        if (!current) {
          // Late supplier settlement after cleanup: release the slot accounting exactly once so no
          // active/waiting slot leaks, even when the provider state is already gone.
          return [
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
        const promotion =
          successor && successor.syncId !== key.syncId
            ? [
                ProviderAttemptsState().new([
                  ...removeBy(providers, (item) => matchesSync(item, key)),
                  { ...successor }
                ]),
                ProviderSupplySuccessorsState().new(
                  removeBy(
                    get(ProviderSupplySuccessorsState()),
                    (item) => item.sourcePeerId === key.sourcePeerId && item.domain === key.domain
                  )
                ),
                ProviderTimeoutArmedEvent(successor),
                AdmitProviderSupplyCommand({
                  sourcePeerId: successor.sourcePeerId,
                  domain: successor.domain,
                  syncId: successor.syncId,
                  syncToken: successor.syncToken,
                  queueBytes: getTextByteSize(JSON.stringify({ syncId: successor.syncId })),
                  ready: true
                })
              ]
            : [
                ProviderAttemptsState().new(removeBy(providers, (item) => matchesSync(item, key))),
                ProviderSupplySuccessorsState().new(
                  removeBy(
                    get(ProviderSupplySuccessorsState()),
                    (item) => item.sourcePeerId === key.sourcePeerId && item.domain === key.domain
                  )
                )
              ]
        return [
          ...promotion,
          ProviderSupplyJobsState().new(removeBy(get(ProviderSupplyJobsState()), (item) => matchesSync(item, key))),
          ...(dismissFeedback(get, key) ?? []),
          ReleaseProviderSupplySlotCommand(key)
        ]
      }
    })

    // ── Provider snapshot + response output ─────────────────────────────────────

    const QueueProviderResponseCommand = domain.command({
      name: 'History.QueueProviderResponseCommand',
      impl: (
        { get },
        payload: HistoryAttemptKey & {
          records: { record: ChatMessageRecord; bytes: number }[]
          remaining: { record: ChatMessageRecord; bytes: number }[]
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
        const response: HistoryMessagesResponse = {
          type: MESSAGE_TYPE.HISTORY_MESSAGES_RESPONSE,
          syncId: payload.syncId,
          page: current.nextResponsePage,
          users: usersForRecords(slice.map(({ record }) => record)),
          messages: slice.map(({ record }) => record.message),
          done: pageDone
        }
        const requestId = `history:provider:${payload.syncToken}:${current.nextResponsePage}`
        const pending: PendingProviderSend = {
          ...payload,
          kind: 'provider',
          requestId,
          records: slice,
          remaining: tail,
          terminal: payload.terminal,
          done: pageDone
        }
        return [
          PendingWireSendsState().new([
            ...removeBy(get(PendingWireSendsState()), (item) => item.kind === 'provider' && matchesSync(item, payload)),
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
        const found = pending.find((item) => item.requestId === requestId && item.kind === 'provider')
        if (!found) return null
        const current = found as PendingProviderSend
        const providers = get(ProviderAttemptsState())
        const attempt = providers.find((item) => matchesSync(item, current))
        const clear = PendingWireSendsState().new(removeBy(pending, (item) => item.requestId === requestId))
        if (!attempt) return clear
        const decodedBytes = attempt.responseBytes + current.records.reduce((total, item) => total + item.bytes, 0)
        const messageCount = attempt.responseCount + current.records.length
        const next: ProviderAttemptState = {
          ...attempt,
          nextResponsePage: attempt.nextResponsePage + 1,
          responseBytes: decodedBytes,
          responseCount: messageCount,
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
              ? [CancelProviderAttemptCommand(current)]
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
        if (current.kind === 'inventory') {
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
          CancelProviderAttemptCommand(current)
        ]
      }
    })

    // ── Requester response input (bounded serial queue + replay controls) ──────

    const prepareResponsePage = (
      current: RequesterAttemptState,
      payload: WireMessageEvent & { message: HistoryMessagesResponse }
    ):
      | {
          ok: false
          action: ReturnType<typeof FinishRequestedEvent> | ReturnType<typeof wireDomain.command.DropProtocolCommand>
        }
      | { ok: true; page: HistoryMessagesResponse } => {
      if (current.responseDone) {
        return {
          ok: false,
          action: FinishRequestedEvent({ domain: current.domain, sourcePeerId: current.sourcePeerId })
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
      if (payload.message.messages.length > 0 && current.lastResponsePosition) {
        const newest = payload.message.messages[0]
        if (compareEventPosition(current.lastResponsePosition, newest) <= 0) {
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
      impl: ({ get }, payload: WireMessageEvent & { message: HistoryMessagesResponse }) => {
        const binding = get(
          sessionDomain.query.BindingQuery({ roomId: payload.roomId, sourcePeerId: payload.sourcePeerId })
        )
        if (!binding) return null
        if (!isChatRoomMessageSemanticallyValid(payload.message, clock.now())) {
          return wireDomain.command.DropProtocolCommand({
            sourcePeerId: payload.sourcePeerId,
            reason: 'invalid Chat message semantics'
          })
        }
        const requesters = get(RequesterAttemptsState())
        const current = requesters.find(
          (item) => item.sourcePeerId === payload.sourcePeerId && item.domain === binding.domain
        )
        if (!current || current.syncId !== payload.message.syncId) return null
        if (current.awaitingBatchId) {
          // While a batch is pending: an identical replay of the accepted page is idempotent, a
          // changed replay of the accepted page cancels the attempt (discarding queued work), an
          // identical replay of a queued page is deduplicated, and valid continuous pages (N+1,
          // N+2, ...) join the bounded serial queue in order.
          const fingerprint = JSON.stringify(payload.message)
          if (payload.message.page === current.expectedResponsePage - 1) {
            return current.lastAppliedPageFingerprint === fingerprint
              ? null
              : FinishRequestedEvent({ domain: binding.domain, sourcePeerId: payload.sourcePeerId })
          }
          if (payload.message.page === current.queuedResponseTail) {
            const queued = current.pendingResponsePages
            const lastQueued = queued[queued.length - 1]
            if (lastQueued && JSON.stringify(lastQueued) === fingerprint) return null
            if (queued.length >= MAX_PENDING_RESPONSE_PAGES) {
              return FinishRequestedEvent({ domain: binding.domain, sourcePeerId: payload.sourcePeerId })
            }
            return RequesterAttemptsState().new(
              replaceBy(requesters, (item) => matchesSync(item, current), {
                ...current,
                pendingResponsePages: [...queued, payload.message],
                queuedResponseTail: current.queuedResponseTail + 1
              })
            )
          }
          return FinishRequestedEvent({ domain: binding.domain, sourcePeerId: payload.sourcePeerId })
        }
        if (payload.message.page !== current.expectedResponsePage) {
          // Identical replay of the last applied page is idempotent; anything else (gap,
          // out-of-order, changed replay) cancels the attempt.
          const fingerprint = JSON.stringify(payload.message)
          if (
            payload.message.page === current.expectedResponsePage - 1 &&
            current.lastAppliedPageFingerprint === fingerprint
          ) {
            return null
          }
          return FinishRequestedEvent({ domain: binding.domain, sourcePeerId: payload.sourcePeerId })
        }
        const prepared = prepareResponsePage(current, payload)
        if (!prepared.ok) return prepared.action
        const page = prepared.page
        const expectedHlc = get(sessionDomain.query.HlcQuery())
        let hlc = expectedHlc
        let decodedBytes = current.responseBytes
        let messageCount = current.responseCount
        for (const event of page.messages) {
          const messageBytes = getTextByteSize(JSON.stringify(event))
          if (messageCount + 1 > historySessionMessages || decodedBytes + messageBytes > historySessionBytes) {
            return FinishRequestedEvent({ domain: binding.domain, sourcePeerId: payload.sourcePeerId })
          }
          messageCount += 1
          decodedBytes += messageBytes
        }
        const records: ChatMessageRecord[] = []
        for (const event of page.messages) {
          if (event.hlc.timestamp < current.cutoff) {
            return FinishRequestedEvent({ domain: binding.domain, sourcePeerId: payload.sourcePeerId })
          }
          const user = page.users.find((candidate) => candidate.id === event.userId)
          if (!user) continue
          const observed = observeHlc(hlc, event.hlc, clock.now())
          if (!observed) continue
          hlc = observed
          records.push(makeRecord(event, user, clock.now()))
        }
        const allocated = nextTokens(get, 1)
        const batchId = token('batch', allocated.values[0])
        const oldest = records.length > 0 ? records[records.length - 1].message : undefined
        const next: RequesterAttemptState = {
          ...current,
          expectedResponsePage: current.expectedResponsePage + 1,
          responseBytes: decodedBytes,
          responseCount: messageCount,
          lastResponsePosition: oldest ? { hlc: oldest.hlc, id: oldest.id } : current.lastResponsePosition,
          awaitingBatchId: batchId,
          finalBatch: page.done,
          responseDone: page.done,
          lastAppliedPageFingerprint: JSON.stringify(page),
          queuedResponseTail: Math.max(current.queuedResponseTail, current.expectedResponsePage + 1)
        }
        return [
          TokenState().new(allocated.next),
          sessionDomain.command.UpdateHlcCommand({ expected: expectedHlc, next: hlc }),
          RequesterAttemptsState().new(replaceBy(requesters, (item) => matchesSync(item, current), next)),
          deliveryDomain.command.AcceptInboundBatchCommand({
            domain: binding.domain,
            records,
            source: 'history',
            batchId
          }),
          HistoryTimeoutArmedEvent(next)
        ]
      }
    })

    const ContinueRequesterBatchCommand = domain.command({
      name: 'History.ContinueRequesterBatchCommand',
      impl: ({ get }, payload: { domain: string; batchId: string; inserted: boolean }) => {
        const requesters = get(RequesterAttemptsState())
        const current = requesters.find(
          (item) => item.domain === payload.domain && item.awaitingBatchId === payload.batchId
        )
        if (!current) return null
        const activation = payload.inserted && !current.feedbackActive
        const queued = current.pendingResponsePages[0]
        const next: RequesterAttemptState = {
          ...current,
          awaitingBatchId: undefined,
          feedbackActive: current.feedbackActive || payload.inserted,
          pendingResponsePages: queued ? current.pendingResponsePages.slice(1) : [],
          queuedResponseTail: queued ? current.queuedResponseTail : current.queuedResponseTail
        }
        const output: RemeshCommandOutput[] = [
          RequesterAttemptsState().new(replaceBy(requesters, (item) => matchesSync(item, current), next)),
          HistoryTimeoutArmedEvent(next),
          ...(activation ? (activateFeedback(get, current) ?? []) : []),
          ...(current.finalBatch
            ? [FinishRequestedEvent({ domain: current.domain, sourcePeerId: current.sourcePeerId })]
            : [])
        ]
        if (!current.finalBatch && queued) {
          // Dequeue must re-validate the page number: a stale or duplicated queued page that no
          // longer matches the expected page cancels the attempt instead of being applied.
          if (queued.page !== next.expectedResponsePage) {
            output.push(FinishRequestedEvent({ domain: current.domain, sourcePeerId: current.sourcePeerId }))
            return output
          }
          const prepared = prepareResponsePage(next, {
            roomId: '',
            sourcePeerId: current.sourcePeerId,
            message: queued
          })
          if (!prepared.ok) {
            output.push(prepared.action)
          } else {
            const page = prepared.page
            const expectedHlc = get(sessionDomain.query.HlcQuery())
            let hlc = expectedHlc
            let decodedBytes = next.responseBytes
            let messageCount = next.responseCount
            let budgetOk = true
            for (const event of page.messages) {
              const messageBytes = getTextByteSize(JSON.stringify(event))
              if (messageCount + 1 > historySessionMessages || decodedBytes + messageBytes > historySessionBytes) {
                budgetOk = false
                break
              }
              messageCount += 1
              decodedBytes += messageBytes
            }
            if (!budgetOk) {
              output.push(FinishRequestedEvent({ domain: current.domain, sourcePeerId: current.sourcePeerId }))
            } else {
              const records: ChatMessageRecord[] = []
              for (const event of page.messages) {
                if (event.hlc.timestamp < next.cutoff) {
                  output.push(FinishRequestedEvent({ domain: current.domain, sourcePeerId: current.sourcePeerId }))
                  break
                }
                const user = page.users.find((candidate) => candidate.id === event.userId)
                if (!user) continue
                const observed = observeHlc(hlc, event.hlc, clock.now())
                if (!observed) continue
                hlc = observed
                records.push(makeRecord(event, user, clock.now()))
              }
              if (records.length === page.messages.length) {
                const allocated = nextTokens(get, 1)
                const batchId = token('batch', allocated.values[0])
                const oldest = records.length > 0 ? records[records.length - 1].message : undefined
                const applied: RequesterAttemptState = {
                  ...next,
                  expectedResponsePage: next.expectedResponsePage + 1,
                  responseBytes: decodedBytes,
                  responseCount: messageCount,
                  lastResponsePosition: oldest ? { hlc: oldest.hlc, id: oldest.id } : next.lastResponsePosition,
                  awaitingBatchId: batchId,
                  finalBatch: page.done,
                  responseDone: page.done,
                  lastAppliedPageFingerprint: JSON.stringify(page)
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
                  }),
                  HistoryTimeoutArmedEvent(applied)
                )
              }
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
          (item) => item.domain === payload.domain && item.awaitingBatchId === payload.batchId
        )
        return current ? FinishRequestedEvent({ domain: current.domain, sourcePeerId: current.sourcePeerId }) : null
      }
    })

    const RemovePeerCommand = domain.command({
      name: 'History.RemovePeerCommand',
      impl: ({ get }, payload: { domain: string; sourcePeerId: string }) => {
        const requesters = get(RequesterAttemptsState())
        const providers = get(ProviderAttemptsState())
        const successors = get(ProviderSupplySuccessorsState())
        const jobs = get(ProviderSupplyJobsState())
        const owners = get(FeedbackOwnersState())
        const removedRequesters = requesters.filter(
          (item) => item.sourcePeerId === payload.sourcePeerId && item.domain === payload.domain
        )
        return [
          ...(removedRequesters.length > 0
            ? [FinishRequestedEvent({ domain: payload.domain, sourcePeerId: payload.sourcePeerId })]
            : []),
          RequesterAttemptsState().new(
            requesters.filter((item) => item.sourcePeerId !== payload.sourcePeerId || item.domain !== payload.domain)
          ),
          ProviderAttemptsState().new(
            providers.filter((item) => item.sourcePeerId !== payload.sourcePeerId || item.domain !== payload.domain)
          ),
          ProviderSupplySuccessorsState().new(
            successors.filter((item) => item.sourcePeerId !== payload.sourcePeerId || item.domain !== payload.domain)
          ),
          ProviderSupplyJobsState().new(
            jobs.filter((item) => item.sourcePeerId !== payload.sourcePeerId || item.domain !== payload.domain)
          ),
          ...owners
            .filter((item) => item.sourcePeerId === payload.sourcePeerId && item.domain === payload.domain)
            .flatMap((item) => dismissFeedback(get, item) ?? [])
        ]
      }
    })

    const ReleaseDomainCommand = domain.command({
      name: 'History.ReleaseDomainCommand',
      impl: ({ get }, runtimeDomain: string) => {
        const sourceIds = get(RequesterAttemptsState())
          .filter((item) => item.domain === runtimeDomain)
          .map((item) => ({ domain: runtimeDomain, sourcePeerId: item.sourcePeerId }))
        const owners = get(FeedbackOwnersState()).filter((item) => item.domain === runtimeDomain)
        return [
          ProviderAttemptsState().new(removeBy(get(ProviderAttemptsState()), (item) => item.domain === runtimeDomain)),
          ProviderSupplySuccessorsState().new(
            removeBy(get(ProviderSupplySuccessorsState()), (item) => item.domain === runtimeDomain)
          ),
          ProviderSupplyJobsState().new(
            removeBy(get(ProviderSupplyJobsState()), (item) => item.domain === runtimeDomain)
          ),
          ...owners.flatMap((item) => dismissFeedback(get, item) ?? []),
          ...sourceIds.map(FinishRequestedEvent)
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
      name: 'History.RequesterInventorySupplyEffect',
      impl: ({ fromEvent, get }) =>
        fromEvent(SyncStartedEvent).pipe(
          mergeMap((key) => {
            const failedPageIds: string[] = []
            return defer(async () => {
              const current = get(RequesterAttemptsState()).find((item) => matchesSync(item, key))
              if (!current || current.inventoryPages.length > 0) return []
              const pageIds = pagePort.historyPageIds(key.domain)
              const supplyRequest = {
                domain: key.domain,
                syncId: key.syncId,
                cutoff: current.cutoff,
                mode: 'inventory' as const
              }
              let supplied: Awaited<ReturnType<typeof pagePort.supplyHistory>> | null = null
              const supplyDeadline = clock.now() + HISTORY_REQUEST_TIMEOUT_MS
              for (const pageId of pageIds) {
                const remainingMs = supplyDeadline - clock.now()
                if (remainingMs <= 0) break
                try {
                  const supplyId = `inventory:${key.syncToken}:${failedPageIds.length}`
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
                } catch {
                  try {
                    pagePort.removePage(pageId)
                  } finally {
                    failedPageIds.push(pageId)
                  }
                }
              }
              const attempt = get(RequesterAttemptsState()).find((item) => matchesSync(item, key))
              if (!supplied || !attempt) {
                return [
                  ...(failedPageIds.length > 0 ? [DeadPagesEvent(failedPageIds)] : []),
                  FinishCurrentRequestedEvent(key)
                ]
              }
              const inventoryIds = supplied.records
                .filter((record) => record.message.hlc.timestamp >= attempt.cutoff)
                .slice(0, historySessionMessages)
                .map((record) => record.message.id)
              // Build inventory pages with the REAL production codec so every page is strictly below
              // the final 64KiB encoded frame. NativeWireCodec throws on an oversized frame, so the
              // throw closes the current bucket; only a single ID that cannot form a valid page by
              // itself cancels the attempt locally.
              const pages: HistoryMessagesRequest[] = []
              let bucket: string[] = []
              const encodeFrame = async (messageIds: string[], done: boolean) => {
                const frame = {
                  type: MESSAGE_TYPE.HISTORY_MESSAGES_REQUEST,
                  syncId: key.syncId,
                  page: pages.length,
                  messageIds,
                  done
                }
                await codec.encode(frame)
                return frame
              }
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
                    return [
                      ...(failedPageIds.length > 0 ? [DeadPagesEvent(failedPageIds)] : []),
                      FinishCurrentRequestedEvent(key)
                    ]
                  }
                  pages.push({
                    type: MESSAGE_TYPE.HISTORY_MESSAGES_REQUEST,
                    syncId: key.syncId,
                    page: pages.length,
                    messageIds: bucket,
                    done: false
                  })
                  try {
                    await encodeFrame([id], false)
                  } catch {
                    return [
                      ...(failedPageIds.length > 0 ? [DeadPagesEvent(failedPageIds)] : []),
                      FinishCurrentRequestedEvent(key)
                    ]
                  }
                  bucket = [id]
                } else {
                  bucket = candidate
                }
              }
              pages.push({
                type: MESSAGE_TYPE.HISTORY_MESSAGES_REQUEST,
                syncId: key.syncId,
                page: pages.length,
                messageIds: bucket,
                done: true
              })
              const next: RequesterAttemptState = { ...attempt, inventoryIds, inventoryPages: pages }
              return [
                ...(failedPageIds.length > 0 ? [DeadPagesEvent(failedPageIds)] : []),
                RequesterAttemptsState().new(
                  replaceBy(get(RequesterAttemptsState()), (item) => matchesSync(item, attempt), next)
                ),
                QueueInventoryPageCommand(next) as RemeshCommandOutput
              ]
            }).pipe(
              catchError(() => [
                ...(failedPageIds.length > 0 ? [DeadPagesEvent(failedPageIds)] : []),
                FinishCurrentRequestedEvent(key)
              ])
            )
          }, MAX_PROVIDER_SUPPLY_CONCURRENCY)
        ) as unknown as Observable<never>
    })
    domain.effect({
      name: 'History.WireInventoryEffect',
      impl: ({ fromEvent }) =>
        fromEvent(wireDomain.event.MessageAcceptedEvent).pipe(
          filter(
            (event): event is WireMessageEvent & { message: HistoryMessagesRequest } =>
              'type' in event.message && event.message.type === MESSAGE_TYPE.HISTORY_MESSAGES_REQUEST
          ),
          map(HandleInventoryPageCommand)
        )
    })
    domain.effect({
      name: 'History.WireResponseEffect',
      impl: ({ fromEvent }) =>
        fromEvent(wireDomain.event.MessageAcceptedEvent).pipe(
          filter(
            (event): event is WireMessageEvent & { message: HistoryMessagesResponse } =>
              'type' in event.message && event.message.type === MESSAGE_TYPE.HISTORY_MESSAGES_RESPONSE
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
            return pending.kind === 'inventory'
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
          map(FinishCurrentRequesterCommand)
        )
    })
    domain.effect({
      name: 'History.ProviderSupplyEffect',
      impl: ({ fromEvent, get }) =>
        fromEvent(ProviderSupplyRequestedEvent).pipe(
          mergeMap((request) => {
            const failedPageIds: string[] = []
            return defer(async () => {
              const currentProvider = get(ProviderAttemptsState()).find((item) => matchesSync(item, request))
              if (!currentProvider) return [CancelProviderAttemptCommand(request)]
              const pageIds = pagePort.historyPageIds(request.domain)
              const supplyRequest = {
                domain: request.domain,
                syncId: request.syncId,
                cutoff: currentProvider.cutoff,
                mode: 'provider' as const
              }
              let supplied: Awaited<ReturnType<typeof pagePort.supplyHistory>> | null = null
              const supplyDeadline = clock.now() + HISTORY_REQUEST_TIMEOUT_MS
              for (const pageId of pageIds) {
                const remainingMs = supplyDeadline - clock.now()
                if (remainingMs <= 0) break
                try {
                  const supplyId = `supply:${request.syncToken}:${failedPageIds.length}`
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
                } catch {
                  try {
                    pagePort.removePage(pageId)
                  } finally {
                    failedPageIds.push(pageId)
                  }
                }
              }
              if (!supplied) {
                return [
                  ...(failedPageIds.length > 0 ? [DeadPagesEvent(failedPageIds)] : []),
                  CancelProviderAttemptCommand(request)
                ]
              }
              const attempt = get(ProviderAttemptsState()).find((item) => matchesSync(item, request))
              if (!attempt) {
                return [
                  ...(failedPageIds.length > 0 ? [DeadPagesEvent(failedPageIds)] : []),
                  CancelProviderAttemptCommand(request)
                ]
              }
              const known = attempt.inventory
              const eligible: { record: ChatMessageRecord; bytes: number }[] = []
              let decodedBytes = 0
              for (const record of supplied.records) {
                if (known.has(record.message.id)) continue
                if (eligible.length >= historySessionMessages || decodedBytes >= historySessionBytes) break
                if (record.message.hlc.timestamp < attempt.cutoff) continue
                if (record.id !== record.message.id || record.user.id !== record.message.userId) continue
                if (!isMessageWithinLimit(record.message) || !isUserWithinLimit(record.user)) continue
                const bytes = getTextByteSize(JSON.stringify(record.message))
                if (decodedBytes + bytes > historySessionBytes) break
                decodedBytes += bytes
                eligible.push({ record, bytes })
              }
              const nextProvider: ProviderAttemptState = {
                ...attempt,
                snapshot: eligible.map(({ record }) => record)
              }
              return [
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
            }).pipe(
              catchError(() => [
                ...(failedPageIds.length > 0 ? [DeadPagesEvent(failedPageIds)] : []),
                CancelProviderAttemptCommand(request)
              ])
            )
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
      query: { RequesterAttemptsQuery, ProviderAttemptsQuery, ProviderSupplyJobsQuery },
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
