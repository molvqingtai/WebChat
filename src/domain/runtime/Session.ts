import { Remesh } from 'remesh'
import { filter, map } from 'rxjs'
import DeliveryDomain from '@/domain/runtime/Delivery'
import WireDomain, { type WireMessageEvent } from '@/domain/runtime/Wire'
import { ClockExtern } from '@/domain/runtime/externs/Clock'
import { IdentityExtern } from '@/domain/runtime/externs/Identity'
import { CHAT_ROOM_NAMESPACE_V2 } from '@/constants/config'
import {
  MESSAGE_TYPE,
  isChatRoomMessageSemanticallyValid,
  isHLCInRange,
  parseChatRoomMessage,
  parseWorldRoomMessage,
  type ChatMessage,
  type HLC,
  type MentionedUser,
  type ChatSite,
  type ChatUser
} from '@/protocol'
import {
  MESSAGE_RECORD_TYPE,
  type ChatMessageRecord,
  type ReactionMessageRecord,
  type TextMessageRecord
} from '@/domain/Message'
import type { RuntimeSession, RuntimeSessionEvent, RuntimeSessionSnapshot } from '@/runtime/Contract'
import stringToHex from '@/utils/stringToHex'

export type SessionPreparationMode = 'join' | 'reconnect' | 'recover'

export interface SessionDomainState {
  domain: string
  roomId: string
  sessionId: string
  user: ChatUser
  site: ChatSite
  joinedAt: number
  sessions: RuntimeSession[]
}

interface PreparedSession {
  attemptId: string
  mode: SessionPreparationMode
  runtime: SessionDomainState
  publishRequestId?: string
  missedPeerIds: string[]
}

interface PendingChatSend {
  operationId: string
  requestId: string
}

export interface SessionOperationSucceeded {
  operationId: string
  record?: ChatMessageRecord
}

export interface SessionOperationFailed {
  operationId: string
  error: Error
}

const getChatRoomId = (domain: string): string => stringToHex(`${CHAT_ROOM_NAMESPACE_V2}:${domain}`)
const replaceBy = <T>(items: T[], predicate: (item: T) => boolean, next: T): T[] =>
  items.some(predicate) ? items.map((item) => (predicate(item) ? next : item)) : [...items, next]
const removeBy = <T>(items: T[], predicate: (item: T) => boolean): T[] => items.filter((item) => !predicate(item))
const appendUnique = <T>(items: T[], item: T): T[] => (items.includes(item) ? items : [...items, item])

const optionalSiteField = (value: unknown, maxLength: number): string | undefined =>
  typeof value === 'string' && value.length <= maxLength ? value : undefined

const sanitizeSite = (site: ChatSite): ChatSite => {
  const title = optionalSiteField(site.title, 512)
  const icon = optionalSiteField(site.icon, 16 * 1024)
  const description = optionalSiteField(site.description, 2048)
  return {
    origin: site.origin,
    ...(title ? { title } : {}),
    ...(icon ? { icon } : {}),
    ...(description ? { description } : {})
  }
}

const projectChatUser = (value: unknown): unknown => {
  if (typeof value !== 'object' || value === null) return value
  const user = value as Record<keyof ChatUser, unknown>
  return { id: user.id, name: user.name, avatar: user.avatar }
}

export const allocateHlc = (current: HLC, now: number): HLC => {
  if (now > current.timestamp) return { timestamp: now, counter: 0 }
  const counter = current.counter + 1
  if (!Number.isSafeInteger(counter)) throw new Error('Runtime HLC counter exhausted')
  return { timestamp: current.timestamp, counter }
}

export const adoptHlc = (current: HLC, remote: HLC, now: number): HLC | null => {
  if (!isHLCInRange(remote, now)) return null
  return remote.timestamp > current.timestamp ||
    (remote.timestamp === current.timestamp && remote.counter > current.counter)
    ? { ...remote }
    : current
}

