import EventHub from '@resreq/event-hub'
import { isInvalidMessageRecordError, type InsertMessageResult, type MessageStore } from '@/domain/MessageStore'
import type {
  ChatRoom as ChatRoomPort,
  JoinRoomCommand,
  SendMessageCommand,
  SendReactionCommand,
  SendTextCommand
} from '@/domain/externs/ChatRoom'
import type { ChatMessage, ReactionMessage, TextMessage } from '@/protocol/ChatRoom'
import type { ConnectionLifecycleResult } from '@/domain/externs/ConnectionLifecycle'
import type { ConnectionResultReporter } from '@/domain/impls/ConnectionLifecycle'
import type { Unsubscribe } from '@/domain/Subscription'
import {
  MESSAGE_RECORD_TYPE,
  NOTICE_TYPE,
  compareEventPosition,
  type ChatMessageRecord,
  type MessageRecord,
  type SystemNoticeRecord
} from '@/domain/Message'
import { stringToHex } from '@/utils'
import type { ChatSession } from '@/protocol/Session'
import type {
  HistoryFeedbackEvent,
  HistorySupplyEvent,
  HistorySupplyResult,
  RuntimeServer,
  RuntimeSession,
  RuntimeSessionEvent,
  RuntimeSessionSnapshot,
  RuntimeSnapshot
} from '@/runtime/Contract'

export interface ChatRoomDependencies {
  server: RuntimeServer
  messageStore: RuntimeMessageStore
  pageDomain: string
  pageId: string
  getSnapshot: () => RuntimeSnapshot
  whenReady: (callback: () => void | Promise<void>) => Unsubscribe
}

type RuntimeMessageStore = MessageStore & {
  insert(record: MessageRecord, options?: { signal?: AbortSignal }): Promise<InsertMessageResult>
}

type RegistrationKey = 'inbound' | 'session' | 'error' | 'history' | 'historyFeedback'

interface RuntimeAttachment {
  readyGeneration: number
  hostId: string
  controller: AbortController
  ownerAttemptId: number | null
  state: 'pending' | 'ready' | 'failed'
  error?: unknown
  task: Promise<void>
  registrations: Partial<Record<RegistrationKey, () => Promise<void>>>
  repairs: Set<RegistrationKey>
}

interface PageConnectionAttempt {
  id: number
  resultToken: number
  hostId: string
  controller: AbortController
  timeout: ReturnType<typeof globalThis.setTimeout>
}

const PAGE_CONNECTION_ATTEMPT_TIMEOUT_MS = 10000

const abortError = (message: string): DOMException => new DOMException(message, 'AbortError')

const raceWithSignal = <Value>(task: Promise<Value>, signal: AbortSignal): Promise<Value> =>
  new Promise<Value>((resolve, reject) => {
    let settled = false
    const finish = (callback: () => void) => {
      if (settled) return
      settled = true
      signal.removeEventListener('abort', onAbort)
      callback()
    }
    const onAbort = () => finish(() => reject(signal.reason ?? abortError('Page connection attempt aborted')))
    signal.addEventListener('abort', onAbort, { once: true })
    task.then(
      (value) => finish(() => resolve(value)),
      (error) => finish(() => reject(error))
    )
    if (signal.aborted) onAbort()
  })

const withDeadline = <Value>(task: Promise<Value>, message: string): Promise<Value> =>
  new Promise<Value>((resolve, reject) => {
    let settled = false
    const finish = (callback: () => void) => {
      if (settled) return
      settled = true
      globalThis.clearTimeout(timer)
      callback()
    }
    const timer = globalThis.setTimeout(
      () => finish(() => reject(new Error(message))),
      PAGE_CONNECTION_ATTEMPT_TIMEOUT_MS
    )
    task.then(
      (value) => finish(() => resolve(value)),
      (error) => finish(() => reject(error))
    )
  })

