import { Remesh } from 'remesh'
import { concatMap, filter, map } from 'rxjs'
import DeliveryDomain from '@/domain/runtime/Delivery'
import WireDomain, { type WireMessageEvent } from '@/domain/runtime/Wire'
import { ClockExtern } from '@/domain/runtime/externs/Clock'
import { IdentityExtern } from '@/domain/runtime/externs/Identity'
import {
  MAX_PRESENCE_OBSERVATIONS,
  PresenceStoreExtern,
  type ObservedPresence,
  type PendingPresenceEnd,
  type PresenceDomainRecord
} from '@/domain/runtime/externs/PresenceStore'
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
  isFinalizingPresence: boolean
  publishRequestId?: string
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
}

type PendingReleasePhase =
  | 'retiring'
  | 'retrying'
  | 'publishing'
  | 'pending'
  | 'settling'
  | 'settlement-failed'
  | 'cleaning'
  | 'cleanup-failed'

interface PendingRelease {
  domain: string
  roomId: string
  presenceId: string
  userId: string
  joinedAt: number
  requestId: string
  phase: PendingReleasePhase
}

type PresencePersistTransition =
  | { type: 'retire'; release: PendingRelease }
  | { type: 'retry'; release: PendingRelease }
  | { type: 'failure'; release: PendingRelease; error: Error }
  | { type: 'settle'; release: PendingRelease }
  | { type: 'cleanup'; release: PendingRelease }

