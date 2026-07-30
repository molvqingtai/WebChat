import EventHub from '@resreq/event-hub'
import { isInvalidMessageRecordError, type InsertMessageResult, type MessageStore } from '@/domain/MessageStore'
import type { ChatRoom as ChatRoomPort, JoinRoomCommand, SendMessageCommand } from '@/domain/externs/ChatRoom'
import type { Unsubscribe } from '@/domain/Subscription'
import {
  MESSAGE_RECORD_TYPE,
  NOTICE_TYPE,
  compareEventPosition,
  type ChatMessageRecord,
  type MessageRecord,
  type SystemNoticeRecord
} from '@/domain/Message'
import type { ChatMessage, HistoryCursor } from '@/protocol/ChatRoom'
import { MAX_HISTORY_RESPONSE_MESSAGES } from '@/protocol/Limits'
import { stringToHex } from '@/utils'
import type { ChatSession } from '@/protocol/Session'
import type {
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
  whenReady: (callback: () => void) => Unsubscribe
}

type RuntimeMessageStore = MessageStore & {
  insert(record: MessageRecord, options?: { signal?: AbortSignal }): Promise<InsertMessageResult>
}

type RegistrationKey = 'inbound' | 'session' | 'error' | 'history'

interface RuntimeAttachment {
  readyGeneration: number
  hostId: string
  controller: AbortController
  ownerAttemptId: number | null
  state: 'pending' | 'ready' | 'failed'
  task: Promise<void>
  registrations: Partial<Record<RegistrationKey, () => Promise<void>>>
  repairs: Set<RegistrationKey>
}

interface PageConnectionAttempt {
  id: number
  hostId: string
  controller: AbortController
  timeout: ReturnType<typeof globalThis.setTimeout>
}

const PAGE_CONNECTION_ATTEMPT_TIMEOUT_MS = 10000

const abortError = (message: string) => new DOMException(message, 'AbortError')

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

const isSelfJoinNotice = (record: MessageRecord, session: Pick<RuntimeSession, 'user' | 'joinedAt'>): boolean =>
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
    const result = await raceWithSignal(messageStore.insert(selfJoinNotice(session, slot), { signal }), signal)
    if (result.inserted || isSelfJoinNotice(result.existing, session)) return
  }
}

const projectHistory = (
  records: readonly MessageRecord[],
  before: HistoryCursor | undefined,
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
  const candidates = recent
    .filter((record) => !before || compareEventPosition(record.message, before) < 0)
    .toSorted((left, right) => compareEventPosition(right.message, left.message))
  signal.throwIfAborted()
  return {
    records: candidates.slice(0, MAX_HISTORY_RESPONSE_MESSAGES),
    done: candidates.length <= MAX_HISTORY_RESPONSE_MESSAGES
  }
}

export class ChatRoom extends EventHub implements ChatRoomPort {
  private readonly disposeReady: Unsubscribe
  private readonly pendingSelfJoinGenerations = new Set<string>()
  private readyGeneration = 0
  private connectionSequence = 0
  private attachment: RuntimeAttachment | null = null
  private activeConnection: PageConnectionAttempt | null = null
  private disposed = false