const toChatSession = (session: Pick<RuntimeSession, 'sessionId' | 'user'>): ChatSession => ({
  sessionId: session.sessionId,
  user: session.user
})

const sessionsFrom = (snapshot: RuntimeSessionSnapshot): readonly ChatSession[] => [
  ...(snapshot.localSession ? [toChatSession(snapshot.localSession)] : []),
  ...snapshot.sessions.map(toChatSession)
]

const selfJoinNotice = (session: Pick<RuntimeSession, 'user' | 'joinedAt'>, slot: number): SystemNoticeRecord => {
  const generationKey = `self:join:${session.user.id}:${session.joinedAt}`
  const key = slot === 0 ? generationKey : `${generationKey}:${slot}`
  const id = `notice:${stringToHex(key)}`
  return {
    type: MESSAGE_RECORD_TYPE.SYSTEM_NOTICE,
    id,
    notice: {
      id,
      hlc: { timestamp: session.joinedAt, counter: 0 },
      type: NOTICE_TYPE.JOIN,
      body: `"${session.user.name}" joined the chat`
    },
    user: session.user,
    receivedAt: session.joinedAt
  }
}

const isTypedSelfJoinNotice = (record: MessageRecord, session: Pick<RuntimeSession, 'user' | 'joinedAt'>): boolean =>
  record.type === MESSAGE_RECORD_TYPE.SYSTEM_NOTICE &&
  record.notice.type === NOTICE_TYPE.JOIN &&
  record.user.id === session.user.id &&
  record.notice.hlc.timestamp === session.joinedAt

const persistSelfJoinNotice = async (
  messageStore: RuntimeMessageStore,
  session: Pick<RuntimeSession, 'user' | 'joinedAt'>,
  signal: AbortSignal
): Promise<void> => {
  for (let slot = 0; ; slot += 1) {
    signal.throwIfAborted()
    const candidate = selfJoinNotice(session, slot)
    const result = await raceWithSignal(messageStore.insert(candidate, { signal }), signal)
    if (result.inserted) return
    // The raw conflict occupant stays opaque: the typed occupant is obtained only through the
    // authorized local-load boundary; continue to the next slot if it is absent.
    const stored = await messageStore.query({ type: MESSAGE_RECORD_TYPE.SYSTEM_NOTICE, signal })
    const occupant = stored.find((item) => item.id === candidate.id)
    if (occupant && isTypedSelfJoinNotice(occupant, session)) return
  }
}

const projectHistory = (
  records: readonly MessageRecord[],
  cutoff: number,
  signal: AbortSignal
): HistorySupplyResult => {
  signal.throwIfAborted()
  const chatRecords = records.filter(
    (record): record is ChatMessageRecord => record.type === MESSAGE_RECORD_TYPE.CHAT_MESSAGE
  )
  signal.throwIfAborted()
  const recent = chatRecords.filter((record) => record.message.hlc.timestamp >= cutoff)
  signal.throwIfAborted()
  // One fixed snapshot in canonical recent-first order; the Runtime pages it for inventory or response.
  const candidates = recent.toSorted((left, right) => compareEventPosition(right.message, left.message))
  signal.throwIfAborted()
  return { records: candidates, done: true }
}

export class ChatRoom extends EventHub implements ChatRoomPort {
  private readonly disposeReady: Unsubscribe
  private readonly pendingSelfJoinGenerations = new Set<string>()
  /** Dedups transport repeats of one failure event for the whole live content generation (never evicts). */
  private readonly seenErrorEventIds = new Set<string>()
  private readyGeneration = 0
  private connectionSequence = 0
  private connectionTokenSequence = 0
  private reportResult: ((token: number, result: ConnectionLifecycleResult) => void) | null = null
  private standaloneMint: (() => number) | null = null
  private standaloneBind: ((task: Promise<void>, token: number) => void) | null = null
  private attachment: RuntimeAttachment | null = null
  private activeConnection: PageConnectionAttempt | null = null
  private disposed = false

