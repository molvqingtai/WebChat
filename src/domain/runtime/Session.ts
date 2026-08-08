import { Remesh } from 'remesh'
import { concatMap, filter, map } from 'rxjs'
import DeliveryDomain from '@/domain/runtime/Delivery'
import WireDomain, { type WireFailureStage, type WireMessageEvent } from '@/domain/runtime/Wire'
import { ClockExtern } from '@/domain/runtime/externs/Clock'
import { RoomTransportExtern } from '@/domain/runtime/externs/RoomTransport'
import { IdentityExtern } from '@/domain/runtime/externs/Identity'
import {
  MAX_PRESENCE_OBSERVATIONS,
  PresenceStoreExtern,
  type ObservedPresence,
  type PresenceDomainRecord
} from '@/domain/runtime/externs/PresenceStore'
import { CHAT_ROOM_NAMESPACE_V4 } from '@/constants/config'
import { MESSAGE_TYPE, type ChatMessage, type HLC, type MentionedUser, type ChatSite, type ChatUser } from '@/protocol'
import {
  MESSAGE_RECORD_TYPE,
  type ChatMessageRecord,
  type ReactionMessageRecord,
  type TextMessageRecord
} from '@/domain/Message'
import type { RuntimeSession, RuntimeSessionEvent, RuntimeSessionSnapshot } from '@/runtime/Contract'
import stringToHex from '@/utils/stringToHex'

export type SessionPreparationMode = 'join' | 'reconnect' | 'recover'

interface SessionBinding extends RuntimeSession {
  presenceId: string
}

export interface SessionDomainState {
  domain: string
  roomId: string
  sessionId: string
  presenceId: string
  user: ChatUser
  site: ChatSite
  joinedAt: number
  sessions: SessionBinding[]
}

interface PreparedSession {
  attemptId: string
  mode: SessionPreparationMode
  runtime: SessionDomainState
  observers: ObservedPresence[]
  isNewPresence: boolean
  publishRequestId?: string
  /** Frozen distinct publication targets still awaiting their single send. */
  publishPendingTargets: string[]
  missedPeerIds: string[]
  baselinePeerIds: string[]
}

interface PendingBaselinePeers {
  domain: string
  sourcePeerIds: string[]
}

interface DepartedBinding {
  domain: string
  binding: SessionBinding
}

interface PendingChatSend {
  operationId: string
  requestId: string
  domain: string
  roomId: string
  message: ChatMessage
  /** Frozen distinct per-target send requests still awaiting their single provider call. */
  pendingTargets: string[]
  /** Count of targets whose provider call accepted; drives settled success/failure semantics. */
  accepted: number
}

