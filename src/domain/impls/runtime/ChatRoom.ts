import EventHub from '@resreq/event-hub'
import { isInvalidMessageRecordError, type InsertMessageResult, type MessageStore } from '@/domain/MessageStore'
import type {
  ChatRoom as ChatRoomPort,
  HistorySyncCompletedEvent,
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
import type { ProjectionApplyContext } from '@/runtime/DocumentClient'
import type {
  HistoryFeedbackEvent,
  HistorySupplyEvent,
  HistorySupplyResult,
  RuntimeServer,
  RuntimeSession,
  RuntimeSnapshot
} from '@/runtime/Contract'

export interface ChatRoomDependencies {
  server: RuntimeServer
  messageStore: RuntimeMessageStore
  pageDomain: string
}

type RuntimeMessageStore = MessageStore & {
  insert(record: MessageRecord, options?: { signal?: AbortSignal }): Promise<InsertMessageResult>
}

interface PageConnectionAttempt {
  id: number
  resultToken: number
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

const toChatSession = (session: Pick<RuntimeSession, 'sessionId' | 'user'>): ChatSession => ({
  sessionId: session.sessionId,
  user: session.user
})

const sessionsFrom = (snapshot: {
  localSession?: Omit<RuntimeSession, 'sourcePeerId'>
  sessions: RuntimeSession[]
}): readonly ChatSession[] => [
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
  signal?: AbortSignal
): Promise<void> => {
  for (let slot = 0; ; slot += 1) {
    const candidate = selfJoinNotice(session, slot)
    const result = await messageStore.insert(candidate, { signal })
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

/**
 * Page-local Chat projection owner. It no longer holds any remote Runtime callback: the sole
 * document-local drain pulls the current full projection and applies it here under one owner.
 * Join/leave/sessions/feedback/failure projections are derived by diffing successive current
 * projections; inbound persistence settles through the ordinary `ackInbound` action.
 */
export class ChatRoom extends EventHub implements ChatRoomPort {
  private reportResult: ((token: number, result: ConnectionLifecycleResult) => void) | null = null
  private standaloneMint: (() => number) | null = null
  private standaloneBind: ((task: Promise<void>, token: number) => void) | null = null
  private connectionSequence = 0
  private connectionTokenSequence = 0
  private activeConnection: PageConnectionAttempt | null = null
  private disposed = false

  /** Last applied current facts; diffed against the next projection. `null` until the first
   * projection containing the domain establishes the notice baseline (first-pull sessions are
   * current state, never live join/leave transitions). */
  private appliedSessions: readonly RuntimeSession[] | null = null
  private appliedFeedbackOwnerIds = new Set<string>()
  private historyProvided = false
  /** Dedups repeated current failure facts; reconciled to the projection's bounded window each pull. */
  private readonly seenErrorEventIds = new Set<string>()
  /** Records proven unable to become durable are acknowledged false once; retained only until that
   * exact current event's ordinary ACK terminal or a Runtime replacement, never cross-Runtime.
   * Keyed by sequence bound to the exact current record identity, so a same-sequence different
   * record from a replacement buffer is never mistaken for the failed event. */
  private readonly invalidInbound = new Map<number, string>()
  private readonly activeHistorySupplies = new Map<string, AbortController>()
  /** The Runtime host the appliers' host-local state belongs to. */
  private appliedHostId: string | null = null
  /** The exact attached-document capability captured by long-lived History supply work. */
  private documentCapability: ProjectionApplyContext['document'] | null = null
  /** The self-join notice generation already persisted (or present) from the projection. */
  private appliedSelfJoinKey: string | null = null

  constructor(private readonly dependencies: ChatRoomDependencies) {
    super()
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

  private emitError(error: unknown) {
    let failure: Error
    try {
      failure = error instanceof Error ? error : new Error('Unknown failure', { cause: error })
    } catch {
      failure = new Error('Unknown failure', { cause: error })
    }
    try {
      this.emit('error', failure)
    } catch (deliveryError) {
      // Error listeners are the terminal application projection. Their own failure cannot recurse
      // into another room event or reject shared projection bookkeeping.
      console.error(deliveryError)
    }
  }

  // ── Chat projection stage (drain owner) ─────────────────────────────────────

  applyChat(projection: RuntimeSnapshot) {
    this.resetHostLocalStateIfReplaced(projection)
    const domain = projection.domains.find((item) => item.domain === this.dependencies.pageDomain)
    const sessions = sessionsFrom({ localSession: domain?.localSession, sessions: domain?.sessions ?? [] })
    // Join/leave lifecycle events derive only from remote sessions: the local self-join notice is
    // owned once by the persistence stage's idempotent self-join projection.
    const remoteSessions = domain?.sessions ?? []
    const localJoinedAt = domain?.localSession?.joinedAt
    if (!domain) {
      // The released domain leaves no membership: a later rejoin starts from a fresh baseline.
      this.appliedSessions = null
      return
    }
    if (!domain.chatRoomJoined) {
      // An internal transition window (refresh/reset/provisional replacement) is not a live
      // transition and cannot establish the notice baseline: only a committed runtime can.
      return
    }
    const previous = this.appliedSessions
    if (previous === null) {
      // Baseline: the first committed projection cannot produce live join/leave notices;
      // sessions present here are current state.
      this.appliedSessions = remoteSessions
      this.emit('sessions', sessions)
    } else {
      this.appliedSessions = remoteSessions
      this.emit('sessions', sessions)
      const localUserId = domain.localSession?.user.id
      // Membership finality counts every presence of the user, including this page's own local
      // session: a same-user local presence suppresses the final leave exactly like a remote one.
      const countIn = (list: readonly RuntimeSession[], userId: string) =>
        list.filter((session) => session.user.id === userId).length + (localUserId === userId ? 1 : 0)
      const userIds = new Set([
        ...previous.map((session) => session.user.id),
        ...remoteSessions.map((session) => session.user.id)
      ])
      for (const userId of userIds) {
        const before = countIn(previous, userId)
        const after = countIn(remoteSessions, userId)
        if (before === 0 && after > 0) {
          // A live join notice exists only for a strictly later logical join while this page is
          // a committed member; an older/equal generation converges silently as current state.
          const joined = remoteSessions.find((session) => session.user.id === userId)
          if (joined && localJoinedAt !== undefined && joined.joinedAt > localJoinedAt) {
            this.emit('join', toChatSession(joined))
          }
        } else if (before > 0 && after === 0) {
          const left = previous.find((session) => session.user.id === userId)
          if (left) this.emit('leave', toChatSession(left))
        }
      }
    }

    // History loading owners are current state: activate on appearance, dismiss on disappearance.
    const ownerIds = new Set((domain?.historyFeedback ?? []).map((item) => item.ownerId))
    for (const ownerId of ownerIds) {
      if (!this.appliedFeedbackOwnerIds.has(ownerId)) {
        this.emit('historyFeedback', {
          domain: this.dependencies.pageDomain,
          ownerId,
          type: 'loading'
        } satisfies HistoryFeedbackEvent)
      }
    }
    for (const ownerId of this.appliedFeedbackOwnerIds) {
      if (!ownerIds.has(ownerId)) {
        this.emit('historyFeedback', {
          domain: this.dependencies.pageDomain,
          ownerId,
          type: 'dismiss'
        } satisfies HistoryFeedbackEvent)
      }
    }
    this.appliedFeedbackOwnerIds = ownerIds

    // Retained Runtime failures are idempotent current facts: present each unseen eventId once,
    // and reconcile the dedup window to the projection's own bounded current set (never unbounded).
    const currentFailureIds = new Set(projection.failures.map((failure) => failure.eventId))
    for (const eventId of this.seenErrorEventIds) {
      if (!currentFailureIds.has(eventId)) this.seenErrorEventIds.delete(eventId)
    }
    for (const failure of projection.failures) {
      if (failure.scope !== undefined && failure.scope !== this.dependencies.pageDomain) continue
      if (this.seenErrorEventIds.has(failure.eventId)) continue
      this.seenErrorEventIds.add(failure.eventId)
      this.emitError(new Error(failure.message))
    }
  }

  /** A Runtime replacement retires only host-local projection state; durable business facts stay. */
  private resetHostLocalStateIfReplaced(projection: RuntimeSnapshot) {
    if (this.appliedHostId === projection.hostId) return
    // Old-host terminal sweep first: every projected History loading owner gets exactly one
    // dismiss, and old-host local supply work is retired through its existing cancel surface.
    // Neither is a cross-host acknowledgement; no durable business fact is touched.
    for (const ownerId of this.appliedFeedbackOwnerIds) {
      this.emit('historyFeedback', {
        domain: this.dependencies.pageDomain,
        ownerId,
        type: 'dismiss'
      } satisfies HistoryFeedbackEvent)
    }
    this.activeHistorySupplies.forEach((controller) => controller.abort(abortError('Runtime host replaced')))
    this.activeHistorySupplies.clear()
    this.appliedHostId = projection.hostId
    this.appliedSessions = null
    this.appliedFeedbackOwnerIds = new Set()
    this.historyProvided = false
    this.invalidInbound.clear()
    this.seenErrorEventIds.clear()
    this.appliedSelfJoinKey = null
  }

  // ── Local persistence projection stage (drain owner) ────────────────────────

  async applyPersistence(projection: RuntimeSnapshot, context: ProjectionApplyContext) {
    this.resetHostLocalStateIfReplaced(projection)
    const current = context
    // Long-lived supplier work captures exactly this document capability.
    this.documentCapability = current.document
    const domain = projection.domains.find((item) => item.domain === this.dependencies.pageDomain)

    // The `fresh` current fact is owned by the projection: the one self-join notice is written
    // idempotently from any full pull, so a lost join response or a later/new Page still converges.
    const localSession = domain?.localSession
    if (localSession?.fresh) {
      const key = `${localSession.user.id}:${localSession.joinedAt}`
      if (key !== this.appliedSelfJoinKey) {
        // The key is committed only after the idempotent write succeeds; a rejection keeps the
        // fact unapplied so a later explicit hint retries it through the same projection.
        current.assertCurrent()
        await persistSelfJoinNotice(this.dependencies.messageStore, localSession, current.signal)
        current.assertCurrent()
        this.appliedSelfJoinKey = key
      }
    }

    if (domain && !this.historyProvided) {
      current.assertCurrent()
      await this.dependencies.server.provideHistory({ domain: this.dependencies.pageDomain }, (event) =>
        this.provideHistory(event)
      )
      current.assertCurrent()
      this.historyProvided = true
    }

    // Retry knowledge for an invalid record lives only while that exact current event still needs
    // its ordinary ACK terminal; a settled ACK (the event left the projection) clears it.
    const currentSequences = new Set((domain?.inbound ?? []).map((event) => event.sequence))
    for (const sequence of this.invalidInbound.keys()) {
      if (!currentSequences.has(sequence)) this.invalidInbound.delete(sequence)
    }

    for (const event of domain?.inbound ?? []) {
      await this.persistInbound(event, current)
    }
  }

  private async persistInbound(
    event: RuntimeSnapshot['domains'][number]['inbound'][number],
    context: ProjectionApplyContext
  ) {
    if (event.domain !== this.dependencies.pageDomain) return
    const invalidRecordId = this.invalidInbound.get(event.sequence)
    if (invalidRecordId !== undefined && invalidRecordId !== event.record.id) {
      // A same-sequence different record comes from a replacement buffer: retire the stale pair
      // and persist the new event normally.
      this.invalidInbound.delete(event.sequence)
    } else if (invalidRecordId !== undefined) {
      // Retry knowledge ends at this exact current event's ordinary ACK terminal: only an ACK
      // failure retains the pair for the same event's next projection attempt.
      context.assertCurrent()
      await this.dependencies.server.ackInbound({
        domain: this.dependencies.pageDomain,
        sequence: event.sequence,
        inserted: false
      })
      context.assertCurrent()
      this.invalidInbound.delete(event.sequence)
      return
    }
    try {
      context.assertCurrent()
      const result = await this.dependencies.messageStore.insert(event.record, { signal: context.signal })
      context.assertCurrent()
      if (result.inserted && event.source === 'live') this.emit('message', event.record.message)
      context.assertCurrent()
      await this.dependencies.server.ackInbound({
        domain: this.dependencies.pageDomain,
        sequence: event.sequence,
        inserted: result.inserted
      })
    } catch (error) {
      if (isInvalidMessageRecordError(error)) {
        // The record cannot become durable; ACK discards only this invalid Runtime event after diagnosis.
        context.assertCurrent()
        this.emitError(error)
        this.invalidInbound.set(event.sequence, event.record.id)
        await this.dependencies.server.ackInbound({
          domain: this.dependencies.pageDomain,
          sequence: event.sequence,
          inserted: false
        })
        context.assertCurrent()
        // The invalid fact ends at its own successful negative ACK terminal.
        this.invalidInbound.delete(event.sequence)
        return
      }
      throw error
    }
  }

  private provideHistory(event: HistorySupplyEvent) {
    if (this.disposed) return
    if (event.type === 'sync-completed') {
      if (event.completion.domain === this.dependencies.pageDomain) {
        this.emit('historySyncCompleted', { syncId: event.completion.syncId, inserted: event.completion.inserted })
      }
      return
    }
    if (event.type === 'cancel') {
      const controller = this.activeHistorySupplies.get(event.supplyId)
      if (!controller) return
      // The AbortSignal fires immediately, but the supply owner is kept until the physical
      // query/projection chain has exited: only that chain settles the cancelled supplyId,
      // exactly once, so Runtime cancellation never precedes the page's actual work stop.
      controller.abort(abortError('History supply cancelled'))
      return
    }
    const { request } = event
    this.activeHistorySupplies.get(request.supplyId)?.abort(abortError('History supply replaced'))
    const controller = new AbortController()
    this.activeHistorySupplies.set(request.supplyId, controller)
    // The long-lived supply binds the exact attached-document capability: a document detach and
    // a Runtime cancel both terminate the same physical query, and a stale terminal stays silent.
    const document = this.documentCapability
    const abortFromDocument = () => controller.abort(abortError('Runtime client detached'))
    document?.signal.addEventListener('abort', abortFromDocument, { once: true })
    const documentAlive = () => {
      if (this.documentCapability !== document || document === null) return false
      try {
        document.assertActive()
        return true
      } catch {
        return false
      }
    }
    // Page-owned MessageStore supplies local history; Runtime owns only orchestration.
    // Every terminal/effect is live-rechecked against document + exact slot ownership at its own
    // settle time. The final error sink runs BEFORE the exact-entry finally retires this
    // controller's entry, so a current owner's original Error is never self-suppressed.
    const ownershipCurrent = () => documentAlive() && this.activeHistorySupplies.get(request.supplyId) === controller
    // Safe normalization: any property access on an unknown rejection happens inside one
    // controlled try; a fallible custom Error/proxy can never escape this boundary.
    const reasonOf = (value: unknown): string => {
      try {
        return value instanceof Error ? value.message : 'History supply failed'
      } catch {
        return 'History supply failed'
      }
    }
    void (async () => {
      try {
        const records = await this.dependencies.messageStore.query({
          type: MESSAGE_RECORD_TYPE.CHAT_MESSAGE,
          signal: controller.signal
        })
        const result = projectHistory(records, request.cutoff, controller.signal)
        controller.signal.throwIfAborted()
        if (this.disposed || !ownershipCurrent()) {
          return
        }
        await raceWithSignal(
          this.dependencies.server.resolveHistorySupply({ supplyId: request.supplyId, result }),
          controller.signal
        )
      } catch (error) {
        if (controller.signal.aborted) {
          // Physical query/projection chain has exited on the cancellation: settle the
          // cancelled supplyId exactly once, but only while this exact controller still owns
          // the slot and the document still owns this supplier — a detached/stale terminal
          // never reaches a successor facade or a successor's pending entry.
          if (ownershipCurrent()) {
            const reason = reasonOf(error) || 'History supply cancelled'
            await this.dependencies.server
              .rejectHistorySupply({ supplyId: request.supplyId, reason })
              .catch((settleError) => {
                if (!this.disposed && ownershipCurrent()) {
                  this.emitError(settleError)
                }
              })
          }
          return
        }
        if (this.disposed || !ownershipCurrent()) {
          return
        }
        // A failed terminal RPC publishes the original Error only while this exact controller
        // still owns the slot at its own settle time.
        await raceWithSignal(
          this.dependencies.server.rejectHistorySupply({
            supplyId: request.supplyId,
            reason: reasonOf(error)
          }),
          controller.signal
        ).catch((settleError) => {
          if (!this.disposed && ownershipCurrent()) {
            this.emitError(settleError)
          }
        })
      }
    })()
      .catch((error) => {
        // Final sink for any escaping terminal failure (synchronous facade throw, non-standard
        // rejection shapes): live-verify ownership at settle time, BEFORE exact-entry retirement.
        if (!this.disposed && ownershipCurrent()) this.emitError(error)
      })
      .finally(() => {
        document?.signal.removeEventListener('abort', abortFromDocument)
        if (this.activeHistorySupplies.get(request.supplyId) === controller) {
          this.activeHistorySupplies.delete(request.supplyId)
        }
      })
  }

  // ── Ordinary actions (request/response, no delivery coupling) ───────────────

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
      controller,
      timeout: globalThis.setTimeout(() => {
        controller.abort(new Error('Page connection attempt timed out'))
      }, PAGE_CONNECTION_ATTEMPT_TIMEOUT_MS)
    }
    this.activeConnection = attempt
    return attempt
  }

  private finishConnectionAttempt(attempt: PageConnectionAttempt) {
    globalThis.clearTimeout(attempt.timeout)
    if (this.activeConnection === attempt) this.activeConnection = null
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
      const domainSnapshot = snapshot.domains.find((item) => item.domain === this.dependencies.pageDomain)
      if (!domainSnapshot?.localSession) throw new Error('Runtime did not create a local session')
      // Only a newly allocated logical presence owns a local self-notice (idempotent by content hash).
      if (domainSnapshot.localSession.fresh) {
        await persistSelfJoinNotice(this.dependencies.messageStore, domainSnapshot.localSession)
      }
      this.recordResult(attempt.resultToken, 'succeeded')
      this.finishConnectionAttempt(attempt)
    } catch (error) {
      this.recordResult(attempt.resultToken, 'failed')
      this.finishConnectionAttempt(attempt)
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
      const result = await raceWithSignal(
        this.dependencies.server.reconnectDomain({ domain: this.dependencies.pageDomain }),
        attempt.controller.signal
      )
      if (result === null) {
        this.recordResult(attempt.resultToken, 'cancelled')
        throw abortError('ChatRoom operation cancelled')
      }
      attempt.controller.signal.throwIfAborted()
      this.recordResult(attempt.resultToken, 'succeeded')
      this.finishConnectionAttempt(attempt)
    } catch (error) {
      this.recordResult(attempt.resultToken, 'failed')
      this.finishConnectionAttempt(attempt)
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

  onHistorySyncCompleted(listener: (completion: HistorySyncCompletedEvent) => void): Unsubscribe {
    this.on('historySyncCompleted', listener)
    return () => this.off('historySyncCompleted', listener)
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
    const reason = abortError('Runtime page detached')
    const connection = this.activeConnection
    if (connection) {
      globalThis.clearTimeout(connection.timeout)
      connection.controller.abort(reason)
      this.activeConnection = null
    }
    this.activeHistorySupplies.forEach((controller) => controller.abort(reason))
    this.activeHistorySupplies.clear()
    this.off()
  }
}