  constructor(private readonly dependencies: ChatRoomDependencies) {
    super()
    this.disposeReady = dependencies.whenReady(() => {
      if (this.disposed) return
      this.readyGeneration += 1
      // Runtime generation replacement supersedes the old connection attempt; that is a structural
      // cancellation fact for that attempt.
      if (this.activeConnection) this.reportResult?.(this.activeConnection.resultToken, 'cancelled')
      this.activeConnection?.controller.abort(abortError('Runtime host generation replaced'))
      const attachment = this.startAttachment(null)
      const readiness = attachment.task.then(() => {
        if (attachment.error !== undefined) throw attachment.error
      })
      // ClientLease awaits this exact readiness promise during a private rebind. Some isolated
      // dependency fakes only notify and intentionally ignore callback results, so observe their
      // rejection here as well without changing the promise returned to the real lease.
      void readiness.catch(() => {})
      return readiness
    })
  }

  bindConnectionResultReporter(reporter: ConnectionResultReporter) {
    this.reportResult = reporter
  }

  bindStandaloneInvocation(mint: () => number, bind: (task: Promise<void>, token: number) => void) {
    this.standaloneMint = mint
    this.standaloneBind = bind
  }

  private recordResult(token: number, result: ConnectionLifecycleResult) {
    if (result !== 'active') this.reportResult?.(token, result)
  }

  private isAttachmentCurrent(attachment: RuntimeAttachment) {
    return (
      !this.disposed &&
      this.attachment === attachment &&
      this.readyGeneration === attachment.readyGeneration &&
      !attachment.controller.signal.aborted &&
      this.dependencies.getSnapshot().hostId === attachment.hostId
    )
  }

  private cancelAttachment(attachment: RuntimeAttachment, reason: unknown) {
    if (!attachment.controller.signal.aborted) attachment.controller.abort(reason)
    if (this.attachment === attachment) this.attachment = null
  }

  private emitError(error: unknown) {
    const failure = error instanceof Error ? error : new Error(String(error))
    try {
      this.emit('error', failure)
    } catch (deliveryError) {
      // Error listeners are the terminal application projection. Their own failure cannot recurse
      // into another room event or reject shared attachment/repair bookkeeping.
      console.error(deliveryError)
    }
  }

  private startAttachment(ownerAttemptId: number | null) {
    if (this.disposed) throw abortError('Runtime page detached')
    const previous = this.attachment
    if (previous) this.cancelAttachment(previous, abortError('Runtime attachment superseded'))
    const controller = new AbortController()
    const attachment: RuntimeAttachment = {
      readyGeneration: this.readyGeneration,
      hostId: this.dependencies.getSnapshot().hostId,
      controller,
      ownerAttemptId,
      state: 'pending',
      task: Promise.resolve(),
      registrations: {},
      repairs: new Set()
    }
    this.attachment = attachment
    const timeout = globalThis.setTimeout(() => {
      controller.abort(new Error('Connection timed out'))
    }, PAGE_CONNECTION_ATTEMPT_TIMEOUT_MS)
    attachment.task = this.attachRuntime(attachment)
      .then(() => {
        attachment.state = 'ready'
      })
      .catch((error) => {
        const failure = error instanceof Error ? error : new Error(String(error))
        attachment.state = 'failed'
        attachment.error = failure
        if (!controller.signal.aborted) controller.abort(failure)
        if (!this.disposed && attachment.ownerAttemptId === null && this.attachment === attachment) {
          this.emitError(failure)
        }
      })
      .finally(() => globalThis.clearTimeout(timeout))
    return attachment
  }