interface LiveRelease {
  domain: string
  roomId: string
  presenceId: string
  userId: string
  joinedAt: number
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

/** A domain-scoped Runtime failure; host/world-scoped failures omit the domain. */
export interface SessionFailure {
  error: Error
  domain?: string
}

const getChatRoomId = (domain: string): string => stringToHex(`${CHAT_ROOM_NAMESPACE_V4}:${domain}`)
const replaceBy = <T>(items: T[], predicate: (item: T) => boolean, next: T): T[] =>
  items.some(predicate) ? items.map((item) => (predicate(item) ? next : item)) : [...items, next]
const removeBy = <T>(items: T[], predicate: (item: T) => boolean): T[] => items.filter((item) => !predicate(item))
const appendUnique = <T>(items: T[], item: T): T[] => (items.includes(item) ? items : [...items, item])
const retainBoundedObservations = (observations: ObservedPresence[]): ObservedPresence[] => {
  if (observations.length <= MAX_PRESENCE_OBSERVATIONS) return observations
  const overflow = observations.length - MAX_PRESENCE_OBSERVATIONS
  const ended = new Set(
    observations.flatMap((observation, index) => (observation.status === 'ended' ? [index] : [])).slice(0, overflow)
  )
  const withoutEnded = observations.filter((_, index) => !ended.has(index))
  return withoutEnded.slice(withoutEnded.length - MAX_PRESENCE_OBSERVATIONS)
}
const replaceObservation = (observations: ObservedPresence[], next: ObservedPresence) =>
  retainBoundedObservations(replaceBy(observations, (item) => item.presenceId === next.presenceId, next))
const hasActiveUserPresence = (observations: ObservedPresence[], userId: string, exceptPresenceId?: string) =>
  observations.some(
    (observation) =>
      observation.status === 'active' && observation.user.id === userId && observation.presenceId !== exceptPresenceId
  )

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

const projectChatUser = (value: ChatUser): ChatUser => ({
  id: value.id,
  name: value.name,
  avatar: value.avatar
})

export const allocateHlc = (current: HLC, now: number): HLC => {
  if (now > current.timestamp) return { timestamp: now, counter: 0 }
  const counter = current.counter + 1
  if (!Number.isSafeInteger(counter)) throw new Error('Runtime HLC counter exhausted')
  return { timestamp: current.timestamp, counter }
}

export const adoptHlc = (current: HLC, remote: HLC, now: number): HLC | null => {
  return remote.timestamp > current.timestamp ||
    (remote.timestamp === current.timestamp && remote.counter > current.counter)
    ? { ...remote }
    : current
}

export const observeHlc = (current: HLC, remote: HLC, now: number): HLC | null => {
  const timestamp = Math.max(now, current.timestamp, remote.timestamp)
  if (timestamp === now && now > current.timestamp && now > remote.timestamp) {
    return { timestamp: now, counter: 0 }
  }
  const localCounter = timestamp === current.timestamp ? current.counter : 0
  const remoteCounter = timestamp === remote.timestamp ? remote.counter : 0
  const counter = Math.max(localCounter, remoteCounter) + 1
  return Number.isSafeInteger(counter) ? { timestamp, counter } : null
}

const projectRuntimeSession = ({ presenceId: _presenceId, ...session }: SessionBinding): RuntimeSession => session
const snapshot = (runtime: SessionDomainState): RuntimeSessionSnapshot => ({
  localSession: { sessionId: runtime.sessionId, user: runtime.user, joinedAt: runtime.joinedAt },
  sessions: runtime.sessions.map(projectRuntimeSession)
})

const makeRecord = (message: ChatMessage, user: ChatUser, receivedAt: number): ChatMessageRecord => {
  if (user.id !== message.userId) throw new Error('Chat record user does not match its message')
  return { type: MESSAGE_RECORD_TYPE.CHAT_MESSAGE, id: message.id, message, user, receivedAt }
}

const initialRequestId = (attemptId: string) => `session:initial:${attemptId}`
const publishTargetRequestId = (requestId: string, target: string) => `${requestId}:${target}`
const publishedTarget = (prepared: { publishRequestId?: string }, requestId: string) =>
  requestId.slice(`${prepared.publishRequestId}:`.length)
const catchUpRequestId = (attemptId: string, sourcePeerId: string) => `session:catch-up:${attemptId}:${sourcePeerId}`
const chatRequestId = (operationId: string) => `session:chat:${operationId}`
const chatTargetRequestId = (requestId: string, target: string) => `${requestId}:${target}`
const endRequestId = (presenceId: string) => `session:end:${presenceId}`
/** Extracts the exact domain from identity/catch-up send request ids, when structurally present. */
const backgroundSendDomain = (requestId: string): string | undefined => {
  if (requestId.startsWith('session:peer:')) {
    const rest = requestId.slice('session:peer:'.length)
    const colon = rest.lastIndexOf(':')
    return colon > 0 ? rest.slice(0, colon) : rest
  }
  if (requestId.startsWith('session:catch-up:')) {
    const rest = requestId.slice('session:catch-up:'.length)
    const parts = rest.split(':')
    return parts[0] === 'recovery' && parts[1] ? parts[1] : undefined
  }
  return undefined
}
const RELEASE_END_RETRY_INTERVAL_MS = 5000
const retainedLocalLifecycle = (record: PresenceDomainRecord | undefined) =>
  record?.local ? { local: record.local } : {}

const SessionDomain = Remesh.domain({
  name: 'SessionDomain',
  impl: (domain) => {
    const clock = domain.getExtern(ClockExtern)
    const roomTransport = domain.getExtern(RoomTransportExtern)
    const identity = domain.getExtern(IdentityExtern)
    const presenceStore = domain.getExtern(PresenceStoreExtern)
    const wireDomain = domain.getDomain(WireDomain())
    const deliveryDomain = domain.getDomain(DeliveryDomain())

    const HlcState = domain.state<HLC>({ name: 'Session.HlcState', default: { timestamp: 0, counter: 0 } })
    const DomainsState = domain.state<SessionDomainState[]>({ name: 'Session.DomainsState', default: [] })
    const PreparedSessionsState = domain.state<PreparedSession[]>({
      name: 'Session.PreparedSessionsState',
      default: []
    })
    const PendingBaselinePeersState = domain.state<PendingBaselinePeers[]>({
      name: 'Session.PendingBaselinePeersState',
      default: []
    })
    const PresenceDomainsState = domain.state<PresenceDomainRecord[]>({
      name: 'Session.PresenceDomainsState',
      default: []
    })
    const DepartedBindingsState = domain.state<DepartedBinding[]>({
      name: 'Session.DepartedBindingsState',
      default: []
    })
    const LiveReleasesState = domain.state<LiveRelease[]>({
      name: 'Session.LiveReleasesState',
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
    const PresenceDomainQuery = domain.query({
      name: 'Session.PresenceDomainQuery',
      impl: ({ get }, runtimeDomain: string) =>
        get(PresenceDomainsState()).find((item) => item.domain === runtimeDomain) ?? null
    })
    const ReleasingDomainQuery = domain.query({
      name: 'Session.ReleasingDomainQuery',
      impl: ({ get }, runtimeDomain: string) => get(LiveReleasesState()).some((item) => item.domain === runtimeDomain)
    })
    // Message authority ends as soon as release starts or a durable finalization marker is restored.
    const FinalizingPresenceQuery = domain.query({
      name: 'Session.FinalizingPresenceQuery',
      impl: ({ get }, runtimeDomain: string) => get(ReleasingDomainQuery(runtimeDomain))
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
    const ChatLeavePublishedEvent = domain.event<{ domain: string }>({ name: 'Session.ChatLeavePublishedEvent' })
    const DomainReleasedEvent = domain.event<string>({ name: 'Session.DomainReleasedEvent' })
    const ReleaseCompletedEvent = domain.event<{ domain: string; roomId?: string }>({
      name: 'Session.ReleaseCompletedEvent'
    })
    const DomainReleaseFailedEvent = domain.event<{ domain: string; error: Error }>({
      name: 'Session.DomainReleaseFailedEvent'
    })
    const ReleaseEndRetryRequestedEvent = domain.event<{ requestId: string }>({
      name: 'Session.ReleaseEndRetryRequestedEvent'
    })
    const PersistPresenceRequestedEvent = domain.event<{ record: PresenceDomainRecord }>({
      name: 'Session.PersistPresenceRequestedEvent'
    })
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
    const ErrorEvent = domain.event<SessionFailure>({ name: 'Session.ErrorEvent' })

    const HydratePresenceCommand = domain.command({
      name: 'Session.HydratePresenceCommand',
      impl: ({ get }, record: PresenceDomainRecord) =>
        PresenceDomainsState().new(
          replaceBy(get(PresenceDomainsState()), (item) => item.domain === record.domain, record)
        )
    })

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
          user = projectChatUser(payload.user!)
          // Local identity authorization: the joined site must belong to the domain. Protocol
          // shape is not validated here (local production trusts its typed inputs).
          if (site.origin !== payload.domain) {
            return PreparationFailedEvent({
              attemptId: payload.attemptId,
              error: new Error('Invalid local identity or site metadata')
            })
          }
        } else {
          user = current!.user
          site = current!.site
        }

        const presence = get(PresenceDomainsState()).find((item) => item.domain === payload.domain)
        const local = current
          ? {
              presenceId: current.presenceId,
              userId: current.user.id,
              joinedAt: current.joinedAt,
              status: 'active' as const
            }
          : (presence?.local ?? undefined)
        if (!local || local.userId !== user.id) {
          return PreparationFailedEvent({
            attemptId: payload.attemptId,
            error: new Error('Runtime logical presence is unavailable')
          })
        }
        const runtime: SessionDomainState = {
          domain: payload.domain,
          roomId: current?.roomId ?? getChatRoomId(payload.domain),
          sessionId: payload.mode === 'join' && current ? current.sessionId : identity.nextId(),
          presenceId: local.presenceId,
          user,
          site,
          joinedAt: local.joinedAt,
          sessions: payload.mode === 'join' ? (committed?.sessions ?? []) : []
        }
        const prepared: PreparedSession = {
          attemptId: payload.attemptId,
          mode: payload.mode,
          runtime,
          observers: priorPrepared?.observers ?? presence?.observers ?? [],
          isNewPresence: !current && local.status === 'pending',
          publishPendingTargets: [],
          missedPeerIds: [],
          baselinePeerIds: []
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
        const message = {
          type: MESSAGE_TYPE.SESSION,
          sessionId: prepared.runtime.sessionId,
          presenceId: prepared.runtime.presenceId,
          joinedAt: prepared.runtime.joinedAt,
          user: prepared.runtime.user
        } as const
        // Freeze the current physical Room membership as this publication's distinct targets.
        const targets = [...new Set(roomTransport.peers(prepared.runtime.roomId))]
        const pending = {
          ...prepared,
          publishRequestId: requestId,
          publishPendingTargets: targets
        }
        const first = targets[0]
        return [
          PreparedSessionsState().new(
            replaceBy(get(PreparedSessionsState()), (item) => item.attemptId === attemptId, pending)
          ),
          ...(first
            ? [
                wireDomain.command.SendMessageCommand({
                  requestId: publishTargetRequestId(requestId, first),
                  roomId: prepared.runtime.roomId,
                  targetPeerIds: [first],
                  message
                })
              ]
            : [PreparedPublishedEvent({ attemptId })])
        ]
      }
    })

    const advancePreparedPublish = (
      get: Parameters<Parameters<typeof domain.command>[0]['impl']>[0]['get'],
      prepared: PreparedSession,
      settled: string
    ) => {
      const remaining = prepared.publishPendingTargets.filter((item) => item !== settled)
      const advanced = { ...prepared, publishPendingTargets: remaining }
      const next = remaining[0]
      return [
        PreparedSessionsState().new(
          replaceBy(get(PreparedSessionsState()), (item) => item.attemptId === prepared.attemptId, advanced)
        ),
        ...(next
          ? [
              wireDomain.command.SendMessageCommand({
                requestId: publishTargetRequestId(prepared.publishRequestId!, next),
                roomId: prepared.runtime.roomId,
                targetPeerIds: [next],
                message: {
                  type: MESSAGE_TYPE.SESSION,
                  sessionId: prepared.runtime.sessionId,
                  presenceId: prepared.runtime.presenceId,
                  joinedAt: prepared.runtime.joinedAt,
                  user: prepared.runtime.user
                }
              })
            ]
          : [PreparedPublishedEvent({ attemptId: prepared.attemptId })])
      ]
    }

    const CompletePreparedPublishCommand = domain.command({
      name: 'Session.CompletePreparedPublishCommand',
      impl: ({ get }, requestId: string) => {
        const prepared = get(PreparedSessionsState()).find(
          (item) =>
            item.publishRequestId !== undefined &&
            item.publishPendingTargets.some(
              (target) => publishTargetRequestId(item.publishRequestId!, target) === requestId
            )
        )
        return prepared ? advancePreparedPublish(get, prepared, publishedTarget(prepared, requestId)) : null
      }
    })

    const FailPreparedPublishCommand = domain.command({
      name: 'Session.FailPreparedPublishCommand',
      impl: ({ get }, payload: { requestId: string; error: Error; stage?: WireFailureStage }) => {
        const prepared = get(PreparedSessionsState()).find(
          (item) =>
            item.publishRequestId !== undefined &&
            item.publishPendingTargets.some(
              (target) => publishTargetRequestId(item.publishRequestId!, target) === payload.requestId
            )
        )
        if (!prepared) return null
        // Owner loss (leave/supersede invalidates the queue) cancels the publish quietly.
        if (payload.stage === 'cancelled') return null
        // A preflight failure performed zero provider sends and fails the attempt.
        if (payload.stage === 'preflight') {
          return PreparedPublishFailedEvent({ attemptId: prepared.attemptId, error: payload.error })
        }
        // A genuine target failure is surfaced once and never retried; remaining targets still run.
        return [
          ErrorEvent({ error: payload.error, domain: prepared.runtime.domain }),
          ...advancePreparedPublish(get, prepared, publishedTarget(prepared, payload.requestId))
        ]
      }
    })

    const CommitPreparedCommand = domain.command({
      name: 'Session.CommitPreparedCommand',
      impl: ({ get }, attemptId: string) => {
        const prepared = get(PreparedSessionsState()).find((item) => item.attemptId === attemptId)
        if (!prepared) return null
        const domains = get(DomainsState())
        const previous = domains.find((item) => item.domain === prepared.runtime.domain)
        const newBindings = prepared.runtime.sessions.filter(
          (session) =>
            !previous?.sessions.some(
              (current) => current.sourcePeerId === session.sourcePeerId && current.sessionId === session.sessionId
            )
        )
        const newSessions = newBindings.map(projectRuntimeSession)
        const presenceDomains = get(PresenceDomainsState())
        const priorPresence = presenceDomains.find((item) => item.domain === prepared.runtime.domain)
        const priorActiveUserIds = new Set([
          ...(previous?.sessions.map((session) => session.user.id) ?? []),
          ...(priorPresence?.observers.flatMap((observer) =>
            observer.status === 'active' ? [observer.user.id] : []
          ) ?? [])
        ])
        const laterJoins = newBindings.filter(
          (session, index, sessions) =>
            session.joinedAt > prepared.runtime.joinedAt &&
            !priorActiveUserIds.has(session.user.id) &&
            sessions.findIndex(
              (candidate) => candidate.user.id === session.user.id && candidate.joinedAt > prepared.runtime.joinedAt
            ) === index
        )
        const presence: PresenceDomainRecord = {
          domain: prepared.runtime.domain,
          lastJoinedAt: Math.max(priorPresence?.lastJoinedAt ?? 0, prepared.runtime.joinedAt),
          local: {
            presenceId: prepared.runtime.presenceId,
            userId: prepared.runtime.user.id,
            joinedAt: prepared.runtime.joinedAt,
            status: 'active' as const
          },
          observers: prepared.observers
        }
        const baselines = get(PendingBaselinePeersState())
        const currentBaseline = baselines.find((item) => item.domain === prepared.runtime.domain)
        const sourcePeerIds = [
          ...(currentBaseline?.sourcePeerIds ?? []),
          ...prepared.baselinePeerIds.filter(
            (sourcePeerId) => !prepared.runtime.sessions.some((session) => session.sourcePeerId === sourcePeerId)
          )
        ].filter((sourcePeerId, index, items) => items.indexOf(sourcePeerId) === index)
        const nextBaselines =
          sourcePeerIds.length > 0
            ? replaceBy(baselines, (item) => item.domain === prepared.runtime.domain, {
                domain: prepared.runtime.domain,
                sourcePeerIds
              })
            : removeBy(baselines, (item) => item.domain === prepared.runtime.domain)
        return [
          DomainsState().new(replaceBy(domains, (item) => item.domain === prepared.runtime.domain, prepared.runtime)),
          PreparedSessionsState().new(removeBy(get(PreparedSessionsState()), (item) => item.attemptId === attemptId)),
          PendingBaselinePeersState().new(nextBaselines),
          PresenceDomainsState().new(
            replaceBy(presenceDomains, (item) => item.domain === prepared.runtime.domain, presence)
          ),
          PersistPresenceRequestedEvent({ record: presence }),
          RuntimeSessionChangedEvent({
            type: 'snapshot',
            domain: prepared.runtime.domain,
            snapshot: snapshot(prepared.runtime),
            // Only a newly allocated logical presence owns a local self-notice.
            provenance: prepared.isNewPresence
              ? 'join'
              : prepared.mode === 'reconnect'
                ? 'reconnect'
                : prepared.mode === 'recover'
                  ? 'recovery'
                  : 'refresh'
          }),
          ...laterJoins.map((session) =>
            RuntimeSessionChangedEvent({
              type: 'join',
              domain: prepared.runtime.domain,
              snapshot: snapshot(prepared.runtime),
              session: projectRuntimeSession(session),
              provenance: 'live'
            })
          ),
          DomainCommittedEvent({ attemptId, domain: prepared.runtime.domain, newSessions }),
          ...prepared.missedPeerIds.map((sourcePeerId) =>
            wireDomain.command.SendMessageCommand({
              requestId: catchUpRequestId(attemptId, sourcePeerId),
              roomId: prepared.runtime.roomId,
              targetPeerIds: [sourcePeerId],
              message: {
                type: MESSAGE_TYPE.SESSION,
                sessionId: prepared.runtime.sessionId,
                presenceId: prepared.runtime.presenceId,
                joinedAt: prepared.runtime.joinedAt,
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

    const PublishPresenceEndCommand = domain.command({
      name: 'Session.PublishPresenceEndCommand',
      impl: ({ get }, release: LiveRelease) =>
        get(LiveReleasesState()).some((item) => item.domain === release.domain && item.requestId === release.requestId)
          ? wireDomain.command.SendMessageCommand({
              requestId: release.requestId,
              roomId: release.roomId,
              message: { type: MESSAGE_TYPE.SESSION_END, presenceId: release.presenceId }
            })
          : null
    })

    // Retirement and every unsettled END attempt retain one durable final-generation identity.
    const BeginReleaseDomainCommand = domain.command({
      name: 'Session.BeginReleaseDomainCommand',
      impl: ({ get }, runtimeDomain: string) => {
        // A single live in-memory release owner: Chat leave (SESSION_END) -> contribution remove
        // (world.ReleaseDomain publishes latest Presence via the sole iterator) -> Connection settles close.
        // No durable owner/outcome/journal; on host replacement the next current event reconciles.
        if (get(ReleasingDomainQuery(runtimeDomain))) return null
        const runtime = get(DomainsState()).find((item) => item.domain === runtimeDomain)
        const prepared = get(PreparedSessionsState()).find((item) => item.runtime.domain === runtimeDomain)
        const current = runtime ?? prepared?.runtime
        if (!current) return ReleaseCompletedEvent({ domain: runtimeDomain })
        const release: LiveRelease = {
          domain: runtimeDomain,
          roomId: current.roomId,
          presenceId: current.presenceId,
          userId: current.user.id,
          joinedAt: current.joinedAt,
          requestId: endRequestId(current.presenceId)
        }
        return [LiveReleasesState().new([...get(LiveReleasesState()), release]), PublishPresenceEndCommand(release)]
      }
    })

    const RetryReleaseEndCommand = domain.command({
      name: 'Session.RetryReleaseEndCommand',
      impl: ({ get }, requestId: string) => {
        const current = get(LiveReleasesState()).find((item) => item.requestId === requestId)
        return current ? PublishPresenceEndCommand(current) : null
      }
    })

    const CompletePresenceEndCommand = domain.command({
      name: 'Session.CompletePresenceEndCommand',
      impl: ({ get }, requestId: string) => {
        const pending = get(LiveReleasesState())
        const current = pending.find((item) => item.requestId === requestId)
        if (!current) return null
        return [
          // The live owner advances only after the Chat leave has been accepted.
          DomainsState().new(removeBy(get(DomainsState()), (item) => item.domain === current.domain)),
          PreparedSessionsState().new(
            removeBy(get(PreparedSessionsState()), (item) => item.runtime.domain === current.domain)
          ),
          PresenceDomainsState().new(removeBy(get(PresenceDomainsState()), (item) => item.domain === current.domain)),
          PersistPresenceRequestedEvent({
            record: { domain: current.domain, lastJoinedAt: 0, observers: [] }
          }),
          ChatLeavePublishedEvent({ domain: current.domain })
        ]
      }
    })

    const FailPresenceEndCommand = domain.command({
      name: 'Session.FailPresenceEndCommand',
      impl: ({ get }, payload: { requestId: string; error: Error }) => {
        const pending = get(LiveReleasesState())
        const current = pending.find((item) => item.requestId === payload.requestId)
        if (!current) return null
        // The Chat-leave END step failed: surface it once and retry only this step boundedly.
        return [
          ErrorEvent({ error: payload.error, domain: current.domain }),
          ReleaseEndRetryRequestedEvent({ requestId: current.requestId })
        ]
      }
    })

    const CompleteReleaseCommand = domain.command({
      name: 'Session.CompleteReleaseCommand',
      impl: ({ get }, runtimeDomain: string) => {
        const pending = get(LiveReleasesState())
        const current = pending.find((item) => item.domain === runtimeDomain)
        return current
          ? [
              LiveReleasesState().new(removeBy(pending, (item) => item.domain === runtimeDomain)),
              ReleaseCompletedEvent({ domain: runtimeDomain, roomId: current.roomId })
            ]
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
          PendingBaselinePeersState().new(
            removeBy(get(PendingBaselinePeersState()), (item) => item.domain === runtimeDomain)
          ),
          PresenceDomainsState().new(removeBy(get(PresenceDomainsState()), (item) => item.domain === runtimeDomain)),
          DepartedBindingsState().new(removeBy(get(DepartedBindingsState()), (item) => item.domain === runtimeDomain)),
          LiveReleasesState().new(removeBy(get(LiveReleasesState()), (item) => item.domain === runtimeDomain)),
          DomainReleasedEvent(runtimeDomain)
        ]
      }
    })

    const AllocateTextMessageCommand = domain.command({
      name: 'Session.AllocateTextMessageCommand',
      impl: ({ get }, payload: { operationId: string; domain: string; body: string; mentions: MentionedUser[] }) => {
        if (get(FinalizingPresenceQuery(payload.domain))) {
          return OperationFailedEvent({
            operationId: payload.operationId,
            error: new Error('Runtime presence is completing its final release')
          })
        }
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
        const record: TextMessageRecord = {
          type: MESSAGE_RECORD_TYPE.CHAT_MESSAGE,
          id: candidate.id,
          message: candidate,
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
        if (get(FinalizingPresenceQuery(payload.domain))) {
          return OperationFailedEvent({
            operationId: payload.operationId,
            error: new Error('Runtime presence is completing its final release')
          })
        }
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
        const record: ReactionMessageRecord = {
          type: MESSAGE_RECORD_TYPE.CHAT_MESSAGE,
          id: candidate.id,
          message: candidate,
          user: runtime.user,
          receivedAt: clock.now()
        }
        return [HlcState().new(hlc), OperationSucceededEvent({ operationId: payload.operationId, record })]
      }
    })

    const SendChatMessageCommand = domain.command({
      name: 'Session.SendChatMessageCommand',
      impl: ({ get }, payload: { operationId: string; domain: string; event: ChatMessage }) => {
        if (get(FinalizingPresenceQuery(payload.domain))) {
          return OperationFailedEvent({
            operationId: payload.operationId,
            error: new Error('Runtime presence is completing its final release')
          })
        }
        const runtime = get(DomainsState()).find((item) => item.domain === payload.domain)
        const event = payload.event
        if (!runtime || (event.type !== MESSAGE_TYPE.TEXT && event.type !== MESSAGE_TYPE.REACTION)) {
          return OperationFailedEvent({
            operationId: payload.operationId,
            error: new Error('Chat message does not match the active local session')
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
        const targets = [...new Set(runtime.sessions.map((session) => session.sourcePeerId))]
        const pending: PendingChatSend = {
          operationId: payload.operationId,
          requestId,
          domain: payload.domain,
          roomId: runtime.roomId,
          message: event,
          pendingTargets: targets,
          accepted: 0
        }
        return [
          HlcState().new(adopted),
          PendingChatSendsState().new([
            ...get(PendingChatSendsState()).filter((item) => item.operationId !== payload.operationId),
            pending
          ]),
          ...(targets.length > 0
            ? [sendChatTarget(pending)]
            : [OperationSucceededEvent({ operationId: payload.operationId })])
        ]
      }
    })

    const sendChatTarget = (pending: PendingChatSend) =>
      wireDomain.command.SendMessageCommand({
        requestId: chatTargetRequestId(pending.requestId, pending.pendingTargets[0]),
        roomId: pending.roomId,
        targetPeerIds: [pending.pendingTargets[0]],
        message: pending.message
      })

    const CompleteChatSendCommand = domain.command({
      name: 'Session.CompleteChatSendCommand',
      impl: ({ get }, requestId: string) => {
        const state = get(PendingChatSendsState())
        const pending = state.find((item) =>
          item.pendingTargets.some((target) => chatTargetRequestId(item.requestId, target) === requestId)
        )
        if (!pending) return null
        const remaining = pending.pendingTargets.filter(
          (target) => chatTargetRequestId(pending.requestId, target) !== requestId
        )
        const next = { ...pending, pendingTargets: remaining, accepted: pending.accepted + 1 }
        if (remaining.length > 0) {
          return [
            PendingChatSendsState().new(replaceBy(state, (item) => item.operationId === pending.operationId, next)),
            sendChatTarget(next)
          ]
        }
        return [
          PendingChatSendsState().new(removeBy(state, (item) => item.operationId === pending.operationId)),
          OperationSucceededEvent({ operationId: pending.operationId })
        ]
      }
    })

    const FailChatSendCommand = domain.command({
      name: 'Session.FailChatSendCommand',
      impl: ({ get }, payload: { requestId: string; error: Error; stage?: WireFailureStage }) => {
        const state = get(PendingChatSendsState())
        const pending = state.find((item) =>
          item.pendingTargets.some((target) => chatTargetRequestId(item.requestId, target) === payload.requestId)
        )
        if (!pending) return null
        const settle = (accepted: number) => {
          const clear = [
            PendingChatSendsState().new(removeBy(state, (item) => item.operationId === pending.operationId))
          ]
          // A send settles as success only when at least one target accepted; a wholly-failed or
          // explicit-single-target send rejects so a real send failure is never recorded as success.
          return accepted > 0
            ? [...clear, OperationSucceededEvent({ operationId: pending.operationId })]
            : [...clear, OperationFailedEvent({ operationId: pending.operationId, error: payload.error })]
        }
        // Owner loss cancels the remaining targets; success only if some target had already accepted.
        if (payload.stage === 'cancelled') return settle(pending.accepted)
        const remaining = pending.pendingTargets.filter(
          (target) => chatTargetRequestId(pending.requestId, target) !== payload.requestId
        )
        const next = { ...pending, pendingTargets: remaining }
        const failure = ErrorEvent({ error: payload.error, domain: pending.domain })
        if (remaining.length > 0) {
          return [
            failure,
            PendingChatSendsState().new(replaceBy(state, (item) => item.operationId === pending.operationId, next)),
            sendChatTarget(next)
          ]
        }
        return [failure, ...settle(pending.accepted)]
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
        if (!runtime || get(ReleasingDomainQuery(runtime.domain))) return null

        const current = runtime.sessions.find((item) => item.sourcePeerId === payload.sourcePeerId)
        const presenceDomains = get(PresenceDomainsState())
        const persisted = presenceDomains.find((item) => item.domain === runtime.domain)
        const observers = prepared?.observers ?? persisted?.observers ?? []
        const observed = observers.find((item) => item.presenceId === message.presenceId)
        if (
          observed?.status === 'ended' ||
          (observed && (observed.user.id !== message.user.id || observed.joinedAt !== message.joinedAt)) ||
          (current?.sessionId === message.sessionId &&
            (current.presenceId !== message.presenceId ||
              current.user.id !== message.user.id ||
              current.joinedAt !== message.joinedAt))
        ) {
          return wireDomain.command.DropProtocolCommand({
            sourcePeerId: payload.sourcePeerId,
            reason: 'session does not match its logical presence binding'
          })
        }

        let nextObservers = observers
        if (current && current.presenceId !== message.presenceId) {
          const previous = nextObservers.find((item) => item.presenceId === current.presenceId)
          if (previous) nextObservers = replaceObservation(nextObservers, { ...previous, status: 'ended' })
        }
        const session: SessionBinding = {
          sourcePeerId: payload.sourcePeerId,
          sessionId: message.sessionId,
          presenceId: message.presenceId,
          user: message.user,
          joinedAt: message.joinedAt
        }
        nextObservers = replaceObservation(nextObservers, {
          presenceId: message.presenceId,
          sessionId: message.sessionId,
          user: message.user,
          joinedAt: session.joinedAt,
          status: 'active'
        })
        const nextRuntime = {
          ...runtime,
          sessions: replaceBy(
            runtime.sessions.map((item) =>
              item.presenceId === message.presenceId ? { ...item, user: message.user } : item
            ),
            (item) => item.sourcePeerId === payload.sourcePeerId,
            session
          )
        }
        if (prepared) {
          return PreparedSessionsState().new(
            replaceBy(preparedSessions, (item) => item.attemptId === prepared.attemptId, {
              ...prepared,
              runtime: nextRuntime,
              observers: nextObservers,
              baselinePeerIds: prepared.baselinePeerIds.filter((sourcePeerId) => sourcePeerId !== payload.sourcePeerId)
            })
          )
        }

        const record: PresenceDomainRecord = {
          domain: runtime.domain,
          lastJoinedAt: persisted?.lastJoinedAt ?? 0,
          ...retainedLocalLifecycle(persisted),
          observers: nextObservers
        }
        const baselines = get(PendingBaselinePeersState())
        const baseline = baselines.find((item) => item.domain === runtime.domain)
        const isBaselinePeer = baseline?.sourcePeerIds.includes(payload.sourcePeerId) === true
        const remainingBaselinePeerIds =
          baseline?.sourcePeerIds.filter((sourcePeerId) => sourcePeerId !== payload.sourcePeerId) ?? []
        const nextBaselines = isBaselinePeer
          ? remainingBaselinePeerIds.length > 0
            ? replaceBy(baselines, (item) => item.domain === runtime.domain, {
                domain: runtime.domain,
                sourcePeerIds: remainingBaselinePeerIds
              })
            : removeBy(baselines, (item) => item.domain === runtime.domain)
          : baselines
        const wasLogicallyActive =
          observed?.status === 'active' || hasActiveUserPresence(nextObservers, message.user.id, message.presenceId)
        const isLaterLogicalJoin = message.joinedAt > runtime.joinedAt
        const physicalBindingChanged =
          current?.sessionId !== message.sessionId || current?.presenceId !== message.presenceId
        const sessionSnapshot = snapshot(nextRuntime)
        const publicSession = projectRuntimeSession(session)
        // Preparation peers and known generations are membership convergence; only logical zero-to-one is a live join.
        const sessionEvent: RuntimeSessionEvent =
          !isLaterLogicalJoin || wasLogicallyActive || (current?.user.id === message.user.id && Boolean(current))
            ? { type: 'snapshot', domain: runtime.domain, snapshot: sessionSnapshot, provenance: 'refresh' }
            : current
              ? {
                  type: 'replace',
                  domain: runtime.domain,
                  snapshot: sessionSnapshot,
                  previous: projectRuntimeSession(current),
                  session: publicSession,
                  occurredAt: clock.now(),
                  provenance: 'live'
                }
              : {
                  type: 'join',
                  domain: runtime.domain,
                  snapshot: sessionSnapshot,
                  session: publicSession,
                  provenance: 'live'
                }
        return [
          DomainsState().new(replaceBy(domains, (item) => item.domain === runtime.domain, nextRuntime)),
          PresenceDomainsState().new(replaceBy(presenceDomains, (item) => item.domain === runtime.domain, record)),
          DepartedBindingsState().new(
            removeBy(get(DepartedBindingsState()), (item) => item.binding.presenceId === message.presenceId)
          ),
          PersistPresenceRequestedEvent({ record }),
          ...(isBaselinePeer ? [PendingBaselinePeersState().new(nextBaselines)] : []),
          RuntimeSessionChangedEvent(sessionEvent),
          ...(physicalBindingChanged
            ? [BindingChangedEvent({ domain: runtime.domain, sourcePeerId: payload.sourcePeerId })]
            : [])
        ]
      }
    })

    const ApplySessionEndCommand = domain.command({
      name: 'Session.ApplySessionEndCommand',
      impl: ({ get }, payload: WireMessageEvent) => {
        if (!('type' in payload.message) || payload.message.type !== MESSAGE_TYPE.SESSION_END) return null
        const message = payload.message
        const preparedSessions = get(PreparedSessionsState())
        const prepared = preparedSessions.find((item) => item.runtime.roomId === payload.roomId)
        const domains = get(DomainsState())
        const runtime = prepared?.runtime ?? domains.find((item) => item.roomId === payload.roomId)
        if (!runtime || get(ReleasingDomainQuery(runtime.domain))) return null
        const presenceDomains = get(PresenceDomainsState())
        const persisted = presenceDomains.find((item) => item.domain === runtime.domain)
        const observers = prepared?.observers ?? persisted?.observers ?? []
        const observed = observers.find((item) => item.presenceId === message.presenceId)
        if (observed?.status === 'ended') return null
        const departed = get(DepartedBindingsState())
        const binding =
          runtime.sessions.find(
            (item) => item.sourcePeerId === payload.sourcePeerId && item.presenceId === message.presenceId
          ) ??
          departed.find(
            (item) =>
              item.domain === runtime.domain &&
              item.binding.sourcePeerId === payload.sourcePeerId &&
              item.binding.presenceId === message.presenceId
          )?.binding
        if (!binding) {
          return wireDomain.command.DropProtocolCommand({
            sourcePeerId: payload.sourcePeerId,
            reason: 'presence end arrived without a matching source binding'
          })
        }
        const ended: ObservedPresence = {
          presenceId: message.presenceId,
          sessionId: observed?.sessionId ?? binding.sessionId,
          user: observed?.user ?? binding.user,
          joinedAt: observed?.joinedAt ?? binding.joinedAt,
          status: 'ended'
        }
        const nextObservers = replaceObservation(observers, ended)
        const removed = runtime.sessions.filter((item) => item.presenceId === message.presenceId)
        const nextRuntime = {
          ...runtime,
          sessions: runtime.sessions.filter((item) => item.presenceId !== message.presenceId)
        }
        const nextDeparted = removeBy(
          departed,
          (item) => item.domain === runtime.domain && item.binding.presenceId === message.presenceId
        )
        if (prepared) {
          return [
            PreparedSessionsState().new(
              replaceBy(preparedSessions, (item) => item.attemptId === prepared.attemptId, {
                ...prepared,
                runtime: nextRuntime,
                observers: nextObservers
              })
            ),
            DepartedBindingsState().new(nextDeparted)
          ]
        }
        const record: PresenceDomainRecord = {
          domain: runtime.domain,
          lastJoinedAt: persisted?.lastJoinedAt ?? 0,
          ...retainedLocalLifecycle(persisted),
          observers: nextObservers
        }
        const publicBinding = projectRuntimeSession(binding)
        const sessionSnapshot = snapshot(nextRuntime)
        const stillOnline = hasActiveUserPresence(nextObservers, binding.user.id, message.presenceId)
        return [
          DomainsState().new(replaceBy(domains, (item) => item.domain === runtime.domain, nextRuntime)),
          PresenceDomainsState().new(replaceBy(presenceDomains, (item) => item.domain === runtime.domain, record)),
          DepartedBindingsState().new(nextDeparted),
          PersistPresenceRequestedEvent({ record }),
          RuntimeSessionChangedEvent(
            stillOnline
              ? { type: 'snapshot', domain: runtime.domain, snapshot: sessionSnapshot, provenance: 'refresh' }
              : {
                  type: 'leave',
                  domain: runtime.domain,
                  snapshot: sessionSnapshot,
                  session: publicBinding,
                  occurredAt: clock.now(),
                  provenance: 'live'
                }
          ),
          ...removed.map((item) => BindingRemovedEvent({ domain: runtime.domain, sourcePeerId: item.sourcePeerId }))
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
          const baselinePeerIds = appendUnique(prepared.baselinePeerIds, payload.sourcePeerId)
          const missedPeerIds = prepared.publishRequestId
            ? appendUnique(prepared.missedPeerIds, payload.sourcePeerId)
            : prepared.missedPeerIds
          return baselinePeerIds === prepared.baselinePeerIds && missedPeerIds === prepared.missedPeerIds
            ? null
            : PreparedSessionsState().new(
                replaceBy(preparedSessions, (item) => item.attemptId === prepared.attemptId, {
                  ...prepared,
                  baselinePeerIds,
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
              message: {
                type: MESSAGE_TYPE.SESSION,
                sessionId: runtime.sessionId,
                presenceId: runtime.presenceId,
                joinedAt: runtime.joinedAt,
                user: runtime.user
              }
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
                baselinePeerIds: prepared.baselinePeerIds.filter((item) => item !== payload.sourcePeerId),
                runtime: {
                  ...prepared.runtime,
                  sessions: prepared.runtime.sessions.filter((item) => item.sourcePeerId !== payload.sourcePeerId)
                }
              })
            )
          : null
        const domains = get(DomainsState())
        const runtime = domains.find((item) => item.roomId === payload.roomId)
        const baselineDomain = prepared?.runtime.domain ?? runtime?.domain
        const baselines = get(PendingBaselinePeersState())
        const baseline = baselines.find((item) => item.domain === baselineDomain)
        const remainingBaselinePeerIds =
          baseline?.sourcePeerIds.filter((sourcePeerId) => sourcePeerId !== payload.sourcePeerId) ?? []
        const baselineAction = baseline?.sourcePeerIds.includes(payload.sourcePeerId)
          ? PendingBaselinePeersState().new(
              remainingBaselinePeerIds.length > 0
                ? replaceBy(baselines, (item) => item.domain === baseline.domain, {
                    domain: baseline.domain,
                    sourcePeerIds: remainingBaselinePeerIds
                  })
                : removeBy(baselines, (item) => item.domain === baseline.domain)
            )
          : null
        const cleanupActions = [
          ...(preparedAction ? [preparedAction] : []),
          ...(baselineAction ? [baselineAction] : [])
        ]
        if (!runtime) return cleanupActions.length > 0 ? cleanupActions : null
        const session = runtime.sessions.find((item) => item.sourcePeerId === payload.sourcePeerId)
        if (!session) return cleanupActions.length > 0 ? cleanupActions : null
        const nextRuntime = {
          ...runtime,
          sessions: runtime.sessions.filter((item) => item.sourcePeerId !== payload.sourcePeerId)
        }
        const departed = get(DepartedBindingsState())
        return [
          ...cleanupActions,
          DomainsState().new(replaceBy(domains, (item) => item.domain === runtime.domain, nextRuntime)),
          DepartedBindingsState().new(
            replaceBy(
              departed,
              (item) => item.domain === runtime.domain && item.binding.sourcePeerId === payload.sourcePeerId,
              { domain: runtime.domain, binding: session }
            )
          ),
          RuntimeSessionChangedEvent({
            type: 'snapshot',
            domain: runtime.domain,
            snapshot: snapshot(nextRuntime),
            provenance: 'refresh'
          }),
          BindingRemovedEvent({ domain: runtime.domain, sourcePeerId: payload.sourcePeerId })
        ]
      }
    })

    domain.effect({
      name: 'Session.PresencePersistEffect',
      impl: ({ fromEvent }) =>
        fromEvent(PersistPresenceRequestedEvent).pipe(
          concatMap(async (request) => {
            try {
              await presenceStore.save(request.record)
              return null
            } catch (error) {
              return ErrorEvent({ error: error as Error, domain: request.record.domain })
            }
          })
        )
    })
    domain.effect({
      name: 'Session.ReleaseEndRetryEffect',
      impl: ({ fromEvent }) =>
        fromEvent(ReleaseEndRetryRequestedEvent).pipe(
          concatMap(
            ({ requestId }) =>
              new globalThis.Promise<{ requestId: string }>((resolve) =>
                globalThis.setTimeout(() => resolve({ requestId }), RELEASE_END_RETRY_INTERVAL_MS)
              )
          ),
          map(({ requestId }) => RetryReleaseEndCommand(requestId))
        )
    })
    domain.effect({
      name: 'Session.PresenceEndSendSuccessEffect',
      impl: ({ fromEvent }) =>
        fromEvent(wireDomain.event.MessageSentEvent).pipe(
          filter(({ requestId }) => requestId.startsWith('session:end:')),
          map(({ requestId }) => CompletePresenceEndCommand(requestId))
        )
    })
    domain.effect({
      name: 'Session.PresenceEndSendFailureEffect',
      impl: ({ fromEvent }) =>
        fromEvent(wireDomain.event.MessageSendFailedEvent).pipe(
          filter(({ requestId }) => requestId.startsWith('session:end:')),
          map(FailPresenceEndCommand)
        )
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
          map(({ requestId, error }) => ErrorEvent({ error, domain: backgroundSendDomain(requestId) }))
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
      name: 'Session.WirePresenceEndEffect',
      impl: ({ fromEvent }) =>
        fromEvent(wireDomain.event.MessageAcceptedEvent).pipe(
          filter((event) => 'type' in event.message && event.message.type === MESSAGE_TYPE.SESSION_END),
          map(ApplySessionEndCommand)
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
      query: {
        HlcQuery,
        DomainsQuery,
        DomainQuery,
        PreparedSessionQuery,
        PresenceDomainQuery,
        ReleasingDomainQuery,
        FinalizingPresenceQuery,
        RoomDomainQuery,
        BindingQuery
      },
      command: {
        HydratePresenceCommand,
        PrepareDomainCommand,
        PublishPreparedCommand,
        CommitPreparedCommand,
        AbortPreparedCommand,
        BeginReleaseDomainCommand,
        CompleteReleaseCommand,
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
        ChatLeavePublishedEvent,
        DomainReleasedEvent,
        ReleaseCompletedEvent,
        DomainReleaseFailedEvent,
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
