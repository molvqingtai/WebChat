import { Remesh } from 'remesh'
import { filter, map, mergeMap, timer } from 'rxjs'
import { MESSAGE_RECORD_TYPE, type ChatMessageRecord } from '@/domain/Message'
import { MESSAGE_TYPE, type ChatMessage, type ChatSite, type ChatUser, type HLC, type SessionMessage } from '@/protocol'
import isEqual from '@/utils/isEqual'
import stringToHex from '@/utils/stringToHex'
import { CHAT_ROOM_NAMESPACE, JOIN_RETRY_MS, PEER_LEAVE_GRACE_MS } from '../Config'
import type { SendCommand } from '../Contract'
import { ClockExtern, IdentityExtern, RoomTransportExtern, WireCodecExtern } from '../Externs'
import LifecycleDomain from './Lifecycle'
import WireDomain, { errorMessage, joinWithTimeout, sendWire } from './Wire'

export const chatRoomId = (domain: string) => stringToHex(`${CHAT_ROOM_NAMESPACE}:${domain}`)

export interface Peer {
  peerId: string
  sessionId: string
  presenceId: string
  user: ChatUser
  joinedAt: number
  /** The physical peer is gone; the presence stays listed until its grace expires. */
  leaving: boolean
}

export interface Room {
  domain: string
  roomId: string
  user: ChatUser
  site: ChatSite
  sessionId: string
  presenceId: string
  joinedAt: number
  joined: boolean
  /** Bumped on every (re)join so results of an older attempt are ignored. */
  connection: number
  /** Consecutive failed joins since the last success; only the third one is reported. */
  failures: number
  peers: Peer[]
}

interface Attempt {
  domain: string
  connection: number
}

const allocate = (clock: HLC, now: number): HLC =>
  now > clock.timestamp ? { timestamp: now, counter: 0 } : { timestamp: clock.timestamp, counter: clock.counter + 1 }

const observe = (clock: HLC, remote: HLC, now: number): HLC => {
  const timestamp = Math.max(now, clock.timestamp, remote.timestamp)
  if (timestamp > clock.timestamp && timestamp > remote.timestamp) return { timestamp, counter: 0 }
  const counter = Math.max(
    clock.timestamp === timestamp ? clock.counter : -1,
    remote.timestamp === timestamp ? remote.counter : -1
  )
  return { timestamp, counter: counter + 1 }
}

const sessionMessage = (room: Room): SessionMessage => ({
  type: MESSAGE_TYPE.SESSION,
  sessionId: room.sessionId,
  presenceId: room.presenceId,
  joinedAt: room.joinedAt,
  user: room.user
})