  private beginConnectionAttempt(resultToken: number) {
    if (this.disposed) throw abortError('Runtime page detached')
    if (this.activeConnection) {
      // This attempt supersedes the in-flight one: report its own token `cancelled` BEFORE aborting it,
      // so that first-terminal-wins keeps the structural cancellation rather than a later generic `failed`.
      this.recordResult(this.activeConnection.resultToken, 'cancelled')
      this.activeConnection.controller.abort(abortError('Page connection attempt superseded'))
    }
    const controller = new AbortController()
    const attempt: PageConnectionAttempt = {
      id: ++this.connectionSequence,
      resultToken,
      hostId: this.dependencies.getSnapshot().hostId,
      controller,
      timeout: globalThis.setTimeout(() => {
        controller.abort(new Error('Page connection attempt timed out'))
      }, PAGE_CONNECTION_ATTEMPT_TIMEOUT_MS)
    }
    this.activeConnection = attempt
    return attempt
  }

  private finishConnectionAttempt(attempt: PageConnectionAttempt, error?: unknown) {
    globalThis.clearTimeout(attempt.timeout)
    const attachment = this.attachment
    if (error && attachment?.state === 'pending' && attachment.ownerAttemptId === attempt.id) {
      this.cancelAttachment(attachment, error)
    }
    if (!error && attachment?.ownerAttemptId === attempt.id) attachment.ownerAttemptId = null
    if (this.activeConnection === attempt) this.activeConnection = null
  }

  private isConnectionCurrent(attempt: PageConnectionAttempt, attachment: RuntimeAttachment) {
    return (
      this.activeConnection === attempt &&
      !attempt.controller.signal.aborted &&
      attempt.hostId === attachment.hostId &&
      this.isAttachmentCurrent(attachment)
    )
  }

  private async currentAttachment(attempt: PageConnectionAttempt) {
    let attachment = this.attachment
    if (
      !attachment ||
      attachment.hostId !== attempt.hostId ||
      attachment.readyGeneration !== this.readyGeneration ||
      attachment.state === 'failed' ||
      attachment.controller.signal.aborted
    ) {
      attachment = this.startAttachment(attempt.id)
    } else if (attachment.state === 'pending') {
      if (attachment.ownerAttemptId !== null && attachment.ownerAttemptId !== attempt.id) {
        attachment = this.startAttachment(attempt.id)
      } else {
        attachment.ownerAttemptId = attempt.id
      }
    }

    try {
      await raceWithSignal(attachment.task, attempt.controller.signal)
      if (attachment.error !== undefined) throw attachment.error
    } catch (error) {
      if (this.attachment === attachment && attachment.ownerAttemptId === attempt.id) {
        this.cancelAttachment(attachment, error)
      }
      throw error
    }
    attempt.controller.signal.throwIfAborted()
    if (!this.isAttachmentCurrent(attachment) || attachment.hostId !== attempt.hostId) {
      throw abortError('Runtime attachment superseded')
    }
    return attachment
  }

  private repairRegistration(key: RegistrationKey) {
    const attachment = this.attachment
    if (
      !attachment ||
      !attachment.registrations[key] ||
      !this.isAttachmentCurrent(attachment) ||
      attachment.repairs.has(key)
    ) {
      return
    }
    attachment.repairs.add(key)
    const repair = withDeadline(this.register(attachment, key), 'Page callback repair timed out')
    void repair
      .catch((error) => {
        if (this.isAttachmentCurrent(attachment)) this.emitError(error)
      })
      .finally(() => attachment.repairs.delete(key))
  }

  private register(attachment: RuntimeAttachment, key: RegistrationKey) {
    const registration = attachment.registrations[key]
    if (!registration) throw new Error(`Missing Runtime ${key} registration`)
    const physical = Promise.resolve().then(registration)
    const repairIfOwnershipMoved = () => {
      if (!this.isAttachmentCurrent(attachment)) this.repairRegistration(key)
    }
    // raceWithSignal owns the physical result; this side branch performs only the same
    // post-settlement registration repair on both outcomes.
    void physical.then(repairIfOwnershipMoved, repairIfOwnershipMoved)
    return raceWithSignal(physical, attachment.controller.signal)
  }

