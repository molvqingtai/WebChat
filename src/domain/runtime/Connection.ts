import { Remesh } from 'remesh'
import { map, mergeMap, Observable } from 'rxjs'
import HistoryDomain from '@/domain/runtime/History'
import LifecycleDomain from '@/domain/runtime/Lifecycle'
import SessionDomain, { type SessionPreparationMode } from '@/domain/runtime/Session'
import WireDomain from '@/domain/runtime/Wire'
import WorldDomain, { getWorldRoomId } from '@/domain/runtime/World'
import type { ChatSite, ChatUser } from '@/protocol'
import type { RuntimeSnapshot } from '@/runtime/Contract'

export interface ConnectionOptions {
  [key: string]: string | number | undefined
  hostId: string
  worldSessionId: string
  historySessionBytes?: number
  historySessionMessages?: number
}

interface JoinAttempt {
  attemptId: string
  operationId?: string
  mode: SessionPreparationMode
  domain: string
  generation: number
  hostGeneration: number
  roomId?: string
  joinRequestId?: string
}

interface DomainGeneration {
  domain: string
  generation: number
}

interface WorldRecoveryAttempt {
  requestId: string
  generation: number
  hostGeneration: number
  joinRequestId: string
}

export interface ConnectionOperationSucceeded {
  operationId: string
}

export interface ConnectionOperationFailed {
  operationId: string
  error: Error
}

export interface ConnectionOperationCancelled {
  operationId: string
  supersedingOperationId: string
}

const PHYSICAL_ROOM_JOIN_TIMEOUT_MS = 10000
const replaceBy = <T>(items: T[], predicate: (item: T) => boolean, next: T): T[] =>
  items.some(predicate) ? items.map((item) => (predicate(item) ? next : item)) : [...items, next]
const worldJoinRequestId = (requestId: string) => `connection:world:${requestId}`
const joinRequestId = (attemptId: string) => `connection:join:${attemptId}`

