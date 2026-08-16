import { Remesh } from 'remesh'
import { concatMap, filter, map, mergeMap, Observable } from 'rxjs'
import DeliveryDomain from '@/domain/runtime/Delivery'
import WireDomain, { selectPeerIds, type WireFailureStage, type WireMessageEvent } from '@/domain/runtime/Wire'
import { ClockExtern } from '@/domain/runtime/externs/Clock'
import { RoomTransportExtern } from '@/domain/runtime/externs/RoomTransport'
import { IdentityExtern } from '@/domain/runtime/externs/Identity'
import {
  MAX_PRESENCE_OBSERVATIONS,
  PresenceStoreExtern,
  type ObservedPresence,
  type PresenceDomainRecord
} from '@/domain/runtime/externs/PresenceStore'
import { CHAT_ROOM_NAMESPACE_V5, PENDING_LEAVE_GRACE_MS } from '@/constants/config'
import {
  ChatMessageSchema,
  MESSAGE_TYPE,
  type ChatMessage,
  type HLC,
  type MentionedUser,
  type ChatSite,
  type ChatUser
} from '@/protocol'
import * as v from 'valibot'
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
  /** (presenceId, sourcePeerId) rebinds whose pending-leave deadlines this attempt may cancel on commit. */
  reboundBindings: Array<{ presenceId: string; sourcePeerId: string }>
  /** Unprotected same-source bindings this attempt displaced (rollback/supersession transfers none). */
  displacedBindings: SessionBinding[]
  publishRequestId?: string
  missedPeerIds: string[]
  baselinePeerIds: string[]
}

interface PendingBaselinePeers {
  domain: string
  sourcePeerIds: string[]
}

/** One observer-side pending-leave deadline per remote presence (idempotent duplicates). */
interface PendingLeave {
  domain: string
  presenceId: string
  /** The departed physical source whose session entry stays visible throughout the grace. */
  sourcePeerId: string
  sessionId: string
  user: ChatUser
  joinedAt: number
  /** Distinguishes this armed deadline instance so stale timers are fenced after a rebind. */
  armedId: string
  /** Release-fenced: expiry effects are suspended but the record still closes authority. */
  fenced: boolean
  /** Absolute expiry (Date.now() based): restoration resumes only the unelapsed remainder. */
  expiresAt: number
}

interface PendingChatSend {
  operationId: string
  requestId: string
  domain: string
  roomId: string
  message: ChatMessage
  /** Frozen distinct per-target send requests still awaiting their single provider call. */
}

interface LiveRelease {
  domain: string
  roomId: string
  /**
   * Phase of the awaited active-record cleanup write. A late release request attaches without
   * emitting cleanup while a write is `pending`, retries only an observed `failed` write, and
   * never replays a `settled` one (its remaining World step is owned by the live release).
   */
  cleanup: 'pending' | 'failed' | 'settled'
}

export interface SessionOperationSucceeded {
  operationId: string
}

/** Typed allocation-success payloads: the exact record variant is the boundary contract. */
export interface TextMessageAllocatedEventPayload {
  operationId: string
  record: TextMessageRecord
}