  private emitSessionEvent(event: RuntimeSessionEvent) {
    const sessions = sessionsFrom(event.snapshot)
    const localSession = event.snapshot.localSession
    if (event.provenance === 'join' && localSession) {
      // Runtime generation classification is the sole owner of self-notice eligibility.
      this.pendingSelfJoinGenerations.add(`${localSession.user.id}:${localSession.joinedAt}`)
    }
    const userSessionCount = (userId: string) => sessions.filter((session) => session.user.id === userId).length
    this.emit('sessions', sessions)
    if (event.type === 'join') {
      if (userSessionCount(event.session.user.id) === 1) this.emit('join', toChatSession(event.session))
    } else if (event.type === 'leave') {
      if (userSessionCount(event.session.user.id) === 0) this.emit('leave', toChatSession(event.session))
    } else if (event.type === 'replace' && event.previous.user.id !== event.session.user.id) {
      if (userSessionCount(event.previous.user.id) === 0) this.emit('leave', toChatSession(event.previous))
      if (userSessionCount(event.session.user.id) === 1) this.emit('join', toChatSession(event.session))
    }
  }

  private async attachRuntime(attachment: RuntimeAttachment) {
    const { dependencies } = this
    const { signal } = attachment.controller
    const isCurrent = () => this.isAttachmentCurrent(attachment)
    const assertCurrent = () => {
      signal.throwIfAborted()
      if (!isCurrent()) throw abortError('Runtime attachment superseded')
    }
    type RuntimeInboundEvent = Awaited<ReturnType<RuntimeServer['replayInbound']>>[number]
    const retryingInbound = new Set<number>()
    const invalidInbound = new Set<number>()
    const retryTimers = new Set<ReturnType<typeof globalThis.setTimeout>>()
    const activeHistorySupplies = new Map<string, AbortController>()
    const cleanup = () => {
      retryTimers.forEach((timer) => globalThis.clearTimeout(timer))
      retryTimers.clear()
      retryingInbound.clear()
      activeHistorySupplies.forEach((controller) =>
        controller.abort(signal.reason ?? abortError('Runtime attachment cancelled'))
      )
      activeHistorySupplies.clear()
    }
    signal.addEventListener('abort', cleanup, { once: true })

    const retryInbound = (event: RuntimeInboundEvent) => {
      if (!isCurrent() || retryingInbound.has(event.sequence)) return
      retryingInbound.add(event.sequence)
      const timer = globalThis.setTimeout(() => {
        retryTimers.delete(timer)
        retryingInbound.delete(event.sequence)
        if (isCurrent()) void persistInbound(event, false)
      }, 1000)
      retryTimers.add(timer)
    }

    const acknowledgeInbound = async (event: RuntimeInboundEvent, inserted: boolean) => {
      assertCurrent()
      await raceWithSignal(
        dependencies.server.ackInbound({ domain: dependencies.pageDomain, sequence: event.sequence, inserted }),
        signal
      )
      assertCurrent()
      retryingInbound.delete(event.sequence)
      invalidInbound.delete(event.sequence)
    }

    const persistInbound = async (event: RuntimeInboundEvent, prerequisite: boolean): Promise<void> => {
      if (event.domain !== dependencies.pageDomain) return
      if (!isCurrent()) {
        if (prerequisite) assertCurrent()
        return
      }
      if (invalidInbound.has(event.sequence)) {
        try {
          await acknowledgeInbound(event, false)
        } catch (error) {
          if (prerequisite) throw error
          if (!isCurrent()) return
          this.emitError(error)
          retryInbound(event)
        }
        return
      }
      try {
        const result = await raceWithSignal(dependencies.messageStore.insert(event.record, { signal }), signal)
        assertCurrent()
        if (result.inserted && event.source === 'live') this.emit('message', event.record.message)
        await acknowledgeInbound(event, result.inserted)
      } catch (error) {
        if (!isCurrent()) {
          if (prerequisite) assertCurrent()
          return
        }
        if (isInvalidMessageRecordError(error)) {
          // The record cannot become durable; ACK discards only this invalid Runtime event after diagnosis.
          this.emitError(error)
          invalidInbound.add(event.sequence)
          try {
            await acknowledgeInbound(event, false)
          } catch (ackError) {
            if (prerequisite) throw ackError
            if (!isCurrent()) return
            this.emitError(ackError)
            retryInbound(event)
          }
          return
        }
        if (prerequisite) throw error
        this.emitError(error)
        retryInbound(event)
      }
    }

    const provideHistory = (event: HistorySupplyEvent) => {
      if (!isCurrent()) return
      if (event.type === 'cancel') {
        const controller = activeHistorySupplies.get(event.supplyId)
        if (!controller) return
        // The AbortSignal fires immediately, but the supply owner is kept until the physical
        // query/projection chain has exited: only that chain settles the cancelled supplyId,
        // exactly once, so Runtime cancellation never precedes the page's actual work stop.
        controller.abort(abortError('History supply cancelled'))
        return
      }
      const { request } = event
      activeHistorySupplies.get(request.supplyId)?.abort(abortError('History supply replaced'))
      const controller = new AbortController()
      activeHistorySupplies.set(request.supplyId, controller)
      // Page-owned MessageStore supplies local history; Runtime owns only orchestration.
      void dependencies.messageStore
        .query({ type: MESSAGE_RECORD_TYPE.CHAT_MESSAGE, signal: controller.signal })
        .then((records) => projectHistory(records, request.cutoff, controller.signal))
        .then(async (result) => {
          controller.signal.throwIfAborted()
          if (!isCurrent() || activeHistorySupplies.get(request.supplyId) !== controller) return
          await raceWithSignal(
            dependencies.server.resolveHistorySupply({
              pageId: dependencies.pageId,
              supplyId: request.supplyId,
              result
            }),
            controller.signal
          )
        })
        .catch(async (error) => {
          if (controller.signal.aborted) {
            // Physical query/projection chain has exited on the cancellation: settle the
            // cancelled supplyId exactly once (the pending PagePort entry is in failover mode,
            // so this rejects the Runtime supplier promise and confirms settlement).
            await dependencies.server
              .rejectHistorySupply({
                pageId: dependencies.pageId,
                supplyId: request.supplyId,
                reason: (error as Error).message || 'History supply cancelled'
              })
              .catch((settleError) => {
                if (isCurrent()) this.emitError(settleError)
              })
            return
          }
          if (!isCurrent() || activeHistorySupplies.get(request.supplyId) !== controller) {
            return
          }
          await raceWithSignal(
            dependencies.server.rejectHistorySupply({
              pageId: dependencies.pageId,
              supplyId: request.supplyId,
              reason: (error as Error).message
            }),
            controller.signal
          )
        })
        .finally(() => {
          if (activeHistorySupplies.get(request.supplyId) === controller) {
            activeHistorySupplies.delete(request.supplyId)
          }
        })
        .catch((error) => {
          if (isCurrent()) this.emitError(error)
        })
    }

    attachment.registrations.inbound = () =>
      dependencies.server.onInbound({ pageId: dependencies.pageId }, (event) => {
        if (isCurrent()) return persistInbound(event, false)
      })
    attachment.registrations.session = () =>
      dependencies.server.onSessionEvent({ pageId: dependencies.pageId }, (event) => {
        if (isCurrent() && event.domain === dependencies.pageDomain) this.emitSessionEvent(event)
      })
    attachment.registrations.error = () =>
      dependencies.server.onError({ pageId: dependencies.pageId }, (event) => {
        if (!isCurrent()) return
        // One failure event is displayed once per live content generation; transport repeats are
        // dropped, while every later distinct failure carries its own eventId and therefore a
        // fresh toast. The identity never expires so a late transport repeat cannot reappear.
        if (this.seenErrorEventIds.has(event.eventId)) return
        this.seenErrorEventIds.add(event.eventId)
        this.emitError(new Error(event.message))
      })
    attachment.registrations.history = () =>
      dependencies.server.provideHistory(
        { domain: dependencies.pageDomain, pageId: dependencies.pageId },
        provideHistory
      )
    attachment.registrations.historyFeedback = () =>
      dependencies.server.onHistoryFeedback({ pageId: dependencies.pageId }, (event) => {
        if (isCurrent()) this.emit('historyFeedback', event)
      })

    await Promise.all(
      (['inbound', 'session', 'error', 'history', 'historyFeedback'] as const).map((key) =>
        this.register(attachment, key)
      )
    )
    assertCurrent()

    const replay = await raceWithSignal(
      dependencies.server.replayInbound({ domain: dependencies.pageDomain, after: 0 }),
      signal
    )
    assertCurrent()
    await Promise.all(replay.map((event) => persistInbound(event, true)))
    assertCurrent()
  }