export const observeHlc = (current: HLC, remote: HLC, now: number): HLC | null => {
  if (!isHLCInRange(remote, now)) return null
  const timestamp = Math.max(now, current.timestamp, remote.timestamp)
  if (timestamp === now && now > current.timestamp && now > remote.timestamp) {
    return { timestamp: now, counter: 0 }
  }
  const localCounter = timestamp === current.timestamp ? current.counter : 0
  const remoteCounter = timestamp === remote.timestamp ? remote.counter : 0
  const counter = Math.max(localCounter, remoteCounter) + 1
  return Number.isSafeInteger(counter) ? { timestamp, counter } : null
}

const snapshot = (runtime: SessionDomainState): RuntimeSessionSnapshot => ({
  localSession: { sessionId: runtime.sessionId, user: runtime.user, joinedAt: runtime.joinedAt },
  sessions: runtime.sessions
})

const makeRecord = (message: ChatMessage, user: ChatUser, receivedAt: number): ChatMessageRecord => {
  if (user.id !== message.userId) throw new Error('Chat record user does not match its message')
  return { type: MESSAGE_RECORD_TYPE.CHAT_MESSAGE, id: message.id, message, user, receivedAt }
}

const initialRequestId = (attemptId: string) => `session:initial:${attemptId}`
const catchUpRequestId = (attemptId: string, sourcePeerId: string) => `session:catch-up:${attemptId}:${sourcePeerId}`
const chatRequestId = (operationId: string) => `session:chat:${operationId}`

