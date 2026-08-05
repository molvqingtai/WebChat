import { Remesh } from 'remesh'
import { fromEventPattern, map, mergeMap } from 'rxjs'
import { MAX_DECODE_QUEUE_BYTES, MAX_DECODE_QUEUE_FRAMES, WORLD_ROOM_ID_V3 } from '@/constants/config'
import { RoomTransportExtern, WireCodecExtern } from '@/domain/runtime/externs/RoomTransport'
import {
  MESSAGE_TYPE,
  WireCodecError,
  isHistoryResponseFrameWithinLimit,
  parseChatRoomMessage,
  parseWorldRoomMessage,
  type ChatRoomMessage,
  type WorldRoomMessage
} from '@/protocol'
import { getTextByteSize } from '@/utils/getTextByteSize'
import stringToHex from '@/utils/stringToHex'

export type WireMessage = ChatRoomMessage | WorldRoomMessage

export interface WireJoinResult {
  requestId: string
  roomIds: string[]
}

export interface WireFailure {
  requestId: string
  error: Error
}

export interface WireSendRequest {
  requestId: string
  roomId: string
  targetPeerIds?: string[]
  message: WireMessage
}

export interface WireMessageEvent {
  roomId: string
  sourcePeerId: string
  message: WireMessage
}

interface RoomGeneration {
  roomId: string
  generation: number
}

interface QueueIdentity {
  generation: number
  sequence: number
}

interface RawFrame extends QueueIdentity {
  roomId: string
  sourcePeerId: string
  rawPayload: string
  wireBytes: number
}

interface QueuedSendRequest extends WireSendRequest, QueueIdentity {}

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
  requests: QueuedSendRequest[]
}

interface DropRecord {
  sourcePeerId: string
  loggedAt: number
}

const MAX_LOGGED_SOURCES = 256
const LOG_INTERVAL_MS = 10000
const worldRoomId = stringToHex(WORLD_ROOM_ID_V3)
const queueId = (roomId: string, sourcePeerId: string) => JSON.stringify([roomId, sourcePeerId])
const generationFor = (generations: RoomGeneration[], roomId: string) =>
  generations.find((item) => item.roomId === roomId)?.generation ?? 0
