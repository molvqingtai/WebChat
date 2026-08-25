import { Remesh } from 'remesh'
import * as v from 'valibot'
import { fromEventPattern, map, mergeMap } from 'rxjs'
import { MAX_DECODE_QUEUE_BYTES, MAX_DECODE_QUEUE_FRAMES, WORLD_ROOM_ID_V5 } from '@/constants/config'
import { RoomTransportExtern, WireCodecExtern } from '@/domain/runtime/externs/RoomTransport'
import { ChatRoomMessageSchema, WorldRoomMessageSchema, type ChatRoomMessage, type WorldRoomMessage } from '@/protocol'
import { getTextByteSize } from '@/utils/getTextByteSize'
import stringToHex from '@/utils/stringToHex'

export type WireMessage = ChatRoomMessage | WorldRoomMessage

export interface WireJoinResult {
  requestId: string
  roomIds: string[]
}

export type WireFailureStage = 'preflight' | 'provider' | 'cancelled'

export interface WireFailure {
  requestId: string
  error: Error
  stage?: WireFailureStage
}

interface WireSendRequestBase {
  requestId: string
  roomId: string
  message: WireMessage
}

export type WireSendRequest = WireSendRequestBase & { targetPeerIds?: string[] }

export interface WireMessageEvent {
  roomId: string
  sourcePeerId: string
  /** Present for provider ingress; internal callers that do not cross a physical peer fence omit it. */
  sourceGeneration?: number
  message: WireMessage
}

/** Server-private ingress route used only while a dual replacement is preparing. */
export interface WirePreparedMessageEvent extends WireMessageEvent {
  epoch: string
  /** Physical room incarnation chosen by the prepared route, distinct from source generation. */
  roomGeneration: number
}

interface RoomGeneration {
  roomId: string
  generation: number
}

interface PreparedRoute {
  epoch: string
  requestId: string
  rooms: RoomGeneration[]
  /** Provider joins completed for every room; only ready routes may admit staged ingress or commit. */
  ready: boolean
}

interface QueueIdentity {
  generation: number
  sequence: number
}

interface RawFrame extends QueueIdentity {
  roomId: string
  sourcePeerId: string
  sourceGeneration: number
  rawPayload: string
  wireBytes: number
  /** Internal ingress-drain settlement; never enters protocol state or a projection. */
  settle?: () => void
}

type QueuedSendRequest = WireSendRequest & QueueIdentity

interface EncodedSend {
  request: QueuedSendRequest
  rawPayload: string
}

interface DecodeQueue {
  id: string
  frameCount: number
  wireBytes: number
  frames: RawFrame[]
}

interface SendQueue {
  roomId: string
  requestCount: number
  suspended: boolean
  /** True while the head request's provider call has already started and must settle, never re-send. */
  headInvoked: boolean
  requests: QueuedSendRequest[]
}

interface DropRecord {
  sourcePeerId: string
  loggedAt: number
}

interface RoomSource {
  sourcePeerId: string
  generation: number
}

interface RoomSources {
  roomId: string
  sources: RoomSource[]
}

interface SourceIncarnation {
  roomId: string
  sourcePeerId: string
  generation: number
}

const MAX_LOGGED_SOURCES = 256
const LOG_INTERVAL_MS = 10000
const worldRoomId = stringToHex(WORLD_ROOM_ID_V5)
const queueId = (roomId: string, sourcePeerId: string) => JSON.stringify([roomId, sourcePeerId])
const generationFor = (generations: RoomGeneration[], roomId: string) =>
  generations.find((item) => item.roomId === roomId)?.generation ?? 0
const sourceGenerationFor = (sources: RoomSources[], roomId: string, sourcePeerId: string) =>
  sources.find((item) => item.roomId === roomId)?.sources.find((item) => item.sourcePeerId === sourcePeerId)?.generation
const replaceBy = <T>(items: T[], predicate: (item: T) => boolean, next: T): T[] =>
  items.some(predicate) ? items.map((item) => (predicate(item) ? next : item)) : [...items, next]

/**
 * Deduplicates and self-excludes the supplied peer ids. Retained only for the explicit targeted
 * sends (History inventory/response and Session/World catch-up); room-wide product sends now use
 * the provider's native broadcast instead.
 */
export const selectPeerIds = (sourcePeerIds: string[], selfPeerId: string): string[] =>
  [...new Set(sourcePeerIds)].filter((peerId) => peerId !== selfPeerId)

