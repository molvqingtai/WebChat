import { Remesh } from 'remesh'
import { catchError, defer, filter, map, mergeMap, Observable } from 'rxjs'
import DeliveryDomain from '@/domain/runtime/Delivery'
import SessionDomain, { observeHlc, type SessionDomainState } from '@/domain/runtime/Session'
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
  type HLC,
  type HistoryRequestMessage,
  type HistoryResponseMessage,
  type ChatUser
} from '@/protocol'
import { compareEventPosition, type ChatMessageRecord } from '@/domain/Message'
import type { HistorySupplyRequest } from '@/runtime/Contract'
import { getTextByteSize } from '@/utils/getTextByteSize'

export interface HistoryOptions {
  [key: string]: number | undefined
  historySessionBytes?: number
  historySessionMessages?: number
}

interface RequesterHistoryState {
  sourcePeerId: string
  domain: string
  syncId: string
  cutoff: number
  decodedBytes: number
  messageCount: number
  syncToken: string
  awaitingBatchId?: string
  nextBefore?: { hlc: HLC; id: string }
  stopAfterAck: boolean
}

interface QueuedHistoryState {
  sourcePeerId: string
  domains: string[]
}

interface HistorySyncKey {
  sourcePeerId: string
  domain: string
  syncId: string
  syncToken: string
}

interface ProviderSessionState extends HistorySyncKey {
  cutoff: number
  decodedBytes: number
  messageCount: number
  supplying: boolean
}

interface ProviderSupplyPayload extends HistorySyncKey {
  before?: { hlc: HLC; id: string }
  cutoff: number
  remainingBytes: number
  remainingMessages: number
  queueBytes: number
}

interface ProviderSupplyJobState extends HistorySyncKey {
  queueBytes: number
}

type ProviderSupplySuccessorState = ProviderSupplyPayload

interface PendingRequestSend extends HistorySyncKey {
  kind: 'request'
  requestId: string
}

interface PendingProviderSend extends HistorySyncKey {
  kind: 'provider'
  requestId: string
  records: { record: ChatMessageRecord; bytes: number }[]
  suppliedCount: number
  suppliedDone: boolean
}

type PendingWireSend = PendingRequestSend | PendingProviderSend

const replaceBy = <T>(items: T[], predicate: (item: T) => boolean, next: T): T[] =>
  items.some(predicate) ? items.map((item) => (predicate(item) ? next : item)) : [...items, next]
const removeBy = <T>(items: T[], predicate: (item: T) => boolean): T[] => items.filter((item) => !predicate(item))
const historyCutoff = (now: number) => now - HISTORY_WINDOW_DAYS * 24 * 60 * 60 * 1000
const token = (kind: string, counter: number) => `${kind}:${counter.toString(36)}`

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

const matchesSync = (item: HistorySyncKey, key: HistorySyncKey) =>
  item.sourcePeerId === key.sourcePeerId &&
  item.domain === key.domain &&
  item.syncId === key.syncId &&
  item.syncToken === key.syncToken