export interface ReactionMessageAllocatedEventPayload {
  operationId: string
  record: ReactionMessageRecord
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

const getChatRoomId = (domain: string): string => stringToHex(`${CHAT_ROOM_NAMESPACE_V5}:${domain}`)
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

export const allocateHlc = (current: HLC, now: number): HLC => {
  if (now > current.timestamp) return { timestamp: now, counter: 0 }
  const counter = current.counter + 1
  if (!Number.isSafeInteger(counter)) throw new Error('Runtime HLC counter exhausted')
  return { timestamp: current.timestamp, counter }
}

export const adoptHlc = (current: HLC, remote: HLC): HLC | null => {
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

/** The source's CURRENT binding: the first entry not retained by a pending-leave record. */
const currentBindingForSource = (
  runtime: SessionDomainState,
  sourcePeerId: string,
  pendingLeaves: PendingLeave[]
): SessionBinding | undefined =>
  runtime.sessions.find(
    (item) =>
      item.sourcePeerId === sourcePeerId &&
      !pendingLeaves.some(
        (leave) =>
          leave.domain === runtime.domain &&
          leave.sourcePeerId === item.sourcePeerId &&
          leave.presenceId === item.presenceId
      )
  )

const projectRuntimeSession = ({ presenceId: _presenceId, ...session }: SessionBinding): RuntimeSession => session
const snapshot = (runtime: SessionDomainState): RuntimeSessionSnapshot => ({
  localSession: { sessionId: runtime.sessionId, user: runtime.user, joinedAt: runtime.joinedAt },
  sessions: runtime.sessions.map(projectRuntimeSession)
})

const makeRecord = (message: ChatMessage, user: ChatUser, receivedAt: number): ChatMessageRecord => ({
  type: MESSAGE_RECORD_TYPE.CHAT_MESSAGE,
  id: message.id,
  message,
  user,
  receivedAt
})

const initialRequestId = (attemptId: string) => `session:initial:${attemptId}`
const catchUpRequestId = (attemptId: string, sourcePeerId: string) => `session:catch-up:${attemptId}:${sourcePeerId}`
const chatRequestId = (operationId: string) => `session:chat:${operationId}`
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
const retainedLocalLifecycle = (record: PresenceDomainRecord | undefined) =>
  record?.local ? { local: record.local } : {}

const SessionDomain = Remesh.domain({
  name: 'SessionDomain',
  impl: (domain) => {
    const clock = domain.getExtern(ClockExtern)
    domain.getExtern(RoomTransportExtern)
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
    const PendingLeavesState = domain.state<PendingLeave[]>({
      name: 'Session.PendingLeavesState',
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
    // True after a manual-refresh reset: the committed aggregate is gone but the active local
    // logical seed was retained, authorizing the canonical replacement attempt.
    const RetainedLocalSeedQuery = domain.query({
      name: 'Session.RetainedLocalSeedQuery',
      impl: ({ get }, runtimeDomain: string) =>
        get(PresenceDomainsState()).some((item) => item.domain === runtimeDomain && item.local !== undefined)
    })
    const ReleaseRoomQuery = domain.query({
      name: 'Session.ReleaseRoomQuery',
      impl: ({ get }, runtimeDomain: string) =>
        get(LiveReleasesState()).find((item) => item.domain === runtimeDomain)?.roomId ?? null
    })
    // Message authority ends as soon as release starts or a durable finalization marker is restored.
    const FinalizingPresenceQuery = domain.query({
      name: 'Session.FinalizingPresenceQuery',
      impl: ({ get }, runtimeDomain: string) => get(ReleasingDomainQuery(runtimeDomain))
    })
    const RoomDomainQuery = domain.query({
      name: 'Session.RoomDomainQuery',
      impl: ({ get }, roomId: string) => {
        // The exact room→domain authority stays valid through committed membership, a prepared
        // attempt, and live-release teardown until the physical cleanup settles; a provider error
        // must never fall back to global delivery merely because committed state is absent.
        const committed = get(DomainsState()).find((item) => item.roomId === roomId)?.domain
        if (committed) return committed
        const prepared = get(PreparedSessionsState()).find((item) => item.runtime.roomId === roomId)?.runtime.domain
        if (prepared) return prepared
        return get(LiveReleasesState()).find((item) => item.roomId === roomId)?.domain ?? null
      }
    })
    const BindingQuery = domain.query({
      name: 'Session.BindingQuery',
      impl: ({ get }, payload: { roomId: string; sourcePeerId: string }) => {
        const runtime = get(DomainsState()).find((item) => item.roomId === payload.roomId)
        if (!runtime) return null
        // A source may carry a current presence plus a grace-preserved one: the current binding
        // is the entry NOT retained by a pending-leave record (a grace-only source is not
        // current physical authority; a fresh presence on the same source stays trusted).
        const pendingLeaves = get(PendingLeavesState())
        const session = runtime.sessions.find(
          (item) =>
            item.sourcePeerId === payload.sourcePeerId &&
            !pendingLeaves.some(
              (leave) =>
                leave.domain === runtime.domain &&
                leave.sourcePeerId === item.sourcePeerId &&
                leave.presenceId === item.presenceId
            )
        )
        return session ? { domain: runtime.domain, runtime, session } : null
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
    const PersistPresenceRequestedEvent = domain.event<{ record: PresenceDomainRecord; requestId?: string }>({
      name: 'Session.PersistPresenceRequestedEvent'
    })
    // Correlated settlement for a manual-refresh reset: the replacement may only start after the
    // cleared-observer record persisted; a rejection fails the reconnect request retryably.
    const PresencePersistenceSettledEvent = domain.event<{ requestId: string; error?: Error }>({
      name: 'Session.PresencePersistenceSettledEvent'
    })
    const ClearActivePresenceRequestedEvent = domain.event<{ domain: string }>({
      name: 'Session.ClearActivePresenceRequestedEvent'
    })
    const PendingLeaveArmedEvent = domain.event<{
      domain: string
      presenceId: string
      armedId: string
      delayMs: number
    }>({
      name: 'Session.PendingLeaveArmedEvent'
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
    // Typed allocation successes: the record variant is exact, so the Session-to-Server path
    // needs no value assertion below the public contract.
    const TextMessageAllocatedEvent = domain.event<TextMessageAllocatedEventPayload>({
      name: 'Session.TextMessageAllocatedEvent'
    })
    const ReactionMessageAllocatedEvent = domain.event<ReactionMessageAllocatedEventPayload>({
      name: 'Session.ReactionMessageAllocatedEvent'
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
        // A manual-refresh reset removed the committed aggregate but retained the active local
        // logical seed; that retained seed authorizes the reconnect preparation.
        const retainedLocalSeed = get(PresenceDomainsState()).some(
          (item) => item.domain === payload.domain && item.local
        )
        if (payload.mode !== 'join' && !current && !retainedLocalSeed) {
          return PreparationFailedEvent({ attemptId: payload.attemptId, error: new Error('Runtime domain missing') })
        }

        let user: ChatUser
        let site: ChatSite
        if (payload.mode === 'join') {
          site = payload.site!
          user = payload.user!
          // Local identity authorization: the joined site must belong to the domain. Protocol
          // shape is not validated here (local production trusts its typed inputs).
          if (site.origin !== payload.domain) {
            return PreparationFailedEvent({
              attemptId: payload.attemptId,
              error: new Error('Invalid local identity or site metadata')
            })
          }
        } else {
          // A manual-refresh reset removed the committed aggregate: the replacement reuses the
          // captured local logical identity carried by the attempt instead of the retired runtime.
          user = current?.user ?? payload.user!
          site = current?.site ?? payload.site!
          if (!current && site.origin !== payload.domain) {
            return PreparationFailedEvent({
              attemptId: payload.attemptId,
              error: new Error('Invalid local identity or site metadata')
            })
          }
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
          reboundBindings: priorPrepared?.reboundBindings ?? [],
          displacedBindings: priorPrepared?.displacedBindings ?? [],
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
        const targetPeerIds = selectPeerIds(
          prepared.runtime.sessions.map((session) => session.sourcePeerId),
          get(wireDomain.query.PeerIdQuery(prepared.runtime.roomId))
        )
        const message = {
          type: MESSAGE_TYPE.SESSION,
          sessionId: prepared.runtime.sessionId,
          presenceId: prepared.runtime.presenceId,
          joinedAt: prepared.runtime.joinedAt,
          user: prepared.runtime.user
        } as const
        if (targetPeerIds.length === 0) return PreparedPublishedEvent({ attemptId })
        const pending = {
          ...prepared,
          publishRequestId: requestId
        }
        return [
          PreparedSessionsState().new(
            replaceBy(get(PreparedSessionsState()), (item) => item.attemptId === attemptId, pending)
          ),
          wireDomain.command.SendMessageCommand({
            requestId,
            roomId: prepared.runtime.roomId,
            targetPeerIds,
            message
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
      impl: ({ get }, payload: { requestId: string; error: Error; stage?: WireFailureStage }) => {
        const prepared = get(PreparedSessionsState()).find((item) => item.publishRequestId === payload.requestId)
        if (!prepared) return null
        // Owner loss (leave/supersede invalidates the queue) cancels the publish quietly.
        if (payload.stage === 'cancelled') return null
        // A preflight failure performed zero provider sends and fails the attempt.
        if (payload.stage === 'preflight') {
          return PreparedPublishFailedEvent({ attemptId: prepared.attemptId, error: payload.error })
        }
        // A genuine broadcast failure is surfaced once; the publication is complete.
        return [
          ErrorEvent({ error: payload.error, domain: prepared.runtime.domain }),
          PreparedPublishedEvent({ attemptId: prepared.attemptId })
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
        // Atomic commit: promote the attempt's runtime and cancel ONLY the pending-leave
        // deadlines this attempt actually rebound and still holds current sources for. Prior
        // committed sessions are retained only when a current pending-leave record preserves
        // that logical generation and the attempt has no session for the same presence (a
        // different presence on the same source is NOT a reason to erase the graced generation).
        const pendingLeaves = get(PendingLeavesState())
        // One final transition per logical user: displaced bindings whose user keeps no other
        // active or grace-preserved observation collapse to a single per-user fact.
        const commitDisplacedLeaves = [
          ...new Map(
            prepared.displacedBindings
              .filter(
                (displaced) =>
                  !prepared.observers.some(
                    (observation) =>
                      observation.status === 'active' &&
                      observation.user.id === displaced.user.id &&
                      observation.presenceId !== displaced.presenceId
                  )
              )
              .map((displaced) => [displaced.user.id, displaced])
          ).values()
        ]
        const promotedRuntime: SessionDomainState = {
          ...prepared.runtime,
          sessions: [
            ...prepared.runtime.sessions,
            ...(previous?.sessions ?? []).filter(
              (current) =>
                pendingLeaves.some(
                  (leave) => leave.domain === prepared.runtime.domain && leave.presenceId === current.presenceId
                ) && !prepared.runtime.sessions.some((session) => session.presenceId === current.presenceId)
            )
          ]
        }
        return [
          DomainsState().new(replaceBy(domains, (item) => item.domain === prepared.runtime.domain, promotedRuntime)),
          PreparedSessionsState().new(removeBy(get(PreparedSessionsState()), (item) => item.attemptId === attemptId)),
          PendingLeavesState().new(
            pendingLeaves.filter(
              (item) =>
                !(
                  item.domain === prepared.runtime.domain &&
                  prepared.reboundBindings.some(
                    (rebind) =>
                      rebind.presenceId === item.presenceId &&
                      prepared.runtime.sessions.some(
                        (session) =>
                          session.sourcePeerId === rebind.sourcePeerId && session.presenceId === item.presenceId
                      )
                  )
                )
            )
          ),
          PendingBaselinePeersState().new(nextBaselines),
          PresenceDomainsState().new(
            replaceBy(presenceDomains, (item) => item.domain === prepared.runtime.domain, presence)
          ),
          PersistPresenceRequestedEvent({ record: presence }),
          RuntimeSessionChangedEvent({
            type: 'snapshot',
            domain: prepared.runtime.domain,
            snapshot: snapshot(promotedRuntime),
            // Only a newly allocated logical presence owns a local self-notice.
            provenance: prepared.isNewPresence
              ? 'join'
              : prepared.mode === 'reconnect'
                ? 'reconnect'
                : prepared.mode === 'recover'
                  ? 'recovery'
                  : 'refresh'
          }),
          ...(commitDisplacedLeaves.length > 0 && laterJoins.length > 0
            ? [
                RuntimeSessionChangedEvent({
                  type: 'replace',
                  domain: prepared.runtime.domain,
                  snapshot: snapshot(promotedRuntime),
                  previous: projectRuntimeSession(commitDisplacedLeaves[0]),
                  session: projectRuntimeSession(laterJoins[0]),
                  occurredAt: clock.now(),
                  provenance: 'live'
                }),
                ...commitDisplacedLeaves.slice(1).map((displaced) =>
                  RuntimeSessionChangedEvent({
                    type: 'leave',
                    domain: prepared.runtime.domain,
                    snapshot: snapshot(promotedRuntime),
                    session: projectRuntimeSession(displaced),
                    occurredAt: clock.now(),
                    provenance: 'live'
                  })
                ),
                ...laterJoins.slice(1).map((session) =>
                  RuntimeSessionChangedEvent({
                    type: 'join',
                    domain: prepared.runtime.domain,
                    snapshot: snapshot(promotedRuntime),
                    session: projectRuntimeSession(session),
                    provenance: 'live'
                  })
                )
              ]
            : [
                ...commitDisplacedLeaves.map((displaced) =>
                  RuntimeSessionChangedEvent({
                    type: 'leave',
                    domain: prepared.runtime.domain,
                    snapshot: snapshot(promotedRuntime),
                    session: projectRuntimeSession(displaced),
                    occurredAt: clock.now(),
                    provenance: 'live'
                  })
                ),
                ...laterJoins.map((session) =>
                  RuntimeSessionChangedEvent({
                    type: 'join',
                    domain: prepared.runtime.domain,
                    snapshot: snapshot(promotedRuntime),
                    session: projectRuntimeSession(session),
                    provenance: 'live'
                  })
                )
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

    // Retirement keeps one live in-memory release owner: awaited local cleanup (no Chat end
    // value) -> contribution remove (world.ReleaseDomain publishes latest Presence via the sole
    // iterator) -> Connection settles close. No durable owner/outcome/journal; on host
    // replacement the next current event reconciles. The cleanup write is request-correlated:
    // only a successful removal of the local active-generation record may release Session State
    // and advance World/Chat departure; failure retains the fence and physical membership.
    const BeginReleaseDomainCommand = domain.command({
      name: 'Session.BeginReleaseDomainCommand',
      impl: ({ get }, runtimeDomain: string) => {
        const existing = get(LiveReleasesState()).find((item) => item.domain === runtimeDomain)
        if (existing) {
          // A cleanup write is already pending or has already settled for this live release: the
          // current owner drives the remaining phases, so a late request attaches without
          // emitting another cleanup write or re-publishing the Chat departure.
          if (existing.cleanup !== 'failed') return null
          // Only an observed failed cleanup is retried: re-fence the observer deadlines, mark the
          // phase pending again, and re-issue exactly one cleanup write.
          return [
            LiveReleasesState().new(
              replaceBy(get(LiveReleasesState()), (item) => item.domain === runtimeDomain, {
                ...existing,
                cleanup: 'pending' as const
              })
            ),
            PendingLeavesState().new(
              get(PendingLeavesState()).map((item) =>
                item.domain === runtimeDomain ? { ...item, fenced: true } : item
              )
            ),
            ClearActivePresenceRequestedEvent({ domain: runtimeDomain })
          ]
        }
        const runtime = get(DomainsState()).find((item) => item.domain === runtimeDomain)
        const prepared = get(PreparedSessionsState()).find((item) => item.runtime.domain === runtimeDomain)
        const current = runtime ?? prepared?.runtime
        if (!current) return ReleaseCompletedEvent({ domain: runtimeDomain })
        const release: LiveRelease = { domain: runtimeDomain, roomId: current.roomId, cleanup: 'pending' }
        // Fence every domain-owned observer deadline BEFORE the awaited cleanup write: a grace
        // expiry can never queue a stale pre-release record behind the cleanup, while the fenced
        // records still close live/History authority until the release resolves.
        return [
          LiveReleasesState().new([...get(LiveReleasesState()), release]),
          PendingLeavesState().new(
            get(PendingLeavesState()).map((item) => (item.domain === runtimeDomain ? { ...item, fenced: true } : item))
          ),
          ClearActivePresenceRequestedEvent({ domain: runtimeDomain })
        ]
      }
    })

    const FailReleaseCleanupCommand = domain.command({
      name: 'Session.FailReleaseCleanupCommand',
      impl: ({ get }, payload: { domain: string; error: Error }) => {
        const release = get(LiveReleasesState()).find((item) => item.domain === payload.domain)
        // Only the pending phase's own failure marks the phase and surfaces the exact error; a
        // stale failure from a superseded write must not fail an already-advanced release.
        if (!release || release.cleanup !== 'pending') return null
        return [
          LiveReleasesState().new(
            replaceBy(get(LiveReleasesState()), (item) => item.domain === payload.domain, {
              ...release,
              cleanup: 'failed' as const
            })
          ),
          DomainReleaseFailedEvent({ domain: payload.domain, error: payload.error }),
          RestorePendingLeavesCommand(payload.domain)
        ]
      }
    })

    const RestorePendingLeavesCommand = domain.command({
      name: 'Session.RestorePendingLeavesCommand',
      impl: ({ get }, runtimeDomain: string) => {
        const pending = get(PendingLeavesState())
        const affected = pending.filter((item) => item.domain === runtimeDomain && item.fenced)
        if (affected.length === 0) return null
        // Resume only the unelapsed remainder of the ORIGINAL absolute deadline: cleanup failure
        // is neither a new PeerLeave nor a valid rebind and must not extend remote lifecycle time.
        const now = Date.now()
        const restored = affected.map((item) => ({
          ...item,
          fenced: false,
          armedId: identity.nextId(),
          delayMs: Math.max(0, item.expiresAt - now)
        }))
        return [
          PendingLeavesState().new([
            ...pending.filter((item) => !(item.domain === runtimeDomain && item.fenced)),
            ...restored.map(({ delayMs: _delayMs, ...record }) => record)
          ]),
          ...restored.map((item) =>
            PendingLeaveArmedEvent({
              domain: item.domain,
              presenceId: item.presenceId,
              armedId: item.armedId,
              delayMs: item.delayMs
            })
          )
        ]
      }
    })

    const CompleteReleaseCleanupCommand = domain.command({
      name: 'Session.CompleteReleaseCleanupCommand',
      impl: ({ get }, runtimeDomain: string) => {
        const release = get(LiveReleasesState()).find((item) => item.domain === runtimeDomain)
        if (!release) return null
        // A duplicate in-flight cleanup write may settle after the first one advanced the release;
        // only the pending phase's completion removes State and publishes the Chat departure.
        if (release.cleanup !== 'pending') return null
        // Only the fenced release owner advances: remove every domain-owned State (including any
        // observer pending-leave deadlines) and emit the event that advances World/Chat departure.
        return [
          LiveReleasesState().new(
            replaceBy(get(LiveReleasesState()), (item) => item.domain === runtimeDomain, {
              ...release,
              cleanup: 'settled' as const
            })
          ),
          DomainsState().new(removeBy(get(DomainsState()), (item) => item.domain === runtimeDomain)),
          PreparedSessionsState().new(
            removeBy(get(PreparedSessionsState()), (item) => item.runtime.domain === runtimeDomain)
          ),
          PresenceDomainsState().new(removeBy(get(PresenceDomainsState()), (item) => item.domain === runtimeDomain)),
          PendingLeavesState().new(removeBy(get(PendingLeavesState()), (item) => item.domain === runtimeDomain)),
          PendingBaselinePeersState().new(
            removeBy(get(PendingBaselinePeersState()), (item) => item.domain === runtimeDomain)
          ),
          ChatLeavePublishedEvent({ domain: runtimeDomain })
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
          PendingLeavesState().new(removeBy(get(PendingLeavesState()), (item) => item.domain === runtimeDomain)),
          LiveReleasesState().new(removeBy(get(LiveReleasesState()), (item) => item.domain === runtimeDomain)),
          DomainReleasedEvent(runtimeDomain)
        ]
      }
    })

    // Manual refresh destruction: remove the domain's complete Session connection aggregate while
    // retaining only the active local logical seed. No remote observer, member, pending-leave, or
    // baseline fact may seed the replacement; the canonical join rebuilds them from the wire. The
    // cleared-observer record persistence is correlated to the reconnect operation.
    const ResetDomainConnectionCommand = domain.command({
      name: 'Session.ResetDomainConnectionCommand',
      impl: ({ get }, payload: { domain: string; requestId: string }) => {
        const { domain: runtimeDomain, requestId } = payload
        const presenceDomains = get(PresenceDomainsState())
        const persisted = presenceDomains.find((item) => item.domain === runtimeDomain)
        const record: PresenceDomainRecord = persisted
          ? { ...persisted, observers: [] }
          : { domain: runtimeDomain, lastJoinedAt: 0, observers: [] }
        return [
          DomainsState().new(removeBy(get(DomainsState()), (item) => item.domain === runtimeDomain)),
          PreparedSessionsState().new(
            removeBy(get(PreparedSessionsState()), (item) => item.runtime.domain === runtimeDomain)
          ),
          PresenceDomainsState().new(replaceBy(presenceDomains, (item) => item.domain === runtimeDomain, record)),
          PendingLeavesState().new(removeBy(get(PendingLeavesState()), (item) => item.domain === runtimeDomain)),
          PendingBaselinePeersState().new(
            removeBy(get(PendingBaselinePeersState()), (item) => item.domain === runtimeDomain)
          ),
          PersistPresenceRequestedEvent({ record, requestId })
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
          mentions: payload.mentions
        }
        const record: TextMessageRecord = {
          type: MESSAGE_RECORD_TYPE.CHAT_MESSAGE,
          id: candidate.id,
          message: candidate,
          user: runtime.user,
          receivedAt: clock.now()
        }
        return [HlcState().new(hlc), TextMessageAllocatedEvent({ operationId: payload.operationId, record })]
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
        return [HlcState().new(hlc), ReactionMessageAllocatedEvent({ operationId: payload.operationId, record })]
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
        if (!runtime) {
          return OperationFailedEvent({
            operationId: payload.operationId,
            error: new Error('Runtime is not ready for this site')
          })
        }
        // The Chat delivery boundary: a locally authored ChatMessage is parsed once through the
        // same static ChatMessageSchema before local persistence and peer codec encoding/send;
        // failure performs neither side effect. The schema owns the type discriminant; no
        // pre-Schema allow-list or second validation branch exists here.
        const parsed = v.safeParse(ChatMessageSchema, event)
        if (!parsed.success) {
          return OperationFailedEvent({
            operationId: payload.operationId,
            error: new Error('Invalid message.')
          })
        }
        const adopted = adoptHlc(get(HlcState()), event.hlc)
        if (event.userId !== runtime.user.id || !adopted) {
          return OperationFailedEvent({
            operationId: payload.operationId,
            error: new Error('Chat message does not match the active local session')
          })
        }
        const requestId = chatRequestId(payload.operationId)
        const targetPeerIds = selectPeerIds(
          runtime.sessions.map((session) => session.sourcePeerId),
          get(wireDomain.query.PeerIdQuery(runtime.roomId))
        )
        if (targetPeerIds.length === 0) {
          return [HlcState().new(adopted), OperationSucceededEvent({ operationId: payload.operationId })]
        }
        const pending: PendingChatSend = {
          operationId: payload.operationId,
          requestId,
          domain: payload.domain,
          roomId: runtime.roomId,
          message: event
        }
        return [
          HlcState().new(adopted),
          PendingChatSendsState().new([
            ...get(PendingChatSendsState()).filter((item) => item.operationId !== payload.operationId),
            pending
          ]),
          wireDomain.command.SendMessageCommand({
            requestId,
            roomId: runtime.roomId,
            targetPeerIds,
            message: event
          })
        ]
      }
    })

    const CompleteChatSendCommand = domain.command({
      name: 'Session.CompleteChatSendCommand',
      impl: ({ get }, requestId: string) => {
        const state = get(PendingChatSendsState())
        const pending = state.find((item) => item.requestId === requestId)
        if (!pending) return null
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
        const pending = state.find((item) => item.requestId === payload.requestId)
        if (!pending) return null
        const clear = [PendingChatSendsState().new(removeBy(state, (item) => item.operationId === pending.operationId))]
        // Owner loss cancels the send quietly.
        if (payload.stage === 'cancelled') return clear
        const failure = ErrorEvent({ error: payload.error, domain: pending.domain })
        return [...clear, failure, OperationFailedEvent({ operationId: pending.operationId, error: payload.error })]
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

        // A source may legally carry a current presence plus a different grace-preserved one:
        // the current binding slot is keyed by (source, presence), never by the bare source.
        const current = runtime.sessions.find(
          (item) => item.sourcePeerId === payload.sourcePeerId && item.presenceId === message.presenceId
        )
        const pendingLeaves = get(PendingLeavesState())
        const presenceDomains = get(PresenceDomainsState())
        const persisted = presenceDomains.find((item) => item.domain === runtime.domain)
        const observers = prepared?.observers ?? persisted?.observers ?? []
        const observed = observers.find((item) => item.presenceId === message.presenceId)
        if (observed?.status === 'ended') {
          // The wire acceptance already limited this frame to the current trusted Chat room
          // generation. A lawful same-presence correction additionally requires the source to be a
          // CURRENTLY ADMITTED physical member of the room: a source that left (PeerLeave) without
          // a fresh PeerJoin may not re-activate an ended presence with a sender-chosen new
          // sessionId. It is accepted only with a NEW physical sessionId that exactly matches the
          // observer's accepted logical identity and time and conflicts with no newer active
          // binding or logical generation; an exact replay, an identity/time mutation, or a newer
          // conflict stays terminally rejected.
          const exactReplay = message.sessionId === observed.sessionId
          const identityMatch = message.user.id === observed.user.id && message.joinedAt === observed.joinedAt
          const admitted = get(
            wireDomain.query.IsSourceAdmittedQuery({ roomId: payload.roomId, sourcePeerId: payload.sourcePeerId })
          )
          const newerConflict =
            runtime.sessions.some((item) => item.user.id === message.user.id && item.joinedAt > message.joinedAt) ||
            observers.some(
              (observer) =>
                observer.status === 'active' &&
                observer.user.id === message.user.id &&
                observer.presenceId !== message.presenceId &&
                observer.joinedAt > message.joinedAt
            )
          if (exactReplay || !identityMatch || !admitted || newerConflict) {
            return wireDomain.command.DropProtocolCommand({
              sourcePeerId: payload.sourcePeerId,
              reason: 'session does not match its logical presence binding'
            })
          }
          // Legal correction: fall through so the binding/observer/leave flow below re-activates
          // the same logical observation without allocating a new logical generation.
        } else if (
          (observed && (observed.user.id !== message.user.id || observed.joinedAt !== message.joinedAt)) ||
          (current?.sessionId === message.sessionId &&
            (current.user.id !== message.user.id || current.joinedAt !== message.joinedAt))
        ) {
          return wireDomain.command.DropProtocolCommand({
            sourcePeerId: payload.sourcePeerId,
            reason: 'session does not match its logical presence binding'
          })
        }

        // The displaced source-current: the source's previous NON-pending binding that is not
        // the incoming generation. It is replaced by the new SESSION: its observation is marked
        // ended (so no phantom active presence suppresses the final leave) and it becomes the
        // `previous` side of a replacement lifecycle. A pending-protected generation is never
        // displaced by this rule.
        const displaced = runtime.sessions.find(
          (item) =>
            item.sourcePeerId === payload.sourcePeerId &&
            item.presenceId !== message.presenceId &&
            !pendingLeaves.some((leave) => leave.domain === runtime.domain && leave.presenceId === item.presenceId)
        )
        let nextObservers = observers
        if (displaced) {
          const previous = nextObservers.find((item) => item.presenceId === displaced.presenceId)
          if (previous) {
            // The ended marker carries the SUPERSEDED binding's physical sessionId so an exact
            // replay of the displaced generation is recognized and rejected, while a genuinely
            // new physical sessionId for the same logical presence remains correctable.
            nextObservers = replaceObservation(nextObservers, {
              ...previous,
              sessionId: displaced.sessionId,
              status: 'ended'
            })
          }
        }
        const displacedBinding = displaced ?? undefined
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
        // A valid SESSION for a presence under a pending-leave deadline cancels the grace and
        // removes the departed source's retained entry (the fresh source entry replaces it).
        const pendingLeave = pendingLeaves.find(
          (item) => item.domain === runtime.domain && item.presenceId === message.presenceId
        )
        // A source may legally carry a current presence plus a different grace-preserved one.
        // In a prepared attempt the source owns one NON-pending current slot (the latest SESSION
        // replaces it, while pending-preserved generations stay); in the committed runtime the
        // exact (source, presence) slot is replaced. Any OTHER same-source generation is retained
        // only when a pending-leave record preserves it, so a repeated SESSION never duplicates
        // a binding and an unprotected historical presence keeps no live/History authority.
        const replaceKey = (item: SessionBinding) =>
          item.sourcePeerId === payload.sourcePeerId && item.presenceId === message.presenceId
        const nextRuntime = {
          ...runtime,
          sessions: replaceBy(
            runtime.sessions
              .map((item) => (item.presenceId === message.presenceId ? { ...item, user: message.user } : item))
              .filter((item) => {
                if (!(item.sourcePeerId === payload.sourcePeerId && item.presenceId !== message.presenceId)) {
                  return true
                }
                return pendingLeaves.some(
                  (leave) => leave.domain === runtime.domain && leave.presenceId === item.presenceId
                )
              })
              .filter(
                (item) =>
                  !(
                    pendingLeave &&
                    item.presenceId === message.presenceId &&
                    item.sourcePeerId === pendingLeave.sourcePeerId
                  )
              ),
            replaceKey,
            session
          )
        }
        if (prepared) {
          const displacedBindings = displacedBinding
            ? prepared.displacedBindings.some(
                (item) =>
                  item.presenceId === displacedBinding.presenceId && item.sourcePeerId === displacedBinding.sourcePeerId
              )
              ? prepared.displacedBindings
              : [...prepared.displacedBindings, displacedBinding]
            : prepared.displacedBindings
          const binding = { presenceId: message.presenceId, sourcePeerId: payload.sourcePeerId }
          // A same-source switch revokes this attempt's rebind markers for other presences: the
          // recorded source no longer holds its old presence, so commit cannot cancel those
          // leaves from a stale fact (rollback/supersession transfers nothing either).
          const reboundBindings = pendingLeave
            ? prepared.reboundBindings
                .filter(
                  (rebind) => rebind.sourcePeerId !== payload.sourcePeerId || rebind.presenceId === message.presenceId
                )
                .some(
                  (rebind) => rebind.presenceId === binding.presenceId && rebind.sourcePeerId === binding.sourcePeerId
                )
              ? prepared.reboundBindings.filter(
                  (rebind) => rebind.sourcePeerId !== payload.sourcePeerId || rebind.presenceId === message.presenceId
                )
              : [
                  ...prepared.reboundBindings.filter(
                    (rebind) => rebind.sourcePeerId !== payload.sourcePeerId || rebind.presenceId === message.presenceId
                  ),
                  binding
                ]
            : prepared.reboundBindings.filter(
                (rebind) => rebind.sourcePeerId !== payload.sourcePeerId || rebind.presenceId === message.presenceId
              )
          return PreparedSessionsState().new(
            replaceBy(preparedSessions, (item) => item.attemptId === prepared.attemptId, {
              ...prepared,
              runtime: nextRuntime,
              observers: nextObservers,
              reboundBindings,
              displacedBindings,
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
        // The displaced user's one-to-zero transition is classified independently from the
        // incoming generation's zero-to-one eligibility: replace when both apply, a final leave
        // when only the displaced side applies, a join when only the incoming side applies,
        // otherwise a refresh snapshot. The displaced side counts only when the displaced user
        // has no OTHER active or grace-preserved observation (excluding the displaced presence).
        const incomingJoins = isLaterLogicalJoin && !wasLogicallyActive
        const displacedLeaves =
          displaced !== undefined &&
          !nextObservers.some(
            (observation) =>
              observation.status === 'active' &&
              observation.user.id === displaced.user.id &&
              observation.presenceId !== displaced.presenceId
          )
        const sessionEvent: RuntimeSessionEvent =
          incomingJoins && displacedLeaves
            ? {
                type: 'replace',
                domain: runtime.domain,
                snapshot: sessionSnapshot,
                previous: projectRuntimeSession(displaced),
                session: publicSession,
                occurredAt: clock.now(),
                provenance: 'live'
              }
            : displacedLeaves
              ? {
                  type: 'leave',
                  domain: runtime.domain,
                  snapshot: sessionSnapshot,
                  session: projectRuntimeSession(displaced),
                  occurredAt: clock.now(),
                  provenance: 'live'
                }
              : incomingJoins
                ? {
                    type: 'join',
                    domain: runtime.domain,
                    snapshot: sessionSnapshot,
                    session: publicSession,
                    provenance: 'live'
                  }
                : {
                    type: 'snapshot',
                    domain: runtime.domain,
                    snapshot: sessionSnapshot,
                    provenance: 'refresh'
                  }
        return [
          DomainsState().new(replaceBy(domains, (item) => item.domain === runtime.domain, nextRuntime)),
          PresenceDomainsState().new(replaceBy(presenceDomains, (item) => item.domain === runtime.domain, record)),
          ...(pendingLeave
            ? [
                PendingLeavesState().new(
                  removeBy(
                    pendingLeaves,
                    (item) => item.domain === runtime.domain && item.presenceId === message.presenceId
                  )
                )
              ]
            : []),
          PersistPresenceRequestedEvent({ record }),
          ...(isBaselinePeer ? [PendingBaselinePeersState().new(nextBaselines)] : []),
          RuntimeSessionChangedEvent(sessionEvent),
          ...(physicalBindingChanged
            ? [BindingChangedEvent({ domain: runtime.domain, sourcePeerId: payload.sourcePeerId })]
            : [])
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
        // The source's CURRENT binding: a grace-retained generation is not current physical
        // authority, so live admission resolves the first non-pending entry (e.g. current C on
        // a reused source carrying grace-preserved B).
        const session = currentBindingForSource(runtime, payload.sourcePeerId, get(PendingLeavesState()))
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
          ? (() => {
              const nextPreparedRuntime = {
                ...prepared.runtime,
                sessions: prepared.runtime.sessions.filter((item) => item.sourcePeerId !== payload.sourcePeerId)
              }
              const committed = get(DomainsState()).find((item) => item.domain === prepared.runtime.domain)
              const pendingLeaves = get(PendingLeavesState())
              // Reconcile ONLY the observations whose authority the departed source carried:
              // the source's prepared bindings and its committed bindings. Unrelated ended
              // tombstones and finality already owned by the current preparation are preserved.
              const departedSourcePresences = new Set([
                ...prepared.runtime.sessions
                  .filter((session) => session.sourcePeerId === payload.sourcePeerId)
                  .map((session) => session.presenceId),
                ...(committed?.sessions
                  .filter((session) => session.sourcePeerId === payload.sourcePeerId)
                  .map((session) => session.presenceId) ?? [])
              ])
              // Committed bindings the current preparation has already displaced/replaced cannot
              // keep their presence active: post-departure authority obeys preparation precedence.
              const displacedSourceBindings = new Set(
                prepared.displacedBindings.map((displaced) => `${displaced.sourcePeerId}\u0000${displaced.presenceId}`)
              )
              // This same PeerLeft arms a grace deadline for the departed source's presence when
              // that source was its last current committed binding (mirroring the committed
              // branch), so the observation must stay eligible for an exact rebind.
              const pendingWillBeArmedFor = (presenceId: string) => {
                const committedForPresence = (committed?.sessions ?? []).filter(
                  (session) => session.presenceId === presenceId
                )
                return (
                  committedForPresence.length > 0 &&
                  committedForPresence.every((session) => session.sourcePeerId === payload.sourcePeerId)
                )
              }
              const authoritativeAfterDeparture = (presenceId: string) =>
                nextPreparedRuntime.sessions.some((session) => session.presenceId === presenceId) ||
                pendingWillBeArmedFor(presenceId) ||
                (committed?.sessions.some(
                  (session) =>
                    session.presenceId === presenceId &&
                    session.sourcePeerId !== payload.sourcePeerId &&
                    !displacedSourceBindings.has(`${session.sourcePeerId}\u0000${session.presenceId}`) &&
                    !pendingLeaves.some(
                      (leave) => leave.domain === prepared.runtime.domain && leave.presenceId === presenceId
                    )
                ) ??
                  false) ||
                pendingLeaves.some(
                  (leave) =>
                    leave.domain === prepared.runtime.domain &&
                    leave.presenceId === presenceId &&
                    (committed?.sessions.some((session) => session.presenceId === presenceId) ||
                      nextPreparedRuntime.sessions.some((session) => session.presenceId === presenceId))
                )
              const reconciledObservers = prepared.observers
                .filter((observer) => {
                  if (!departedSourcePresences.has(observer.presenceId)) return true
                  if (authoritativeAfterDeparture(observer.presenceId)) return true
                  // A provisional ACTIVE observation with no authority is dropped (its later
                  // real binding must emit a join); an already-ENDED observation stays as a
                  // tombstone so an expired generation cannot resurrect.
                  return observer.status === 'ended'
                })
                .map((observer) =>
                  departedSourcePresences.has(observer.presenceId) && authoritativeAfterDeparture(observer.presenceId)
                    ? { ...observer, status: 'active' as const }
                    : observer
                )
              return PreparedSessionsState().new(
                replaceBy(preparedSessions, (item) => item.attemptId === prepared.attemptId, {
                  ...prepared,
                  missedPeerIds: prepared.missedPeerIds.filter((item) => item !== payload.sourcePeerId),
                  baselinePeerIds: prepared.baselinePeerIds.filter((item) => item !== payload.sourcePeerId),
                  // The departed source's rebind marker AND displaced fact are revoked: only a
                  // CURRENT source may carry cancellation authority or a displacement to the commit.
                  reboundBindings: prepared.reboundBindings.filter(
                    (rebind) => rebind.sourcePeerId !== payload.sourcePeerId
                  ),
                  displacedBindings: prepared.displacedBindings.filter(
                    (displaced) => displaced.sourcePeerId !== payload.sourcePeerId
                  ),
                  runtime: nextPreparedRuntime,
                  observers: reconciledObservers
                })
              )
            })()
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
        // Resolve the source's CURRENT binding: on a reused source carrying a grace-preserved
        // older generation plus a current one, physical departure closes/arms the CURRENT
        // generation's leave (the older deadline keeps running untouched).
        const session = currentBindingForSource(runtime, payload.sourcePeerId, get(PendingLeavesState()))
        // Duplicate PeerLeave facts are idempotent and SHALL NOT restart or extend a deadline.
        if (!session) return cleanupActions.length > 0 ? cleanupActions : null
        const pending = get(PendingLeavesState())
        const existingPending = pending.find(
          (item) => item.domain === runtime.domain && item.presenceId === session.presenceId
        )
        const otherCurrentSource = runtime.sessions.some(
          (item) => item.presenceId === session.presenceId && item.sourcePeerId !== payload.sourcePeerId
        )
        if (existingPending) {
          return [
            ...cleanupActions,
            BindingRemovedEvent({ domain: runtime.domain, sourcePeerId: payload.sourcePeerId })
          ]
        }
        if (otherCurrentSource) {
          // Another current physical source for the same presence prevents pending leave.
          const nextRuntime = {
            ...runtime,
            sessions: runtime.sessions.filter((item) => item.sourcePeerId !== payload.sourcePeerId)
          }
          return [
            ...cleanupActions,
            DomainsState().new(replaceBy(domains, (item) => item.domain === runtime.domain, nextRuntime)),
            RuntimeSessionChangedEvent({
              type: 'snapshot',
              domain: runtime.domain,
              snapshot: snapshot(nextRuntime),
              provenance: 'refresh'
            }),
            BindingRemovedEvent({ domain: runtime.domain, sourcePeerId: payload.sourcePeerId })
          ]
        }
        // Last current physical source: start exactly one five-second pending-leave deadline and
        // retain the generation in every online snapshot throughout the grace.
        const armedId = identity.nextId()
        const pendingLeave: PendingLeave = {
          domain: runtime.domain,
          presenceId: session.presenceId,
          sourcePeerId: session.sourcePeerId,
          sessionId: session.sessionId,
          user: session.user,
          joinedAt: session.joinedAt,
          armedId,
          fenced: false,
          expiresAt: Date.now() + PENDING_LEAVE_GRACE_MS
        }
        return [
          ...cleanupActions,
          PendingLeavesState().new([...pending, pendingLeave]),
          PendingLeaveArmedEvent({
            domain: runtime.domain,
            presenceId: session.presenceId,
            armedId,
            delayMs: PENDING_LEAVE_GRACE_MS
          }),
          BindingRemovedEvent({ domain: runtime.domain, sourcePeerId: payload.sourcePeerId })
        ]
      }
    })

    const ExpirePendingLeaveCommand = domain.command({
      name: 'Session.ExpirePendingLeaveCommand',
      impl: ({ get }, payload: { domain: string; presenceId: string; armedId: string }) => {
        const pending = get(PendingLeavesState())
        const current = pending.find((item) => item.domain === payload.domain && item.presenceId === payload.presenceId)
        // A valid rebind cancelled the pending leave; a stale timer is fenced by its armed id;
        // a release-fenced deadline suspends ALL effects (authority stays closed by the record).
        if (!current || current.armedId !== payload.armedId || current.fenced) return null
        const domains = get(DomainsState())
        const runtime = domains.find((item) => item.domain === payload.domain)
        const presenceDomains = get(PresenceDomainsState())
        const persisted = presenceDomains.find((item) => item.domain === payload.domain)
        // The local domain was released: the deadline is stale and SHALL create no state,
        // persistence, notice, or binding action.
        if (!runtime) {
          return PendingLeavesState().new(
            removeBy(pending, (item) => item.domain === payload.domain && item.presenceId === payload.presenceId)
          )
        }
        const observers = persisted?.observers ?? []
        const nextObservers = replaceObservation(observers, {
          presenceId: current.presenceId,
          sessionId: current.sessionId,
          user: current.user,
          joinedAt: current.joinedAt,
          status: 'ended'
        })
        const removed = runtime.sessions.filter((item) => item.presenceId === payload.presenceId)
        const nextRuntime = {
          ...runtime,
          sessions: runtime.sessions.filter((item) => item.presenceId !== payload.presenceId)
        }
        const stillOnline = hasActiveUserPresence(nextObservers, current.user.id, payload.presenceId)
        const record: PresenceDomainRecord = {
          domain: payload.domain,
          lastJoinedAt: persisted?.lastJoinedAt ?? 0,
          ...retainedLocalLifecycle(persisted),
          observers: nextObservers
        }
        // Source-removal cleanup only when NO current session still owns that source: a reused
        // source carrying a current presence must not lose its History owner to an expired
        // older generation on the same source.
        const freedSources = removed
          .filter((item) => !nextRuntime.sessions.some((session) => session.sourcePeerId === item.sourcePeerId))
          .map((item) => item.sourcePeerId)
        return [
          DomainsState().new(replaceBy(domains, (item) => item.domain === payload.domain, nextRuntime)),
          PresenceDomainsState().new(replaceBy(presenceDomains, (item) => item.domain === payload.domain, record)),
          PendingLeavesState().new(
            removeBy(pending, (item) => item.domain === payload.domain && item.presenceId === payload.presenceId)
          ),
          PersistPresenceRequestedEvent({ record }),
          RuntimeSessionChangedEvent(
            stillOnline
              ? {
                  type: 'snapshot',
                  domain: payload.domain,
                  snapshot: snapshot(nextRuntime),
                  provenance: 'refresh'
                }
              : {
                  type: 'leave',
                  domain: payload.domain,
                  snapshot: snapshot(nextRuntime),
                  session: projectRuntimeSession(current),
                  occurredAt: clock.now(),
                  provenance: 'live'
                }
          ),
          ...freedSources.map((sourcePeerId) => BindingRemovedEvent({ domain: payload.domain, sourcePeerId }))
        ]
      }
    })

    domain.effect({
      name: 'Session.PendingLeaveGraceEffect',
      impl: ({ fromEvent }) =>
        fromEvent(PendingLeaveArmedEvent).pipe(
          mergeMap(
            (payload) =>
              new Observable<typeof payload>((observer) => {
                const timerId = globalThis.setTimeout(() => {
                  observer.next(payload)
                  observer.complete()
                }, payload.delayMs)
                return () => globalThis.clearTimeout(timerId)
              })
          ),
          map(ExpirePendingLeaveCommand)
        )
    })
    domain.effect({
      name: 'Session.ClearActivePresenceEffect',
      impl: ({ fromEvent }) =>
        fromEvent(ClearActivePresenceRequestedEvent).pipe(
          concatMap(async ({ domain }) => {
            try {
              await presenceStore.save({ domain, lastJoinedAt: 0, observers: [] })
              return CompleteReleaseCleanupCommand(domain)
            } catch (error) {
              // The authoritative active record was not removed: surface the exact failure,
              // retain the current fence and physical membership, restore the observer deadline
              // ownership (re-armed), and allow a later retry.
              return FailReleaseCleanupCommand({ domain, error: error as Error })
            }
          })
        )
    })
    domain.effect({
      name: 'Session.PresencePersistEffect',
      impl: ({ fromEvent }) =>
        fromEvent(PersistPresenceRequestedEvent).pipe(
          concatMap(async (request) => {
            try {
              await presenceStore.save(request.record)
              return request.requestId ? PresencePersistenceSettledEvent({ requestId: request.requestId }) : null
            } catch (error) {
              return request.requestId
                ? PresencePersistenceSettledEvent({ requestId: request.requestId, error: error as Error })
                : ErrorEvent({ error: error as Error, domain: request.record.domain })
            }
          })
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
        RetainedLocalSeedQuery,
        FinalizingPresenceQuery,
        RoomDomainQuery,
        BindingQuery,
        ReleaseRoomQuery
      },
      command: {
        HydratePresenceCommand,
        PrepareDomainCommand,
        PublishPreparedCommand,
        CommitPreparedCommand,
        AbortPreparedCommand,
        BeginReleaseDomainCommand,
        ResetDomainConnectionCommand,
        RestorePendingLeavesCommand,
        CompleteReleaseCommand,
        ReleaseDomainCommand,
        AllocateTextMessageCommand,
        AllocateReactionMessageCommand,
        SendChatMessageCommand,
        UpdateHlcCommand,
        PeerJoinedCommand,
        PeerLeftCommand,
        ExpirePendingLeaveCommand
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
        PresencePersistenceSettledEvent,
        RuntimeSessionChangedEvent,
        BindingChangedEvent,
        BindingRemovedEvent,
        OperationSucceededEvent,
        TextMessageAllocatedEvent,
        ReactionMessageAllocatedEvent,
        OperationFailedEvent,
        ErrorEvent,
        PendingLeaveArmedEvent
      }
    }
  }
})

export default SessionDomain
export { getChatRoomId }