  joinRoom(command: JoinRoomCommand): Promise<void> {
    // Return the exact inner task (not an async wrapper) so task-identity binding survives.
    const token = this.standaloneMint ? this.standaloneMint() : ++this.connectionTokenSequence
    const task = this.joinRoomWithToken(token, command)
    this.standaloneBind?.(task, token)
    return task
  }

  async joinRoomWithToken(resultToken: number, command: JoinRoomCommand): Promise<void> {
    const attempt = this.beginConnectionAttempt(resultToken)
    try {
      const attachment = await this.currentAttachment(attempt)
      if (!this.isConnectionCurrent(attempt, attachment)) {
        this.recordResult(attempt.resultToken, 'cancelled')
        throw abortError('Page connection attempt superseded')
      }
      const snapshot = await raceWithSignal(
        this.dependencies.server.joinChatRoom({
          domain: this.dependencies.pageDomain,
          ...command
        }),
        attempt.controller.signal
      )
      if (!snapshot) {
        this.recordResult(attempt.resultToken, 'cancelled')
        throw abortError('ChatRoom operation cancelled')
      }
      attempt.controller.signal.throwIfAborted()
      if (
        !this.isConnectionCurrent(attempt, attachment) ||
        snapshot.hostId !== attempt.hostId ||
        this.dependencies.getSnapshot().hostId !== attempt.hostId
      ) {
        this.recordResult(attempt.resultToken, 'cancelled')
        throw abortError('Page connection attempt superseded')
      }
      const domainSnapshot = snapshot.domains.find((item) => item.domain === this.dependencies.pageDomain)
      if (!domainSnapshot?.localSession) throw new Error('Runtime did not create a local session')
      const generationKey = `${domainSnapshot.localSession.user.id}:${domainSnapshot.localSession.joinedAt}`
      if (this.pendingSelfJoinGenerations.delete(generationKey)) {
        try {
          await persistSelfJoinNotice(
            this.dependencies.messageStore,
            domainSnapshot.localSession,
            attempt.controller.signal
          )
        } catch (error) {
          this.pendingSelfJoinGenerations.add(generationKey)
          throw error
        }
      }
      attempt.controller.signal.throwIfAborted()
      if (!this.isConnectionCurrent(attempt, attachment)) {
        this.recordResult(attempt.resultToken, 'cancelled')
        throw abortError('Page connection attempt superseded')
      }
      this.recordResult(attempt.resultToken, 'succeeded')
      this.finishConnectionAttempt(attempt)
    } catch (error) {
      this.recordResult(attempt.resultToken, 'failed')
      this.finishConnectionAttempt(attempt, error)
      throw error
    }
  }