const WireDomain = Remesh.domain({
  name: 'WireDomain',
  impl: (domain) => {
    const transport = domain.getExtern(RoomTransportExtern)
    const codec = domain.getExtern(WireCodecExtern)

    const TrustedRoomsState = domain.state<string[]>({ name: 'Wire.TrustedRoomsState', default: [] })
    const RoomGenerationsState = domain.state<RoomGeneration[]>({
      name: 'Wire.RoomGenerationsState',
      default: []
    })
    const DecodeQueuesState = domain.state<DecodeQueue[]>({ name: 'Wire.DecodeQueuesState', default: [] })
    const SendQueuesState = domain.state<SendQueue[]>({ name: 'Wire.SendQueuesState', default: [] })
    const QueueSequenceState = domain.state<number>({ name: 'Wire.QueueSequenceState', default: 0 })
    const DropRecordsState = domain.state<DropRecord[]>({ name: 'Wire.DropRecordsState', default: [] })
    // Current physical source admission per room: a source is admitted only while it is a member
    // of the current room generation (PeerJoined added it and no PeerLeave/room close removed it).
    // This is the upstream fact the lawful-rebind classifier requires before an ended observation
    // may be re-activated; a departed source without a fresh PeerJoin is never admitted.
    const RoomSourcesState = domain.state<RoomSources[]>({
      name: 'Wire.RoomSourcesState',
      default: []
    })
    // Kept after a leave for the current room lifecycle so a reused peer id gets a fresh
    // physical incarnation and an old asynchronous decode can never settle into it.
    const SourceIncarnationsState = domain.state<SourceIncarnation[]>({
      name: 'Wire.SourceIncarnationsState',
      default: []
    })
    // Prepared routes intentionally sit outside TrustedRoomsState. Their decoded frames may be
    // consumed only by the matching staged Session/World owners until Server commits both sides.
    const PreparedRoutesState = domain.state<PreparedRoute[]>({ name: 'Wire.PreparedRoutesState', default: [] })

    const PeerIdQuery = domain.query({
      name: 'Wire.PeerIdQuery',
      impl: (_, roomId: string) => transport.peerIdOf(roomId)
    })
    const IsSourceAdmittedQuery = domain.query({
      name: 'Wire.IsSourceAdmittedQuery',
      impl: ({ get }, payload: { roomId: string; sourcePeerId: string }) =>
        get(RoomSourcesState())
          .find((item) => item.roomId === payload.roomId)
          ?.sources.some((item) => item.sourcePeerId === payload.sourcePeerId) ?? false
    })
    const SourcesQuery = domain.query({
      name: 'Wire.SourcesQuery',
      impl: ({ get }, roomId: string) =>
        get(RoomSourcesState())
          .find((item) => item.roomId === roomId)
          ?.sources.map((source) => ({ ...source })) ?? []
    })
    const TrustedRoomsQuery = domain.query({
      name: 'Wire.TrustedRoomsQuery',
      impl: ({ get }) => get(TrustedRoomsState())
    })
    const RoomGenerationQuery = domain.query({
      name: 'Wire.RoomGenerationQuery',
      impl: ({ get }, roomId: string) => generationFor(get(RoomGenerationsState()), roomId)
    })
    const IsRoomTrustedQuery = domain.query({
      name: 'Wire.IsRoomTrustedQuery',
      impl: ({ get }, roomId: string) => get(TrustedRoomsState()).includes(roomId)
    })
    const DecodeQueuesQuery = domain.query({
      name: 'Wire.DecodeQueuesQuery',
      impl: ({ get }) =>
        get(DecodeQueuesState()).map(({ id, frameCount, wireBytes }) => ({ id, frameCount, wireBytes }))
    })
    const PreparedRouteQuery = domain.query({
      name: 'Wire.PreparedRouteQuery',
      impl: ({ get }, epoch: string) => get(PreparedRoutesState()).find((route) => route.epoch === epoch) ?? null
    })
    const IsPreparedRouteCurrentQuery = domain.query({
      name: 'Wire.IsPreparedRouteCurrentQuery',
      impl: ({ get }, epoch: string) => {
        const route = get(PreparedRoutesState()).find((item) => item.epoch === epoch)
        return Boolean(
          route?.ready &&
          route.rooms.every((room) => generationFor(get(RoomGenerationsState()), room.roomId) === room.generation)
        )
      }
    })

    const RoomsJoinedEvent = domain.event<WireJoinResult>({ name: 'Wire.RoomsJoinedEvent' })
    /** Private terminal. It is not a public Wire completion and never reaches Page consumers. */
    const RoomsPreparedEvent = domain.event<WireJoinResult & { epoch: string }>({ name: 'Wire.RoomsPreparedEvent' })
    const RoomsJoinFailedEvent = domain.event<WireFailure>({ name: 'Wire.RoomsJoinFailedEvent' })
    const MessageSentEvent = domain.event<{ requestId: string }>({ name: 'Wire.MessageSentEvent' })
    const MessageSendFailedEvent = domain.event<WireFailure>({ name: 'Wire.MessageSendFailedEvent' })
    const MessageAcceptedEvent = domain.event<WireMessageEvent>({ name: 'Wire.MessageAcceptedEvent' })
    const PreparedMessageAcceptedEvent = domain.event<WirePreparedMessageEvent>({
      name: 'Wire.PreparedMessageAcceptedEvent'
    })
    const PeerJoinedEvent = domain.event<{ roomId: string; sourcePeerId: string }>({
      name: 'Wire.PeerJoinedEvent'
    })
    const PeerLeftEvent = domain.event<{ roomId: string; sourcePeerId: string }>({ name: 'Wire.PeerLeftEvent' })
    const RoomClosedEvent = domain.event<{ roomId: string }>({ name: 'Wire.RoomClosedEvent' })
    const ErrorEvent = domain.event<{ error: Error; roomId: string }>({ name: 'Wire.ErrorEvent' })
    const ProtocolDropEvent = domain.event<{ sourcePeerId: string; reason: string; error?: unknown }>({
      name: 'Wire.ProtocolDropEvent'
    })
    const JoinRoomsRequestedEvent = domain.event<{
      requestId: string
      rooms: { roomId: string; generation: number }[]
    }>({ name: 'Wire.JoinRoomsRequestedEvent' })
    const PrepareRoomsRequestedEvent = domain.event<PreparedRoute>({ name: 'Wire.PrepareRoomsRequestedEvent' })
    const LeaveRoomRequestedEvent = domain.event<{ roomId: string; diagnosticOnly?: boolean }>({
      name: 'Wire.LeaveRoomRequestedEvent'
    })
    const SendRequestedEvent = domain.event<QueuedSendRequest>({ name: 'Wire.SendRequestedEvent' })
    const SendResumeAfterJoinRequestedEvent = domain.event<QueueIdentity & { roomId: string }>({
      name: 'Wire.SendResumeAfterJoinRequestedEvent'
    })
    const ProviderSendRequestedEvent = domain.event<EncodedSend>({ name: 'Wire.ProviderSendRequestedEvent' })
    const RawFrameAdmittedEvent = domain.event<RawFrame>({ name: 'Wire.RawFrameAdmittedEvent' })

    // The single peer-receive parse boundary: the room-selected complete declarative schema
    // owns all protocol validation. A rejection emits no typed message and reaches no downstream
    // domain or user-visible feedback.
    const parseMessage = (roomId: string, value: unknown): WireMessage | null => {
      const parsed =
        roomId === worldRoomId ? v.safeParse(WorldRoomMessageSchema, value) : v.safeParse(ChatRoomMessageSchema, value)
      return parsed.success ? parsed.output : null
    }

    const RecordDropCommand = domain.command({
      name: 'Wire.RecordDropCommand',
      impl: ({ get }, payload: { sourcePeerId: string; reason: string; error?: unknown }) => {
        const timestamp = Date.now()
        const records = get(DropRecordsState())
        const current = records.find((item) => item.sourcePeerId === payload.sourcePeerId)
        if (current && timestamp - current.loggedAt < LOG_INTERVAL_MS) return null
        const bounded = current ? records : records.length >= MAX_LOGGED_SOURCES ? records.slice(1) : records
        return [
          DropRecordsState().new(
            replaceBy(bounded, (item) => item.sourcePeerId === payload.sourcePeerId, {
              sourcePeerId: payload.sourcePeerId,
              loggedAt: timestamp
            })
          ),
          ProtocolDropEvent(payload)
        ]
      }
    })

    const JoinRoomsCommand = domain.command({
      name: 'Wire.JoinRoomsCommand',
      impl: ({ get }, payload: { requestId: string; roomIds: string[] }) => {
        const generations = get(RoomGenerationsState())
        return JoinRoomsRequestedEvent({
          requestId: payload.requestId,
          rooms: [...new Set(payload.roomIds)].map((roomId) => ({
            roomId,
            generation: generations.find((item) => item.roomId === roomId)?.generation ?? 0
          }))
        })
      }
    })

    const PrepareRoomsCommand = domain.command({
      name: 'Wire.PrepareRoomsCommand',
      impl: ({ get }, payload: { epoch: string; requestId: string; roomIds: string[] }) => {
        if (!payload.epoch || get(PreparedRoutesState()).some((route) => route.epoch === payload.epoch)) return null
        const generations = get(RoomGenerationsState())
        const route: PreparedRoute = {
          epoch: payload.epoch,
          requestId: payload.requestId,
          rooms: [...new Set(payload.roomIds)].map((roomId) => ({
            roomId,
            generation: generationFor(generations, roomId)
          })),
          ready: false
        }
        return [PreparedRoutesState().new([...get(PreparedRoutesState()), route]), PrepareRoomsRequestedEvent(route)]
      }
    })

    /**
     * A replacement's logical cut. It deliberately has no provider call or public terminal: the
     * Server invokes it only after the transport has retired every selected physical owner.
     * Source-incarnation tombstones remain, so an old peer id cannot speak again without a fresh
     * post-cut PeerJoined admission.
     */
    const BeginEpochReplacementCommand = domain.command({
      name: 'Wire.BeginEpochReplacementCommand',
      impl: ({ get }, payload: { rooms: RoomGeneration[] }) => {
        const selected = [...new Map(payload.rooms.map((room) => [room.roomId, room])).values()]
        const selectedIds = selected.map((room) => room.roomId)
        const generations = get(RoomGenerationsState())
        if (
          selected.length !== payload.rooms.length ||
          selected.some((room) => room.generation !== generationFor(generations, room.roomId) + 1)
        ) {
          return null
        }
        const decodeQueues = get(DecodeQueuesState())
        decodeQueues
          .filter((queue) => queue.frames.some((frame) => selectedIds.includes(frame.roomId)))
          .flatMap((queue) => queue.frames)
          .forEach((frame) => frame.settle?.())
        return [
          RoomGenerationsState().new(
            selected.reduce(
              (current, room) => replaceBy(current, (item) => item.roomId === room.roomId, room),
              generations
            )
          ),
          TrustedRoomsState().new(get(TrustedRoomsState()).filter((roomId) => !selectedIds.includes(roomId))),
          RoomSourcesState().new(get(RoomSourcesState()).filter((room) => !selectedIds.includes(room.roomId))),
          DecodeQueuesState().new(
            decodeQueues.filter((queue) => !queue.frames.some((frame) => selectedIds.includes(frame.roomId)))
          ),
          SendQueuesState().new(get(SendQueuesState()).filter((queue) => !selectedIds.includes(queue.roomId))),
          PreparedRoutesState().new(
            get(PreparedRoutesState()).filter((route) => !route.rooms.some((room) => selectedIds.includes(room.roomId)))
          )
        ]
      }
    })

    /**
     * A provider call that already started must settle its target once. It pops the head and emits the
     * result even if the room generation changed meanwhile; it is never re-sent into a new generation.
     */
    const AdmitSourceCommand = domain.command({
      name: 'Wire.AdmitSourceCommand',
      impl: ({ get }, payload: { roomId: string; sourcePeerId: string }) => {
        const prepared = get(PreparedRoutesState()).some((route) =>
          route.rooms.some(
            (room) =>
              room.roomId === payload.roomId &&
              room.generation === generationFor(get(RoomGenerationsState()), room.roomId)
          )
        )
        if (!get(TrustedRoomsState()).includes(payload.roomId) && !prepared) return null
        const sources = get(RoomSourcesState())
        const room = sources.find((item) => item.roomId === payload.roomId)
        if (room?.sources.some((source) => source.sourcePeerId === payload.sourcePeerId)) return null
        const incarnations = get(SourceIncarnationsState())
        const prior = incarnations.find(
          (item) => item.roomId === payload.roomId && item.sourcePeerId === payload.sourcePeerId
        )
        const source = { sourcePeerId: payload.sourcePeerId, generation: (prior?.generation ?? 0) + 1 }
        const nextIncarnations = replaceBy(
          incarnations,
          (item) => item.roomId === payload.roomId && item.sourcePeerId === payload.sourcePeerId,
          { roomId: payload.roomId, ...source }
        )
        const next = room
          ? sources.map((item) =>
              item.roomId === payload.roomId
                ? {
                    roomId: item.roomId,
                    sources: [...item.sources, source]
                  }
                : item
            )
          : [...sources, { roomId: payload.roomId, sources: [source] }]
        return [SourceIncarnationsState().new(nextIncarnations), RoomSourcesState().new(next)]
      }
    })

    const RemoveSourceCommand = domain.command({
      name: 'Wire.RemoveSourceCommand',
      impl: ({ get }, payload: { roomId: string; sourcePeerId: string }) => {
        const sources = get(RoomSourcesState())
        const room = sources.find((item) => item.roomId === payload.roomId)
        if (!room) return null
        const remaining = room.sources.filter((item) => item.sourcePeerId !== payload.sourcePeerId)
        return RoomSourcesState().new(
          remaining.length === 0
            ? sources.filter((item) => item.roomId !== payload.roomId)
            : sources.map((item) =>
                item.roomId === payload.roomId ? { roomId: item.roomId, sources: remaining } : item
              )
        )
      }
    })

    /** Rehydrates only current physical admission facts from an atomic transport rebind cut. */
    const RecoverTransportStateCommand = domain.command({
      name: 'Wire.RecoverTransportStateCommand',
      impl: ({ get }, payload: Array<{ roomId: string; sources: RoomSource[] }>) => {
        const recovered = payload
          .filter(({ roomId }) => roomId.length > 0)
          .map(({ roomId, sources }) => ({
            roomId,
            sources: [...new Map(sources.map((source) => [source.sourcePeerId, source])).values()]
          }))
        if (recovered.length === 0) return null
        const roomIds = [...new Set(recovered.map(({ roomId }) => roomId))]
        const sources = get(RoomSourcesState()).filter((item) => !roomIds.includes(item.roomId))
        const incarnations = get(SourceIncarnationsState()).filter((item) => !roomIds.includes(item.roomId))
        return [
          TrustedRoomsState().new([...new Set([...get(TrustedRoomsState()), ...roomIds])]),
          RoomSourcesState().new([...sources, ...recovered]),
          SourceIncarnationsState().new([
            ...incarnations,
            ...recovered.flatMap(({ roomId, sources }) => sources.map((source) => ({ roomId, ...source })))
          ])
        ]
      }
    })

    const CompleteProviderSendCommand = domain.command({
      name: 'Wire.CompleteProviderSendCommand',
      impl: ({ get }, payload: { request: QueuedSendRequest; error?: Error }) => {
        const { request } = payload
        const queues = get(SendQueuesState())
        const current = queues.find((item) => item.roomId === request.roomId)
        if (current?.requests[0]?.sequence !== request.sequence) return null
        const requests = current.requests.slice(1)
        const nextHead = requests[0]
        // The next request starts only when its room is trusted and its generation is current;
        // otherwise the tail stays suspended for a lawful join transition instead of reaching the
        // provider after a logical leave or going stale across a generation boundary.
        const canStartNext =
          nextHead !== undefined &&
          get(TrustedRoomsState()).includes(request.roomId) &&
          generationFor(get(RoomGenerationsState()), request.roomId) === nextHead.generation
        const nextQueues =
          requests.length === 0
            ? queues.filter((item) => item.roomId !== request.roomId)
            : replaceBy(queues, (item) => item.roomId === request.roomId, {
                roomId: request.roomId,
                requestCount: requests.length,
                suspended: !canStartNext,
                headInvoked: false,
                requests
              })
        const result = payload.error
          ? MessageSendFailedEvent({ requestId: request.requestId, error: payload.error, stage: 'provider' })
          : MessageSentEvent({ requestId: request.requestId })
        return requests.length === 0
          ? [SendQueuesState().new(nextQueues), result]
          : canStartNext
            ? [SendQueuesState().new(nextQueues), result, SendRequestedEvent(nextHead)]
            : [SendQueuesState().new(nextQueues), result]
      }
    })

    const CompleteJoinRoomsCommand = domain.command({
      name: 'Wire.CompleteJoinRoomsCommand',
      impl: ({ get }, payload: { requestId: string; rooms: { roomId: string; generation: number }[] }) => {
        const generations = get(RoomGenerationsState())
        const current = (roomId: string) => generations.find((item) => item.roomId === roomId)?.generation ?? 0
        if (payload.rooms.some((room) => current(room.roomId) !== room.generation)) {
          return RoomsJoinFailedEvent({
            requestId: payload.requestId,
            error: new Error('Room join superseded')
          })
        }
        const roomIds = payload.rooms.map((room) => room.roomId)
        const sendQueues = get(SendQueuesState())
        const resumed = roomIds.flatMap((roomId) => {
          if (roomId === worldRoomId) return []
          const queue = sendQueues.find((item) => item.roomId === roomId)
          // Every suspended owner moves into the new join generation so no tail is stranded stale,
          // but only a never-invoked head is re-sent here; an already invoked head keeps settling
          // its own physical result and is never re-sent.
          return queue?.suspended && queue.requests[0] ? [{ roomId, queue, head: queue.requests[0] }] : []
        })
        const nextQueues = resumed.reduce(
          (queues, { roomId, queue }) =>
            replaceBy(queues, (item) => item.roomId === roomId, {
              ...queue,
              suspended: !queue.headInvoked,
              requests: queue.requests.map((request) => ({ ...request, generation: current(roomId) }))
            }),
          sendQueues
        )
        return [
          TrustedRoomsState().new([...new Set([...get(TrustedRoomsState()), ...roomIds])]),
          ...(resumed.length ? [SendQueuesState().new(nextQueues)] : []),
          RoomsJoinedEvent({
            requestId: payload.requestId,
            roomIds
          }),
          ...resumed
            .filter(({ queue }) => !queue.headInvoked)
            .map(({ head, roomId }) =>
              SendResumeAfterJoinRequestedEvent({
                roomId,
                generation: current(roomId),
                sequence: head.sequence
              })
            )
        ]
      }
    })

    const CompletePreparedRoomsCommand = domain.command({
      name: 'Wire.CompletePreparedRoomsCommand',
      impl: ({ get }, route: PreparedRoute) => {
        const current = (roomId: string) => generationFor(get(RoomGenerationsState()), roomId)
        const prepared = get(PreparedRoutesState()).find((item) => item.epoch === route.epoch)
        if (
          !prepared ||
          prepared.requestId !== route.requestId ||
          route.rooms.some((room) => current(room.roomId) !== room.generation)
        ) {
          return RoomsJoinFailedEvent({ requestId: route.requestId, error: new Error('Prepared room join superseded') })
        }
        if (prepared.ready) return null
        // No TrustedRoomsState, queue resumption, public event, or projection mutation belongs to
        // prepare. Server is the only consumer of this private terminal.
        return [
          PreparedRoutesState().new(
            get(PreparedRoutesState()).map((item) => (item.epoch === route.epoch ? { ...item, ready: true } : item))
          ),
          RoomsPreparedEvent({
            epoch: route.epoch,
            requestId: route.requestId,
            roomIds: route.rooms.map((room) => room.roomId)
          })
        ]
      }
    })

    const AbortPreparedRoomsCommand = domain.command({
      name: 'Wire.AbortPreparedRoomsCommand',
      impl: ({ get }, epoch: string) => {
        const routes = get(PreparedRoutesState())
        return routes.some((route) => route.epoch === epoch)
          ? PreparedRoutesState().new(routes.filter((route) => route.epoch !== epoch))
          : null
      }
    })

    const AbortEpochPreparedRoomsCommand = domain.command({
      name: 'Wire.AbortEpochPreparedRoomsCommand',
      impl: ({ get }, payload: { epoch: string; rooms: RoomGeneration[] }) => {
        const routes = get(PreparedRoutesState())
        const route = routes.find((item) => item.epoch === payload.epoch)
        if (
          !route ||
          route.rooms.length !== payload.rooms.length ||
          route.rooms.some(
            (room) =>
              payload.rooms.find((candidate) => candidate.roomId === room.roomId)?.generation !== room.generation
          )
        ) {
          return null
        }
        return PreparedRoutesState().new(routes.filter((item) => item.epoch !== payload.epoch))
      }
    })

    const CommitPreparedRoomsCommand = domain.command({
      name: 'Wire.CommitPreparedRoomsCommand',
      impl: ({ get }, epoch: string) => {
        const route = get(PreparedRoutesState()).find((item) => item.epoch === epoch)
        if (!route?.ready) return null
        const current = (roomId: string) => generationFor(get(RoomGenerationsState()), roomId)
        if (route.rooms.some((room) => current(room.roomId) !== room.generation)) {
          return [
            PreparedRoutesState().new(get(PreparedRoutesState()).filter((item) => item.epoch !== epoch)),
            RoomsJoinFailedEvent({ requestId: route.requestId, error: new Error('Prepared room commit superseded') })
          ]
        }
        const roomIds = route.rooms.map((room) => room.roomId)
        return [
          PreparedRoutesState().new(get(PreparedRoutesState()).filter((item) => item.epoch !== epoch)),
          TrustedRoomsState().new([...new Set([...get(TrustedRoomsState()), ...roomIds])]),
          RoomsJoinedEvent({ requestId: route.requestId, roomIds })
        ]
      }
    })

    const SilentInstallPreparedRoomsCommand = domain.command({
      name: 'Wire.SilentInstallPreparedRoomsCommand',
      impl: ({ get }, payload: { epoch: string; rooms: RoomGeneration[] }) => {
        const route = get(PreparedRoutesState()).find((item) => item.epoch === payload.epoch)
        if (
          !route ||
          !route.ready ||
          route.rooms.length !== payload.rooms.length ||
          route.rooms.some(
            (room) =>
              payload.rooms.find((candidate) => candidate.roomId === room.roomId)?.generation !== room.generation ||
              generationFor(get(RoomGenerationsState()), room.roomId) !== room.generation
          )
        ) {
          return null
        }
        return [
          PreparedRoutesState().new(get(PreparedRoutesState()).filter((item) => item.epoch !== payload.epoch)),
          TrustedRoomsState().new([
            ...new Set([...get(TrustedRoomsState()), ...route.rooms.map((room) => room.roomId)])
          ])
        ]
      }
    })

    const ResumeSendAfterJoinCommand = domain.command({
      name: 'Wire.ResumeSendAfterJoinCommand',
      impl: ({ get }, identity: QueueIdentity & { roomId: string }) => {
        const queues = get(SendQueuesState())
        const current = queues.find((item) => item.roomId === identity.roomId)
        const head = current?.requests[0]
        if (
          !current?.suspended ||
          current.headInvoked ||
          head?.sequence !== identity.sequence ||
          head.generation !== identity.generation ||
          generationFor(get(RoomGenerationsState()), identity.roomId) !== identity.generation ||
          !get(TrustedRoomsState()).includes(identity.roomId)
        ) {
          return null
        }
        return [
          SendQueuesState().new(
            replaceBy(queues, (item) => item.roomId === identity.roomId, { ...current, suspended: false })
          ),
          SendRequestedEvent(head)
        ]
      }
    })

    const LeaveRoomCommand = domain.command({
      name: 'Wire.LeaveRoomCommand',
      impl: ({ get }, payload: { roomId: string; preservePending: boolean; diagnosticOnly?: boolean }) => {
        const { roomId } = payload
        const generations = get(RoomGenerationsState())
        const generation = generationFor(generations, roomId) + 1
        const sendQueues = get(SendQueuesState())
        const current = sendQueues.find((item) => item.roomId === roomId)
        // An already-invoked head still awaits the actual transport.send() Promise: logical leave
        // suppresses the queue's logical output but never impersonates that physical settlement,
        // so exact ownership (one suspended queue holding only the invoked head) settles with the
        // real Promise instead of a synthetic cancellation.
        const invokedHead = payload.preservePending || !current?.headInvoked ? undefined : current.requests[0]
        const invalidated = payload.preservePending
          ? []
          : (current?.requests ?? []).filter((request) => request !== invokedHead)
        return [
          RoomGenerationsState().new(replaceBy(generations, (item) => item.roomId === roomId, { roomId, generation })),
          TrustedRoomsState().new(get(TrustedRoomsState()).filter((item) => item !== roomId)),
          RoomSourcesState().new(get(RoomSourcesState()).filter((item) => item.roomId !== roomId)),
          SourceIncarnationsState().new(get(SourceIncarnationsState()).filter((item) => item.roomId !== roomId)),
          ...(payload.preservePending
            ? [
                SendQueuesState().new(
                  sendQueues.map((item) => (item.roomId === roomId ? { ...item, suspended: true } : item))
                )
              ]
            : invokedHead && current
              ? [
                  SendQueuesState().new(
                    replaceBy(sendQueues, (item) => item.roomId === roomId, {
                      ...current,
                      suspended: true,
                      requests: [invokedHead]
                    })
                  )
                ]
              : [SendQueuesState().new(sendQueues.filter((item) => item.roomId !== roomId))]),
          DecodeQueuesState().new(get(DecodeQueuesState()).filter((item) => item.frames[0]?.roomId !== roomId)),
          ...invalidated.map((request) =>
            MessageSendFailedEvent({
              requestId: request.requestId,
              error: new DOMException('Room operation cancelled', 'AbortError'),
              stage: 'cancelled'
            })
          ),
          LeaveRoomRequestedEvent({ roomId, ...(payload.diagnosticOnly ? { diagnosticOnly: true } : {}) })
        ]
      }
    })

    const SendMessageCommand = domain.command({
      name: 'Wire.SendMessageCommand',
      impl: ({ get }, request: WireSendRequest) => {
        const trusted = get(TrustedRoomsState()).includes(request.roomId)
        if (
          !trusted &&
          (request.roomId === worldRoomId ||
            !get(RoomGenerationsState()).some((item) => item.roomId === request.roomId))
        ) {
          return MessageSendFailedEvent({
            requestId: request.requestId,
            error: new Error('Untrusted room message'),
            stage: 'preflight'
          })
        }
        const sequence = get(QueueSequenceState()) + 1
        const queued: QueuedSendRequest = {
          ...request,
          generation: generationFor(get(RoomGenerationsState()), request.roomId),
          sequence
        }
        const queues = get(SendQueuesState())
        const current = queues.find((item) => item.roomId === request.roomId)
        const requests = [...(current?.requests ?? []), queued]
        const nextState = SendQueuesState().new(
          replaceBy(queues, (item) => item.roomId === request.roomId, {
            roomId: request.roomId,
            requestCount: requests.length,
            suspended: current?.suspended ?? !trusted,
            // Appending a tail never changes the existing head's physical stage: an already
            // invoked head keeps its exact ownership marker.
            headInvoked: current?.headInvoked ?? false,
            requests
          })
        )
        return [
          QueueSequenceState().new(sequence),
          nextState,
          ...(current || !trusted ? [] : [SendRequestedEvent(queued)])
        ]
      }
    })

    const CompleteSendCommand = domain.command({
      name: 'Wire.CompleteSendCommand',
      impl: ({ get }, payload: { request: QueuedSendRequest; error?: Error; stage?: WireFailureStage }) => {
        const { request } = payload
        const queues = get(SendQueuesState())
        const current = queues.find((item) => item.roomId === request.roomId)
        if (current?.requests[0]?.sequence !== request.sequence) return null
        const requests = current.requests.slice(1)
        const isCurrent =
          get(TrustedRoomsState()).includes(request.roomId) &&
          generationFor(get(RoomGenerationsState()), request.roomId) === request.generation
        // Work that never reached the provider (encode still pending when the room changed, or a
        // preflight encode failure) is held at the suspended head and moves to the next join
        // generation instead of being re-sent as a duplicate.
        if (!isCurrent) {
          const held = replaceBy(queues, (item) => item.roomId === request.roomId, {
            ...current,
            suspended: true,
            requests: [request, ...requests]
          })
          return [SendQueuesState().new(held)]
        }
        const nextQueues =
          requests.length === 0
            ? queues.filter((item) => item.roomId !== request.roomId)
            : replaceBy(queues, (item) => item.roomId === request.roomId, {
                roomId: request.roomId,
                requestCount: requests.length,
                suspended: false,
                headInvoked: false,
                requests
              })
        const result = payload.error
          ? MessageSendFailedEvent({
              requestId: request.requestId,
              error: payload.error,
              stage: payload.stage ?? 'provider'
            })
          : MessageSentEvent({ requestId: request.requestId })
        return requests[0]
          ? [SendQueuesState().new(nextQueues), result, SendRequestedEvent(requests[0])]
          : [SendQueuesState().new(nextQueues), result]
      }
    })

    const CompleteEncodeCommand = domain.command({
      name: 'Wire.CompleteEncodeCommand',
      impl: ({ get }, payload: { request: QueuedSendRequest; rawPayload?: string; error?: Error }) => {
        const current = get(SendQueuesState()).find((item) => item.roomId === payload.request.roomId)
        if (current?.requests[0]?.sequence !== payload.request.sequence) return null
        if (payload.error || payload.rawPayload === undefined) {
          return CompleteSendCommand({
            request: payload.request,
            error: payload.error ?? new Error('Wire encode did not produce a payload'),
            stage: 'preflight'
          })
        }
        if (
          !get(TrustedRoomsState()).includes(payload.request.roomId) ||
          generationFor(get(RoomGenerationsState()), payload.request.roomId) !== payload.request.generation
        ) {
          return CompleteSendCommand({ request: payload.request })
        }
        // Mark the head as handed to the provider so a later generation switch never re-sends it.
        const invokedQueues = replaceBy(get(SendQueuesState()), (item) => item.roomId === payload.request.roomId, {
          ...current,
          headInvoked: true
        })
        return [
          SendQueuesState().new(invokedQueues),
          ProviderSendRequestedEvent({ request: payload.request, rawPayload: payload.rawPayload })
        ]
      }
    })

    const AcceptRawFrameCommand = domain.command({
      name: 'Wire.AcceptRawFrameCommand',
      impl: ({ get }, payload: { roomId: string; sourcePeerId: string; rawPayload: string; settle?: () => void }) => {
        const prepared = get(PreparedRoutesState()).some(
          (route) =>
            route.ready &&
            route.rooms.some(
              (room) =>
                room.roomId === payload.roomId &&
                room.generation === generationFor(get(RoomGenerationsState()), room.roomId)
            )
        )
        if (!get(TrustedRoomsState()).includes(payload.roomId) && !prepared) {
          payload.settle?.()
          return RecordDropCommand({ sourcePeerId: payload.sourcePeerId, reason: 'message from an unjoined room' })
        }
        const sources = get(RoomSourcesState())
        const incarnations = get(SourceIncarnationsState())
        let sourceGeneration = sourceGenerationFor(sources, payload.roomId, payload.sourcePeerId)
        const sourceAdmission = []
        if (sourceGeneration === undefined) {
          // Some providers surface a first data frame before their separate peerJoin callback.
          // It is a one-time physical admission only; once a source has left, a reusable id needs
          // a fresh PeerJoined event and can never revive an old asynchronous decode by speaking.
          const prior = incarnations.find(
            (item) => item.roomId === payload.roomId && item.sourcePeerId === payload.sourcePeerId
          )
          if (prior) {
            payload.settle?.()
            return RecordDropCommand({
              sourcePeerId: payload.sourcePeerId,
              reason: 'message from an unadmitted source'
            })
          }
          sourceGeneration = 1
          const room = sources.find((item) => item.roomId === payload.roomId)
          sourceAdmission.push(
            RoomSourcesState().new(
              room
                ? replaceBy(sources, (item) => item.roomId === payload.roomId, {
                    roomId: payload.roomId,
                    sources: [...room.sources, { sourcePeerId: payload.sourcePeerId, generation: sourceGeneration }]
                  })
                : [
                    ...sources,
                    {
                      roomId: payload.roomId,
                      sources: [{ sourcePeerId: payload.sourcePeerId, generation: sourceGeneration }]
                    }
                  ]
            ),
            SourceIncarnationsState().new([
              ...incarnations,
              { roomId: payload.roomId, sourcePeerId: payload.sourcePeerId, generation: sourceGeneration }
            ])
          )
        }
        const wireBytes = getTextByteSize(payload.rawPayload)
        const id = queueId(payload.roomId, payload.sourcePeerId)
        const queues = get(DecodeQueuesState())
        const current = queues.find((item) => item.id === id)
        if (
          (current?.frameCount ?? 0) >= MAX_DECODE_QUEUE_FRAMES ||
          (current?.wireBytes ?? 0) + wireBytes > MAX_DECODE_QUEUE_BYTES
        ) {
          payload.settle?.()
          return RecordDropCommand({ sourcePeerId: payload.sourcePeerId, reason: 'queue-overflow' })
        }
        const sequence = get(QueueSequenceState()) + 1
        const frame: RawFrame = {
          ...payload,
          wireBytes,
          sourceGeneration,
          generation: generationFor(get(RoomGenerationsState()), payload.roomId),
          sequence
        }
        const frames = [...(current?.frames ?? []), frame]
        const next = {
          id,
          frameCount: frames.length,
          wireBytes: (current?.wireBytes ?? 0) + wireBytes,
          frames
        }
        const nextState = DecodeQueuesState().new(replaceBy(queues, (item) => item.id === id, next))
        return [
          ...sourceAdmission,
          QueueSequenceState().new(sequence),
          nextState,
          ...(current ? [] : [RawFrameAdmittedEvent(frame)])
        ]
      }
    })

    const CompleteRawFrameCommand = domain.command({
      name: 'Wire.CompleteRawFrameCommand',
      impl: ({ get }, payload: RawFrame & { value?: unknown; error?: unknown }) => {
        const id = queueId(payload.roomId, payload.sourcePeerId)
        const queues = get(DecodeQueuesState())
        const current = queues.find((item) => item.id === id)
        if (current?.frames[0]?.sequence !== payload.sequence) {
          payload.settle?.()
          return null
        }
        const frames = current.frames.slice(1)
        const nextBytes = Math.max(0, current.wireBytes - payload.wireBytes)
        const nextQueues =
          frames.length === 0
            ? queues.filter((item) => item.id !== id)
            : replaceBy(queues, (item) => item.id === id, {
                id,
                frameCount: frames.length,
                wireBytes: nextBytes,
                frames
              })
        const queueOutput = frames[0]
          ? [DecodeQueuesState().new(nextQueues), RawFrameAdmittedEvent(frames[0])]
          : [DecodeQueuesState().new(nextQueues)]
        const preparedRoute = get(PreparedRoutesState()).find(
          (route) =>
            route.ready &&
            route.rooms.some((room) => room.roomId === payload.roomId && room.generation === payload.generation)
        )
        if (
          (!get(TrustedRoomsState()).includes(payload.roomId) && !preparedRoute) ||
          generationFor(get(RoomGenerationsState()), payload.roomId) !== payload.generation ||
          sourceGenerationFor(get(RoomSourcesState()), payload.roomId, payload.sourcePeerId) !==
            payload.sourceGeneration
        ) {
          payload.settle?.()
          return queueOutput
        }
        if (payload.error) {
          payload.settle?.()
          return [
            ...queueOutput,
            RecordDropCommand({ sourcePeerId: payload.sourcePeerId, reason: 'invalid-frame', error: payload.error })
          ]
        }
        const message = parseMessage(payload.roomId, payload.value)
        if (!message) {
          payload.settle?.()
          return [...queueOutput, RecordDropCommand({ sourcePeerId: payload.sourcePeerId, reason: 'invalid message' })]
        }
        // MessageAccepted subscribers synchronously submit the owning Session/World command in
        // this store turn. Deferring settlement one microtask makes the ingress terminal follow
        // that owner command instead of the preceding codec/schema completion.
        queueMicrotask(() => payload.settle?.())
        const accepted: WireMessageEvent = {
          roomId: payload.roomId,
          sourcePeerId: payload.sourcePeerId,
          sourceGeneration: payload.sourceGeneration,
          message
        }
        return [
          ...queueOutput,
          ...(preparedRoute
            ? [
                PreparedMessageAcceptedEvent({
                  ...accepted,
                  epoch: preparedRoute.epoch,
                  roomGeneration: payload.generation
                })
              ]
            : [MessageAcceptedEvent(accepted)])
        ]
      }
    })

    const HandleRoomClosedCommand = domain.command({
      name: 'Wire.HandleRoomClosedCommand',
      impl: ({ get }, roomId: string) => {
        const generations = get(RoomGenerationsState())
        const generation = generationFor(generations, roomId) + 1
        const sendQueues = get(SendQueuesState())
        const worldRequests =
          roomId === worldRoomId ? (sendQueues.find((item) => item.roomId === roomId)?.requests ?? []) : []
        get(DecodeQueuesState())
          .filter((item) => item.frames.some((frame) => frame.roomId === roomId))
          .flatMap((item) => item.frames)
          .forEach((frame) => frame.settle?.())
        return [
          RoomGenerationsState().new(replaceBy(generations, (item) => item.roomId === roomId, { roomId, generation })),
          TrustedRoomsState().new(get(TrustedRoomsState()).filter((item) => item !== roomId)),
          RoomSourcesState().new(get(RoomSourcesState()).filter((item) => item.roomId !== roomId)),
          SourceIncarnationsState().new(get(SourceIncarnationsState()).filter((item) => item.roomId !== roomId)),
          ...(roomId === worldRoomId
            ? [SendQueuesState().new(sendQueues.filter((item) => item.roomId !== roomId))]
            : [
                SendQueuesState().new(
                  sendQueues.map((item) => (item.roomId === roomId ? { ...item, suspended: true } : item))
                )
              ]),
          DecodeQueuesState().new(get(DecodeQueuesState()).filter((item) => item.frames[0]?.roomId !== roomId)),
          ...worldRequests.map((request) =>
            MessageSendFailedEvent({
              requestId: request.requestId,
              error: new Error('Room generation superseded'),
              stage: 'cancelled'
            })
          ),
          RoomClosedEvent({ roomId })
        ]
      }
    })
    domain.effect({
      name: 'Wire.JoinRoomsEffect',
      impl: ({ fromEvent }) =>
        fromEvent(JoinRoomsRequestedEvent).pipe(
          mergeMap(async (request) => {
            try {
              await Promise.all(request.rooms.map(({ roomId }) => transport.join(roomId)))
              return CompleteJoinRoomsCommand(request)
            } catch (error) {
              return RoomsJoinFailedEvent({ requestId: request.requestId, error: error as Error })
            }
          })
        )
    })
    domain.effect({
      name: 'Wire.PrepareRoomsEffect',
      impl: ({ fromEvent }) =>
        fromEvent(PrepareRoomsRequestedEvent).pipe(
          mergeMap(async (route) => {
            try {
              await Promise.all(route.rooms.map(({ roomId }) => transport.join(roomId)))
              return CompletePreparedRoomsCommand(route)
            } catch (error) {
              return RoomsJoinFailedEvent({ requestId: route.requestId, error: error as Error })
            }
          })
        )
    })
    domain.effect({
      name: 'Wire.SendResumeAfterJoinEffect',
      impl: ({ fromEvent }) => fromEvent(SendResumeAfterJoinRequestedEvent).pipe(map(ResumeSendAfterJoinCommand))
    })

    domain.effect({
      name: 'Wire.LeaveRoomEffect',
      impl: ({ fromEvent }) =>
        fromEvent(LeaveRoomRequestedEvent).pipe(
          map(({ roomId, diagnosticOnly }) => {
            transport.leave(roomId, { diagnosticOnly })
            return null
          })
        )
    })

    domain.effect({
      name: 'Wire.EncodeEffect',
      impl: ({ fromEvent }) =>
        fromEvent(SendRequestedEvent).pipe(
          mergeMap(async (request) => {
            try {
              // The codec's uniform encoded-frame bound is the only representation check; no
              // message-property validation happens on the outbound path.
              const rawPayload = await codec.encode(request.message)
              return CompleteEncodeCommand({ request, rawPayload })
            } catch (error) {
              return CompleteEncodeCommand({ request, error: error as Error })
            }
          })
        )
    })

    domain.effect({
      name: 'Wire.SendEffect',
      impl: ({ fromEvent }) =>
        fromEvent(ProviderSendRequestedEvent).pipe(
          mergeMap(async ({ request, rawPayload }) => {
            try {
              await transport.send(request.roomId, rawPayload, request.targetPeerIds)
              return CompleteProviderSendCommand({ request })
            } catch (error) {
              return CompleteProviderSendCommand({ request, error: error as Error })
            }
          })
        )
    })

    domain.effect({
      name: 'Wire.ProviderMessageEffect',
      impl: () =>
        fromEventPattern<{ roomId: string; sourcePeerId: string; rawPayload: string; settle: () => void }>(
          (handler) =>
            transport.onMessage(
              (roomId, sourcePeerId, rawPayload) =>
                new Promise<void>((resolve) => handler({ roomId, sourcePeerId, rawPayload, settle: resolve }))
            ),
          (_handler, dispose) => dispose()
        ).pipe(map(AcceptRawFrameCommand))
    })

    domain.effect({
      name: 'Wire.DecodeEffect',
      impl: ({ fromEvent }) =>
        fromEvent(RawFrameAdmittedEvent).pipe(
          mergeMap(async (frame) => {
            try {
              return CompleteRawFrameCommand({ ...frame, value: await codec.decode(frame.rawPayload) })
            } catch (error) {
              return CompleteRawFrameCommand({ ...frame, error })
            }
          })
        )
    })

    domain.effect({
      name: 'Wire.ProviderPeerJoinEffect',
      impl: () =>
        fromEventPattern<{ roomId: string; sourcePeerId: string }>(
          (handler) => transport.onPeerJoin((roomId, sourcePeerId) => handler({ roomId, sourcePeerId })),
          (_handler, dispose) => dispose()
        ).pipe(map(PeerJoinedEvent))
    })

    domain.effect({
      name: 'Wire.AdmitSourceEffect',
      impl: ({ fromEvent }) => fromEvent(PeerJoinedEvent).pipe(map(AdmitSourceCommand))
    })

    domain.effect({
      name: 'Wire.RemoveSourceEffect',
      impl: ({ fromEvent }) => fromEvent(PeerLeftEvent).pipe(map(RemoveSourceCommand))
    })

    domain.effect({
      name: 'Wire.ProviderPeerLeaveEffect',
      impl: () =>
        fromEventPattern<{ roomId: string; sourcePeerId: string }>(
          (handler) => transport.onPeerLeave((roomId, sourcePeerId) => handler({ roomId, sourcePeerId })),
          (_handler, dispose) => dispose()
        ).pipe(map(PeerLeftEvent))
    })

    domain.effect({
      name: 'Wire.ProviderRoomCloseEffect',
      impl: () =>
        fromEventPattern<string>(
          (handler) => transport.onRoomClose(handler),
          (_handler, dispose) => dispose()
        ).pipe(map(HandleRoomClosedCommand))
    })

    domain.effect({
      name: 'Wire.ProviderErrorEffect',
      impl: () =>
        fromEventPattern<{ error: Error; roomId: string }>(
          (handler) => transport.onError((error, roomId) => handler({ error, roomId })),
          (_handler, dispose) => dispose()
        ).pipe(map(ErrorEvent))
    })

    return {
      query: {
        PeerIdQuery,
        TrustedRoomsQuery,
        IsRoomTrustedQuery,
        RoomGenerationQuery,
        DecodeQueuesQuery,
        IsSourceAdmittedQuery,
        SourcesQuery,
        PreparedRouteQuery,
        IsPreparedRouteCurrentQuery
      },
      command: {
        JoinRoomsCommand,
        PrepareRoomsCommand,
        BeginEpochReplacementCommand,
        CommitPreparedRoomsCommand,
        SilentInstallPreparedRoomsCommand,
        AbortPreparedRoomsCommand,
        AbortEpochPreparedRoomsCommand,
        LeaveRoomCommand,
        SendMessageCommand,
        DropProtocolCommand: RecordDropCommand,
        AdmitSourceCommand,
        RecoverTransportStateCommand,
        RemoveSourceCommand
      },
      event: {
        RoomsJoinedEvent,
        RoomsPreparedEvent,
        RoomsJoinFailedEvent,
        MessageSentEvent,
        MessageSendFailedEvent,
        MessageAcceptedEvent,
        PreparedMessageAcceptedEvent,
        PeerJoinedEvent,
        PeerLeftEvent,
        RoomClosedEvent,
        ErrorEvent,
        ProtocolDropEvent
      }
    }
  }
})

export default WireDomain