const HistoryDomain = Remesh.domain({
  name: 'HistoryDomain',
  impl: (domain, options: HistoryOptions = {}) => {
    const clock = domain.getExtern(ClockExtern)
    const pagePort = domain.getExtern(PagePortExtern)
    const wireDomain = domain.getDomain(WireDomain())
    const deliveryDomain = domain.getDomain(DeliveryDomain())
    const sessionDomain = domain.getDomain(SessionDomain())
    const historySessionBytes = options.historySessionBytes ?? MAX_HISTORY_SESSION_BYTES
    const historySessionMessages = options.historySessionMessages ?? MAX_HISTORY_SESSION_MESSAGES

    const TokenState = domain.state<number>({ name: 'History.TokenState', default: 0 })
    const RequesterHistoriesState = domain.state<RequesterHistoryState[]>({
      name: 'History.RequesterHistoriesState',
      default: []
    })
    const QueuedHistoriesState = domain.state<QueuedHistoryState[]>({
      name: 'History.QueuedHistoriesState',
      default: []
    })
    const ProviderSessionsState = domain.state<ProviderSessionState[]>({
      name: 'History.ProviderSessionsState',
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
    const ActiveSuppliesState = domain.state<HistorySyncKey[]>({
      name: 'History.ActiveSuppliesState',
      default: []
    })
    const WaitingSuppliesState = domain.state<ProviderSupplyPayload[]>({
      name: 'History.WaitingSuppliesState',
      default: []
    })

    const RequesterHistoriesQuery = domain.query({
      name: 'History.RequesterHistoriesQuery',
      impl: ({ get }) => get(RequesterHistoriesState())
    })
    const ProviderSessionsQuery = domain.query({
      name: 'History.ProviderSessionsQuery',
      impl: ({ get }) => get(ProviderSessionsState())
    })
    const ProviderSupplyJobsQuery = domain.query({
      name: 'History.ProviderSupplyJobsQuery',
      impl: ({ get }) => get(ProviderSupplyJobsState())
    })

    const SyncStartedEvent = domain.event<HistorySyncKey>({ name: 'History.SyncStartedEvent' })
    const SyncCompletedEvent = domain.event<{ sourcePeerId: string }>({ name: 'History.SyncCompletedEvent' })
    const ResponseAcceptedEvent = domain.event<{ domain: string; sourcePeerId: string; count: number }>({
      name: 'History.ResponseAcceptedEvent'
    })
    const ProviderSupplyRequestedEvent = domain.event<ProviderSupplyPayload>({
      name: 'History.ProviderSupplyRequestedEvent'
    })
    const HistoryTimeoutArmedEvent = domain.event<HistorySyncKey>({ name: 'History.TimeoutArmedEvent' })
    const ProviderTimeoutArmedEvent = domain.event<HistorySyncKey>({ name: 'History.ProviderTimeoutArmedEvent' })
    const DeadPagesEvent = domain.event<string[]>({ name: 'History.DeadPagesEvent' })
    const ErrorEvent = domain.event<Error>({ name: 'History.ErrorEvent' })
    const StartRequestedEvent = domain.event<{ domain: string; sourcePeerId: string }>({
      name: 'History.StartRequestedEvent'
    })
    const FinishRequestedEvent = domain.event<string>({ name: 'History.FinishRequestedEvent' })
    const FinishCurrentRequestedEvent = domain.event<HistorySyncKey>({
      name: 'History.FinishCurrentRequestedEvent'
    })
    const RequestQueuedEvent = domain.event<HistorySyncKey & { before?: { hlc: HLC; id: string } }>({
      name: 'History.RequestQueuedEvent'
    })

    const nextTokens = (get: (action: ReturnType<typeof TokenState>) => number, count: number) => {
      const start = get(TokenState()) + 1
      return { next: start + count - 1, values: Array.from({ length: count }, (_, index) => start + index) }
    }

    const StartHistoryCommand = domain.command({
      name: 'History.StartHistoryCommand',
      impl: ({ get }, payload: { domain: string; sourcePeerId: string }) => {
        const runtime = get(sessionDomain.query.DomainQuery(payload.domain))
        if (!runtime?.sessions.some((session) => session.sourcePeerId === payload.sourcePeerId)) return null
        const requesters = get(RequesterHistoriesState())
        if (requesters.some((item) => item.sourcePeerId === payload.sourcePeerId)) {
          const queues = get(QueuedHistoriesState())
          const current = queues.find((item) => item.sourcePeerId === payload.sourcePeerId)
          if (current?.domains.includes(payload.domain)) return null
          return QueuedHistoriesState().new(
            replaceBy(queues, (item) => item.sourcePeerId === payload.sourcePeerId, {
              sourcePeerId: payload.sourcePeerId,
              domains: [...(current?.domains ?? []), payload.domain]
            })
          )
        }
        const allocated = nextTokens(get, 2)
        const state: RequesterHistoryState = {
          sourcePeerId: payload.sourcePeerId,
          domain: payload.domain,
          syncId: token('sync', allocated.values[0]),
          cutoff: historyCutoff(clock.now()),
          decodedBytes: 0,
          messageCount: 0,
          syncToken: token('request', allocated.values[1]),
          stopAfterAck: false
        }
        const key: HistorySyncKey = state
        return [
          TokenState().new(allocated.next),
          RequesterHistoriesState().new([...requesters, state]),
          RequestQueuedEvent(key),
          HistoryTimeoutArmedEvent(key),
          SyncStartedEvent(key)
        ]
      }
    })

    const QueueHistoryRequestCommand = domain.command({
      name: 'History.QueueHistoryRequestCommand',
      impl: ({ get }, payload: HistorySyncKey & { before?: { hlc: HLC; id: string } }) => {
        const runtime = get(sessionDomain.query.DomainQuery(payload.domain))
        if (!runtime) return FinishCurrentRequestedEvent(payload)
        const requestId = `history:request:${payload.syncToken}`
        const pending: PendingRequestSend = { ...payload, kind: 'request', requestId }
        return [
          PendingWireSendsState().new([
            ...removeBy(get(PendingWireSendsState()), (item) => item.requestId === requestId),
            pending
          ]),
          wireDomain.command.SendMessageCommand({
            requestId,
            roomId: runtime.roomId,
            targetPeerIds: [payload.sourcePeerId],
            message: {
              type: MESSAGE_TYPE.HISTORY_REQUEST,
              syncId: payload.syncId,
              ...(payload.before ? { before: payload.before } : {})
            }
          })
        ]
      }
    })

    const FinishHistoryCommand = domain.command({
      name: 'History.FinishHistoryCommand',
      impl: ({ get }, sourcePeerId: string) => {
        const requesters = get(RequesterHistoriesState())
        if (!requesters.some((item) => item.sourcePeerId === sourcePeerId)) return null
        const queues = get(QueuedHistoriesState())
        const currentQueue = queues.find((item) => item.sourcePeerId === sourcePeerId)?.domains ?? []
        const nextDomain = currentQueue.find((queuedDomain) =>
          get(sessionDomain.query.DomainQuery(queuedDomain))?.sessions.some(
            (session) => session.sourcePeerId === sourcePeerId
          )
        )
        const remainingQueue = nextDomain ? currentQueue.slice(currentQueue.indexOf(nextDomain) + 1) : []
        const nextQueues =
          remainingQueue.length > 0
            ? replaceBy(queues, (item) => item.sourcePeerId === sourcePeerId, { sourcePeerId, domains: remainingQueue })
            : removeBy(queues, (item) => item.sourcePeerId === sourcePeerId)
        return [
          RequesterHistoriesState().new(removeBy(requesters, (item) => item.sourcePeerId === sourcePeerId)),
          QueuedHistoriesState().new(nextQueues),
          PendingWireSendsState().new(
            removeBy(
              get(PendingWireSendsState()),
              (item) => item.sourcePeerId === sourcePeerId && item.kind === 'request'
            )
          ),
          SyncCompletedEvent({ sourcePeerId }),
          ...(nextDomain ? [StartRequestedEvent({ domain: nextDomain, sourcePeerId })] : [])
        ]
      }
    })

    const FinishCurrentHistoryCommand = domain.command({
      name: 'History.FinishCurrentHistoryCommand',
      impl: ({ get }, payload: HistorySyncKey) => {
        const current = get(RequesterHistoriesState()).find((item) => item.sourcePeerId === payload.sourcePeerId)
        return current?.domain === payload.domain &&
          current.syncId === payload.syncId &&
          current.syncToken === payload.syncToken
          ? FinishRequestedEvent(payload.sourcePeerId)
          : null
      }
    })

    const ResetHistoryForSessionCommand = domain.command({
      name: 'History.ResetHistoryForSessionCommand',
      impl: ({ get }, payload: { domain: string; sourcePeerId: string }) => [
        RequesterHistoriesState().new(
          get(RequesterHistoriesState()).filter(
            (item) => item.sourcePeerId !== payload.sourcePeerId || item.domain !== payload.domain
          )
        ),
        QueuedHistoriesState().new(
          get(QueuedHistoriesState())
            .map((item) =>
              item.sourcePeerId === payload.sourcePeerId
                ? { ...item, domains: item.domains.filter((queued) => queued !== payload.domain) }
                : item
            )
            .filter((item) => item.domains.length > 0)
        ),
        ProviderSessionsState().new(
          get(ProviderSessionsState()).filter(
            (item) => item.sourcePeerId !== payload.sourcePeerId || item.domain !== payload.domain
          )
        ),
        ProviderSupplySuccessorsState().new(
          get(ProviderSupplySuccessorsState()).filter(
            (item) => item.sourcePeerId !== payload.sourcePeerId || item.domain !== payload.domain
          )
        ),
        StartRequestedEvent(payload)
      ]
    })

    const ContinueHistoryBatchCommand = domain.command({
      name: 'History.ContinueHistoryBatchCommand',
      impl: ({ get }, payload: { domain: string; batchId: string }) => {
        const requesters = get(RequesterHistoriesState())
        const current = requesters.find(
          (item) => item.domain === payload.domain && item.awaitingBatchId === payload.batchId
        )
        if (!current) return null
        if (current.stopAfterAck || !current.nextBefore) return FinishRequestedEvent(current.sourcePeerId)
        const allocated = nextTokens(get, 1)
        const next: RequesterHistoryState = {
          ...current,
          awaitingBatchId: undefined,
          stopAfterAck: false,
          syncToken: token('request', allocated.values[0])
        }
        const request = { ...next, before: next.nextBefore }
        return [
          TokenState().new(allocated.next),
          RequesterHistoriesState().new(
            replaceBy(requesters, (item) => item.sourcePeerId === current.sourcePeerId, next)
          ),
          RequestQueuedEvent(request),
          HistoryTimeoutArmedEvent(next)
        ]
      }
    })

    const DiscardHistoryBatchCommand = domain.command({
      name: 'History.DiscardHistoryBatchCommand',
      impl: ({ get }, payload: { domain: string; batchId: string }) => {
        const current = get(RequesterHistoriesState()).find(
          (item) => item.domain === payload.domain && item.awaitingBatchId === payload.batchId
        )
        return current ? FinishRequestedEvent(current.sourcePeerId) : null
      }
    })

    const ApplyHistoryResponseCommand = domain.command({
      name: 'History.ApplyHistoryResponseCommand',
      impl: ({ get }, payload: WireMessageEvent & { message: HistoryResponseMessage }) => {
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
        const requesters = get(RequesterHistoriesState())
        const current = requesters.find((item) => item.sourcePeerId === payload.sourcePeerId)
        if (
          !current ||
          current.awaitingBatchId ||
          current.domain !== binding.domain ||
          current.syncId !== payload.message.syncId
        ) {
          return null
        }
        const ordered = payload.message.messages.every(
          (event, index) => index === 0 || compareEventPosition(payload.message.messages[index - 1], event) > 0
        )
        if (!ordered) {
          return wireDomain.command.DropProtocolCommand({
            sourcePeerId: payload.sourcePeerId,
            reason: 'history response is not strictly recent-first'
          })
        }

        const expectedHlc = get(sessionDomain.query.HlcQuery())
        let hlc = expectedHlc
        let decodedBytes = current.decodedBytes
        let messageCount = current.messageCount
        let oldest: ChatMessage | undefined
        let reachedLimit = false
        const records: ChatMessageRecord[] = []
        for (const event of payload.message.messages) {
          if (event.hlc.timestamp < current.cutoff) {
            reachedLimit = true
            break
          }
          const messageBytes = getTextByteSize(JSON.stringify(event))
          if (messageCount + 1 > historySessionMessages || decodedBytes + messageBytes > historySessionBytes) {
            reachedLimit = true
            break
          }
          oldest = event
          messageCount += 1
          decodedBytes += messageBytes
          const user = payload.message.users.find((candidate) => candidate.id === event.userId)
          if (!user) continue
          const observed = observeHlc(hlc, event.hlc, clock.now())
          if (!observed) continue
          hlc = observed
          records.push(makeRecord(event, user, clock.now()))
        }

        const stopAfterAck =
          reachedLimit ||
          messageCount >= historySessionMessages ||
          decodedBytes >= historySessionBytes ||
          payload.message.done ||
          !oldest
        const allocated = nextTokens(get, records.length === 0 && !stopAfterAck ? 1 : 2)
        if (records.length === 0) {
          if (stopAfterAck) return FinishRequestedEvent(payload.sourcePeerId)
          const next: RequesterHistoryState = {
            ...current,
            decodedBytes,
            messageCount,
            nextBefore: { hlc: oldest!.hlc, id: oldest!.id },
            syncToken: token('request', allocated.values[0])
          }
          return [
            TokenState().new(allocated.next),
            sessionDomain.command.UpdateHlcCommand({ expected: expectedHlc, next: hlc }),
            RequesterHistoriesState().new(
              replaceBy(requesters, (item) => item.sourcePeerId === payload.sourcePeerId, next)
            ),
            RequestQueuedEvent({ ...next, before: next.nextBefore }),
            HistoryTimeoutArmedEvent(next)
          ]
        }

        const batchId = token('batch', allocated.values[0])
        const syncToken = token('request', allocated.values[1])
        const next: RequesterHistoryState = {
          ...current,
          decodedBytes,
          messageCount,
          awaitingBatchId: batchId,
          nextBefore: oldest ? { hlc: oldest.hlc, id: oldest.id } : undefined,
          stopAfterAck,
          syncToken
        }
        return [
          TokenState().new(allocated.next),
          sessionDomain.command.UpdateHlcCommand({ expected: expectedHlc, next: hlc }),
          RequesterHistoriesState().new(
            replaceBy(requesters, (item) => item.sourcePeerId === payload.sourcePeerId, next)
          ),
          deliveryDomain.command.AcceptInboundBatchCommand({
            domain: binding.domain,
            records,
            source: 'history',
            batchId
          }),
          HistoryTimeoutArmedEvent(next),
          ResponseAcceptedEvent({ domain: binding.domain, sourcePeerId: payload.sourcePeerId, count: records.length })
        ]
      }
    })

    const HandleProviderRequestCommand = domain.command({
      name: 'History.HandleProviderRequestCommand',
      impl: ({ get }, payload: WireMessageEvent & { message: HistoryRequestMessage }) => {
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
        const sessions = get(ProviderSessionsState())
        const current = sessions.find((item) => item.sourcePeerId === payload.sourcePeerId)
        const jobs = get(ProviderSupplyJobsState())
        const successors = get(ProviderSupplySuccessorsState())
        const activeJob = jobs.some((job) => job.sourcePeerId === payload.sourcePeerId)
        if (
          successors.some((item) => item.sourcePeerId === payload.sourcePeerId) ||
          (current &&
            (current.supplying || current.domain !== binding.domain || current.syncId !== payload.message.syncId))
        ) {
          return null
        }
        const queueBytes = getTextByteSize(JSON.stringify(payload.message))
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
        const key: HistorySyncKey = {
          sourcePeerId: payload.sourcePeerId,
          domain: binding.domain,
          syncId: payload.message.syncId,
          syncToken: token('provider', allocated.values[0])
        }
        if (activeJob) {
          const successor: ProviderSupplySuccessorState = {
            ...key,
            before: payload.message.before,
            cutoff: historyCutoff(clock.now()),
            remainingBytes: historySessionBytes,
            remainingMessages: historySessionMessages,
            queueBytes
          }
          return [
            TokenState().new(allocated.next),
            ProviderSupplySuccessorsState().new([...successors, successor]),
            ProviderTimeoutArmedEvent(key)
          ]
        }
        const next: ProviderSessionState = current
          ? { ...current, supplying: true, syncToken: key.syncToken }
          : {
              ...key,
              cutoff: historyCutoff(clock.now()),
              decodedBytes: 0,
              messageCount: 0,
              supplying: true
            }
        const request: ProviderSupplyPayload = {
          ...key,
          before: payload.message.before,
          cutoff: next.cutoff,
          remainingBytes: historySessionBytes - next.decodedBytes,
          remainingMessages: historySessionMessages - next.messageCount,
          queueBytes
        }
        return [
          TokenState().new(allocated.next),
          ProviderSessionsState().new(replaceBy(sessions, (item) => item.sourcePeerId === payload.sourcePeerId, next)),
          ProviderSupplyJobsState().new([...jobs, { ...key, queueBytes }]),
          AdmitProviderSupplyCommand(request),
          ProviderTimeoutArmedEvent(key)
        ]
      }
    })

    const AdmitProviderSupplyCommand = domain.command({
      name: 'History.AdmitProviderSupplyCommand',
      impl: ({ get }, request: ProviderSupplyPayload) => {
        const active = get(ActiveSuppliesState())
        if (active.length >= MAX_PROVIDER_SUPPLY_CONCURRENCY) {
          return WaitingSuppliesState().new([...get(WaitingSuppliesState()), request])
        }
        return [ActiveSuppliesState().new([...active, request]), ProviderSupplyRequestedEvent(request)]
      }
    })

    const ReleaseProviderSupplySlotCommand = domain.command({
      name: 'History.ReleaseProviderSupplySlotCommand',
      impl: ({ get }, key: HistorySyncKey) => {
        const active = removeBy(get(ActiveSuppliesState()), (item) => matchesSync(item, key))
        const waiting = get(WaitingSuppliesState())
        const next = waiting[0]
        return [
          ActiveSuppliesState().new(next ? [...active, next] : active),
          WaitingSuppliesState().new(next ? waiting.slice(1) : waiting),
          ...(next ? [ProviderSupplyRequestedEvent(next)] : [])
        ]
      }
    })

    const releaseProviderJob = (
      key: HistorySyncKey,
      jobs: ProviderSupplyJobState[],
      sessions: ProviderSessionState[],
      successors: ProviderSupplySuccessorState[],
      domains: SessionDomainState[]
    ) => {
      const nextJobs = removeBy(jobs, (job) => matchesSync(job, key))
      const successor = successors.find((item) => item.sourcePeerId === key.sourcePeerId)
      if (!successor || nextJobs.some((job) => job.sourcePeerId === key.sourcePeerId)) {
        return [
          ProviderSessionsState().new(sessions),
          ProviderSupplyJobsState().new(nextJobs),
          ReleaseProviderSupplySlotCommand(key)
        ]
      }
      const nextSuccessors = removeBy(successors, (item) => item.sourcePeerId === key.sourcePeerId)
      const isLive = domains
        .find((runtime) => runtime.domain === successor.domain)
        ?.sessions.some((session) => session.sourcePeerId === successor.sourcePeerId)
      if (!isLive) {
        return [
          ProviderSessionsState().new(sessions),
          ProviderSupplyJobsState().new(nextJobs),
          ProviderSupplySuccessorsState().new(nextSuccessors),
          ReleaseProviderSupplySlotCommand(key)
        ]
      }
      const nextSession: ProviderSessionState = {
        sourcePeerId: successor.sourcePeerId,
        domain: successor.domain,
        syncId: successor.syncId,
        syncToken: successor.syncToken,
        cutoff: successor.cutoff,
        decodedBytes: 0,
        messageCount: 0,
        supplying: true
      }
      return [
        ProviderSessionsState().new(
          replaceBy(sessions, (item) => item.sourcePeerId === successor.sourcePeerId, nextSession)
        ),
        ProviderSupplyJobsState().new([
          ...nextJobs,
          {
            sourcePeerId: successor.sourcePeerId,
            domain: successor.domain,
            syncId: successor.syncId,
            syncToken: successor.syncToken,
            queueBytes: successor.queueBytes
          }
        ]),
        ProviderSupplySuccessorsState().new(nextSuccessors),
        ReleaseProviderSupplySlotCommand(key),
        AdmitProviderSupplyCommand(successor)
      ]
    }

    const AbortProviderSupplyCommand = domain.command({
      name: 'History.AbortProviderSupplyCommand',
      impl: ({ get }, key: HistorySyncKey) =>
        releaseProviderJob(
          key,
          get(ProviderSupplyJobsState()),
          removeBy(get(ProviderSessionsState()), (item) => matchesSync(item, key)),
          get(ProviderSupplySuccessorsState()),
          get(sessionDomain.query.DomainsQuery())
        )
    })

    const ProviderTimedOutCommand = domain.command({
      name: 'History.ProviderTimedOutCommand',
      impl: ({ get }, key: HistorySyncKey) => {
        const sessions = get(ProviderSessionsState())
        const successors = get(ProviderSupplySuccessorsState())
        if (!sessions.some((item) => matchesSync(item, key)) && !successors.some((item) => matchesSync(item, key))) {
          return null
        }
        return [
          ProviderSessionsState().new(removeBy(sessions, (item) => matchesSync(item, key))),
          ProviderSupplySuccessorsState().new(removeBy(successors, (item) => matchesSync(item, key)))
        ]
      }
    })

    const CompleteProviderSupplyCommand = domain.command({
      name: 'History.CompleteProviderSupplyCommand',
      impl: ({ get }, payload: HistorySyncKey & { decodedBytes: number; messageCount: number; done: boolean }) => {
        const jobs = get(ProviderSupplyJobsState())
        const sessions = get(ProviderSessionsState())
        const current = sessions.find((item) => matchesSync(item, payload))
        if (!current) {
          return releaseProviderJob(
            payload,
            jobs,
            sessions,
            get(ProviderSupplySuccessorsState()),
            get(sessionDomain.query.DomainsQuery())
          )
        }
        const decodedBytes = current.decodedBytes + payload.decodedBytes
        const messageCount = current.messageCount + payload.messageCount
        if (payload.done || decodedBytes >= historySessionBytes || messageCount >= historySessionMessages) {
          return releaseProviderJob(
            payload,
            jobs,
            removeBy(sessions, (item) => matchesSync(item, payload)),
            get(ProviderSupplySuccessorsState()),
            get(sessionDomain.query.DomainsQuery())
          )
        }
        const allocated = nextTokens(get, 1)
        const next: ProviderSessionState = {
          ...current,
          decodedBytes,
          messageCount,
          supplying: false,
          syncToken: token('provider', allocated.values[0])
        }
        return [
          TokenState().new(allocated.next),
          ProviderSessionsState().new(replaceBy(sessions, (item) => item.sourcePeerId === payload.sourcePeerId, next)),
          ProviderSupplyJobsState().new(removeBy(jobs, (job) => matchesSync(job, payload))),
          ReleaseProviderSupplySlotCommand(payload),
          ProviderTimeoutArmedEvent(next)
        ]
      }
    })

    const QueueProviderResponseCommand = domain.command({
      name: 'History.QueueProviderResponseCommand',
      impl: (
        { get },
        payload: HistorySyncKey & {
          records: { record: ChatMessageRecord; bytes: number }[]
          suppliedCount: number
          suppliedDone: boolean
        }
      ) => {
        const runtime = get(sessionDomain.query.DomainQuery(payload.domain))
        if (!runtime) return AbortProviderSupplyCommand(payload)
        const requestId = `history:provider:${payload.syncToken}:${payload.records.length}`
        const response: HistoryResponseMessage = {
          type: MESSAGE_TYPE.HISTORY_RESPONSE,
          syncId: payload.syncId,
          users: usersForRecords(payload.records.map(({ record }) => record)),
          messages: payload.records.map(({ record }) => record.message),
          done: payload.suppliedDone && payload.records.length === payload.suppliedCount
        }
        const pending: PendingProviderSend = { ...payload, kind: 'provider', requestId }
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

    const CompleteWireSendCommand = domain.command({
      name: 'History.CompleteWireSendCommand',
      impl: ({ get }, requestId: string) => {
        const pending = get(PendingWireSendsState())
        const current = pending.find((item) => item.requestId === requestId)
        if (!current) return null
        const clear = PendingWireSendsState().new(removeBy(pending, (item) => item.requestId === requestId))
        return current.kind === 'request'
          ? clear
          : [
              clear,
              CompleteProviderSupplyCommand({
                sourcePeerId: current.sourcePeerId,
                domain: current.domain,
                syncId: current.syncId,
                syncToken: current.syncToken,
                decodedBytes: current.records.reduce((total, item) => total + item.bytes, 0),
                messageCount: current.records.length,
                done: current.suppliedDone && current.records.length === current.suppliedCount
              })
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
        if (current.kind === 'request') {
          return [clear, ErrorEvent(payload.error), FinishCurrentRequestedEvent(current)]
        }
        // A preflight failure means the oversized history frame never reached the provider: drop the
        // offending record and advance. Branches on the producer-set structured stage, never on the
        // error's constructor.
        if (payload.stage === 'preflight' && current.records.length > 0) {
          return [clear, QueueProviderResponseCommand({ ...current, records: current.records.slice(0, -1) })]
        }
        return [clear, ErrorEvent(payload.error), AbortProviderSupplyCommand(current)]
      }
    })

    const RemovePeerCommand = domain.command({
      name: 'History.RemovePeerCommand',
      impl: ({ get }, payload: { domain: string; sourcePeerId: string }) => {
        const queues = get(QueuedHistoriesState())
        return [
          QueuedHistoriesState().new(
            queues
              .map((item) =>
                item.sourcePeerId === payload.sourcePeerId
                  ? { ...item, domains: item.domains.filter((queued) => queued !== payload.domain) }
                  : item
              )
              .filter((item) => item.domains.length > 0)
          ),
          ...(get(RequesterHistoriesState()).some(
            (item) => item.sourcePeerId === payload.sourcePeerId && item.domain === payload.domain
          )
            ? [FinishRequestedEvent(payload.sourcePeerId)]
            : []),
          ProviderSessionsState().new(
            removeBy(
              get(ProviderSessionsState()),
              (item) => item.sourcePeerId === payload.sourcePeerId && item.domain === payload.domain
            )
          ),
          ProviderSupplySuccessorsState().new(
            removeBy(
              get(ProviderSupplySuccessorsState()),
              (item) => item.sourcePeerId === payload.sourcePeerId && item.domain === payload.domain
            )
          )
        ]
      }
    })

    const ReleaseDomainCommand = domain.command({
      name: 'History.ReleaseDomainCommand',
      impl: ({ get }, runtimeDomain: string) => {
        const sourceIds = get(RequesterHistoriesState())
          .filter((item) => item.domain === runtimeDomain)
          .map((item) => item.sourcePeerId)
        return [
          ProviderSessionsState().new(removeBy(get(ProviderSessionsState()), (item) => item.domain === runtimeDomain)),
          ProviderSupplySuccessorsState().new(
            removeBy(get(ProviderSupplySuccessorsState()), (item) => item.domain === runtimeDomain)
          ),
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
      impl: ({ fromEvent }) => fromEvent(StartRequestedEvent).pipe(map(StartHistoryCommand))
    })
    domain.effect({
      name: 'History.FinishEffect',
      impl: ({ fromEvent }) => fromEvent(FinishRequestedEvent).pipe(map(FinishHistoryCommand))
    })
    domain.effect({
      name: 'History.FinishCurrentEffect',
      impl: ({ fromEvent }) => fromEvent(FinishCurrentRequestedEvent).pipe(map(FinishCurrentHistoryCommand))
    })
    domain.effect({
      name: 'History.RequestQueueEffect',
      impl: ({ fromEvent }) => fromEvent(RequestQueuedEvent).pipe(map(QueueHistoryRequestCommand))
    })
    domain.effect({
      name: 'History.WireRequestEffect',
      impl: ({ fromEvent }) =>
        fromEvent(wireDomain.event.MessageAcceptedEvent).pipe(
          filter(
            (event): event is WireMessageEvent & { message: HistoryRequestMessage } =>
              'type' in event.message && event.message.type === MESSAGE_TYPE.HISTORY_REQUEST
          ),
          map(HandleProviderRequestCommand)
        )
    })
    domain.effect({
      name: 'History.WireResponseEffect',
      impl: ({ fromEvent }) =>
        fromEvent(wireDomain.event.MessageAcceptedEvent).pipe(
          filter(
            (event): event is WireMessageEvent & { message: HistoryResponseMessage } =>
              'type' in event.message && event.message.type === MESSAGE_TYPE.HISTORY_RESPONSE
          ),
          map(ApplyHistoryResponseCommand)
        )
    })
    domain.effect({
      name: 'History.WireSendSuccessEffect',
      impl: ({ fromEvent }) =>
        fromEvent(wireDomain.event.MessageSentEvent).pipe(map(({ requestId }) => CompleteWireSendCommand(requestId)))
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
              new Observable<HistorySyncKey>((observer) => {
                const timerId = globalThis.setTimeout(() => {
                  observer.next(payload)
                  observer.complete()
                }, HISTORY_REQUEST_TIMEOUT_MS)
                return () => globalThis.clearTimeout(timerId)
              })
          ),
          map(FinishCurrentHistoryCommand)
        )
    })
    domain.effect({
      name: 'History.ProviderSupplyEffect',
      impl: ({ fromEvent, get }) =>
        fromEvent(ProviderSupplyRequestedEvent).pipe(
          mergeMap((request) => {
            const failedPageIds: string[] = []
            return defer(async () => {
              if (!get(ProviderSessionsState()).some((item) => matchesSync(item, request))) {
                return AbortProviderSupplyCommand(request)
              }
              const pageIds = pagePort.historyPageIds(request.domain)
              const supplyRequest = {
                domain: request.domain,
                syncId: request.syncId,
                before: request.before,
                cutoff: request.cutoff
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
                  AbortProviderSupplyCommand(request)
                ]
              }

              const eligible: { record: ChatMessageRecord; bytes: number }[] = []
              let decodedBytes = 0
              for (const record of supplied.records) {
                if (eligible.length >= MAX_HISTORY_RESPONSE_MESSAGES || eligible.length >= request.remainingMessages) {
                  break
                }
                if (record.message.hlc.timestamp < request.cutoff) continue
                if (record.id !== record.message.id || record.user.id !== record.message.userId) continue
                if (!isMessageWithinLimit(record.message) || !isUserWithinLimit(record.user)) continue
                const bytes = getTextByteSize(JSON.stringify(record.message))
                if (decodedBytes + bytes > request.remainingBytes) break
                decodedBytes += bytes
                eligible.push({ record, bytes })
              }
              const current = get(ProviderSessionsState()).find((item) => matchesSync(item, request))
              const binding = get(
                sessionDomain.query.BindingQuery({
                  roomId: get(sessionDomain.query.DomainQuery(request.domain))?.roomId ?? '',
                  sourcePeerId: request.sourcePeerId
                })
              )
              if (!current || !binding) {
                return [
                  ...(failedPageIds.length > 0 ? [DeadPagesEvent(failedPageIds)] : []),
                  AbortProviderSupplyCommand(request)
                ]
              }
              return [
                ...(failedPageIds.length > 0 ? [DeadPagesEvent(failedPageIds)] : []),
                QueueProviderResponseCommand({
                  ...request,
                  records: eligible,
                  suppliedCount: supplied.records.length,
                  suppliedDone: supplied.done
                })
              ]
            }).pipe(
              catchError(() => [
                ...(failedPageIds.length > 0 ? [DeadPagesEvent(failedPageIds)] : []),
                AbortProviderSupplyCommand(request)
              ])
            )
          }, MAX_PROVIDER_SUPPLY_CONCURRENCY)
        )
    })
    domain.effect({
      name: 'History.ProviderTimeoutEffect',
      impl: ({ fromEvent }) =>
        fromEvent(ProviderTimeoutArmedEvent).pipe(
          mergeMap(
            (payload) =>
              new Observable<HistorySyncKey>((observer) => {
                const timerId = globalThis.setTimeout(() => {
                  observer.next(payload)
                  observer.complete()
                }, HISTORY_REQUEST_TIMEOUT_MS)
                return () => globalThis.clearTimeout(timerId)
              })
          ),
          map(ProviderTimedOutCommand)
        )
    })
    domain.effect({
      name: 'History.BatchAckEffect',
      impl: ({ fromEvent }) =>
        fromEvent(deliveryDomain.event.HistoryBatchAckedEvent).pipe(map(ContinueHistoryBatchCommand))
    })
    domain.effect({
      name: 'History.BatchDiscardEffect',
      impl: ({ fromEvent }) =>
        fromEvent(deliveryDomain.event.InboundBatchDiscardedEvent).pipe(map(DiscardHistoryBatchCommand))
    })

    return {
      query: { RequesterHistoriesQuery, ProviderSessionsQuery, ProviderSupplyJobsQuery },
      command: {
        StartHistoryCommand,
        ResetHistoryForSessionCommand,
        FinishHistoryCommand,
        RemovePeerCommand,
        ReleaseDomainCommand,
        HandleProviderRequestCommand
      },
      event: {
        SyncStartedEvent,
        SyncCompletedEvent,
        ResponseAcceptedEvent,
        DeadPagesEvent,
        ErrorEvent
      }
    }
  }
})

export default HistoryDomain