/** One chat room per site: local presence, remote presences, and the message clock. */
const RoomDomain = Remesh.domain({
  name: 'RoomDomain',
  impl: (domain) => {
    const transport = domain.getExtern(RoomTransportExtern)
    const codec = domain.getExtern(WireCodecExtern)
    const clock = domain.getExtern(ClockExtern)
    const identity = domain.getExtern(IdentityExtern)
    const wire = domain.getDomain(WireDomain())
    const lifecycle = domain.getDomain(LifecycleDomain())

    const RoomsState = domain.state<Room[]>({ name: 'Room.RoomsState', default: [] })
    const ClockState = domain.state<HLC>({ name: 'Room.ClockState', default: { timestamp: 0, counter: 0 } })
    /** Last moment any peer frame arrived; the host uses silence, not a timer, as its health hint. */
    const LastFrameAtState = domain.state({ name: 'Room.LastFrameAtState', default: 0 })
    const LastJoinedAtState = domain.state({ name: 'Room.LastJoinedAtState', default: 0 })

    const RoomsQuery = domain.query({ name: 'Room.RoomsQuery', impl: ({ get }) => get(RoomsState()) })
    const LastFrameAtQuery = domain.query({ name: 'Room.LastFrameAtQuery', impl: ({ get }) => get(LastFrameAtState()) })
    const RoomQuery = domain.query({
      name: 'Room.RoomQuery',
      impl: ({ get }, roomDomain: string) => get(RoomsState()).find((room) => room.domain === roomDomain) ?? null
    })

    const JoinRequestedEvent = domain.event<Attempt & { leaveFirst: boolean }>({ name: 'Room.JoinRequestedEvent' })
    const JoinedEvent = domain.event<string>({ name: 'Room.JoinedEvent' })
    const JoinFailedEvent = domain.event<Attempt & { failures: number; message: string }>({
      name: 'Room.JoinFailedEvent'
    })
    const ClosedEvent = domain.event<{ domain: string; roomId: string }>({ name: 'Room.ClosedEvent' })
    const IdentityChangedEvent = domain.event<string>({ name: 'Room.IdentityChangedEvent' })
    /** The set of open rooms, or a room's user or site, changed. */
    const PresenceChangedEvent = domain.event({ name: 'Room.PresenceChangedEvent' })
    const FrameSeenEvent = domain.event({ name: 'Room.FrameSeenEvent' })
    const SessionsChangedEvent = domain.event<string>({ name: 'Room.SessionsChangedEvent' })
    const PeerConnectedEvent = domain.event<Attempt & { peerId: string }>({ name: 'Room.PeerConnectedEvent' })
    const PeerDisconnectedEvent = domain.event<{ domain: string; peerId: string }>({
      name: 'Room.PeerDisconnectedEvent'
    })
    const PeerLeavePendingEvent = domain.event<{ domain: string; peerId: string }>({
      name: 'Room.PeerLeavePendingEvent'
    })
    const MessageAllocatedEvent = domain.event<{ requestId: string; record: ChatMessageRecord }>({
      name: 'Room.MessageAllocatedEvent'
    })
    const MessageReceivedEvent = domain.event<{ domain: string; record: ChatMessageRecord }>({
      name: 'Room.MessageReceivedEvent'
    })
    const ErrorEvent = domain.event<{ domain: string; message: string }>({ name: 'Room.ErrorEvent' })

    const replace = (rooms: Room[], next: Room) => rooms.map((room) => (room.domain === next.domain ? next : room))

    /** Idempotent: pages replay it after every connect. */
    const OpenCommand = domain.command({
      name: 'Room.OpenCommand',
      impl: (
        { get },
        input: { domain: string; user: ChatUser; site: ChatSite; resume?: { presenceId: string; joinedAt: number } }
      ) => {
        const rooms = get(RoomsState())
        const exist = rooms.find((room) => room.domain === input.domain)
        if (exist) {
          if (isEqual(exist.user, input.user) && isEqual(exist.site, input.site)) return null
          return [
            RoomsState().new(replace(rooms, { ...exist, user: input.user, site: input.site })),
            IdentityChangedEvent(input.domain),
            PresenceChangedEvent(),
            SessionsChangedEvent(input.domain)
          ]
        }
        const joinedAt = input.resume?.joinedAt ?? Math.max(clock.now(), get(LastJoinedAtState()) + 1)
        const room: Room = {
          domain: input.domain,
          user: input.user,
          site: input.site,
          roomId: chatRoomId(input.domain),
          sessionId: identity.nextId(),
          presenceId: input.resume?.presenceId ?? identity.nextId(),
          joinedAt,
          joined: false,
          connection: 0,
          failures: 0,
          peers: []
        }
        return [
          RoomsState().new([...rooms, room]),
          LastJoinedAtState().new(Math.max(joinedAt, get(LastJoinedAtState()))),
          PresenceChangedEvent(),
          JoinRequestedEvent({ domain: room.domain, connection: 0, leaveFirst: false })
        ]
      }
    })

    /** Same presence, new physical connection. Remote presences get the leave grace to come back. */
    const ReconnectCommand = domain.command({
      name: 'Room.ReconnectCommand',
      impl: ({ get }, input: { domain: string; leaveFirst: boolean }) => {
        const rooms = get(RoomsState())
        const exist = rooms.find((room) => room.domain === input.domain)
        if (!exist) return null
        const connection = exist.connection + 1
        const departing = exist.peers.filter((peer) => !peer.leaving)
        return [
          RoomsState().new(
            replace(rooms, {
              ...exist,
              sessionId: identity.nextId(),
              joined: false,
              connection,
              failures: 0,
              peers: exist.peers.map((peer) => ({ ...peer, leaving: true }))
            })
          ),
          ...departing.flatMap((peer) => [
            PeerDisconnectedEvent({ domain: exist.domain, peerId: peer.peerId }),
            PeerLeavePendingEvent({ domain: exist.domain, peerId: peer.peerId })
          ]),
          JoinRequestedEvent({ domain: exist.domain, connection, leaveFirst: input.leaveFirst })
        ]
      }
    })

    const RetryJoinCommand = domain.command({
      name: 'Room.RetryJoinCommand',
      impl: ({ get }, attempt: Attempt) => {
        const room = get(RoomQuery(attempt.domain))
        if (!room || room.joined || room.connection !== attempt.connection) return null
        return JoinRequestedEvent({ ...attempt, leaveFirst: false })
      }
    })

    const SettleJoinCommand = domain.command({
      name: 'Room.SettleJoinCommand',
      impl: ({ get }, result: Attempt & { error?: string }) => {
        const rooms = get(RoomsState())
        const room = rooms.find((item) => item.domain === result.domain)
        if (!room || room.joined || room.connection !== result.connection) return null
        if (result.error !== undefined) {
          return [
            RoomsState().new(replace(rooms, { ...room, failures: room.failures + 1 })),
            JoinFailedEvent({
              domain: result.domain,
              connection: result.connection,
              failures: room.failures + 1,
              message: result.error
            })
          ]
        }
        return [
          RoomsState().new(replace(rooms, { ...room, joined: true, failures: 0 })),
          JoinedEvent(room.domain),
          SessionsChangedEvent(room.domain)
        ]
      }
    })

    const CloseCommand = domain.command({
      name: 'Room.CloseCommand',
      impl: ({ get }, roomDomain: string) => {
        const rooms = get(RoomsState())
        const room = rooms.find((item) => item.domain === roomDomain)
        if (!room) return null
        return [
          RoomsState().new(rooms.filter((item) => item !== room)),
          ...room.peers
            .filter((peer) => !peer.leaving)
            .map((peer) => PeerDisconnectedEvent({ domain: roomDomain, peerId: peer.peerId })),
          ClosedEvent({ domain: roomDomain, roomId: room.roomId }),
          PresenceChangedEvent()
        ]
      }
    })

    const PeerJoinedCommand = domain.command({
      name: 'Room.PeerJoinedCommand',
      impl: ({ get }, source: { roomId: string; peerId: string }) => {
        const room = get(RoomsState()).find((item) => item.roomId === source.roomId)
        if (!room) return null
        return PeerConnectedEvent({ domain: room.domain, connection: room.connection, peerId: source.peerId })
      }
    })

    const PeerLeftCommand = domain.command({
      name: 'Room.PeerLeftCommand',
      impl: ({ get }, source: { roomId: string; peerId: string }) => {
        const rooms = get(RoomsState())
        const room = rooms.find((item) => item.roomId === source.roomId)
        if (!room) return null
        const disconnected = PeerDisconnectedEvent({ domain: room.domain, peerId: source.peerId })
        const peer = room.peers.find((item) => item.peerId === source.peerId && !item.leaving)
        if (!peer) return disconnected
        // Another tab or device still holds this presence: drop only this source.
        const shared = room.peers.some((item) => item !== peer && !item.leaving && item.presenceId === peer.presenceId)
        const peers = shared
          ? room.peers.filter((item) => item !== peer)
          : room.peers.map((item) => (item === peer ? { ...item, leaving: true } : item))
        return [
          RoomsState().new(replace(rooms, { ...room, peers })),
          disconnected,
          shared
            ? SessionsChangedEvent(room.domain)
            : PeerLeavePendingEvent({ domain: room.domain, peerId: source.peerId })
        ]
      }
    })

    const ExpireLeaveCommand = domain.command({
      name: 'Room.ExpireLeaveCommand',
      impl: ({ get }, input: { domain: string; peerId: string }) => {
        const rooms = get(RoomsState())
        const room = rooms.find((item) => item.domain === input.domain)
        const peer = room?.peers.find((item) => item.peerId === input.peerId && item.leaving)
        if (!room || !peer) return null
        return [
          RoomsState().new(replace(rooms, { ...room, peers: room.peers.filter((item) => item !== peer) })),
          SessionsChangedEvent(room.domain)
        ]
      }
    })

    const ApplySessionCommand = domain.command({
      name: 'Room.ApplySessionCommand',
      impl: ({ get }, input: { roomId: string; peerId: string; message: SessionMessage }) => {
        const rooms = get(RoomsState())
        const room = rooms.find((item) => item.roomId === input.roomId)
        if (!room) return null
        const { presenceId, sessionId, user, joinedAt } = input.message
        // A presence never changes its owner or its start.
        const conflict = room.peers.some(
          (peer) => peer.presenceId === presenceId && (peer.user.id !== user.id || peer.joinedAt !== joinedAt)
        )
        if (conflict) return null
        const peers = room.peers
          // Replaces this source's previous entry, and a same-presence entry waiting in its leave grace.
          .filter((peer) => peer.peerId !== input.peerId && !(peer.presenceId === presenceId && peer.leaving))
          .map((peer) => (peer.presenceId === presenceId ? { ...peer, user } : peer))
        peers.push({ peerId: input.peerId, sessionId, presenceId, user, joinedAt, leaving: false })
        return [RoomsState().new(replace(rooms, { ...room, peers })), SessionsChangedEvent(room.domain)]
      }
    })

    const ApplyMessageCommand = domain.command({
      name: 'Room.ApplyMessageCommand',
      impl: ({ get }, input: { roomId: string; peerId: string; message: ChatMessage }) => {
        const room = get(RoomsState()).find((item) => item.roomId === input.roomId)
        const peer = room?.peers.find((item) => item.peerId === input.peerId && !item.leaving)
        if (!room || !peer || peer.user.id !== input.message.userId) return null
        const now = clock.now()
        return [
          ClockState().new(observe(get(ClockState()), input.message.hlc, now)),
          MessageReceivedEvent({
            domain: room.domain,
            record: {
              type: MESSAGE_RECORD_TYPE.CHAT_MESSAGE,
              id: input.message.id,
              message: input.message,
              user: peer.user,
              receivedAt: now
            }
          })
        ]
      }
    })

    /** History merges observe the clock without producing a live message. */
    const ObserveClockCommand = domain.command({
      name: 'Room.ObserveClockCommand',
      impl: ({ get }, remote: HLC) => ClockState().new(observe(get(ClockState()), remote, clock.now()))
    })

    const AllocateMessageCommand = domain.command({
      name: 'Room.AllocateMessageCommand',
      impl: ({ get }, input: { domain: string; requestId: string; command: SendCommand }) => {
        const room = get(RoomQuery(input.domain))
        if (!room?.joined) return null
        const now = clock.now()
        const hlc = allocate(get(ClockState()), now)
        const id = identity.nextId()
        const message: ChatMessage =
          input.command.type === 'text'
            ? {
                type: MESSAGE_TYPE.TEXT,
                id,
                hlc,
                userId: room.user.id,
                body: input.command.body,
                mentions: input.command.mentions
              }
            : {
                type: MESSAGE_TYPE.REACTION,
                id,
                hlc,
                targetId: input.command.targetId,
                userId: room.user.id,
                reaction: input.command.reaction,
                active: input.command.active
              }
        return [
          ClockState().new(hlc),
          MessageAllocatedEvent({
            requestId: input.requestId,
            record: { type: MESSAGE_RECORD_TYPE.CHAT_MESSAGE, id, message, user: room.user, receivedAt: now }
          })
        ]
      }
    })

    domain.effect({
      name: 'Room.JoinEffect',
      impl: ({ fromEvent }) =>
        fromEvent(JoinRequestedEvent).pipe(
          mergeMap(async ({ domain: roomDomain, connection, leaveFirst }) => {
            const roomId = chatRoomId(roomDomain)
            try {
              if (leaveFirst) await transport.leave(roomId)
              await joinWithTimeout(transport, roomId)
              return SettleJoinCommand({ domain: roomDomain, connection })
            } catch (error) {
              // Release the attempt so a failed peer never survives into the next retry.
              await transport.leave(roomId)
              return SettleJoinCommand({ domain: roomDomain, connection, error: errorMessage(error) })
            }
          })
        )
    })

    // Retries are silent until the third consecutive timeout, so one failure is not user-facing.
    domain.effect({
      name: 'Room.JoinFailureEffect',
      impl: ({ fromEvent }) =>
        fromEvent(JoinFailedEvent).pipe(
          filter((failed) => failed.failures === 3),
          map(({ domain: roomDomain, message }) => ErrorEvent({ domain: roomDomain, message }))
        )
    })

    domain.effect({
      name: 'Room.JoinRetryEffect',
      impl: ({ fromEvent }) =>
        fromEvent(JoinFailedEvent).pipe(
          mergeMap((attempt) => timer(JOIN_RETRY_MS).pipe(map(() => RetryJoinCommand(attempt))))
        )
    })

    domain.effect({
      name: 'Room.LeaveEffect',
      impl: ({ fromEvent }) =>
        fromEvent(ClosedEvent).pipe(
          mergeMap(async ({ roomId }) => {
            await transport.leave(roomId)
            return null
          })
        )
    })

    domain.effect({
      name: 'Room.ReleaseEffect',
      impl: ({ fromEvent }) => fromEvent(lifecycle.event.ReleasedEvent).pipe(map(CloseCommand))
    })

    domain.effect({
      name: 'Room.LeaveGraceEffect',
      impl: ({ fromEvent }) =>
        fromEvent(PeerLeavePendingEvent).pipe(
          mergeMap((pending) => timer(PEER_LEAVE_GRACE_MS).pipe(map(() => ExpireLeaveCommand(pending))))
        )
    })

    const announce = async (room: Room, to: string | string[]) => {
      try {
        await sendWire(transport, codec, room.roomId, sessionMessage(room), to)
        return null
      } catch (error) {
        return ErrorEvent({ domain: room.domain, message: errorMessage(error) })
      }
    }

    domain.effect({
      name: 'Room.AnnounceToPeerEffect',
      impl: ({ fromEvent, get }) =>
        fromEvent(PeerConnectedEvent).pipe(
          mergeMap(async ({ domain: roomDomain, peerId }) => {
            const room = get(RoomQuery(roomDomain))
            return room ? announce(room, peerId) : null
          })
        )
    })

    domain.effect({
      name: 'Room.AnnounceIdentityEffect',
      impl: ({ fromEvent, get }) =>
        fromEvent(IdentityChangedEvent).pipe(
          mergeMap(async (roomDomain) => {
            const room = get(RoomQuery(roomDomain))
            if (!room) return null
            return announce(
              room,
              room.peers.filter((peer) => !peer.leaving).map((peer) => peer.peerId)
            )
          })
        )
    })

    domain.effect({
      name: 'Room.WireEffect',
      impl: ({ fromEvent }) =>
        fromEvent(wire.event.ChatFrameEvent).pipe(
          map(({ roomId, peerId, message }) => {
            if (message.type === MESSAGE_TYPE.SESSION) return ApplySessionCommand({ roomId, peerId, message })
            if (message.type === MESSAGE_TYPE.TEXT || message.type === MESSAGE_TYPE.REACTION) {
              return ApplyMessageCommand({ roomId, peerId, message })
            }
            return null
          })
        )
    })

    const RecordFrameCommand = domain.command({
      name: 'Room.RecordFrameCommand',
      impl: () => LastFrameAtState().new(clock.now())
    })

    domain.effect({
      name: 'Room.FrameSeenEffect',
      impl: ({ fromEvent }) =>
        fromEvent(wire.event.ChatFrameEvent).pipe(map(() => [RecordFrameCommand(), FrameSeenEvent()]))
    })

    domain.effect({
      name: 'Room.PeerJoinedEffect',
      impl: ({ fromEvent }) => fromEvent(wire.event.PeerJoinedEvent).pipe(map(PeerJoinedCommand))
    })

    domain.effect({
      name: 'Room.PeerLeftEffect',
      impl: ({ fromEvent }) => fromEvent(wire.event.PeerLeftEvent).pipe(map(PeerLeftCommand))
    })

    domain.effect({
      name: 'Room.TransportClosedEffect',
      impl: ({ fromEvent, get }) =>
        fromEvent(wire.event.RoomClosedEvent).pipe(
          map((roomId) => get(RoomsState()).find((room) => room.roomId === roomId)),
          filter((room): room is Room => room !== undefined),
          map((room) => ReconnectCommand({ domain: room.domain, leaveFirst: false }))
        )
    })

    domain.effect({
      name: 'Room.TransportErrorEffect',
      impl: ({ fromEvent, get }) =>
        fromEvent(wire.event.ErrorEvent).pipe(
          map(({ roomId, message }) => {
            const room = get(RoomsState()).find((item) => item.roomId === roomId)
            return room ? ErrorEvent({ domain: room.domain, message }) : null
          })
        )
    })

    return {
      query: { RoomsQuery, RoomQuery, LastFrameAtQuery },
      command: { OpenCommand, ReconnectCommand, CloseCommand, AllocateMessageCommand, ObserveClockCommand },
      event: {
        JoinedEvent,
        JoinFailedEvent,
        ClosedEvent,
        PresenceChangedEvent,
        FrameSeenEvent,
        SessionsChangedEvent,
        PeerConnectedEvent,
        PeerDisconnectedEvent,
        MessageAllocatedEvent,
        MessageReceivedEvent,
        ErrorEvent
      }
    }
  }
})

export default RoomDomain