  constructor(private readonly dependencies: ChatRoomDependencies) {
    super()
    this.disposeReady = dependencies.whenReady(() => {
      if (this.disposed) return
      this.readyGeneration += 1
      this.activeConnection?.controller.abort(abortError('Runtime host generation replaced'))
      this.startAttachment(null)
    })
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
      controller.abort(new Error('Page connection prerequisites timed out'))
    }, PAGE_CONNECTION_ATTEMPT_TIMEOUT_MS)
    attachment.task = this.attachRuntime(attachment)
      .then(() => {
        attachment.state = 'ready'
      })
      .catch((error) => {
        attachment.state = 'failed'
        if (!controller.signal.aborted) controller.abort(error)
        if (!this.disposed && attachment.ownerAttemptId === null && this.attachment === attachment) {
          this.emit('error', error as Error)
        }
        throw error
      })
      .finally(() => globalThis.clearTimeout(timeout))
    void attachment.task.catch(() => {})
    return attachment
  }

  private beginConnectionAttempt() {
    if (this.disposed) throw abortError('Runtime page detached')
    this.activeConnection?.controller.abort(abortError('Page connection attempt superseded'))
    const controller = new AbortController()
    const attempt: PageConnectionAttempt = {
      id: ++this.connectionSequence,
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
        if (this.isAttachmentCurrent(attachment)) this.emit('error', error as Error)
      })
      .finally(() => attachment.repairs.delete(key))
  }

  private register(attachment: RuntimeAttachment, key: RegistrationKey) {
    const registration = attachment.registrations[key]
    if (!registration) throw new Error(`Missing Runtime ${key} registration`)
    const physical = Promise.resolve().then(registration)
    void physical
      .finally(() => {
        if (!this.isAttachmentCurrent(attachment)) this.repairRegistration(key)
      })
      .catch(() => {})
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
      for (const timer of retryTimers) globalThis.clearTimeout(timer)
      retryTimers.clear()
      retryingInbound.clear()
      for (const controller of activeHistorySupplies.values()) {
        controller.abort(signal.reason ?? abortError('Runtime attachment cancelled'))
      }
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

    const acknowledgeInbound = async (event: RuntimeInboundEvent) => {
      assertCurrent()
      await raceWithSignal(
        dependencies.server.ackInbound({ domain: dependencies.pageDomain, sequence: event.sequence }),
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
          await acknowledgeInbound(event)
        } catch (error) {
          if (prerequisite) throw error
          if (!isCurrent()) return
          this.emit('error', error as Error)
          retryInbound(event)
        }
        return
      }
      try {
        const result = await raceWithSignal(dependencies.messageStore.insert(event.record, { signal }), signal)
        assertCurrent()
        if (result.inserted && event.source === 'live') this.emit('message', event.record.message)
        await acknowledgeInbound(event)
      } catch (error) {
        if (!isCurrent()) {
          if (prerequisite) assertCurrent()
          return
        }
        if (isInvalidMessageRecordError(error)) {
          // The record cannot become durable; ACK discards only this invalid Runtime event after diagnosis.
          this.emit('error', error)
          invalidInbound.add(event.sequence)
          try {
            await acknowledgeInbound(event)
          } catch (ackError) {
            if (prerequisite) throw ackError
            if (!isCurrent()) return
            this.emit('error', ackError as Error)
            retryInbound(event)
          }
          return
        }
        if (prerequisite) throw error
        this.emit('error', error as Error)
        retryInbound(event)
      }
    }

    const provideHistory = (event: HistorySupplyEvent) => {
      if (!isCurrent()) return
      if (event.type === 'cancel') {
        const controller = activeHistorySupplies.get(event.supplyId)
        if (!controller) return
        activeHistorySupplies.delete(event.supplyId)
        const reason = abortError('History supply cancelled')
        controller.abort(reason)
        void dependencies.server
          .rejectHistorySupply({
            pageId: dependencies.pageId,
            supplyId: event.supplyId,
            reason: reason.message
          })
          .catch((error) => {
            if (isCurrent()) this.emit('error', error as Error)
          })
        return
      }
      const { request } = event
      activeHistorySupplies.get(request.supplyId)?.abort(abortError('History supply replaced'))
      const controller = new AbortController()
      activeHistorySupplies.set(request.supplyId, controller)
      // Page-owned MessageStore supplies local history; Runtime owns only orchestration.
      void dependencies.messageStore
        .query({ type: MESSAGE_RECORD_TYPE.CHAT_MESSAGE, signal: controller.signal })
        .then((records) => projectHistory(records, request.before, request.cutoff, controller.signal))
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
          if (controller.signal.aborted || !isCurrent() || activeHistorySupplies.get(request.supplyId) !== controller) {
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
          if (isCurrent()) this.emit('error', error as Error)
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
      dependencies.server.onError({ pageId: dependencies.pageId }, (error) => {
        if (isCurrent()) this.emit('error', error)
      })
    attachment.registrations.history = () =>
      dependencies.server.provideHistory(
        { domain: dependencies.pageDomain, pageId: dependencies.pageId },
        provideHistory
      )

    await Promise.all(
      (['inbound', 'session', 'error', 'history'] as const).map((key) => this.register(attachment, key))
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

  async joinRoom(command: JoinRoomCommand): Promise<void> {
    const attempt = this.beginConnectionAttempt()
    try {
      const attachment = await this.currentAttachment(attempt)
      if (!this.isConnectionCurrent(attempt, attachment)) throw abortError('Page connection attempt superseded')
      const snapshot = await raceWithSignal(
        this.dependencies.server.joinChatRoom({
          domain: this.dependencies.pageDomain,
          ...command
        }),
        attempt.controller.signal
      )
      if (!snapshot) throw abortError('ChatRoom operation cancelled')
      attempt.controller.signal.throwIfAborted()
      if (
        !this.isConnectionCurrent(attempt, attachment) ||
        snapshot.hostId !== attempt.hostId ||
        this.dependencies.getSnapshot().hostId !== attempt.hostId
      ) {
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
      if (!this.isConnectionCurrent(attempt, attachment)) throw abortError('Page connection attempt superseded')
      this.finishConnectionAttempt(attempt)
    } catch (error) {
      this.finishConnectionAttempt(attempt, error)
      throw error
    }
  }

  // Application reconnect retains the public leave/join composition; Lifecycle owns final release.
  async leaveRoom(): Promise<void> {
    const attempt = this.beginConnectionAttempt()
    try {
      const attachment = await this.currentAttachment(attempt)
      if (!this.isConnectionCurrent(attempt, attachment)) throw abortError('Page connection attempt superseded')
      const result = await raceWithSignal(
        this.dependencies.server.reconnectDomain({ domain: this.dependencies.pageDomain }),
        attempt.controller.signal
      )
      if (result === null) throw abortError('ChatRoom operation cancelled')
      attempt.controller.signal.throwIfAborted()
      if (!this.isConnectionCurrent(attempt, attachment)) throw abortError('Page connection attempt superseded')
      this.finishConnectionAttempt(attempt)
    } catch (error) {
      this.finishConnectionAttempt(attempt, error)
      throw error
    }
  }

  async sendMessage(command: SendMessageCommand): Promise<ChatMessage> {
    const record =
      command.type === 'text'
        ? await this.dependencies.server.allocateTextMessage({ domain: this.dependencies.pageDomain, ...command })
        : await this.dependencies.server.allocateReactionMessage({ domain: this.dependencies.pageDomain, ...command })
    await this.dependencies.server.sendChatMessage({
      domain: this.dependencies.pageDomain,
      event: record.message
    })
    await this.dependencies.messageStore.insert(record)
    return record.message
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
