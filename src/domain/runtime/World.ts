import { Remesh } from 'remesh'
import { concatMap, filter, map } from 'rxjs'
import WireDomain, { type WireFailureStage, type WireMessageEvent } from '@/domain/runtime/Wire'
import { RoomTransportExtern } from '@/domain/runtime/externs/RoomTransport'
import { WORLD_ROOM_ID_V5 } from '@/constants/config'
import { type ChatSite, type ChatUser, type WorldRoomMessage } from '@/protocol'
import type { WorldPresenceEvent, WorldPresenceRecord } from '@/runtime/Contract'
import stringToHex from '@/utils/stringToHex'

interface WorldDomainRegistration {
  domain: string
  user: ChatUser
  site: ChatSite
}

interface StagedWorldRegistration extends WorldDomainRegistration {
  attemptId: string
  publicationPending: boolean
  missedPeerIds: string[]
}

interface RecoveryState {
  requestId: string
  publicationPending: boolean
  missedPeerIds: string[]
  /** True only for an AppButton manual World replacement: its catch-up work uses manual-scoped
   * request ids so a failure never becomes page UI feedback. */
  manual?: boolean
}

interface FullPublication {
  requestId: string
  revision: number
  presence: WorldRoomMessage
  stagedAttemptId: string | null
  recoveryRequestId: string | null
  /** True only when the publication belongs to an AppButton manual World replacement: its failure
   * stays out of page UI/Toast. */
  manual?: boolean
}

interface PendingPresenceSend {
  requestId: string
}

export interface WorldOptions {
  [key: string]: string
  sessionId: string
}

const worldRoomId = stringToHex(WORLD_ROOM_ID_V5)
export const getWorldRoomId = () => worldRoomId
const replaceBy = <T>(items: T[], predicate: (item: T) => boolean, next: T): T[] =>
  items.some(predicate) ? items.map((item) => (predicate(item) ? next : item)) : [...items, next]
const appendUnique = <T>(items: T[], item: T): T[] => (items.includes(item) ? items : [...items, item])

const presenceFor = (registrations: WorldDomainRegistration[], sessionId: string): WorldRoomMessage | undefined => {
  const first = registrations[0]
  return first ? { sessionId, user: first.user, sites: registrations.map(({ site }) => site) } : undefined
}

const publicationRequestId = (sequence: number) => `world:publication:${sequence}`
// A release publication step that cannot reach the provider (preflight / encode, zero sends) retries
// the un-attempted step at a bounded cadence while the release owner and Runtime generation are current.
const WORLD_RELEASE_STEP_RETRY_MS = 1500