const replaceBy = <T>(items: T[], predicate: (item: T) => boolean, next: T): T[] =>
  items.some(predicate) ? items.map((item) => (predicate(item) ? next : item)) : [...items, next]

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

    const PeerIdQuery = domain.query({ name: 'Wire.PeerIdQuery', impl: () => transport.peerId })
    const TrustedRoomsQuery = domain.query({
      name: 'Wire.TrustedRoomsQuery',
      impl: ({ get }) => get(TrustedRoomsState())
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

    const RoomsJoinedEvent = domain.event<WireJoinResult>({ name: 'Wire.RoomsJoinedEvent' })
    const RoomsJoinFailedEvent = domain.event<WireFailure>({ name: 'Wire.RoomsJoinFailedEvent' })
    const MessageSentEvent = domain.event<{ requestId: string }>({ name: 'Wire.MessageSentEvent' })
    const MessageSendFailedEvent = domain.event<WireFailure>({ name: 'Wire.MessageSendFailedEvent' })
    const MessageAcceptedEvent = domain.event<WireMessageEvent>({ name: 'Wire.MessageAcceptedEvent' })
    const PeerJoinedEvent = domain.event<{ roomId: string; sourcePeerId: string }>({
      name: 'Wire.PeerJoinedEvent'
    })
    const PeerLeftEvent = domain.event<{ roomId: string; sourcePeerId: string }>({ name: 'Wire.PeerLeftEvent' })
    const RoomClosedEvent = domain.event<{ roomId: string }>({ name: 'Wire.RoomClosedEvent' })
    const ErrorEvent = domain.event<Error>({ name: 'Wire.ErrorEvent' })
    const ProtocolDropEvent = domain.event<{ sourcePeerId: string; reason: string; error?: unknown }>({
      name: 'Wire.ProtocolDropEvent'
    })
    const JoinRoomsRequestedEvent = domain.event<{
      requestId: string
      rooms: { roomId: string; generation: number }[]
    }>({ name: 'Wire.JoinRoomsRequestedEvent' })
    const LeaveRoomRequestedEvent = domain.event<string>({ name: 'Wire.LeaveRoomRequestedEvent' })
    const SendRequestedEvent = domain.event<QueuedSendRequest>({ name: 'Wire.SendRequestedEvent' })
    const ProviderSendRequestedEvent = domain.event<EncodedSend>({ name: 'Wire.ProviderSendRequestedEvent' })
    const RawFrameAdmittedEvent = domain.event<RawFrame>({ name: 'Wire.RawFrameAdmittedEvent' })

    const parseMessage = (roomId: string, value: unknown): WireMessage | null => {
      if (roomId === worldRoomId) return parseWorldRoomMessage(value)
      return parseChatRoomMessage(value)
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
          return queue?.suspended && queue.requests[0] ? [{ roomId, queue, head: queue.requests[0] }] : []
        })
        const nextQueues = resumed.reduce(
          (queues, { roomId, queue }) =>
            replaceBy(queues, (item) => item.roomId === roomId, {
              ...queue,
              suspended: false,
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
          ...resumed.map(({ head, roomId }) => SendRequestedEvent({ ...head, generation: current(roomId) }))
        ]
      }
    })

    const LeaveRoomCommand = domain.command({
      name: 'Wire.LeaveRoomCommand',
      impl: ({ get }, payload: { roomId: string; preservePending: boolean }) => {
        const { roomId } = payload
        const generations = get(RoomGenerationsState())
        const generation = generationFor(generations, roomId) + 1
        const sendQueues = get(SendQueuesState())
        const invalidated = payload.preservePending
          ? []
          : (sendQueues.find((item) => item.roomId === roomId)?.requests ?? [])
        return [
          RoomGenerationsState().new(replaceBy(generations, (item) => item.roomId === roomId, { roomId, generation })),
          TrustedRoomsState().new(get(TrustedRoomsState()).filter((item) => item !== roomId)),
          ...(payload.preservePending
            ? [
                SendQueuesState().new(
                  sendQueues.map((item) => (item.roomId === roomId ? { ...item, suspended: true } : item))
                )
              ]
            : [SendQueuesState().new(sendQueues.filter((item) => item.roomId !== roomId))]),
          DecodeQueuesState().new(get(DecodeQueuesState()).filter((item) => item.frames[0]?.roomId !== roomId)),
          ...invalidated.map((request) =>
            MessageSendFailedEvent({
              requestId: request.requestId,
              error: new DOMException('Room operation cancelled', 'AbortError')
            })
          ),
          LeaveRoomRequestedEvent(roomId)
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
            error: new Error('Untrusted room message')
          })
        }
        if (!parseMessage(request.roomId, request.message)) {
          return MessageSendFailedEvent({
            requestId: request.requestId,
            error: new Error(`Invalid message for trusted room "${request.roomId}"`)
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
      impl: ({ get }, payload: { request: QueuedSendRequest; error?: Error }) => {
        const { request } = payload
        const queues = get(SendQueuesState())
        const current = queues.find((item) => item.roomId === request.roomId)
        if (current?.requests[0]?.sequence !== request.sequence) return null
        const requests = current.requests.slice(1)
        const isCurrent =
          get(TrustedRoomsState()).includes(request.roomId) &&
          generationFor(get(RoomGenerationsState()), request.roomId) === request.generation
        if (!isCurrent) {
          // The room's trust is being re-established across a reconnect generation: hold the request at
          // the head without a failure and let the next join resume the queue in the new generation.
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
                requests
              })
        const result = payload.error
          ? MessageSendFailedEvent({ requestId: request.requestId, error: payload.error })
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
            error: payload.error ?? new Error('Wire encode did not produce a payload')
          })
        }
        if (
          !get(TrustedRoomsState()).includes(payload.request.roomId) ||
          generationFor(get(RoomGenerationsState()), payload.request.roomId) !== payload.request.generation
        ) {
          return CompleteSendCommand({ request: payload.request })
        }
        return ProviderSendRequestedEvent({ request: payload.request, rawPayload: payload.rawPayload })
      }
    })

    const AcceptRawFrameCommand = domain.command({
      name: 'Wire.AcceptRawFrameCommand',
      impl: ({ get }, payload: { roomId: string; sourcePeerId: string; rawPayload: string }) => {
        if (!get(TrustedRoomsState()).includes(payload.roomId)) {
          return RecordDropCommand({ sourcePeerId: payload.sourcePeerId, reason: 'message from an unjoined room' })
        }
        const wireBytes = getTextByteSize(payload.rawPayload)
        const id = queueId(payload.roomId, payload.sourcePeerId)
        const queues = get(DecodeQueuesState())
        const current = queues.find((item) => item.id === id)
        if (
          (current?.frameCount ?? 0) >= MAX_DECODE_QUEUE_FRAMES ||
          (current?.wireBytes ?? 0) + wireBytes > MAX_DECODE_QUEUE_BYTES
        ) {
          return RecordDropCommand({ sourcePeerId: payload.sourcePeerId, reason: 'queue-overflow' })
        }
        const sequence = get(QueueSequenceState()) + 1
        const frame: RawFrame = {
          ...payload,
          wireBytes,
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
        return [QueueSequenceState().new(sequence), nextState, ...(current ? [] : [RawFrameAdmittedEvent(frame)])]
      }
    })

    const CompleteRawFrameCommand = domain.command({
      name: 'Wire.CompleteRawFrameCommand',
      impl: ({ get }, payload: RawFrame & { value?: unknown; error?: unknown }) => {
        const id = queueId(payload.roomId, payload.sourcePeerId)
        const queues = get(DecodeQueuesState())
        const current = queues.find((item) => item.id === id)
        if (current?.frames[0]?.sequence !== payload.sequence) return null
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
        if (
          !get(TrustedRoomsState()).includes(payload.roomId) ||
          generationFor(get(RoomGenerationsState()), payload.roomId) !== payload.generation
        ) {
          return queueOutput
        }
        if (payload.error) {
          return [
            ...queueOutput,
            RecordDropCommand({ sourcePeerId: payload.sourcePeerId, reason: 'invalid-frame', error: payload.error })
          ]
        }
        const message = parseMessage(payload.roomId, payload.value)
        if (
          !message ||
          ('type' in message &&
            message.type === MESSAGE_TYPE.HISTORY_RESPONSE &&
            !isHistoryResponseFrameWithinLimit(payload.rawPayload))
        ) {
          return [...queueOutput, RecordDropCommand({ sourcePeerId: payload.sourcePeerId, reason: 'invalid message' })]
        }
        return [
          ...queueOutput,
          MessageAcceptedEvent({ roomId: payload.roomId, sourcePeerId: payload.sourcePeerId, message })
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
        return [
          RoomGenerationsState().new(replaceBy(generations, (item) => item.roomId === roomId, { roomId, generation })),
          TrustedRoomsState().new(get(TrustedRoomsState()).filter((item) => item !== roomId)),
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
              error: new Error('Room generation superseded')
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
      name: 'Wire.LeaveRoomEffect',
      impl: ({ fromEvent }) =>
        fromEvent(LeaveRoomRequestedEvent).pipe(
          map((roomId) => {
            transport.leave(roomId)
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
              const rawPayload = await codec.encode(request.message)
              if (
                'type' in request.message &&
                request.message.type === MESSAGE_TYPE.HISTORY_RESPONSE &&
                !isHistoryResponseFrameWithinLimit(rawPayload)
              ) {
                throw new WireCodecError('History response reached the wire limit')
              }
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
              return CompleteSendCommand({ request })
            } catch (error) {
              return CompleteSendCommand({ request, error: error as Error })
            }
          })
        )
    })

    domain.effect({
      name: 'Wire.ProviderMessageEffect',
      impl: () =>
        fromEventPattern<{ roomId: string; sourcePeerId: string; rawPayload: string }>(
          (handler) =>
            transport.onMessage((roomId, sourcePeerId, rawPayload) => handler({ roomId, sourcePeerId, rawPayload })),
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
        fromEventPattern<Error>(
          (handler) => transport.onError(handler),
          (_handler, dispose) => dispose()
        ).pipe(map(ErrorEvent))
    })

    domain.effect({
      name: 'Wire.ProtocolDropEffect',
      impl: ({ fromEvent }) =>
        fromEvent(ProtocolDropEvent).pipe(
          map(({ sourcePeerId, reason, error }) => {
            console.warn(`[WebChat] Dropped v3 frame from ${sourcePeerId}: ${reason}`, error ?? '')
            return null
          })
        )
    })

    return {
      query: { PeerIdQuery, TrustedRoomsQuery, IsRoomTrustedQuery, DecodeQueuesQuery },
      command: { JoinRoomsCommand, LeaveRoomCommand, SendMessageCommand, DropProtocolCommand: RecordDropCommand },
      event: {
        RoomsJoinedEvent,
        RoomsJoinFailedEvent,
        MessageSentEvent,
        MessageSendFailedEvent,
        MessageAcceptedEvent,
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