const ConnectionDomain = Remesh.domain({
  name: 'ConnectionDomain',
  impl: (domain, options: ConnectionOptions) => {
    const lifecycleDomain = domain.getDomain(LifecycleDomain())
    const wireDomain = domain.getDomain(WireDomain())
    const sessionDomain = domain.getDomain(SessionDomain())
    const worldDomain = domain.getDomain(WorldDomain({ sessionId: options.worldSessionId }))
    const historyDomain = domain.getDomain(
      HistoryDomain({
        historySessionBytes: options.historySessionBytes,
        historySessionMessages: options.historySessionMessages
      })
    )

    const AttemptsState = domain.state<JoinAttempt[]>({ name: 'Connection.AttemptsState', default: [] })
    const GenerationsState = domain.state<DomainGeneration[]>({
      name: 'Connection.GenerationsState',
      default: []
    })
    const WorldRecoveryGenerationState = domain.state<number>({
      name: 'Connection.WorldRecoveryGenerationState',
      default: 0
    })
    const WorldRecoveryAttemptState = domain.state<WorldRecoveryAttempt | null>({
      name: 'Connection.WorldRecoveryAttemptState',
      default: null
    })

    const AttemptsQuery = domain.query({ name: 'Connection.AttemptsQuery', impl: ({ get }) => get(AttemptsState()) })
    const PhaseQuery = domain.query({
      name: 'Connection.PhaseQuery',
      impl: ({ get }, runtimeDomain: string) => {
        if (get(AttemptsState()).some((item) => item.domain === runtimeDomain)) return 'connecting' as const
        return get(sessionDomain.query.DomainQuery(runtimeDomain)) ? ('joined' as const) : ('idle' as const)
      }
    })
    const SnapshotQuery = domain.query({
      name: 'Connection.SnapshotQuery',
      impl: ({ get }): RuntimeSnapshot => {
        const runtimes = get(sessionDomain.query.DomainsQuery())
        return {
          hostId: options.hostId,
          hostPhase: get(lifecycleDomain.query.HostPhaseQuery()),
          peerId: get(wireDomain.query.PeerIdQuery()),
          domains: get(lifecycleDomain.query.DomainLeasesQuery()).map((lease) => {
            const runtime = runtimes.find((item) => item.domain === lease.domain)
            return {
              domain: lease.domain,
              phase: lease.phase,
              pageIds: lease.pageIds,
              chatRoomJoined: Boolean(runtime),
              localSession: runtime
                ? { sessionId: runtime.sessionId, user: runtime.user, joinedAt: runtime.joinedAt }
                : undefined,
              sessions: runtime?.sessions ?? []
            }
          }),
          world: {
            joined: get(worldDomain.query.JoinedQuery()),
            peerId: get(wireDomain.query.PeerIdQuery()),
            localPresence: get(worldDomain.query.LocalPresenceQuery()),
            presences: get(worldDomain.query.PresencesQuery())
          }
        }
      }
    })

    const OperationSucceededEvent = domain.event<ConnectionOperationSucceeded>({
      name: 'Connection.OperationSucceededEvent'
    })
    const OperationFailedEvent = domain.event<ConnectionOperationFailed>({
      name: 'Connection.OperationFailedEvent'
    })
    const OperationCancelledEvent = domain.event<ConnectionOperationCancelled>({
      name: 'Connection.OperationCancelledEvent'
    })
    const AttemptStartedEvent = domain.event<JoinAttempt>({ name: 'Connection.AttemptStartedEvent' })
    const AttemptAcceptedEvent = domain.event<JoinAttempt>({ name: 'Connection.AttemptAcceptedEvent' })
    const AttemptFailedEvent = domain.event<JoinAttempt & { error: Error }>({
      name: 'Connection.AttemptFailedEvent'
    })
    const AttemptSupersededEvent = domain.event<JoinAttempt>({ name: 'Connection.AttemptSupersededEvent' })
    const ConnectionJoinedEvent = domain.event<{ domain: string }>({ name: 'Connection.JoinedEvent' })
    const ConnectionLeftEvent = domain.event<{ domain: string }>({ name: 'Connection.LeftEvent' })
    const JoinTimeoutArmedEvent = domain.event<{ attemptId: string; joinRequestId: string }>({
      name: 'Connection.JoinTimeoutArmedEvent'
    })
    const WorldRecoveryTimeoutArmedEvent = domain.event<{ requestId: string; joinRequestId: string }>({
      name: 'Connection.WorldRecoveryTimeoutArmedEvent'
    })
    const ErrorEvent = domain.event<Error>({ name: 'Connection.ErrorEvent' })

    const startAttempt = (
      get: Parameters<Parameters<typeof domain.command>[0]['impl']>[0]['get'],
      payload: {
        attemptId: string
        operationId?: string
        mode: SessionPreparationMode
        domain: string
        user?: ChatUser
        site?: ChatSite
      }
    ) => {
      const attempts = get(AttemptsState())
      const currentAttempt = attempts.find((item) => item.domain === payload.domain)
      const generations = get(GenerationsState())
      const generation = (generations.find((item) => item.domain === payload.domain)?.generation ?? 0) + 1
      if (!Number.isSafeInteger(generation)) {
        return payload.operationId
          ? OperationFailedEvent({
              operationId: payload.operationId,
              error: new Error('Domain join generation exhausted')
            })
          : ErrorEvent(new Error('Domain join generation exhausted'))
      }
      const attempt: JoinAttempt = {
        attemptId: payload.attemptId,
        operationId: payload.operationId,
        mode: payload.mode,
        domain: payload.domain,
        generation,
        hostGeneration: get(lifecycleDomain.query.HostGenerationQuery())
      }
      return [
        GenerationsState().new(
          replaceBy(generations, (item) => item.domain === payload.domain, { domain: payload.domain, generation })
        ),
        AttemptsState().new(replaceBy(attempts, (item) => item.domain === payload.domain, attempt)),
        ...(currentAttempt?.mode === 'reconnect'
          ? [lifecycleDomain.command.FinishReconnectCommand(payload.domain)]
          : []),
        ...(currentAttempt ? [sessionDomain.command.AbortPreparedCommand(currentAttempt.attemptId)] : []),
        ...(currentAttempt ? [worldDomain.command.AbortStagedCommand(currentAttempt.attemptId)] : []),
        ...(currentAttempt?.operationId
          ? [
              OperationCancelledEvent({
                operationId: currentAttempt.operationId,
                supersedingOperationId: payload.operationId ?? payload.attemptId
              }),
              AttemptSupersededEvent(currentAttempt)
            ]
          : []),
        sessionDomain.command.PrepareDomainCommand({
          attemptId: attempt.attemptId,
          mode: attempt.mode,
          domain: attempt.domain,
          user: payload.user,
          site: payload.site
        }),
        AttemptStartedEvent(attempt)
      ]
    }

    const JoinDomainCommand = domain.command({
      name: 'Connection.JoinDomainCommand',
      impl: ({ get }, payload: { operationId: string; domain: string; user: ChatUser; site: ChatSite }) =>
        get(sessionDomain.query.ReleasingDomainQuery(payload.domain))
          ? OperationFailedEvent({
              operationId: payload.operationId,
              error: new Error('Domain release is already in progress')
            })
          : startAttempt(get, {
              attemptId: payload.operationId,
              operationId: payload.operationId,
              mode: 'join',
              domain: payload.domain,
              user: payload.user,
              site: payload.site
            })
    })

    const ReconnectDomainCommand = domain.command({
      name: 'Connection.ReconnectDomainCommand',
      impl: ({ get }, payload: { operationId: string; domain: string }) => {
        if (get(sessionDomain.query.ReleasingDomainQuery(payload.domain))) {
          return OperationFailedEvent({
            operationId: payload.operationId,
            error: new Error('Domain release is already in progress')
          })
        }
        if (get(lifecycleDomain.query.DomainLeaseQuery(payload.domain))?.reconnecting) {
          return OperationFailedEvent({
            operationId: payload.operationId,
            error: new Error('Domain reconnect is already in progress')
          })
        }
        if (!get(sessionDomain.query.DomainQuery(payload.domain))) {
          return OperationSucceededEvent({ operationId: payload.operationId })
        }
        return [
          lifecycleDomain.command.BeginReconnectCommand(payload.domain),
          startAttempt(get, {
            attemptId: payload.operationId,
            operationId: payload.operationId,
            mode: 'reconnect',
            domain: payload.domain
          })
        ]
      }
    })

    const StartPreparedAttemptCommand = domain.command({
      name: 'Connection.StartPreparedAttemptCommand',
      impl: ({ get }, payload: { attemptId: string; domain: string; roomId: string }) => {
        const attempts = get(AttemptsState())
        const attempt = attempts.find((item) => item.attemptId === payload.attemptId)
        const prepared = get(sessionDomain.query.PreparedSessionQuery(payload.attemptId))
        if (!attempt || !prepared) return null
        const requestId = joinRequestId(attempt.attemptId)
        return [
          AttemptsState().new(
            replaceBy(attempts, (item) => item.attemptId === attempt.attemptId, {
              ...attempt,
              roomId: payload.roomId,
              joinRequestId: requestId
            })
          ),
          worldDomain.command.StageDomainCommand({
            attemptId: attempt.attemptId,
            domain: prepared.runtime.domain,
            user: prepared.runtime.user,
            site: prepared.runtime.site
          }),
          ...(attempt.mode === 'reconnect' ? [wireDomain.command.LeaveRoomCommand(payload.roomId)] : []),
          wireDomain.command.JoinRoomsCommand({
            requestId,
            roomIds: [payload.roomId, getWorldRoomId()]
          }),
          JoinTimeoutArmedEvent({ attemptId: attempt.attemptId, joinRequestId: requestId })
        ]
      }
    })

    const RoomsJoinedCommand = domain.command({
      name: 'Connection.RoomsJoinedCommand',
      impl: ({ get }, payload: { requestId: string; roomIds: string[] }) => {
        const attempt = get(AttemptsState()).find((item) => item.joinRequestId === payload.requestId)
        if (attempt) return sessionDomain.command.PublishPreparedCommand(attempt.attemptId)
        const recovery = get(WorldRecoveryAttemptState())
        return recovery?.joinRequestId === payload.requestId
          ? worldDomain.command.PublishRecoveryCommand(recovery.requestId)
          : null
      }
    })

    const RoomsJoinFailedCommand = domain.command({
      name: 'Connection.RoomsJoinFailedCommand',
      impl: ({ get }, payload: { requestId: string; error: Error }) => {
        const attempt = get(AttemptsState()).find((item) => item.joinRequestId === payload.requestId)
        if (attempt) return AbortAttemptCommand({ attemptId: attempt.attemptId, error: payload.error })
        const recovery = get(WorldRecoveryAttemptState())
        return recovery?.joinRequestId === payload.requestId
          ? AbortWorldRecoveryCommand({ requestId: recovery.requestId, error: payload.error })
          : null
      }
    })

    const PublishWorldForAttemptCommand = domain.command({
      name: 'Connection.PublishWorldForAttemptCommand',
      impl: ({ get }, payload: { attemptId: string }) =>
        get(AttemptsState()).some((item) => item.attemptId === payload.attemptId)
          ? worldDomain.command.PublishStagedCommand(payload.attemptId)
          : null
    })

    const CompleteAttemptCommand = domain.command({
      name: 'Connection.CompleteAttemptCommand',
      impl: ({ get }, payload: { attemptId: string }) => {
        const attempts = get(AttemptsState())
        const attempt = attempts.find((item) => item.attemptId === payload.attemptId)
        if (
          !attempt ||
          attempt.hostGeneration !== get(lifecycleDomain.query.HostGenerationQuery()) ||
          !get(lifecycleDomain.query.DomainLeaseQuery(attempt.domain))
        ) {
          return null
        }
        return [
          AttemptsState().new(attempts.filter((item) => item.attemptId !== attempt.attemptId)),
          sessionDomain.command.CommitPreparedCommand(attempt.attemptId),
          worldDomain.command.CommitStagedCommand(attempt.attemptId),
          ...(attempt.mode === 'reconnect' ? [lifecycleDomain.command.FinishReconnectCommand(attempt.domain)] : []),
          ...(attempt.operationId ? [OperationSucceededEvent({ operationId: attempt.operationId })] : []),
          AttemptAcceptedEvent(attempt),
          ConnectionJoinedEvent({ domain: attempt.domain })
        ]
      }
    })

    const AbortAttemptCommand = domain.command({
      name: 'Connection.AbortAttemptCommand',
      impl: ({ get }, payload: { attemptId: string; error: Error }) => {
        const attempts = get(AttemptsState())
        const attempt = attempts.find((item) => item.attemptId === payload.attemptId)
        if (!attempt) return null
        const committed = get(sessionDomain.query.DomainsQuery()).filter(
          (item) => !get(sessionDomain.query.ReleasingDomainQuery(item.domain))
        )
        const hasOtherAttempt = attempts.some((item) => item.attemptId !== attempt.attemptId)
        return [
          AttemptsState().new(attempts.filter((item) => item.attemptId !== attempt.attemptId)),
          sessionDomain.command.AbortPreparedCommand(attempt.attemptId),
          worldDomain.command.AbortStagedCommand(attempt.attemptId),
          ...(attempt.roomId && (attempt.mode !== 'join' || !committed.some((item) => item.domain === attempt.domain))
            ? [wireDomain.command.LeaveRoomCommand(attempt.roomId)]
            : []),
          ...(committed.length === 0 && !hasOtherAttempt
            ? [wireDomain.command.LeaveRoomCommand(getWorldRoomId())]
            : []),
          ...(attempt.mode === 'reconnect' ? [lifecycleDomain.command.FinishReconnectCommand(attempt.domain)] : []),
          ...(attempt.operationId
            ? [OperationFailedEvent({ operationId: attempt.operationId, error: payload.error })]
            : [ErrorEvent(payload.error)]),
          AttemptFailedEvent({ ...attempt, error: payload.error })
        ]
      }
    })

    const JoinTimedOutCommand = domain.command({
      name: 'Connection.JoinTimedOutCommand',
      impl: ({ get }, payload: { attemptId: string; joinRequestId: string }) => {
        const attempt = get(AttemptsState()).find(
          (item) => item.attemptId === payload.attemptId && item.joinRequestId === payload.joinRequestId
        )
        return attempt
          ? AbortAttemptCommand({ attemptId: attempt.attemptId, error: new Error('Physical room join timed out') })
          : null
      }
    })

    const PeerJoinedCommand = domain.command({
      name: 'Connection.PeerJoinedCommand',
      impl: (_, payload: { roomId: string; sourcePeerId: string }) => [
        sessionDomain.command.PeerJoinedCommand(payload),
        worldDomain.command.PeerJoinedCommand(payload)
      ]
    })

    const PeerLeftCommand = domain.command({
      name: 'Connection.PeerLeftCommand',
      impl: ({ get }, payload: { roomId: string; sourcePeerId: string }) => {
        const runtimeDomain = get(sessionDomain.query.RoomDomainQuery(payload.roomId))
        return [
          sessionDomain.command.PeerLeftCommand(payload),
          worldDomain.command.PeerLeftCommand(payload),
          ...(runtimeDomain
            ? [historyDomain.command.RemovePeerCommand({ domain: runtimeDomain, sourcePeerId: payload.sourcePeerId })]
            : [])
        ]
      }
    })

    const RoomClosedCommand = domain.command({
      name: 'Connection.RoomClosedCommand',
      impl: ({ get }, payload: { roomId: string }) => {
        if (payload.roomId === getWorldRoomId()) {
          if (get(sessionDomain.query.DomainsQuery()).length === 0) return null
          const generation = get(WorldRecoveryGenerationState()) + 1
          if (!Number.isSafeInteger(generation)) return ErrorEvent(new Error('World recovery generation exhausted'))
          const requestId = `world-recovery:${generation}`
          const recovery: WorldRecoveryAttempt = {
            requestId,
            generation,
            hostGeneration: get(lifecycleDomain.query.HostGenerationQuery()),
            joinRequestId: worldJoinRequestId(requestId)
          }
          return [
            WorldRecoveryGenerationState().new(generation),
            WorldRecoveryAttemptState().new(recovery),
            worldDomain.command.BeginRecoveryCommand(requestId),
            wireDomain.command.JoinRoomsCommand({
              requestId: recovery.joinRequestId,
              roomIds: [getWorldRoomId()]
            }),
            WorldRecoveryTimeoutArmedEvent({ requestId, joinRequestId: recovery.joinRequestId })
          ]
        }
        const runtimeDomain = get(sessionDomain.query.RoomDomainQuery(payload.roomId))
        if (!runtimeDomain || !get(lifecycleDomain.query.DomainLeaseQuery(runtimeDomain))) return null
        const generations = get(GenerationsState())
        const generation = (generations.find((item) => item.domain === runtimeDomain)?.generation ?? 0) + 1
        return startAttempt(get, {
          attemptId: `recovery:${runtimeDomain}:${generation}`,
          mode: 'recover',
          domain: runtimeDomain
        })
      }
    })

    const CompleteWorldRecoveryCommand = domain.command({
      name: 'Connection.CompleteWorldRecoveryCommand',
      impl: ({ get }, payload: { requestId: string }) => {
        const recovery = get(WorldRecoveryAttemptState())
        if (
          !recovery ||
          recovery.requestId !== payload.requestId ||
          recovery.hostGeneration !== get(lifecycleDomain.query.HostGenerationQuery()) ||
          get(sessionDomain.query.DomainsQuery()).length === 0
        ) {
          return null
        }
        return [WorldRecoveryAttemptState().new(null), worldDomain.command.CommitRecoveryCommand(payload.requestId)]
      }
    })

    const AbortWorldRecoveryCommand = domain.command({
      name: 'Connection.AbortWorldRecoveryCommand',
      impl: ({ get }, payload: { requestId: string; error: Error }) => {
        const recovery = get(WorldRecoveryAttemptState())
        if (!recovery || recovery.requestId !== payload.requestId) return null
        return [
          WorldRecoveryAttemptState().new(null),
          worldDomain.command.AbortRecoveryCommand(payload.requestId),
          wireDomain.command.LeaveRoomCommand(getWorldRoomId()),
          ErrorEvent(payload.error)
        ]
      }
    })

    const WorldRecoveryTimedOutCommand = domain.command({
      name: 'Connection.WorldRecoveryTimedOutCommand',
      impl: ({ get }, payload: { requestId: string; joinRequestId: string }) => {
        const recovery = get(WorldRecoveryAttemptState())
        return recovery?.requestId === payload.requestId && recovery.joinRequestId === payload.joinRequestId
          ? AbortWorldRecoveryCommand({
              requestId: payload.requestId,
              error: new Error('Physical room join timed out')
            })
          : null
      }
    })

    const FinalizeReleaseDomainCommand = domain.command({
      name: 'Connection.FinalizeReleaseDomainCommand',
      impl: ({ get }, payload: { domain: string; roomId?: string }) => {
        const remainingDomains = get(sessionDomain.query.DomainsQuery()).filter(
          (item) => item.domain !== payload.domain
        )
        const remainingAttempts = get(AttemptsState()).filter((item) => item.domain !== payload.domain)
        return [
          historyDomain.command.ReleaseDomainCommand(payload.domain),
          sessionDomain.command.ReleaseDomainCommand(payload.domain),
          ...(payload.roomId ? [wireDomain.command.LeaveRoomCommand(payload.roomId)] : []),
          ...(remainingDomains.length === 0 && remainingAttempts.length === 0
            ? [wireDomain.command.LeaveRoomCommand(getWorldRoomId())]
            : []),
          ConnectionLeftEvent({ domain: payload.domain })
        ]
      }
    })

    const ReleaseDomainCommand = domain.command({
      name: 'Connection.ReleaseDomainCommand',
      impl: ({ get }, releasedDomain: string) => {
        if (get(sessionDomain.query.ReleasingDomainQuery(releasedDomain))) {
          return sessionDomain.command.BeginReleaseDomainCommand(releasedDomain)
        }
        const runtime = get(sessionDomain.query.DomainQuery(releasedDomain))
        const attempts = get(AttemptsState())
        const attempt = attempts.find((item) => item.domain === releasedDomain)
        if (!runtime && !attempt) return null
        if (!runtime && attempt) {
          return AbortAttemptCommand({
            attemptId: attempt.attemptId,
            error: new Error('Domain released during join')
          })
        }
        const generations = get(GenerationsState())
        const generation = (generations.find((item) => item.domain === releasedDomain)?.generation ?? 0) + 1
        const remainingAttempts = attempts.filter((item) => item.domain !== releasedDomain)
        return [
          AttemptsState().new(remainingAttempts),
          ...(Number.isSafeInteger(generation)
            ? [
                GenerationsState().new(
                  replaceBy(generations, (item) => item.domain === releasedDomain, {
                    domain: releasedDomain,
                    generation
                  })
                )
              ]
            : [ErrorEvent(new Error('Domain join generation exhausted'))]),
          ...(attempt
            ? [
                sessionDomain.command.AbortPreparedCommand(attempt.attemptId),
                worldDomain.command.AbortStagedCommand(attempt.attemptId)
              ]
            : []),
          sessionDomain.command.BeginReleaseDomainCommand(releasedDomain),
          ...(attempt?.mode === 'reconnect' ? [lifecycleDomain.command.FinishReconnectCommand(releasedDomain)] : []),
          ...(attempt?.operationId
            ? [
                OperationFailedEvent({
                  operationId: attempt.operationId,
                  error: new Error('Domain released during join')
                })
              ]
            : [])
        ]
      }
    })

    const LeaveDomainCommand = domain.command({
      name: 'Connection.LeaveDomainCommand',
      impl: (_, runtimeDomain: string) => ReleaseDomainCommand(runtimeDomain)
    })

    domain.effect({
      name: 'Connection.SessionPreparedEffect',
      impl: ({ fromEvent }) => fromEvent(sessionDomain.event.PreparedEvent).pipe(map(StartPreparedAttemptCommand))
    })
    domain.effect({
      name: 'Connection.SessionPreparationFailureEffect',
      impl: ({ fromEvent }) =>
        fromEvent(sessionDomain.event.PreparationFailedEvent).pipe(
          map(({ attemptId, error }) => AbortAttemptCommand({ attemptId, error }))
        )
    })
    domain.effect({
      name: 'Connection.RoomsJoinedEffect',
      impl: ({ fromEvent }) => fromEvent(wireDomain.event.RoomsJoinedEvent).pipe(map(RoomsJoinedCommand))
    })
    domain.effect({
      name: 'Connection.RoomsJoinFailureEffect',
      impl: ({ fromEvent }) => fromEvent(wireDomain.event.RoomsJoinFailedEvent).pipe(map(RoomsJoinFailedCommand))
    })
    domain.effect({
      name: 'Connection.SessionPublishedEffect',
      impl: ({ fromEvent }) =>
        fromEvent(sessionDomain.event.PreparedPublishedEvent).pipe(map(PublishWorldForAttemptCommand))
    })
    domain.effect({
      name: 'Connection.SessionPublishFailureEffect',
      impl: ({ fromEvent }) =>
        fromEvent(sessionDomain.event.PreparedPublishFailedEvent).pipe(
          map(({ attemptId, error }) => AbortAttemptCommand({ attemptId, error }))
        )
    })
    domain.effect({
      name: 'Connection.WorldPublishedEffect',
      impl: ({ fromEvent }) => fromEvent(worldDomain.event.StagedPublishedEvent).pipe(map(CompleteAttemptCommand))
    })
    domain.effect({
      name: 'Connection.WorldPublishFailureEffect',
      impl: ({ fromEvent }) =>
        fromEvent(worldDomain.event.StagedPublishFailedEvent).pipe(
          map(({ attemptId, error }) => AbortAttemptCommand({ attemptId, error }))
        )
    })
    domain.effect({
      name: 'Connection.WorldRecoveryPublishedEffect',
      impl: ({ fromEvent }) =>
        fromEvent(worldDomain.event.RecoveryPublishedEvent).pipe(map(CompleteWorldRecoveryCommand))
    })
    domain.effect({
      name: 'Connection.WorldRecoveryFailureEffect',
      impl: ({ fromEvent }) =>
        fromEvent(worldDomain.event.RecoveryPublishFailedEvent).pipe(map(AbortWorldRecoveryCommand))
    })
    domain.effect({
      name: 'Connection.PeerJoinEffect',
      impl: ({ fromEvent }) => fromEvent(wireDomain.event.PeerJoinedEvent).pipe(map(PeerJoinedCommand))
    })
    domain.effect({
      name: 'Connection.PeerLeaveEffect',
      impl: ({ fromEvent }) => fromEvent(wireDomain.event.PeerLeftEvent).pipe(map(PeerLeftCommand))
    })
    domain.effect({
      name: 'Connection.RoomCloseEffect',
      impl: ({ fromEvent }) => fromEvent(wireDomain.event.RoomClosedEvent).pipe(map(RoomClosedCommand))
    })
    domain.effect({
      name: 'Connection.JoinTimeoutEffect',
      impl: ({ fromEvent }) =>
        fromEvent(JoinTimeoutArmedEvent).pipe(
          mergeMap(
            (payload) =>
              new Observable<typeof payload>((observer) => {
                const timerId = globalThis.setTimeout(() => {
                  observer.next(payload)
                  observer.complete()
                }, PHYSICAL_ROOM_JOIN_TIMEOUT_MS)
                return () => globalThis.clearTimeout(timerId)
              })
          ),
          map(JoinTimedOutCommand)
        )
    })
    domain.effect({
      name: 'Connection.WorldRecoveryTimeoutEffect',
      impl: ({ fromEvent }) =>
        fromEvent(WorldRecoveryTimeoutArmedEvent).pipe(
          mergeMap(
            (payload) =>
              new Observable<typeof payload>((observer) => {
                const timerId = globalThis.setTimeout(() => {
                  observer.next(payload)
                  observer.complete()
                }, PHYSICAL_ROOM_JOIN_TIMEOUT_MS)
                return () => globalThis.clearTimeout(timerId)
              })
          ),
          map(WorldRecoveryTimedOutCommand)
        )
    })
    domain.effect({
      name: 'Connection.BindingChangedEffect',
      impl: ({ fromEvent }) =>
        fromEvent(sessionDomain.event.BindingChangedEvent).pipe(
          map(historyDomain.command.ResetHistoryForSessionCommand)
        )
    })
    domain.effect({
      name: 'Connection.BindingRemovedEffect',
      impl: ({ fromEvent }) =>
        fromEvent(sessionDomain.event.BindingRemovedEvent).pipe(map(historyDomain.command.RemovePeerCommand))
    })
    domain.effect({
      name: 'Connection.CommittedSessionsEffect',
      impl: ({ fromEvent }) =>
        fromEvent(sessionDomain.event.DomainCommittedEvent).pipe(
          map(({ domain: runtimeDomain, newSessions }) =>
            newSessions.map((session) =>
              historyDomain.command.ResetHistoryForSessionCommand({
                domain: runtimeDomain,
                sourcePeerId: session.sourcePeerId
              })
            )
          )
        )
    })
    domain.effect({
      name: 'Connection.ReleaseEffect',
      impl: ({ fromEvent }) => fromEvent(lifecycleDomain.event.DomainReleasedEvent).pipe(map(ReleaseDomainCommand))
    })
    domain.effect({
      name: 'Connection.DurableRetirementEffect',
      impl: ({ fromEvent }) =>
        fromEvent(sessionDomain.event.DomainRetiredEvent).pipe(
          map(({ domain: retiredDomain }) => worldDomain.command.ReleaseDomainCommand(retiredDomain))
        )
    })
    domain.effect({
      name: 'Connection.FinalizeReleaseEffect',
      impl: ({ fromEvent }) =>
        fromEvent(sessionDomain.event.DomainEndPublishedEvent).pipe(map(FinalizeReleaseDomainCommand))
    })
    domain.effect({
      name: 'Connection.ErrorEffect',
      impl: ({ fromEvent }) => fromEvent(wireDomain.event.ErrorEvent).pipe(map(ErrorEvent))
    })
    domain.effect({
      name: 'Connection.SessionErrorEffect',
      impl: ({ fromEvent }) => fromEvent(sessionDomain.event.ErrorEvent).pipe(map(ErrorEvent))
    })
    domain.effect({
      name: 'Connection.WorldErrorEffect',
      impl: ({ fromEvent }) => fromEvent(worldDomain.event.ErrorEvent).pipe(map(ErrorEvent))
    })
    domain.effect({
      name: 'Connection.HistoryErrorEffect',
      impl: ({ fromEvent }) => fromEvent(historyDomain.event.ErrorEvent).pipe(map(ErrorEvent))
    })

    return {
      query: { AttemptsQuery, PhaseQuery, SnapshotQuery },
      command: { JoinDomainCommand, LeaveDomainCommand, ReconnectDomainCommand },
      event: {
        OperationSucceededEvent,
        OperationFailedEvent,
        OperationCancelledEvent,
        AttemptStartedEvent,
        AttemptAcceptedEvent,
        AttemptFailedEvent,
        AttemptSupersededEvent,
        ConnectionJoinedEvent,
        ConnectionLeftEvent,
        ErrorEvent
      }
    }
  }
})

export default ConnectionDomain