const WorldDomain = Remesh.domain({
  name: 'WorldDomain',
  impl: (domain, options: WorldOptions) => {
    const wireDomain = domain.getDomain(WireDomain())
    domain.getExtern(RoomTransportExtern)

    const RegistrationsState = domain.state<WorldDomainRegistration[]>({
      name: 'World.RegistrationsState',
      default: []
    })
    const StagedRegistrationsState = domain.state<StagedWorldRegistration[]>({
      name: 'World.StagedRegistrationsState',
      default: []
    })
    const JoinedState = domain.state<boolean>({ name: 'World.JoinedState', default: false })
    const PresencesState = domain.state<WorldPresenceRecord[]>({ name: 'World.PresencesState', default: [] })
    /** Current physical Room members, tracked from the join/leave events this domain owns. */
    const RoomMembersState = domain.state<string[]>({ name: 'World.RoomMembersState', default: [] })
    const RecoveryState = domain.state<RecoveryState | null>({ name: 'World.RecoveryState', default: null })
    // Per-replacement send correlation: pending presence sends carry this generation in their
    // request id, so an old-generation completion/failure can never settle a fresh marker.
    const WorldSendGenerationState = domain.state<number>({ name: 'World.WorldSendGenerationState', default: 0 })
    const PendingPresenceSendsState = domain.state<PendingPresenceSend[]>({
      name: 'World.PendingPresenceSendsState',
      default: []
    })
    // A release continuation is live Runtime state only.  It makes the final close wait for
    // the current World iterator instead of racing the new presence publication.
    const LiveReleaseContinuationsState = domain.state<string[]>({
      name: 'World.LiveReleaseContinuationsState',
      default: []
    })
    // A final-site release still owes the World room one empty `sites: []` snapshot before the
    // release owner may close; the removed registration's identity is retained for that publication.
    const PendingFinalPublicationState = domain.state<{ user: ChatUser } | null>({
      name: 'World.PendingFinalPublicationState',
      default: null
    })
    const PublicationRevisionState = domain.state<number>({
      name: 'World.PublicationRevisionState',
      default: 0
    })
    const PublicationSequenceState = domain.state<number>({
      name: 'World.PublicationSequenceState',
      default: 0
    })
    const FullPublicationState = domain.state<FullPublication | null>({
      name: 'World.FullPublicationState',
      default: null
    })

    const RegistrationsQuery = domain.query({
      name: 'World.RegistrationsQuery',
      impl: ({ get }) => get(RegistrationsState())
    })
    const JoinedQuery = domain.query({ name: 'World.JoinedQuery', impl: ({ get }) => get(JoinedState()) })
    const PresencesQuery = domain.query({ name: 'World.PresencesQuery', impl: ({ get }) => get(PresencesState()) })
    const LocalPresenceQuery = domain.query({
      name: 'World.LocalPresenceQuery',
      impl: ({ get }) => presenceFor(get(RegistrationsState()), options.sessionId)
    })
    const StagedPresenceQuery = domain.query({
      name: 'World.StagedPresenceQuery',
      impl: ({ get }, attemptId: string) => {
        const staged = get(StagedRegistrationsState()).find((item) => item.attemptId === attemptId)
        if (!staged) return undefined
        const prospective = replaceBy(get(RegistrationsState()), (item) => item.domain === staged.domain, staged)
        return presenceFor(prospective, options.sessionId)
      }
    })
    // Exact World ownership/demand: any committed registration, staged attempt (other than one
    // being aborted by the caller), pending final publication, or live release continuation keeps
    // the physical World room a live owner. The physical departure decision must never be derived
    // from Session/attempt facts alone.
    const WorldDemandQuery = domain.query({
      name: 'World.WorldDemandQuery',
      impl: ({ get }, ignoredAttemptId?: string) =>
        get(RegistrationsState()).length > 0 ||
        get(StagedRegistrationsState()).some((item) => item.attemptId !== ignoredAttemptId) ||
        get(PendingFinalPublicationState()) !== null ||
        get(LiveReleaseContinuationsState()).length > 0
    })
    const PublicationPresenceQuery = domain.query({
      name: 'World.PublicationPresenceQuery',
      impl: ({ get }) => {
        const pendingFinal = get(PendingFinalPublicationState())
        if (pendingFinal) return { sessionId: options.sessionId, user: pendingFinal.user, sites: [] }
        const staged = get(StagedRegistrationsState()).find((item) => item.publicationPending)
        const registrations = staged
          ? replaceBy(get(RegistrationsState()), (item) => item.domain === staged.domain, staged)
          : get(RegistrationsState())
        return presenceFor(registrations, options.sessionId)
      }
    })

    const StagedEvent = domain.event<{ attemptId: string }>({ name: 'World.StagedEvent' })
    // Emitted when a settled final-removal publication deferred a staged registration: the
    // follow-up full snapshot containing the staged site starts from this signal.
    const StagedPublicationDeferredEvent = domain.event({ name: 'World.StagedPublicationDeferredEvent' })
    const StagedPublishedEvent = domain.event<{ attemptId: string; presence: WorldRoomMessage }>({
      name: 'World.StagedPublishedEvent'
    })
    const StagedPublishFailedEvent = domain.event<{ attemptId: string; error: Error }>({
      name: 'World.StagedPublishFailedEvent'
    })
    const DomainCommittedEvent = domain.event<{ attemptId: string; domain: string }>({
      name: 'World.DomainCommittedEvent'
    })
    const DomainReleasedEvent = domain.event<string>({ name: 'World.DomainReleasedEvent' })
    const PresenceChangedEvent = domain.event<WorldPresenceEvent>({ name: 'World.PresenceChangedEvent' })
    const RecoveryPublishedEvent = domain.event<{ requestId: string; presence: WorldRoomMessage }>({
      name: 'World.RecoveryPublishedEvent'
    })
    const RecoveryPublishFailedEvent = domain.event<{ requestId: string; error: Error }>({
      name: 'World.RecoveryPublishFailedEvent'
    })
    const ErrorEvent = domain.event<Error>({ name: 'World.ErrorEvent' })
    // A live release publication whose preflight step could not reach the provider re-issues that
    // un-attempted step at a bounded cadence. It is never a per-target re-send of an attempted target.
    const PublicationStepRetryRequestedEvent = domain.event<{ requestId: string }>({
      name: 'World.PublicationStepRetryRequestedEvent'
    })

    const settlePublication = (
      get: Parameters<Parameters<typeof domain.command>[0]['impl']>[0]['get'],
      publication: Pick<FullPublication, 'presence' | 'stagedAttemptId' | 'recoveryRequestId'>
    ) => {
      const staged = get(StagedRegistrationsState()).find((item) => item.publicationPending)
      const recovery = get(RecoveryState())
      const released = get(LiveReleaseContinuationsState())
      const pendingFinal = get(PendingFinalPublicationState())
      // A final-removal publication settles only the release facts its empty payload represents: a
      // staged registration observed during it earns a follow-up full snapshot containing its own
      // site before it may publish-accept.
      const stagedDeferred = pendingFinal !== null && staged !== undefined
      const deferredRevision = get(PublicationRevisionState()) + 1
      if (stagedDeferred && !Number.isSafeInteger(deferredRevision)) {
        return [FullPublicationState().new(null), ErrorEvent(new Error('World publication revision exhausted'))]
      }
      return [
        FullPublicationState().new(null),
        ...(pendingFinal
          ? [
              PendingFinalPublicationState().new(null),
              ...(stagedDeferred ? [] : [JoinedState().new(false), PresencesState().new([]), RecoveryState().new(null)])
            ]
          : []),
        ...(released.length > 0 ? [LiveReleaseContinuationsState().new([]), ...released.map(DomainReleasedEvent)] : []),
        ...(staged && !stagedDeferred
          ? [StagedPublishedEvent({ attemptId: staged.attemptId, presence: publication.presence })]
          : []),
        ...(stagedDeferred ? [PublicationRevisionState().new(deferredRevision), StagedPublicationDeferredEvent()] : []),
        ...(recovery?.publicationPending
          ? [RecoveryPublishedEvent({ requestId: recovery.requestId, presence: publication.presence })]
          : []),
        ...(!staged && !recovery?.publicationPending && get(JoinedState())
          ? [
              PresenceChangedEvent({
                sourcePeerId: get(wireDomain.query.PeerIdQuery(worldRoomId)),
                presence: {
                  sourcePeerId: get(wireDomain.query.PeerIdQuery(worldRoomId)),
                  presence: publication.presence
                }
              })
            ]
          : [])
      ]
    }

    const EnsureFullPublicationCommand = domain.command({
      name: 'World.EnsureFullPublicationCommand',
      impl: ({ get }) => {
        const currentRevision = get(PublicationRevisionState())
        const existing = get(FullPublicationState())
        // A newer revision supersedes a running iterator: stop the old one, keep the Room and
        // the original continuation, and restart on the latest revision through the same owner.
        if (existing && existing.revision === currentRevision) return null
        const presence = get(PublicationPresenceQuery())
        if (!presence) return existing ? [FullPublicationState().new(null)] : null
        const staged = get(StagedRegistrationsState()).find((item) => item.publicationPending)
        const recovery = get(RecoveryState())
        const pendingFinal = get(PendingFinalPublicationState())
        // A final-removal publication carries only release facts; a staged registration pending
        // during it earns its own follow-up snapshot after the release publication settles.
        const stagedAttemptId = pendingFinal ? null : (staged?.attemptId ?? null)
        const recoveryRequestId = pendingFinal ? null : recovery?.publicationPending ? recovery.requestId : null
        const sequence = get(PublicationSequenceState()) + 1
        if (!Number.isSafeInteger(sequence)) return ErrorEvent(new Error('World publication sequence exhausted'))
        const publication: FullPublication = {
          requestId: publicationRequestId(sequence),
          revision: currentRevision,
          presence,
          stagedAttemptId,
          recoveryRequestId,
          ...(recoveryRequestId && recovery?.manual ? { manual: true } : {})
        }
        // A normal World publication is one room broadcast; the transport fans it out.
        return [
          PublicationSequenceState().new(sequence),
          FullPublicationState().new(publication),
          wireDomain.command.SendMessageCommand({
            requestId: publication.requestId,
            roomId: worldRoomId,
            message: publication.presence
          })
        ]
      }
    })

    const StageDomainCommand = domain.command({
      name: 'World.StageDomainCommand',
      impl: ({ get }, payload: { attemptId: string; domain: string; user: ChatUser; site: ChatSite }) => {
        const staged: StagedWorldRegistration = { ...payload, publicationPending: false, missedPeerIds: [] }
        return [
          StagedRegistrationsState().new(
            replaceBy(get(StagedRegistrationsState()), (item) => item.domain === payload.domain, staged)
          ),
          StagedEvent({ attemptId: payload.attemptId })
        ]
      }
    })

    const PublishStagedCommand = domain.command({
      name: 'World.PublishStagedCommand',
      impl: ({ get }, attemptId: string) => {
        const stages = get(StagedRegistrationsState())
        const staged = stages.find((item) => item.attemptId === attemptId)
        if (!staged || !get(StagedPresenceQuery(attemptId))) {
          return StagedPublishFailedEvent({
            attemptId,
            error: new Error('Runtime local presence disappeared during join')
          })
        }
        if (stages.some((item) => item.publicationPending)) return null
        const revision = get(PublicationRevisionState()) + 1
        if (!Number.isSafeInteger(revision)) {
          return StagedPublishFailedEvent({ attemptId, error: new Error('World publication revision exhausted') })
        }
        return [
          StagedRegistrationsState().new(
            replaceBy(stages, (item) => item.attemptId === attemptId, { ...staged, publicationPending: true })
          ),
          PublicationRevisionState().new(revision),
          EnsureFullPublicationCommand()
        ]
      }
    })

    const CompleteFullPublicationCommand = domain.command({
      name: 'World.CompleteFullPublicationCommand',
      impl: ({ get }, requestId: string) => {
        const publication = get(FullPublicationState())
        if (!publication) return null
        if (publication.requestId !== requestId) return null
        return settlePublication(get, publication)
      }
    })

    const FailFullPublicationCommand = domain.command({
      name: 'World.FailFullPublicationCommand',
      impl: ({ get }, payload: { requestId: string; error: Error; stage?: WireFailureStage }) => {
        const publication = get(FullPublicationState())
        if (!publication) return null
        if (publication.requestId !== payload.requestId) return null
        // Runtime/Room/World-owner loss invalidates the queue; that cancels the iterator quietly.
        if (payload.stage === 'cancelled' || !get(wireDomain.query.IsRoomTrustedQuery(worldRoomId))) {
          return [FullPublicationState().new(null)]
        }
        // A preflight failure performed zero provider sends. For a live-release continuation it keeps
        // the same publication step and re-issues the current un-attempted target at a bounded cadence
        // (never a per-target re-send of an attempted target, never a premature DomainReleasedEvent).
        if (payload.stage === 'preflight') {
          if (!publication.stagedAttemptId && !publication.recoveryRequestId) {
            const released = get(LiveReleaseContinuationsState())
            if (released.length === 0) return [FullPublicationState().new(null), ErrorEvent(payload.error)]
            return [ErrorEvent(payload.error), PublicationStepRetryRequestedEvent({ requestId: publication.requestId })]
          }
          return [
            FullPublicationState().new(null),
            ...(publication.stagedAttemptId
              ? [StagedPublishFailedEvent({ attemptId: publication.stagedAttemptId, error: payload.error })]
              : []),
            ...(publication.recoveryRequestId
              ? [RecoveryPublishFailedEvent({ requestId: publication.recoveryRequestId, error: payload.error })]
              : [])
          ]
        }
        // A provider throw settles the publication; a manual AppButton replacement keeps that
        // failure out of page UI/Toast but never evidence-silent, while automatic recovery
        // retains its existing diagnostics.
        if (publication.manual) console.error(payload.error)
        return [...(publication.manual ? [] : [ErrorEvent(payload.error)]), ...settlePublication(get, publication)]
      }
    })

    const RetryPublicationStepCommand = domain.command({
      name: 'World.RetryPublicationStepCommand',
      impl: ({ get }, requestId: string) => {
        const publication = get(FullPublicationState())
        const live = get(LiveReleaseContinuationsState()).length > 0
        if (
          !publication ||
          publication.requestId !== requestId ||
          !live ||
          !get(wireDomain.query.IsRoomTrustedQuery(worldRoomId))
        ) {
          return null
        }
        // Re-issue the room broadcast for the live release continuation.
        return wireDomain.command.SendMessageCommand({
          requestId,
          roomId: worldRoomId,
          message: publication.presence
        })
      }
    })

    const CommitStagedCommand = domain.command({
      name: 'World.CommitStagedCommand',
      impl: ({ get }, attemptId: string) => {
        const stages = get(StagedRegistrationsState())
        const staged = stages.find((item) => item.attemptId === attemptId)
        if (!staged) return null
        const registrations = replaceBy(get(RegistrationsState()), (item) => item.domain === staged.domain, {
          domain: staged.domain,
          user: staged.user,
          site: staged.site
        })
        const remainingStages = stages.filter((item) => item.attemptId !== attemptId)
        const nextStage = remainingStages.find((item) => !item.publicationPending)
        const presence = presenceFor(registrations, options.sessionId)
        return [
          RegistrationsState().new(registrations),
          StagedRegistrationsState().new(remainingStages),
          JoinedState().new(true),
          ...(presence
            ? [
                PresenceChangedEvent({
                  sourcePeerId: get(wireDomain.query.PeerIdQuery(worldRoomId)),
                  presence: { sourcePeerId: get(wireDomain.query.PeerIdQuery(worldRoomId)), presence }
                })
              ]
            : []),
          ...get(PresencesState()).map((remote) =>
            PresenceChangedEvent({ sourcePeerId: remote.sourcePeerId, presence: remote })
          ),
          ...staged.missedPeerIds.flatMap((sourcePeerId) =>
            presence
              ? [
                  wireDomain.command.SendMessageCommand({
                    requestId: `world:catch-up:${attemptId}:${sourcePeerId}`,
                    roomId: worldRoomId,
                    targetPeerIds: [sourcePeerId],
                    message: presence
                  })
                ]
              : []
          ),
          ...(nextStage ? [PublishStagedCommand(nextStage.attemptId)] : []),
          DomainCommittedEvent({ attemptId, domain: staged.domain })
        ]
      }
    })

    const AbortStagedCommand = domain.command({
      name: 'World.AbortStagedCommand',
      impl: ({ get }, attemptId: string) => {
        const stages = get(StagedRegistrationsState())
        const aborted = stages.find((item) => item.attemptId === attemptId)
        if (!aborted) return null
        const remainingStages = stages.filter((item) => item.attemptId !== attemptId)
        const nextStage = remainingStages.find((item) => !item.publicationPending)
        const revision = get(PublicationRevisionState()) + (aborted.publicationPending ? 1 : 0)
        if (!Number.isSafeInteger(revision)) return ErrorEvent(new Error('World publication revision exhausted'))
        // Supersession aborts the predecessor's stage while the same physical World owner stays
        // live for the successor: the projection is cleared only on actual physical departure.
        return [
          StagedRegistrationsState().new(remainingStages),
          ...(aborted.publicationPending ? [PublicationRevisionState().new(revision)] : []),
          ...(nextStage && !remainingStages.some((item) => item.publicationPending)
            ? [PublishStagedCommand(nextStage.attemptId)]
            : []),
          ...(aborted.publicationPending ? [EnsureFullPublicationCommand()] : [])
        ]
      }
    })

    // The physical World owner departed with no remaining owner: settle the same terminal truth as
    // final World departure. Intentional physical leaves drive this; attempt supersession never
    // does, because a live successor keeps the World owner joined.
    const DepartRoomCommand = domain.command({
      name: 'World.DepartRoomCommand',
      impl: ({ get }) => [
        JoinedState().new(false),
        // The application projection resets to the replacement generation: every prior remote
        // source and the prior local World peer id lose their projected contribution, so the
        // projected list rebuilds only from current-generation facts.
        ...get(PresencesState()).map((item) =>
          PresenceChangedEvent({ sourcePeerId: item.sourcePeerId, presence: null })
        ),
        PresenceChangedEvent({ sourcePeerId: get(wireDomain.query.PeerIdQuery(worldRoomId)), presence: null }),
        PresencesState().new([]),
        // Prior room membership, every pending presence send, and the old full-publication REQUEST
        // owner lose authority with the old generation (an already invoked old provider send then
        // settles against no live slot). Live release continuations and any pending final
        // publication are NOT discarded: they migrate to the fresh generation's current-snapshot
        // publication, which settles each release exactly once.
        RoomMembersState().new([]),
        PendingPresenceSendsState().new([]),
        FullPublicationState().new(null),
        WorldSendGenerationState().new(get(WorldSendGenerationState()) + 1),
        RecoveryState().new(null)
      ]
    })

    const PublishCurrentCommand = domain.command({
      name: 'World.PublishCurrentCommand',
      impl: ({ get }, payload: { requestId: string; targetPeerIds?: string[] }) => {
        const presence = get(LocalPresenceQuery())
        if (!get(JoinedState()) || !presence) return null
        if (payload.targetPeerIds === undefined) {
          const revision = get(PublicationRevisionState()) + 1
          if (!Number.isSafeInteger(revision)) return ErrorEvent(new Error('World publication revision exhausted'))
          return [PublicationRevisionState().new(revision), EnsureFullPublicationCommand()]
        }
        return [
          PendingPresenceSendsState().new([
            ...get(PendingPresenceSendsState()).filter((item) => item.requestId !== payload.requestId),
            { requestId: payload.requestId }
          ]),
          wireDomain.command.SendMessageCommand({
            requestId: payload.requestId,
            roomId: worldRoomId,
            targetPeerIds: payload.targetPeerIds,
            message: presence
          })
        ]
      }
    })

    const CompletePresenceSendCommand = domain.command({
      name: 'World.CompletePresenceSendCommand',
      impl: ({ get }, requestId: string) => {
        const pending = get(PendingPresenceSendsState())
        const current = pending.find((item) => item.requestId === requestId)
        if (!current) return null
        return PendingPresenceSendsState().new(pending.filter((item) => item.requestId !== requestId))
      }
    })

    const FailPresenceSendCommand = domain.command({
      name: 'World.FailPresenceSendCommand',
      impl: ({ get }, payload: { requestId: string; error: Error }) => {
        const pending = get(PendingPresenceSendsState())
        return pending.some((item) => item.requestId === payload.requestId)
          ? [
              PendingPresenceSendsState().new(pending.filter((item) => item.requestId !== payload.requestId)),
              ErrorEvent(payload.error)
            ]
          : null
      }
    })

    const ReleaseDomainCommand = domain.command({
      name: 'World.ReleaseDomainCommand',
      impl: ({ get }, runtimeDomain: string) => {
        const registrations = get(RegistrationsState())
        const stages = get(StagedRegistrationsState())
        const removed = registrations.find((item) => item.domain === runtimeDomain)
        const next = registrations.filter((item) => item.domain !== runtimeDomain)
        const remainingStages = stages.filter((item) => item.domain !== runtimeDomain)
        if (next.length === registrations.length && remainingStages.length === stages.length) return null
        const activeBefore = stages.find((item) => item.publicationPending)
        const activeAfter = remainingStages.find((item) => item.publicationPending)
        const publicationChanged =
          next.length !== registrations.length || activeBefore?.attemptId !== activeAfter?.attemptId
        const revision = get(PublicationRevisionState()) + (publicationChanged ? 1 : 0)
        if (!Number.isSafeInteger(revision)) return ErrorEvent(new Error('World publication revision exhausted'))
        const nextStage = remainingStages.find((item) => !item.publicationPending)
        const finalSite = next.length === 0 && remainingStages.length === 0 && removed
        // Even the final site owes the World room its removal snapshot (empty `sites`) before the
        // release owner may close; the continuation survives a zero-page state and retries only the
        // remaining publication step at the bounded cadence.
        const continuationNeeded = publicationChanged && (next.length > 0 || Boolean(finalSite))
        return [
          RegistrationsState().new(next),
          StagedRegistrationsState().new(remainingStages),
          ...(finalSite ? [PendingFinalPublicationState().new({ user: removed.user })] : []),
          ...(continuationNeeded
            ? [LiveReleaseContinuationsState().new(appendUnique(get(LiveReleaseContinuationsState()), runtimeDomain))]
            : []),
          ...(publicationChanged ? [PublicationRevisionState().new(revision)] : []),
          ...(nextStage && !activeAfter ? [PublishStagedCommand(nextStage.attemptId)] : []),
          ...(publicationChanged ? [EnsureFullPublicationCommand()] : []),
          ...(continuationNeeded ? [] : [DomainReleasedEvent(runtimeDomain)])
        ]
      }
    })

    const ApplyPresenceCommand = domain.command({
      name: 'World.ApplyPresenceCommand',
      impl: ({ get }, payload: WireMessageEvent) => {
        if (!('sites' in payload.message) || payload.roomId !== worldRoomId) return null
        const presences = get(PresencesState())
        const current = presences.find((item) => item.sourcePeerId === payload.sourcePeerId)
        if (
          current?.presence.sessionId === payload.message.sessionId &&
          current.presence.user.id !== payload.message.user.id
        ) {
          return wireDomain.command.DropProtocolCommand({
            sourcePeerId: payload.sourcePeerId,
            reason: 'World user changed inside a bound session'
          })
        }
        const record = { sourcePeerId: payload.sourcePeerId, presence: payload.message }
        return [
          PresencesState().new(replaceBy(presences, (item) => item.sourcePeerId === payload.sourcePeerId, record)),
          ...(get(JoinedState()) && get(RegistrationsState()).length > 0
            ? [PresenceChangedEvent({ sourcePeerId: payload.sourcePeerId, presence: record })]
            : []),
          // A presence from a peer outside the current Room generation still earns one targeted reply;
          // current Room peers are already covered by the iterator or join catch-up.
          ...(current === undefined &&
          !get(RoomMembersState()).includes(payload.sourcePeerId) &&
          get(JoinedState()) &&
          get(RegistrationsState()).length > 0 &&
          !get(StagedRegistrationsState()).some((item) => item.publicationPending) &&
          !get(RecoveryState())?.publicationPending
            ? [
                PublishCurrentCommand({
                  requestId: `world:discovered:${get(WorldSendGenerationState())}:${payload.sourcePeerId}`,
                  targetPeerIds: [payload.sourcePeerId]
                })
              ]
            : [])
        ]
      }
    })

    const PeerJoinedCommand = domain.command({
      name: 'World.PeerJoinedCommand',
      impl: ({ get }, payload: { roomId: string; sourcePeerId: string }) => {
        if (payload.roomId !== worldRoomId) return null
        const members = get(RoomMembersState())
        const nextMembers = members.includes(payload.sourcePeerId) ? members : [...members, payload.sourcePeerId]
        const stages = get(StagedRegistrationsState())
        const changed = stages.map((stage) =>
          stage.publicationPending
            ? { ...stage, missedPeerIds: appendUnique(stage.missedPeerIds, payload.sourcePeerId) }
            : stage
        )
        const recovery = get(RecoveryState())
        const nextRecovery = recovery?.publicationPending
          ? { ...recovery, missedPeerIds: appendUnique(recovery.missedPeerIds, payload.sourcePeerId) }
          : recovery
        const memberUpdate = nextMembers === members ? [] : [RoomMembersState().new(nextMembers)]
        if (stages.some((stage) => stage.publicationPending) || recovery) {
          return [
            ...memberUpdate,
            StagedRegistrationsState().new(changed),
            ...(nextRecovery ? [RecoveryState().new(nextRecovery)] : [])
          ]
        }
        return [
          ...memberUpdate,
          PublishCurrentCommand({
            requestId: `world:peer:${get(WorldSendGenerationState())}:${payload.sourcePeerId}`,
            targetPeerIds: [payload.sourcePeerId]
          })
        ]
      }
    })

    const PeerLeftCommand = domain.command({
      name: 'World.PeerLeftCommand',
      impl: ({ get }, payload: { roomId: string; sourcePeerId: string }) => {
        if (payload.roomId !== worldRoomId) return null
        const memberRemoval = get(RoomMembersState()).includes(payload.sourcePeerId)
          ? [RoomMembersState().new(get(RoomMembersState()).filter((item) => item !== payload.sourcePeerId))]
          : []
        const stages = get(StagedRegistrationsState()).map((stage) => ({
          ...stage,
          missedPeerIds: stage.missedPeerIds.filter((item) => item !== payload.sourcePeerId)
        }))
        const recovery = get(RecoveryState())
        const presences = get(PresencesState())
        const hasPresence = presences.some((item) => item.sourcePeerId === payload.sourcePeerId)
        return [
          ...memberRemoval,
          StagedRegistrationsState().new(stages),
          ...(recovery
            ? [
                RecoveryState().new({
                  ...recovery,
                  missedPeerIds: recovery.missedPeerIds.filter((item) => item !== payload.sourcePeerId)
                })
              ]
            : []),
          ...(hasPresence
            ? [
                PresencesState().new(presences.filter((item) => item.sourcePeerId !== payload.sourcePeerId)),
                ...(get(JoinedState())
                  ? [PresenceChangedEvent({ sourcePeerId: payload.sourcePeerId, presence: null })]
                  : [])
              ]
            : [])
        ]
      }
    })

    const BeginRecoveryCommand = domain.command({
      name: 'World.BeginRecoveryCommand',
      impl: (_, payload: { requestId: string; manual?: boolean }) => [
        JoinedState().new(false),
        RecoveryState().new({
          requestId: payload.requestId,
          publicationPending: false,
          missedPeerIds: [],
          manual: payload.manual
        })
      ]
    })

    const PublishRecoveryCommand = domain.command({
      name: 'World.PublishRecoveryCommand',
      impl: ({ get }, requestId: string) => {
        const recovery = get(RecoveryState())
        if (!recovery || recovery.requestId !== requestId || !get(PublicationPresenceQuery())) {
          return RecoveryPublishFailedEvent({ requestId, error: new Error('Runtime local presence disappeared') })
        }
        const revision = get(PublicationRevisionState()) + 1
        if (!Number.isSafeInteger(revision)) {
          return RecoveryPublishFailedEvent({ requestId, error: new Error('World publication revision exhausted') })
        }
        return [
          RecoveryState().new({ ...recovery, publicationPending: true }),
          PublicationRevisionState().new(revision),
          EnsureFullPublicationCommand()
        ]
      }
    })

    const CommitRecoveryCommand = domain.command({
      name: 'World.CommitRecoveryCommand',
      impl: ({ get }, requestId: string) => {
        const recovery = get(RecoveryState())
        const presence = get(LocalPresenceQuery())
        if (!recovery || recovery.requestId !== requestId || !presence) return null
        return [
          RecoveryState().new(null),
          JoinedState().new(true),
          PresenceChangedEvent({
            sourcePeerId: get(wireDomain.query.PeerIdQuery(worldRoomId)),
            presence: { sourcePeerId: get(wireDomain.query.PeerIdQuery(worldRoomId)), presence }
          }),
          ...recovery.missedPeerIds.map((sourcePeerId) =>
            wireDomain.command.SendMessageCommand({
              requestId: recovery.manual
                ? `world:manual-catch-up:${requestId}:${sourcePeerId}`
                : `world:recovery-catch-up:${requestId}:${sourcePeerId}`,
              roomId: worldRoomId,
              targetPeerIds: [sourcePeerId],
              message: presence
            })
          )
        ]
      }
    })

    const AbortRecoveryCommand = domain.command({
      name: 'World.AbortRecoveryCommand',
      impl: ({ get }, requestId: string) =>
        get(RecoveryState())?.requestId === requestId ? [RecoveryState().new(null), JoinedState().new(false)] : null
    })

    domain.effect({
      name: 'World.StagedPublicationDeferredEffect',
      impl: ({ fromEvent }) => fromEvent(StagedPublicationDeferredEvent).pipe(map(() => EnsureFullPublicationCommand()))
    })

    domain.effect({
      name: 'World.WireMessageEffect',
      impl: ({ fromEvent }) =>
        fromEvent(wireDomain.event.MessageAcceptedEvent).pipe(
          filter((event) => 'sites' in event.message),
          map(ApplyPresenceCommand)
        )
    })
    domain.effect({
      name: 'World.SendSuccessEffect',
      impl: ({ fromEvent }) =>
        fromEvent(wireDomain.event.MessageSentEvent).pipe(
          map(({ requestId }) => [CompleteFullPublicationCommand(requestId), CompletePresenceSendCommand(requestId)])
        )
    })
    domain.effect({
      name: 'World.SendFailureEffect',
      impl: ({ fromEvent }) =>
        fromEvent(wireDomain.event.MessageSendFailedEvent).pipe(
          map((payload) => [FailFullPublicationCommand(payload), FailPresenceSendCommand(payload)])
        )
    })
    domain.effect({
      name: 'World.PublicationStepRetryEffect',
      impl: ({ fromEvent }) =>
        fromEvent(PublicationStepRetryRequestedEvent).pipe(
          concatMap(
            ({ requestId }) =>
              new globalThis.Promise<string>((resolve) =>
                globalThis.setTimeout(() => resolve(requestId), WORLD_RELEASE_STEP_RETRY_MS)
              )
          ),
          map(RetryPublicationStepCommand)
        )
    })
    domain.effect({
      name: 'World.CatchUpFailureEffect',
      impl: ({ fromEvent }) =>
        fromEvent(wireDomain.event.MessageSendFailedEvent).pipe(
          filter(
            ({ requestId }) =>
              requestId.startsWith('world:catch-up:') ||
              requestId.startsWith('world:recovery-catch-up:') ||
              requestId.startsWith('world:manual-catch-up:')
          ),
          map(({ requestId, error }) => {
            // A manual AppButton replacement's catch-up failure stays out of page UI but never
            // evidence-silent; automatic recovery and ordinary join catch-up keep diagnostics.
            if (requestId.startsWith('world:manual-catch-up:')) {
              console.error(error)
              return null
            }
            return ErrorEvent(error)
          })
        )
    })

    return {
      query: {
        RegistrationsQuery,
        JoinedQuery,
        PresencesQuery,
        LocalPresenceQuery,
        StagedPresenceQuery,
        WorldDemandQuery
      },
      command: {
        StageDomainCommand,
        PublishStagedCommand,
        CommitStagedCommand,
        AbortStagedCommand,
        DepartRoomCommand,
        PublishCurrentCommand,
        ReleaseDomainCommand,
        PeerJoinedCommand,
        PeerLeftCommand,
        BeginRecoveryCommand,
        PublishRecoveryCommand,
        CommitRecoveryCommand,
        AbortRecoveryCommand
      },
      event: {
        StagedEvent,
        StagedPublishedEvent,
        StagedPublishFailedEvent,
        DomainCommittedEvent,
        DomainReleasedEvent,
        PresenceChangedEvent,
        RecoveryPublishedEvent,
        RecoveryPublishFailedEvent,
        ErrorEvent
      }
    }
  }
})

export default WorldDomain
