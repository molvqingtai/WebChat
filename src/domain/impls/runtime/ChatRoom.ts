import EventHub from '@resreq/event-hub'
import { isInvalidMessageRecordError, type MessageStore } from '@/domain/MessageStore'
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
  messageStore: MessageStore
  pageDomain: string
  pageId: string
  getSnapshot: () => RuntimeSnapshot
  whenReady: (callback: () => void) => Unsubscribe
}

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
  messageStore: MessageStore,
  session: Pick<RuntimeSession, 'user' | 'joinedAt'>
): Promise<void> => {
  for (let slot = 0; ; slot += 1) {
    const result = await messageStore.insert(selfJoinNotice(session, slot))
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
  private subscriptionTask: Promise<void> = Promise.resolve()
  private readonly disposeReady: Unsubscribe
  private readonly pendingSelfJoinGenerations = new Set<string>()

  constructor(private readonly dependencies: ChatRoomDependencies) {
    super()
    this.disposeReady = dependencies.whenReady(() => {
      const hostId = dependencies.getSnapshot().hostId
      this.subscriptionTask = this.subscriptionTask.catch(() => {}).then(() => this.attachRuntime(hostId))
      void this.subscriptionTask.catch((error) => this.emit('error', error as Error))
    })
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

  private async attachRuntime(hostId: string) {
    const { dependencies } = this
    const isCurrentHost = () => dependencies.getSnapshot().hostId === hostId
    type RuntimeInboundEvent = Awaited<ReturnType<RuntimeServer['replayInbound']>>[number]
    const retryingInbound = new Set<number>()
    const invalidInbound = new Set<number>()
    const retryInbound = (event: RuntimeInboundEvent) => {
      if (retryingInbound.has(event.sequence)) return
      retryingInbound.add(event.sequence)
      globalThis.setTimeout(() => {
        retryingInbound.delete(event.sequence)
        void persistInbound(event)
      }, 1000)
    }
    const acknowledgeInbound = async (event: RuntimeInboundEvent) => {
      if (!isCurrentHost()) return
      await dependencies.server.ackInbound({ domain: dependencies.pageDomain, sequence: event.sequence })
      retryingInbound.delete(event.sequence)
      invalidInbound.delete(event.sequence)
    }
    const persistInbound = async (event: RuntimeInboundEvent): Promise<void> => {
      if (event.domain !== dependencies.pageDomain || !isCurrentHost()) return
      if (invalidInbound.has(event.sequence)) {
        try {
          await acknowledgeInbound(event)
        } catch (error) {
          this.emit('error', error as Error)
          retryInbound(event)
        }
        return
      }
      try {
        const result = await dependencies.messageStore.insert(event.record)
        if (result.inserted && event.source === 'live') this.emit('message', event.record.message)
        await acknowledgeInbound(event)
      } catch (error) {
        this.emit('error', error as Error)
        if (isInvalidMessageRecordError(error)) {
          // The record cannot become durable; ACK discards only this invalid Runtime event after diagnosis.
          invalidInbound.add(event.sequence)
          try {
            await acknowledgeInbound(event)
          } catch (ackError) {
            this.emit('error', ackError as Error)
            retryInbound(event)
          }
          return
        }
        retryInbound(event)
      }
    }

    const activeHistorySupplies = new Map<string, AbortController>()
    const provideHistory = (event: HistorySupplyEvent) => {
      if (event.type === 'cancel') {
        activeHistorySupplies.get(event.supplyId)?.abort(new DOMException('History supply cancelled', 'AbortError'))
        return
      }
      const { request } = event
      const controller = new AbortController()
      activeHistorySupplies.set(request.supplyId, controller)
      // Page-owned MessageStore supplies local history; Runtime owns only orchestration.
      void dependencies.messageStore
        .query({ type: MESSAGE_RECORD_TYPE.CHAT_MESSAGE, signal: controller.signal })
        .then((records) => projectHistory(records, request.before, request.cutoff, controller.signal))
        .then(async (result) => {
          controller.signal.throwIfAborted()
          if (!isCurrentHost() || activeHistorySupplies.get(request.supplyId) !== controller) return
          await dependencies.server.resolveHistorySupply({
            pageId: dependencies.pageId,
            supplyId: request.supplyId,
            result
          })
        })
        .catch(async (error) => {
          if (!isCurrentHost() || activeHistorySupplies.get(request.supplyId) !== controller) return
          await dependencies.server.rejectHistorySupply({
            pageId: dependencies.pageId,
            supplyId: request.supplyId,
            reason: (error as Error).message
          })
        })
        .finally(() => {
          if (activeHistorySupplies.get(request.supplyId) === controller) {
            activeHistorySupplies.delete(request.supplyId)
          }
        })
        .catch((error) => this.emit('error', error as Error))
    }

    await Promise.all([
      dependencies.server.onInbound({ pageId: dependencies.pageId }, persistInbound),
      dependencies.server.onSessionEvent({ pageId: dependencies.pageId }, (event) => {
        if (isCurrentHost() && event.domain === dependencies.pageDomain) this.emitSessionEvent(event)
      }),
      dependencies.server.onError({ pageId: dependencies.pageId }, (error) => {
        if (isCurrentHost()) this.emit('error', error)
      }),
      dependencies.server.provideHistory(
        { domain: dependencies.pageDomain, pageId: dependencies.pageId },
        provideHistory
      )
    ])

    const replay = await dependencies.server.replayInbound({ domain: dependencies.pageDomain, after: 0 })
    await Promise.all(replay.map(persistInbound))
  }

  async joinRoom(command: JoinRoomCommand): Promise<void> {
    await this.subscriptionTask
    const snapshot = await this.dependencies.server.joinChatRoom({
      domain: this.dependencies.pageDomain,
      ...command
    })
    const domainSnapshot = snapshot.domains.find((item) => item.domain === this.dependencies.pageDomain)
    if (!domainSnapshot?.localSession) throw new Error('Runtime did not create a local session')
    const generationKey = `${domainSnapshot.localSession.user.id}:${domainSnapshot.localSession.joinedAt}`
    if (!this.pendingSelfJoinGenerations.delete(generationKey)) return
    await persistSelfJoinNotice(this.dependencies.messageStore, domainSnapshot.localSession)
  }

  // Application reconnect retains the public leave/join composition; Lifecycle owns final release.
  async leaveRoom(): Promise<void> {
    await this.subscriptionTask
    await this.dependencies.server.reconnectDomain({ domain: this.dependencies.pageDomain })
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
    this.disposeReady()
    this.off()
  }
}