const SessionDomain = Remesh.domain({
  name: 'SessionDomain',
  impl: (domain) => {
    const clock = domain.getExtern(ClockExtern)
    const identity = domain.getExtern(IdentityExtern)
    const wireDomain = domain.getDomain(WireDomain())
    const deliveryDomain = domain.getDomain(DeliveryDomain())

    const HlcState = domain.state<HLC>({ name: 'Session.HlcState', default: { timestamp: 0, counter: 0 } })
    const DomainsState = domain.state<SessionDomainState[]>({ name: 'Session.DomainsState', default: [] })
    const PreparedSessionsState = domain.state<PreparedSession[]>({
      name: 'Session.PreparedSessionsState',
      default: []
    })
    const PendingChatSendsState = domain.state<PendingChatSend[]>({
      name: 'Session.PendingChatSendsState',
      default: []
    })

    const HlcQuery = domain.query({ name: 'Session.HlcQuery', impl: ({ get }) => get(HlcState()) })
    const DomainsQuery = domain.query({ name: 'Session.DomainsQuery', impl: ({ get }) => get(DomainsState()) })
    const DomainQuery = domain.query({
      name: 'Session.DomainQuery',
      impl: ({ get }, runtimeDomain: string) =>
        get(DomainsState()).find((item) => item.domain === runtimeDomain) ?? null
    })
    const PreparedSessionQuery = domain.query({
      name: 'Session.PreparedSessionQuery',
      impl: ({ get }, attemptId: string) =>
        get(PreparedSessionsState()).find((item) => item.attemptId === attemptId) ?? null
    })
    const RoomDomainQuery = domain.query({
      name: 'Session.RoomDomainQuery',
      impl: ({ get }, roomId: string) => get(DomainsState()).find((item) => item.roomId === roomId)?.domain ?? null
    })
    const BindingQuery = domain.query({
      name: 'Session.BindingQuery',
      impl: ({ get }, payload: { roomId: string; sourcePeerId: string }) => {
        const runtime = get(DomainsState()).find((item) => item.roomId === payload.roomId)
        const session = runtime?.sessions.find((item) => item.sourcePeerId === payload.sourcePeerId)
        return runtime && session ? { domain: runtime.domain, runtime, session } : null
      }
    })

    const PreparedEvent = domain.event<{ attemptId: string; domain: string; roomId: string }>({
      name: 'Session.PreparedEvent'
    })
    const PreparationFailedEvent = domain.event<{ attemptId: string; error: Error }>({
      name: 'Session.PreparationFailedEvent'
    })
    const PreparedPublishedEvent = domain.event<{ attemptId: string }>({ name: 'Session.PreparedPublishedEvent' })
    const PreparedPublishFailedEvent = domain.event<{ attemptId: string; error: Error }>({
      name: 'Session.PreparedPublishFailedEvent'
    })
    const DomainCommittedEvent = domain.event<{
      attemptId: string
      domain: string
      newSessions: RuntimeSession[]
    }>({ name: 'Session.DomainCommittedEvent' })
    const DomainReleasedEvent = domain.event<string>({ name: 'Session.DomainReleasedEvent' })
    const RuntimeSessionChangedEvent = domain.event<RuntimeSessionEvent>({
      name: 'Session.RuntimeSessionChangedEvent'
    })
    const BindingChangedEvent = domain.event<{ domain: string; sourcePeerId: string }>({
      name: 'Session.BindingChangedEvent'
    })
    const BindingRemovedEvent = domain.event<{ domain: string; sourcePeerId: string }>({
      name: 'Session.BindingRemovedEvent'
    })
    const OperationSucceededEvent = domain.event<SessionOperationSucceeded>({
      name: 'Session.OperationSucceededEvent'
    })
    const OperationFailedEvent = domain.event<SessionOperationFailed>({ name: 'Session.OperationFailedEvent' })
    const ErrorEvent = domain.event<Error>({ name: 'Session.ErrorEvent' })

    const PrepareDomainCommand = domain.command({
      name: 'Session.PrepareDomainCommand',
      impl: (
        { get },
        payload: {
          attemptId: string
          mode: SessionPreparationMode
          domain: string
          user?: ChatUser
          site?: ChatSite
        }
      ) => {
        const committed = get(DomainsState()).find((item) => item.domain === payload.domain)
        const priorPrepared = get(PreparedSessionsState()).find((item) => item.runtime.domain === payload.domain)
        const current = committed ?? priorPrepared?.runtime
        if (payload.mode !== 'join' && !current) {
          return PreparationFailedEvent({ attemptId: payload.attemptId, error: new Error('Runtime domain missing') })
        }

        let user: ChatUser
        let site: ChatSite
        if (payload.mode === 'join') {
          site = sanitizeSite(payload.site!)
          const valid = parseWorldRoomMessage({
            sessionId: 'validation',
            user: projectChatUser(payload.user),
            sites: [site]
          })
          if (!valid || site.origin !== payload.domain) {
            return PreparationFailedEvent({
              attemptId: payload.attemptId,
              error: new Error('Invalid local identity or site metadata')
            })
          }
          user = valid.user
        } else {
          user = current!.user
          site = current!.site
        }

        const joinedAt = payload.mode === 'join' && current?.user.id === user.id ? current.joinedAt : clock.now()
        const sessionId =
          payload.mode === 'join' && current?.user.id === user.id ? current.sessionId : identity.nextId()
        const runtime: SessionDomainState = {
          domain: payload.domain,
          roomId: current?.roomId ?? getChatRoomId(payload.domain),
          sessionId,
          user,
          site,
          joinedAt,
          sessions: payload.mode === 'join' ? (committed?.sessions ?? []) : []
        }
        const prepared: PreparedSession = {
          attemptId: payload.attemptId,
          mode: payload.mode,
          runtime,
          missedPeerIds: []
        }
        return [
          PreparedSessionsState().new(
            replaceBy(get(PreparedSessionsState()), (item) => item.runtime.domain === payload.domain, prepared)
          ),
          PreparedEvent({ attemptId: payload.attemptId, domain: payload.domain, roomId: runtime.roomId })
        ]
      }
    })

    const PublishPreparedCommand = domain.command({
      name: 'Session.PublishPreparedCommand',
      impl: ({ get }, attemptId: string) => {
        const prepared = get(PreparedSessionsState()).find((item) => item.attemptId === attemptId)
        if (!prepared) {
          return PreparedPublishFailedEvent({ attemptId, error: new Error('Prepared session disappeared') })
        }
        const requestId = initialRequestId(attemptId)
        return [
          PreparedSessionsState().new(
            replaceBy(get(PreparedSessionsState()), (item) => item.attemptId === attemptId, {
              ...prepared,
              publishRequestId: requestId
            })
          ),
          wireDomain.command.SendMessageCommand({
            requestId,
            roomId: prepared.runtime.roomId,
            message: {
              type: MESSAGE_TYPE.SESSION,
              sessionId: prepared.runtime.sessionId,
              user: prepared.runtime.user
            }
          })
        ]
      }
    })

    const CompletePreparedPublishCommand = domain.command({
      name: 'Session.CompletePreparedPublishCommand',
      impl: ({ get }, requestId: string) => {
        const prepared = get(PreparedSessionsState()).find((item) => item.publishRequestId === requestId)
        return prepared ? PreparedPublishedEvent({ attemptId: prepared.attemptId }) : null
      }
    })

    const FailPreparedPublishCommand = domain.command({
      name: 'Session.FailPreparedPublishCommand',
      impl: ({ get }, payload: { requestId: string; error: Error }) => {
        const prepared = get(PreparedSessionsState()).find((item) => item.publishRequestId === payload.requestId)
        return prepared ? PreparedPublishFailedEvent({ attemptId: prepared.attemptId, error: payload.error }) : null
      }
    })

    const CommitPreparedCommand = domain.command({
      name: 'Session.CommitPreparedCommand',
      impl: ({ get }, attemptId: string) => {
        const prepared = get(PreparedSessionsState()).find((item) => item.attemptId === attemptId)
        if (!prepared) return null
        const domains = get(DomainsState())
        const previous = domains.find((item) => item.domain === prepared.runtime.domain)
        const newSessions = prepared.runtime.sessions.filter(
          (session) =>
            !previous?.sessions.some(
              (current) => current.sourcePeerId === session.sourcePeerId && current.sessionId === session.sessionId
            )
        )
        return [
          DomainsState().new(replaceBy(domains, (item) => item.domain === prepared.runtime.domain, prepared.runtime)),
          PreparedSessionsState().new(removeBy(get(PreparedSessionsState()), (item) => item.attemptId === attemptId)),
          RuntimeSessionChangedEvent({
            type: 'snapshot',
            domain: prepared.runtime.domain,
            snapshot: snapshot(prepared.runtime),
            provenance: prepared.mode === 'join' ? 'join' : prepared.mode === 'reconnect' ? 'reconnect' : 'recovery'
          }),
          DomainCommittedEvent({ attemptId, domain: prepared.runtime.domain, newSessions }),
          ...prepared.missedPeerIds.map((sourcePeerId) =>
            wireDomain.command.SendMessageCommand({
              requestId: catchUpRequestId(attemptId, sourcePeerId),
              roomId: prepared.runtime.roomId,
              targetPeerIds: [sourcePeerId],
              message: {
                type: MESSAGE_TYPE.SESSION,
                sessionId: prepared.runtime.sessionId,
                user: prepared.runtime.user
              }
            })
          )
        ]
      }
    })

    const AbortPreparedCommand = domain.command({
      name: 'Session.AbortPreparedCommand',
      impl: ({ get }, attemptId: string) => {
        const prepared = get(PreparedSessionsState())
        return prepared.some((item) => item.attemptId === attemptId)
          ? PreparedSessionsState().new(removeBy(prepared, (item) => item.attemptId === attemptId))
          : null
      }
    })

    const ReleaseDomainCommand = domain.command({
      name: 'Session.ReleaseDomainCommand',
      impl: ({ get }, runtimeDomain: string) => {
        const domains = get(DomainsState())
        const prepared = get(PreparedSessionsState())
        if (
          !domains.some((item) => item.domain === runtimeDomain) &&
          !prepared.some((item) => item.runtime.domain === runtimeDomain)
        ) {
          return null
        }
        return [
          DomainsState().new(removeBy(domains, (item) => item.domain === runtimeDomain)),
          PreparedSessionsState().new(removeBy(prepared, (item) => item.runtime.domain === runtimeDomain)),
          DomainReleasedEvent(runtimeDomain)
        ]
      }
    })

    const AllocateTextMessageCommand = domain.command({
      name: 'Session.AllocateTextMessageCommand',
      impl: ({ get }, payload: { operationId: string; domain: string; body: string; mentions: MentionedUser[] }) => {
        const runtime = get(DomainsState()).find((item) => item.domain === payload.domain)
        if (!runtime) {
          return OperationFailedEvent({
            operationId: payload.operationId,
            error: new Error('Runtime is not ready for this site')
          })
        }
        let hlc: HLC
        try {
          hlc = allocateHlc(get(HlcState()), clock.now())
        } catch (error) {
          return OperationFailedEvent({ operationId: payload.operationId, error: error as Error })
        }
        const candidate = {
          type: MESSAGE_TYPE.TEXT,
          id: identity.nextId(),
          hlc,
          userId: runtime.user.id,
          body: payload.body,
          mentions: payload.mentions.map(({ id, name, avatar, ranges }) => ({ id, name, avatar, ranges }))
        }
        const validated = parseChatRoomMessage(candidate)
        if (
          !validated ||
          validated.type !== MESSAGE_TYPE.TEXT ||
          !isChatRoomMessageSemanticallyValid(validated, clock.now())
        ) {
          return OperationFailedEvent({
            operationId: payload.operationId,
            error: new Error('Message exceeds the v2 event contract')
          })
        }
        const record: TextMessageRecord = {
          type: MESSAGE_RECORD_TYPE.CHAT_MESSAGE,
          id: validated.id,
          message: validated,
          user: runtime.user,
          receivedAt: clock.now()
        }
        return [HlcState().new(hlc), OperationSucceededEvent({ operationId: payload.operationId, record })]
      }
    })

    const AllocateReactionMessageCommand = domain.command({
      name: 'Session.AllocateReactionMessageCommand',
      impl: (
        { get },
        payload: {
          operationId: string
          domain: string
          targetId: string
          reaction: 'like' | 'hate'
          active: boolean
        }
      ) => {
        const runtime = get(DomainsState()).find((item) => item.domain === payload.domain)
        if (!runtime) {
          return OperationFailedEvent({
            operationId: payload.operationId,
            error: new Error('Runtime is not ready for this site')
          })
        }
        let hlc: HLC
        try {
          hlc = allocateHlc(get(HlcState()), clock.now())
        } catch (error) {
          return OperationFailedEvent({ operationId: payload.operationId, error: error as Error })
        }
        const candidate = {
          type: MESSAGE_TYPE.REACTION,
          id: identity.nextId(),
          hlc,
          targetId: payload.targetId,
          userId: runtime.user.id,
          reaction: payload.reaction,
          active: payload.active
        }
        const validated = parseChatRoomMessage(candidate)
        if (
          !validated ||
          validated.type !== MESSAGE_TYPE.REACTION ||
          !isChatRoomMessageSemanticallyValid(validated, clock.now())
        ) {
          return OperationFailedEvent({
            operationId: payload.operationId,
            error: new Error('Reaction exceeds the v2 event contract')
          })
        }
        const record: ReactionMessageRecord = {
          type: MESSAGE_RECORD_TYPE.CHAT_MESSAGE,
          id: validated.id,
          message: validated,
          user: runtime.user,
          receivedAt: clock.now()
        }
        return [HlcState().new(hlc), OperationSucceededEvent({ operationId: payload.operationId, record })]
      }
    })

    const SendChatMessageCommand = domain.command({
      name: 'Session.SendChatMessageCommand',
      impl: ({ get }, payload: { operationId: string; domain: string; event: ChatMessage }) => {
        const runtime = get(DomainsState()).find((item) => item.domain === payload.domain)
        const event = parseChatRoomMessage(payload.event)
        if (
          !runtime ||
          !event ||
          (event.type !== MESSAGE_TYPE.TEXT && event.type !== MESSAGE_TYPE.REACTION) ||
          !isChatRoomMessageSemanticallyValid(event, clock.now())
        ) {
          return OperationFailedEvent({
            operationId: payload.operationId,
            error: new Error('Chat message does not match the v2 event contract')
          })
        }
        const adopted = adoptHlc(get(HlcState()), event.hlc, clock.now())
        if (event.userId !== runtime.user.id || !adopted) {
          return OperationFailedEvent({
            operationId: payload.operationId,
            error: new Error('Chat message does not match the active local session')
          })
        }
        const requestId = chatRequestId(payload.operationId)
        return [
          HlcState().new(adopted),
          PendingChatSendsState().new([
            ...get(PendingChatSendsState()),
            { operationId: payload.operationId, requestId }
          ]),
          wireDomain.command.SendMessageCommand({
            requestId,
            roomId: runtime.roomId,
            ...(runtime.sessions.length > 0
              ? { targetPeerIds: runtime.sessions.map((session) => session.sourcePeerId) }
              : {}),
            message: event
          })
        ]
      }
    })

    const CompleteChatSendCommand = domain.command({
      name: 'Session.CompleteChatSendCommand',
      impl: ({ get }, requestId: string) => {
        const pending = get(PendingChatSendsState())
        const current = pending.find((item) => item.requestId === requestId)
        return current
          ? [
              PendingChatSendsState().new(removeBy(pending, (item) => item.requestId === requestId)),
              OperationSucceededEvent({ operationId: current.operationId })
            ]
          : null
      }
    })

    const FailChatSendCommand = domain.command({
      name: 'Session.FailChatSendCommand',
      impl: ({ get }, payload: { requestId: string; error: Error }) => {
        const pending = get(PendingChatSendsState())
        const current = pending.find((item) => item.requestId === payload.requestId)
        return current
          ? [
              PendingChatSendsState().new(removeBy(pending, (item) => item.requestId === payload.requestId)),
              OperationFailedEvent({ operationId: current.operationId, error: payload.error })
            ]
          : null
      }
    })

    const ApplySessionMessageCommand = domain.command({
      name: 'Session.ApplySessionMessageCommand',
      impl: ({ get }, payload: WireMessageEvent) => {
        if (!('type' in payload.message) || payload.message.type !== MESSAGE_TYPE.SESSION) return null
        const message = payload.message
        const preparedSessions = get(PreparedSessionsState())
        const prepared = preparedSessions.find((item) => item.runtime.roomId === payload.roomId)
        const domains = get(DomainsState())
        const committed = domains.find((item) => item.roomId === payload.roomId)
        const runtime = prepared?.runtime ?? committed
        if (!runtime) return null
        const current = runtime.sessions.find((item) => item.sourcePeerId === payload.sourcePeerId)
        if (current?.sessionId === message.sessionId && current.user.id !== message.user.id) {
          return wireDomain.command.DropProtocolCommand({
            sourcePeerId: payload.sourcePeerId,
            reason: 'user changed inside a bound session'
          })
        }
        const isNewSession = current?.sessionId !== message.sessionId
        const session: RuntimeSession = {
          sourcePeerId: payload.sourcePeerId,
          sessionId: message.sessionId,
          user: message.user,
          joinedAt: clock.now()
        }
        const nextRuntime = {
          ...runtime,
          sessions: replaceBy(runtime.sessions, (item) => item.sourcePeerId === payload.sourcePeerId, session)
        }
        if (prepared) {
          return PreparedSessionsState().new(
            replaceBy(preparedSessions, (item) => item.attemptId === prepared.attemptId, {
              ...prepared,
              runtime: nextRuntime
            })
          )
        }
        const sessionSnapshot = snapshot(nextRuntime)
        const sessionEvent: RuntimeSessionEvent = current
          ? isNewSession
            ? {
                type: 'replace',
                domain: runtime.domain,
                snapshot: sessionSnapshot,
                previous: current,
                session,
                occurredAt: clock.now(),
                provenance: 'live'
              }
            : { type: 'snapshot', domain: runtime.domain, snapshot: sessionSnapshot, provenance: 'refresh' }
          : { type: 'join', domain: runtime.domain, snapshot: sessionSnapshot, session, provenance: 'live' }
        return [
          DomainsState().new(replaceBy(domains, (item) => item.domain === runtime.domain, nextRuntime)),
          RuntimeSessionChangedEvent(sessionEvent),
          ...(isNewSession ? [BindingChangedEvent({ domain: runtime.domain, sourcePeerId: payload.sourcePeerId })] : [])
        ]
      }
    })

    const ApplyLiveMessageCommand = domain.command({
      name: 'Session.ApplyLiveMessageCommand',
      impl: ({ get }, payload: WireMessageEvent) => {
        if (
          !('type' in payload.message) ||
          (payload.message.type !== MESSAGE_TYPE.TEXT && payload.message.type !== MESSAGE_TYPE.REACTION)
        ) {
          return null
        }
        const runtime = get(DomainsState()).find((item) => item.roomId === payload.roomId)
        if (!runtime) return null
        const session = runtime.sessions.find((item) => item.sourcePeerId === payload.sourcePeerId)
        if (!session) {
          return wireDomain.command.DropProtocolCommand({
            sourcePeerId: payload.sourcePeerId,
            reason: 'message arrived before session binding'
          })
        }
        if (payload.message.userId !== session.user.id) {
          return wireDomain.command.DropProtocolCommand({
            sourcePeerId: payload.sourcePeerId,
            reason: 'live event does not match the bound session'
          })
        }
        const observed = observeHlc(get(HlcState()), payload.message.hlc, clock.now())
        if (!observed) {
          return wireDomain.command.DropProtocolCommand({
            sourcePeerId: payload.sourcePeerId,
            reason: 'invalid live event HLC'
          })
        }
        return [
          HlcState().new(observed),
          deliveryDomain.command.AcceptInboundCommand({
            domain: runtime.domain,
            record: makeRecord(payload.message, session.user, clock.now()),
            source: 'live'
          })
        ]
      }
    })

    const UpdateHlcCommand = domain.command({
      name: 'Session.UpdateHlcCommand',
      impl: ({ get }, payload: { expected: HLC; next: HLC }) => {
        const current = get(HlcState())
        return current.timestamp === payload.expected.timestamp && current.counter === payload.expected.counter
          ? HlcState().new(payload.next)
          : null
      }
    })

    const PeerJoinedCommand = domain.command({
      name: 'Session.PeerJoinedCommand',
      impl: ({ get }, payload: { roomId: string; sourcePeerId: string }) => {
        const preparedSessions = get(PreparedSessionsState())
        const prepared = preparedSessions.find((item) => item.runtime.roomId === payload.roomId)
        if (prepared) {
          if (!prepared.publishRequestId) return null
          const missedPeerIds = appendUnique(prepared.missedPeerIds, payload.sourcePeerId)
          return missedPeerIds === prepared.missedPeerIds
            ? null
            : PreparedSessionsState().new(
                replaceBy(preparedSessions, (item) => item.attemptId === prepared.attemptId, {
                  ...prepared,
                  missedPeerIds
                })
              )
        }
        const runtime = get(DomainsState()).find((item) => item.roomId === payload.roomId)
        return runtime
          ? wireDomain.command.SendMessageCommand({
              requestId: `session:peer:${runtime.domain}:${payload.sourcePeerId}`,
              roomId: runtime.roomId,
              targetPeerIds: [payload.sourcePeerId],
              message: { type: MESSAGE_TYPE.SESSION, sessionId: runtime.sessionId, user: runtime.user }
            })
          : null
      }
    })

    const PeerLeftCommand = domain.command({
      name: 'Session.PeerLeftCommand',
      impl: ({ get }, payload: { roomId: string; sourcePeerId: string }) => {
        const preparedSessions = get(PreparedSessionsState())
        const prepared = preparedSessions.find((item) => item.runtime.roomId === payload.roomId)
        const preparedAction = prepared
          ? PreparedSessionsState().new(
              replaceBy(preparedSessions, (item) => item.attemptId === prepared.attemptId, {
                ...prepared,
                missedPeerIds: prepared.missedPeerIds.filter((item) => item !== payload.sourcePeerId),
                runtime: {
                  ...prepared.runtime,
                  sessions: prepared.runtime.sessions.filter((item) => item.sourcePeerId !== payload.sourcePeerId)
                }
              })
            )
          : null
        const domains = get(DomainsState())
        const runtime = domains.find((item) => item.roomId === payload.roomId)
        if (!runtime) return preparedAction
        const session = runtime.sessions.find((item) => item.sourcePeerId === payload.sourcePeerId)
        if (!session) return preparedAction
        const nextRuntime = {
          ...runtime,
          sessions: runtime.sessions.filter((item) => item.sourcePeerId !== payload.sourcePeerId)
        }
        return [
          ...(preparedAction ? [preparedAction] : []),
          DomainsState().new(replaceBy(domains, (item) => item.domain === runtime.domain, nextRuntime)),
          RuntimeSessionChangedEvent({
            type: 'leave',
            domain: runtime.domain,
            snapshot: snapshot(nextRuntime),
            session,
            occurredAt: clock.now(),
            provenance: 'live'
          }),
          BindingRemovedEvent({ domain: runtime.domain, sourcePeerId: payload.sourcePeerId })
        ]
      }
    })

    domain.effect({
      name: 'Session.InitialSendSuccessEffect',
      impl: ({ fromEvent }) =>
        fromEvent(wireDomain.event.MessageSentEvent).pipe(
          map(({ requestId }) => CompletePreparedPublishCommand(requestId))
        )
    })
    domain.effect({
      name: 'Session.InitialSendFailureEffect',
      impl: ({ fromEvent }) => fromEvent(wireDomain.event.MessageSendFailedEvent).pipe(map(FailPreparedPublishCommand))
    })
    domain.effect({
      name: 'Session.ChatSendSuccessEffect',
      impl: ({ fromEvent }) =>
        fromEvent(wireDomain.event.MessageSentEvent).pipe(map(({ requestId }) => CompleteChatSendCommand(requestId)))
    })
    domain.effect({
      name: 'Session.ChatSendFailureEffect',
      impl: ({ fromEvent }) => fromEvent(wireDomain.event.MessageSendFailedEvent).pipe(map(FailChatSendCommand))
    })
    domain.effect({
      name: 'Session.BackgroundSendFailureEffect',
      impl: ({ fromEvent }) =>
        fromEvent(wireDomain.event.MessageSendFailedEvent).pipe(
          filter(({ requestId }) => requestId.startsWith('session:peer:') || requestId.startsWith('session:catch-up:')),
          map(({ error }) => ErrorEvent(error))
        )
    })
    domain.effect({
      name: 'Session.WireSessionEffect',
      impl: ({ fromEvent }) =>
        fromEvent(wireDomain.event.MessageAcceptedEvent).pipe(
          filter((event) => 'type' in event.message && event.message.type === MESSAGE_TYPE.SESSION),
          map(ApplySessionMessageCommand)
        )
    })
    domain.effect({
      name: 'Session.WireLiveEffect',
      impl: ({ fromEvent }) =>
        fromEvent(wireDomain.event.MessageAcceptedEvent).pipe(
          filter(
            (event) =>
              'type' in event.message &&
              (event.message.type === MESSAGE_TYPE.TEXT || event.message.type === MESSAGE_TYPE.REACTION)
          ),
          map(ApplyLiveMessageCommand)
        )
    })

    return {
      query: { HlcQuery, DomainsQuery, DomainQuery, PreparedSessionQuery, RoomDomainQuery, BindingQuery },
      command: {
        PrepareDomainCommand,
        PublishPreparedCommand,
        CommitPreparedCommand,
        AbortPreparedCommand,
        ReleaseDomainCommand,
        AllocateTextMessageCommand,
        AllocateReactionMessageCommand,
        SendChatMessageCommand,
        UpdateHlcCommand,
        PeerJoinedCommand,
        PeerLeftCommand
      },
      event: {
        PreparedEvent,
        PreparationFailedEvent,
        PreparedPublishedEvent,
        PreparedPublishFailedEvent,
        DomainCommittedEvent,
        DomainReleasedEvent,
        RuntimeSessionChangedEvent,
        BindingChangedEvent,
        BindingRemovedEvent,
        OperationSucceededEvent,
        OperationFailedEvent,
        ErrorEvent
      }
    }
  }
})

export default SessionDomain
export { getChatRoomId }