  // Application reconnect retains the public leave/join composition; Lifecycle owns final release.
  leaveRoom(): Promise<void> {
    const token = this.standaloneMint ? this.standaloneMint() : ++this.connectionTokenSequence
    const task = this.leaveRoomWithToken(token)
    this.standaloneBind?.(task, token)
    return task
  }

  async leaveRoomWithToken(resultToken: number): Promise<void> {
    const attempt = this.beginConnectionAttempt(resultToken)
    try {
      const attachment = await this.currentAttachment(attempt)
      if (!this.isConnectionCurrent(attempt, attachment)) {
        this.recordResult(attempt.resultToken, 'cancelled')
        throw abortError('Page connection attempt superseded')
      }
      const result = await raceWithSignal(
        this.dependencies.server.reconnectDomain({ domain: this.dependencies.pageDomain }),
        attempt.controller.signal
      )
      if (result === null) {
        this.recordResult(attempt.resultToken, 'cancelled')
        throw abortError('ChatRoom operation cancelled')
      }
      attempt.controller.signal.throwIfAborted()
      if (!this.isConnectionCurrent(attempt, attachment)) {
        this.recordResult(attempt.resultToken, 'cancelled')
        throw abortError('Page connection attempt superseded')
      }
      this.recordResult(attempt.resultToken, 'succeeded')
      this.finishConnectionAttempt(attempt)
    } catch (error) {
      this.recordResult(attempt.resultToken, 'failed')
      this.finishConnectionAttempt(attempt, error)
      throw error
    }
  }