interface PresencePersistRequest {
  record: PresenceDomainRecord
  transition?: PresencePersistTransition
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
const catchUpRequestId = (attemptId: string, sourcePeerId: string) => `session:catch-up:${attemptId}:${sourcePeerId}`
const chatRequestId = (operationId: string) => `session:chat:${operationId}`
const endRequestId = (presenceId: string) => `session:end:${presenceId}`
const finalEndIdentity = ({ presenceId, userId, joinedAt }: PendingRelease): PendingPresenceEnd => ({
  presenceId,
  userId,
  joinedAt
})
const withoutFinalEnd = ({
  inflightEnd: _inflightEnd,
  pendingEnd: _pendingEnd,
  settledEnd: _settledEnd,
  ...record
}: PresenceDomainRecord) => record
const retainedLocalLifecycle = (record: PresenceDomainRecord | undefined) => ({
  ...(record?.local ? { local: record.local } : {}),
  ...(record?.inflightEnd ? { inflightEnd: record.inflightEnd } : {}),
  ...(record?.pendingEnd ? { pendingEnd: record.pendingEnd } : {}),
  ...(record?.settledEnd ? { settledEnd: record.settledEnd } : {})
})
const withReleasePhase = (release: PendingRelease, phase: PendingReleasePhase): PendingRelease => ({
  ...release,
  phase
})

const SessionDomain = Remesh.domain({
  name: 'SessionDomain',
  impl: (domain) => {
    const clock = domain.getExtern(ClockExtern)
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
    const PendingReleasesState = domain.state<PendingRelease[]>({
      name: 'Session.PendingReleasesState',
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
      impl: ({ get }, runtimeDomain: string) =>
        get(PendingReleasesState()).some((item) => item.domain === runtimeDomain)
    })
    // Message authority ends as soon as release starts or a durable finalization marker is restored.
    const FinalizingPresenceQuery = domain.query({
      name: 'Session.FinalizingPresenceQuery',
      impl: ({ get }, runtimeDomain: string) => {
        if (get(ReleasingDomainQuery(runtimeDomain))) return true
        const presence = get(PresenceDomainsState()).find((item) => item.domain === runtimeDomain)
        return Boolean(
          presence && !presence.local && (presence.inflightEnd || presence.pendingEnd || presence.settledEnd)
        )
      }
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
    const DomainRetiredEvent = domain.event<{ domain: string }>({ name: 'Session.DomainRetiredEvent' })
    const DomainReleasedEvent = domain.event<string>({ name: 'Session.DomainReleasedEvent' })
    const DomainEndPublishedEvent = domain.event<{ domain: string; roomId?: string; error?: Error }>({
      name: 'Session.DomainEndPublishedEvent'
    })
    const DomainReleaseFailedEvent = domain.event<{ domain: string; error: Error }>({
      name: 'Session.DomainReleaseFailedEvent'
    })
    const PersistPresenceRequestedEvent = domain.event<PresencePersistRequest>({
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
    const ErrorEvent = domain.event<Error>({ name: 'Session.ErrorEvent' })

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

        const presence = get(PresenceDomainsState()).find((item) => item.domain === payload.domain)
        const pendingFinalEnd = presence?.pendingEnd ?? presence?.inflightEnd
        const isFinalizingPresence = !current && !presence?.local && Boolean(pendingFinalEnd)
        const local = current
          ? {
              presenceId: current.presenceId,
              userId: current.user.id,
              joinedAt: current.joinedAt,
              status: 'active' as const
            }
          : (presence?.local ?? (pendingFinalEnd ? { ...pendingFinalEnd, status: 'active' as const } : undefined))
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
          isFinalizingPresence,
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
              presenceId: prepared.runtime.presenceId,
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
        const newSessions = prepared.runtime.sessions
          .filter(
            (session) =>
              !previous?.sessions.some(
                (current) => current.sourcePeerId === session.sourcePeerId && current.sessionId === session.sessionId
              )
          )
          .map(projectRuntimeSession)
        const presenceDomains = get(PresenceDomainsState())
        const priorPresence = presenceDomains.find((item) => item.domain === prepared.runtime.domain)
        const finalizingIdentity = priorPresence?.pendingEnd ??
          priorPresence?.inflightEnd ?? {
            presenceId: prepared.runtime.presenceId,
            userId: prepared.runtime.user.id,
            joinedAt: prepared.runtime.joinedAt
          }
        const presence: PresenceDomainRecord = {
          domain: prepared.runtime.domain,
          lastJoinedAt: Math.max(priorPresence?.lastJoinedAt ?? 0, prepared.runtime.joinedAt),
          ...(prepared.isFinalizingPresence
            ? priorPresence?.pendingEnd
              ? { pendingEnd: finalizingIdentity }
              : { inflightEnd: finalizingIdentity }
            : {
                local: {
                  presenceId: prepared.runtime.presenceId,
                  userId: prepared.runtime.user.id,
                  joinedAt: prepared.runtime.joinedAt,
                  status: 'active' as const
                }
              }),
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
          ...(prepared.isFinalizingPresence
            ? []
            : [
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
                })
              ]),
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
      impl: ({ get }, release: PendingRelease) =>
        get(PendingReleasesState()).some(
          (item) => item.domain === release.domain && item.requestId === release.requestId
        )
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
        const pending = get(PendingReleasesState())
        const existing = pending.find((item) => item.domain === runtimeDomain)
        if (existing) {
          const presence = get(PresenceDomainsState()).find((item) => item.domain === runtimeDomain)
          if (!presence || presence.local) return null
          if (existing.phase === 'settlement-failed') {
            const settling = withReleasePhase(existing, 'settling')
            return [
              PendingReleasesState().new(replaceBy(pending, (item) => item.requestId === existing.requestId, settling)),
              PersistPresenceRequestedEvent({
                record: { ...withoutFinalEnd(presence), settledEnd: finalEndIdentity(settling) },
                transition: { type: 'settle', release: settling }
              })
            ]
          }
          if (existing.phase === 'cleanup-failed') {
            const cleaning = withReleasePhase(existing, 'cleaning')
            return [
              PendingReleasesState().new(replaceBy(pending, (item) => item.requestId === existing.requestId, cleaning)),
              PersistPresenceRequestedEvent({
                record: withoutFinalEnd(presence),
                transition: { type: 'cleanup', release: cleaning }
              })
            ]
          }
          if (existing.phase !== 'pending') return null
          const retainedIdentity = presence.pendingEnd ?? presence.inflightEnd
          if (retainedIdentity?.presenceId !== existing.presenceId) return null
          const retrying = withReleasePhase(existing, 'retrying')
          return [
            PendingReleasesState().new(replaceBy(pending, (item) => item.requestId === existing.requestId, retrying)),
            PersistPresenceRequestedEvent({
              record: { ...withoutFinalEnd(presence), inflightEnd: retainedIdentity },
              transition: { type: 'retry', release: retrying }
            })
          ]
        }
        const runtime = get(DomainsState()).find((item) => item.domain === runtimeDomain)
        const prepared = get(PreparedSessionsState()).find((item) => item.runtime.domain === runtimeDomain)
        const current = runtime ?? prepared?.runtime
        if (!current) return DomainEndPublishedEvent({ domain: runtimeDomain })
        const presenceDomains = get(PresenceDomainsState())
        const presence = presenceDomains.find((item) => item.domain === runtimeDomain)
        const release: PendingRelease = {
          domain: runtimeDomain,
          roomId: current.roomId,
          presenceId: current.presenceId,
          userId: current.user.id,
          joinedAt: current.joinedAt,
          requestId: endRequestId(current.presenceId),
          phase: 'retiring'
        }
        const retired: PresenceDomainRecord = {
          domain: runtimeDomain,
          lastJoinedAt: Math.max(presence?.lastJoinedAt ?? 0, current.joinedAt),
          inflightEnd: finalEndIdentity(release),
          observers: prepared?.observers ?? presence?.observers ?? []
        }
        return [
          PendingReleasesState().new([...pending, release]),
          PersistPresenceRequestedEvent({ record: retired, transition: { type: 'retire', release } })
        ]
      }
    })

    const CompletePresenceRetirementCommand = domain.command({
      name: 'Session.CompletePresenceRetirementCommand',
      impl: ({ get }, request: PresencePersistRequest) => {
        const transition = request.transition
        if (transition?.type !== 'retire') return null
        const pending = get(PendingReleasesState())
        const current = pending.find((item) => item.requestId === transition.release.requestId)
        if (current?.phase !== 'retiring') return null
        const publishing = withReleasePhase(current, 'publishing')
        return [
          PendingReleasesState().new(replaceBy(pending, (item) => item.requestId === current.requestId, publishing)),
          PresenceDomainsState().new(
            replaceBy(get(PresenceDomainsState()), (item) => item.domain === current.domain, request.record)
          ),
          DomainRetiredEvent({ domain: current.domain }),
          PublishPresenceEndCommand(publishing)
        ]
      }
    })

    const FailPresenceRetirementCommand = domain.command({
      name: 'Session.FailPresenceRetirementCommand',
      impl: ({ get }, payload: { release: PendingRelease; error: Error }) => {
        const pending = get(PendingReleasesState())
        if (!pending.some((item) => item.requestId === payload.release.requestId)) return null
        return [
          PendingReleasesState().new(removeBy(pending, (item) => item.requestId === payload.release.requestId)),
          DomainReleaseFailedEvent({ domain: payload.release.domain, error: payload.error }),
          ErrorEvent(payload.error)
        ]
      }
    })

    const CompletePresenceEndCommand = domain.command({
      name: 'Session.CompletePresenceEndCommand',
      impl: ({ get }, requestId: string) => {
        const pending = get(PendingReleasesState())
        const current = pending.find((item) => item.requestId === requestId)
        const presence = get(PresenceDomainsState()).find((item) => item.domain === current?.domain)
        if (current?.phase !== 'publishing' || !presence || presence.local) return null
        const settling = withReleasePhase(current, 'settling')
        return [
          PendingReleasesState().new(replaceBy(pending, (item) => item.requestId === current.requestId, settling)),
          PersistPresenceRequestedEvent({
            record: { ...withoutFinalEnd(presence), settledEnd: finalEndIdentity(settling) },
            transition: { type: 'settle', release: settling }
          })
        ]
      }
    })

    const CompletePresenceTransitionCommand = domain.command({
      name: 'Session.CompletePresenceTransitionCommand',
      impl: ({ get }, request: PresencePersistRequest) => {
        const transition = request.transition
        if (!transition || transition.type === 'retire') return null
        const pending = get(PendingReleasesState())
        const current = pending.find((item) => item.requestId === transition.release.requestId)
        if (!current) return null
        const presenceAction = PresenceDomainsState().new(
          replaceBy(get(PresenceDomainsState()), (item) => item.domain === current.domain, request.record)
        )
        if (transition.type === 'retry') {
          if (current.phase !== 'retrying') return null
          const publishing = withReleasePhase(current, 'publishing')
          return [
            PendingReleasesState().new(replaceBy(pending, (item) => item.requestId === current.requestId, publishing)),
            presenceAction,
            PublishPresenceEndCommand(publishing)
          ]
        }
        if (transition.type === 'failure') {
          if (current.phase !== 'pending') return null
          return [
            presenceAction,
            DomainReleaseFailedEvent({ domain: current.domain, error: transition.error }),
            ErrorEvent(transition.error)
          ]
        }
        if (transition.type === 'settle') {
          if (current.phase !== 'settling') return null
          const cleaning = withReleasePhase(current, 'cleaning')
          return [
            PendingReleasesState().new(replaceBy(pending, (item) => item.requestId === current.requestId, cleaning)),
            presenceAction,
            PersistPresenceRequestedEvent({
              record: withoutFinalEnd(request.record),
              transition: { type: 'cleanup', release: cleaning }
            })
          ]
        }
        if (current.phase !== 'cleaning') return null
        return [presenceAction, DomainEndPublishedEvent({ domain: current.domain, roomId: current.roomId })]
      }
    })

    const FailPresenceTransitionCommand = domain.command({
      name: 'Session.FailPresenceTransitionCommand',
      impl: ({ get }, payload: { transition: PresencePersistTransition; error: Error }) => {
        const pending = get(PendingReleasesState())
        const current = pending.find((item) => item.requestId === payload.transition.release.requestId)
        if (!current) return null
        if (payload.transition.type === 'retry' && current.phase === 'retrying') {
          return [
            PendingReleasesState().new(
              replaceBy(pending, (item) => item.requestId === current.requestId, withReleasePhase(current, 'pending'))
            ),
            DomainReleaseFailedEvent({ domain: current.domain, error: payload.error }),
            ErrorEvent(payload.error)
          ]
        }
        if (payload.transition.type === 'settle' && current.phase === 'settling') {
          return [
            PendingReleasesState().new(
              replaceBy(
                pending,
                (item) => item.requestId === current.requestId,
                withReleasePhase(current, 'settlement-failed')
              )
            ),
            DomainReleaseFailedEvent({ domain: current.domain, error: payload.error }),
            ErrorEvent(payload.error)
          ]
        }
        if (payload.transition.type === 'cleanup' && current.phase === 'cleaning') {
          return [
            PendingReleasesState().new(
              replaceBy(
                pending,
                (item) => item.requestId === current.requestId,
                withReleasePhase(current, 'cleanup-failed')
              )
            ),
            DomainReleaseFailedEvent({ domain: current.domain, error: payload.error }),
            ErrorEvent(payload.error)
          ]
        }
        const error = payload.transition.type === 'failure' ? payload.transition.error : payload.error
        return [DomainReleaseFailedEvent({ domain: current.domain, error }), ErrorEvent(error)]
      }
    })

    const FailPresenceEndCommand = domain.command({
      name: 'Session.FailPresenceEndCommand',
      impl: ({ get }, payload: { requestId: string; error: Error }) => {
        const pending = get(PendingReleasesState())
        const current = pending.find((item) => item.requestId === payload.requestId)
        const presence = get(PresenceDomainsState()).find((item) => item.domain === current?.domain)
        if (current?.phase !== 'publishing' || !presence || presence.local) return null
        const failed = withReleasePhase(current, 'pending')
        const record: PresenceDomainRecord = {
          ...withoutFinalEnd(presence),
          pendingEnd: finalEndIdentity(current)
        }
        return [
          PendingReleasesState().new(replaceBy(pending, (item) => item.requestId === current.requestId, failed)),
          PersistPresenceRequestedEvent({
            record,
            transition: { type: 'failure', release: failed, error: payload.error }
          })
        ]
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
          PendingReleasesState().new(removeBy(get(PendingReleasesState()), (item) => item.domain === runtimeDomain)),
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
        if (get(FinalizingPresenceQuery(payload.domain))) {
          return OperationFailedEvent({
            operationId: payload.operationId,
            error: new Error('Runtime presence is completing its final release')
          })
        }
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
        if (!runtime || get(ReleasingDomainQuery(runtime.domain))) return null

        const current = runtime.sessions.find((item) => item.sourcePeerId === payload.sourcePeerId)
        const presenceDomains = get(PresenceDomainsState())
        const persisted = presenceDomains.find((item) => item.domain === runtime.domain)
        const observers = prepared?.observers ?? persisted?.observers ?? []
        const observed = observers.find((item) => item.presenceId === message.presenceId)
        if (
          observed?.status === 'ended' ||
          (observed && observed.user.id !== message.user.id) ||
          (current?.sessionId === message.sessionId &&
            (current.presenceId !== message.presenceId || current.user.id !== message.user.id))
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
          joinedAt: observed?.joinedAt ?? clock.now()
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
          sessions: replaceBy(runtime.sessions, (item) => item.sourcePeerId === payload.sourcePeerId, session)
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
        const physicalBindingChanged =
          current?.sessionId !== message.sessionId || current?.presenceId !== message.presenceId
        const sessionSnapshot = snapshot(nextRuntime)
        const publicSession = projectRuntimeSession(session)
        // Preparation peers and known generations are membership convergence; only logical zero-to-one is a live join.
        const sessionEvent: RuntimeSessionEvent =
          isBaselinePeer || wasLogicallyActive || (current?.user.id === message.user.id && Boolean(current))
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
              return request.transition?.type === 'retire'
                ? CompletePresenceRetirementCommand(request)
                : CompletePresenceTransitionCommand(request)
            } catch (error) {
              if (!request.transition) return ErrorEvent(error as Error)
              return request.transition.type === 'retire'
                ? FailPresenceRetirementCommand({ release: request.transition.release, error: error as Error })
                : FailPresenceTransitionCommand({ transition: request.transition, error: error as Error })
            }
          })
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
        DomainRetiredEvent,
        DomainReleasedEvent,
        DomainEndPublishedEvent,
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
