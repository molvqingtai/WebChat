import { Remesh } from 'remesh'
import { concatMap, filter, map, mergeMap, timer } from 'rxjs'
import type { ChatUser, WorldRoomMessage } from '@/protocol'
import { JOIN_RETRY_MS } from '../Config'
import type { WorldSites } from '../Contract'
import { IdentityExtern, RoomTransportExtern, WireCodecExtern } from '../Externs'
import RoomDomain from './Room'
import WireDomain, { errorMessage, joinWithTimeout, sendWire, worldRoomId } from './Wire'

interface Connection {
  /** At least one site is open, so the world room should be held. */
  active: boolean
  joined: boolean
  connection: number
  user: ChatUser | null
}

type Task = { kind: 'join'; connection: number } | { kind: 'publish'; to?: string } | { kind: 'leave' }

/** One world room per browser: publishes which sites this browser is on, and lists everyone else's. */
const WorldDomain = Remesh.domain({
  name: 'WorldDomain',
  impl: (domain) => {
    const transport = domain.getExtern(RoomTransportExtern)
    const codec = domain.getExtern(WireCodecExtern)
    const sessionId = domain.getExtern(IdentityExtern).nextId()
    const wire = domain.getDomain(WireDomain())
    const room = domain.getDomain(RoomDomain())

    const ConnectionState = domain.state<Connection>({
      name: 'World.ConnectionState',
      default: { active: false, joined: false, connection: 0, user: null }
    })
    const PresencesState = domain.state<Array<{ peerId: string; presence: WorldRoomMessage }>>({
      name: 'World.PresencesState',
      default: []
    })

    const LocalPresenceQuery = domain.query({
      name: 'World.LocalPresenceQuery',
      impl: ({ get }): WorldRoomMessage | null => {
        const user = get(ConnectionState()).user
        return user ? { sessionId, user, sites: get(room.query.RoomsQuery()).map((item) => item.site) } : null
      }
    })

    const SitesQuery = domain.query({
      name: 'World.SitesQuery',
      impl: ({ get }): WorldSites => {
        const local = get(LocalPresenceQuery())
        const presences = [...(local ? [local] : []), ...get(PresencesState()).map((item) => item.presence)]
        const sites = new Map<string, WorldSites[number]>()
        // One user entry per contributing browser; site metadata comes from the first one seen.
        presences.forEach((presence) =>
          presence.sites.forEach((site) => {
            const exist = sites.get(site.origin)
            if (exist) exist.users.push(presence.user)
            else sites.set(site.origin, { ...site, users: [presence.user] })
          })
        )
        return [...sites.values()]
      }
    })

    const TaskEvent = domain.event<Task>({ name: 'World.TaskEvent' })
    const JoinFailedEvent = domain.event<number>({ name: 'World.JoinFailedEvent' })
    const SitesChangedEvent = domain.event({ name: 'World.SitesChangedEvent' })
    const ErrorEvent = domain.event<string>({ name: 'World.ErrorEvent' })

    const SyncCommand = domain.command({
      name: 'World.SyncCommand',
      impl: ({ get }) => {
        const state = get(ConnectionState())
        const user = get(room.query.RoomsQuery())[0]?.user
        if (user) {
          if (state.active) {
            return [
              ConnectionState().new({ ...state, user }),
              ...(state.joined ? [TaskEvent({ kind: 'publish' })] : []),
              SitesChangedEvent()
            ]
          }
          const connection = state.connection + 1
          return [
            ConnectionState().new({ active: true, joined: false, connection, user }),
            TaskEvent({ kind: 'join', connection }),
            SitesChangedEvent()
          ]
        }
        if (!state.active) return null
        // Last site released: tell everyone we are on no site, then leave.
        return [
          ConnectionState().new({ ...state, active: false, joined: false }),
          PresencesState().new([]),
          TaskEvent({ kind: 'publish' }),
          TaskEvent({ kind: 'leave' }),
          SitesChangedEvent()
        ]
      }
    })

    const ReconnectCommand = domain.command({
      name: 'World.ReconnectCommand',
      impl: ({ get }, leaveFirst: boolean) => {
        const state = get(ConnectionState())
        if (!state.active) return null
        const connection = state.connection + 1
        return [
          ConnectionState().new({ ...state, joined: false, connection }),
          PresencesState().new([]),
          ...(leaveFirst ? [TaskEvent({ kind: 'leave' })] : []),
          TaskEvent({ kind: 'join', connection }),
          SitesChangedEvent()
        ]
      }
    })

    const RetryJoinCommand = domain.command({
      name: 'World.RetryJoinCommand',
      impl: ({ get }, connection: number) => {
        const state = get(ConnectionState())
        return state.active && !state.joined && state.connection === connection
          ? TaskEvent({ kind: 'join', connection })
          : null
      }
    })

    const SettleJoinCommand = domain.command({
      name: 'World.SettleJoinCommand',
      impl: ({ get }, result: { connection: number; error?: string }) => {
        const state = get(ConnectionState())
        if (!state.active || state.joined || state.connection !== result.connection) return null
        if (result.error !== undefined) return [ErrorEvent(result.error), JoinFailedEvent(result.connection)]
        return [ConnectionState().new({ ...state, joined: true }), TaskEvent({ kind: 'publish' })]
      }
    })

    const ApplyPresenceCommand = domain.command({
      name: 'World.ApplyPresenceCommand',
      impl: ({ get }, input: { peerId: string; message: WorldRoomMessage }) => {
        if (!get(ConnectionState()).active) return null
        const presences = get(PresencesState())
        // A world session never changes its owner.
        if (
          presences.some(
            ({ presence }) => presence.sessionId === input.message.sessionId && presence.user.id !== input.message.user.id
          )
        ) {
          return null
        }
        const next = { peerId: input.peerId, presence: input.message }
        const known = presences.some((item) => item.peerId === input.peerId)
        return [
          PresencesState().new(
            known ? presences.map((item) => (item.peerId === input.peerId ? next : item)) : [...presences, next]
          ),
          // Its frame can arrive before the transport reports the peer; make sure it has ours.
          ...(known ? [] : [TaskEvent({ kind: 'publish', to: input.peerId })]),
          SitesChangedEvent()
        ]
      }
    })

    const RemovePresenceCommand = domain.command({
      name: 'World.RemovePresenceCommand',
      impl: ({ get }, peerId: string) => {
        const presences = get(PresencesState())
        if (!presences.some((item) => item.peerId === peerId)) return null
        return [PresencesState().new(presences.filter((item) => item.peerId !== peerId)), SitesChangedEvent()]
      }
    })

    const inWorld = <Source extends { roomId: string }>(source: Source) => source.roomId === worldRoomId

    domain.effect({
      name: 'World.SyncEffect',
      impl: ({ fromEvent }) => fromEvent(room.event.PresenceChangedEvent).pipe(map(() => SyncCommand()))
    })

    // One queue for join, publish and leave keeps them in the order they were decided.
    domain.effect({
      name: 'World.TaskEffect',
      impl: ({ fromEvent, get }) =>
        fromEvent(TaskEvent).pipe(
          concatMap(async (task) => {
            try {
              if (task.kind === 'join') {
                await joinWithTimeout(transport, worldRoomId)
                return SettleJoinCommand({ connection: task.connection })
              }
              if (task.kind === 'leave') {
                transport.leave(worldRoomId)
                return null
              }
              const presence = get(LocalPresenceQuery())
              if (presence && transport.peerIdOf(worldRoomId)) {
                await sendWire(transport, codec, worldRoomId, presence, task.to)
              }
              return null
            } catch (error) {
              return task.kind === 'join'
                ? SettleJoinCommand({ connection: task.connection, error: errorMessage(error) })
                : ErrorEvent(errorMessage(error))
            }
          })
        )
    })

    domain.effect({
      name: 'World.JoinRetryEffect',
      impl: ({ fromEvent }) =>
        fromEvent(JoinFailedEvent).pipe(
          mergeMap((connection) => timer(JOIN_RETRY_MS).pipe(map(() => RetryJoinCommand(connection))))
        )
    })

    domain.effect({
      name: 'World.PresenceEffect',
      impl: ({ fromEvent }) =>
        fromEvent(wire.event.WorldFrameEvent).pipe(
          map(({ peerId, message }) => ApplyPresenceCommand({ peerId, message }))
        )
    })

    domain.effect({
      name: 'World.PeerJoinedEffect',
      impl: ({ fromEvent }) =>
        fromEvent(wire.event.PeerJoinedEvent).pipe(
          filter(inWorld),
          map(({ peerId }) => TaskEvent({ kind: 'publish', to: peerId }))
        )
    })

    domain.effect({
      name: 'World.PeerLeftEffect',
      impl: ({ fromEvent }) =>
        fromEvent(wire.event.PeerLeftEvent).pipe(
          filter(inWorld),
          map(({ peerId }) => RemovePresenceCommand(peerId))
        )
    })

    domain.effect({
      name: 'World.TransportClosedEffect',
      impl: ({ fromEvent }) =>
        fromEvent(wire.event.RoomClosedEvent).pipe(
          filter((roomId) => roomId === worldRoomId),
          map(() => ReconnectCommand(false))
        )
    })

    domain.effect({
      name: 'World.TransportErrorEffect',
      impl: ({ fromEvent }) =>
        fromEvent(wire.event.ErrorEvent).pipe(
          filter(inWorld),
          map(({ message }) => ErrorEvent(message))
        )
    })

    return {
      query: { SitesQuery },
      command: { ReconnectCommand },
      event: { SitesChangedEvent, ErrorEvent }
    }
  }
})

export default WorldDomain
