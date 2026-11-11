import { Remesh } from 'remesh'
import { Observable } from 'rxjs'
import * as v from 'valibot'
import {
  ChatRoomMessageSchema,
  WorldRoomMessageSchema,
  type ChatRoomMessage,
  type WireCodec,
  type WorldRoomMessage
} from '@/protocol'
import stringToHex from '@/utils/stringToHex'
import { MAX_DECODE_QUEUE_FRAMES, WORLD_ROOM_ID } from '../Config'
import { RoomTransportExtern, WireCodecExtern } from '../Externs'
import type { RoomTransport } from '../RoomTransport'

export const worldRoomId = stringToHex(WORLD_ROOM_ID)

export const sendWire = async (
  transport: RoomTransport,
  codec: WireCodec,
  roomId: string,
  message: ChatRoomMessage | WorldRoomMessage,
  to?: string | string[]
) => {
  if (Array.isArray(to) && to.length === 0) return
  await transport.send(roomId, await codec.encode(message), to)
}

interface Source {
  roomId: string
  peerId: string
}

/** Anti-corruption layer: turns transport callbacks into validated, per-source ordered facts. */
const WireDomain = Remesh.domain({
  name: 'WireDomain',
  impl: (domain) => {
    const transport = domain.getExtern(RoomTransportExtern)
    const codec = domain.getExtern(WireCodecExtern)

    const ChatFrameEvent = domain.event<Source & { message: ChatRoomMessage }>({ name: 'Wire.ChatFrameEvent' })
    const WorldFrameEvent = domain.event<Source & { message: WorldRoomMessage }>({ name: 'Wire.WorldFrameEvent' })
    const PeerJoinedEvent = domain.event<Source>({ name: 'Wire.PeerJoinedEvent' })
    const PeerLeftEvent = domain.event<Source>({ name: 'Wire.PeerLeftEvent' })
    const RoomClosedEvent = domain.event<string>({ name: 'Wire.RoomClosedEvent' })
    const ErrorEvent = domain.event<{ roomId: string; message: string }>({ name: 'Wire.ErrorEvent' })

    domain.effect({
      name: 'Wire.IngressEffect',
      impl: () =>
        new Observable((observer) => {
          // Decoding is async, so each source gets its own chain to keep arrival order.
          const queues = new Map<string, { tail: Promise<void>; size: number }>()
          const enqueue = (source: Source, bounded: boolean, task: () => Promise<void> | void) => {
            const key = `${source.roomId}\u0000${source.peerId}`
            const queue = queues.get(key) ?? { tail: Promise.resolve(), size: 0 }
            if (bounded && queue.size >= MAX_DECODE_QUEUE_FRAMES) return
            queue.size += 1
            queues.set(key, queue)
            queue.tail = queue.tail.then(task).then(
              () => {},
              () => {}
            )
            void queue.tail.then(() => {
              queue.size -= 1
              if (queue.size === 0) queues.delete(key)
            })
          }
          const disposers = [
            transport.onMessage((roomId, peerId, payload) =>
              enqueue({ roomId, peerId }, true, async () => {
                const raw = await codec.decode(payload)
                if (roomId === worldRoomId) {
                  const parsed = v.safeParse(WorldRoomMessageSchema, raw)
                  if (parsed.success) observer.next(WorldFrameEvent({ roomId, peerId, message: parsed.output }))
                } else {
                  const parsed = v.safeParse(ChatRoomMessageSchema, raw)
                  if (parsed.success) observer.next(ChatFrameEvent({ roomId, peerId, message: parsed.output }))
                }
              })
            ),
            transport.onPeerJoin((roomId, peerId) => observer.next(PeerJoinedEvent({ roomId, peerId }))),
            transport.onPeerLeave((roomId, peerId) =>
              enqueue({ roomId, peerId }, false, () => observer.next(PeerLeftEvent({ roomId, peerId })))
            ),
            transport.onRoomClose((roomId) => observer.next(RoomClosedEvent(roomId))),
            transport.onError((error, roomId) => observer.next(ErrorEvent({ roomId, message: error.message })))
          ]
          return () => disposers.forEach((dispose) => dispose())
        })
    })

    return { event: { ChatFrameEvent, WorldFrameEvent, PeerJoinedEvent, PeerLeftEvent, RoomClosedEvent, ErrorEvent } }
  }
})

export default WireDomain