  async sendMessage(command: SendTextCommand): Promise<TextMessage>
  async sendMessage(command: SendReactionCommand): Promise<ReactionMessage>
  async sendMessage(command: SendMessageCommand): Promise<ChatMessage>
  async sendMessage(command: SendMessageCommand): Promise<ChatMessage> {
    const record =
      command.type === 'text'
        ? await this.dependencies.server.allocateTextMessage({ domain: this.dependencies.pageDomain, ...command })
        : await this.dependencies.server.allocateReactionMessage({ domain: this.dependencies.pageDomain, ...command })
    const accepted = await this.dependencies.server.sendChatMessage({
      domain: this.dependencies.pageDomain,
      event: record.message
    })
    if (command.type === 'text') {
      void this.dependencies.messageStore.insert(record).catch((error) => this.emitError(error))
      return accepted
    }
    await this.dependencies.messageStore.insert(record)
    return accepted
  }

  onMessage(listener: (message: ChatMessage) => void): Unsubscribe {
    this.on('message', listener)
    return () => this.off('message', listener)
  }

  onJoinRoom(listener: (session: ChatSession) => void): Unsubscribe {
    this.on('join', listener)
    return () => this.off('join', listener)
  }

  onLeaveRoom(listener: (session: ChatSession) => void): Unsubscribe {
    this.on('leave', listener)
    return () => this.off('leave', listener)
  }

  onSessions(listener: (sessions: readonly ChatSession[]) => void): Unsubscribe {
    this.on('sessions', listener)
    return () => this.off('sessions', listener)
  }

  onError(listener: (error: Error) => void): Unsubscribe {
    this.on('error', listener)
    return () => this.off('error', listener)
  }

  /**
   * Concrete-class receipt signal (not part of the replaceable ChatRoom port): projects one
   * attempt-owned History loading owner (activate/dismiss) to this page. The composition root maps
   * it to the generic loading Toast through the attempt owner id.
   */
  onHistoryFeedback(listener: (event: HistoryFeedbackEvent) => void): Unsubscribe {
    this.on('historyFeedback', listener)
    return () => this.off('historyFeedback', listener)
  }

  dispose() {
    if (this.disposed) return
    this.disposed = true
    this.disposeReady()
    const reason = abortError('Runtime page detached')
    const connection = this.activeConnection
    if (connection) {
      globalThis.clearTimeout(connection.timeout)
      connection.controller.abort(reason)
      this.activeConnection = null
    }
    const attachment = this.attachment
    if (attachment) this.cancelAttachment(attachment, reason)
    this.pendingSelfJoinGenerations.clear()
    this.off()
  }
}
