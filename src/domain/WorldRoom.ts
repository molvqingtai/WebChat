import { Remesh } from 'remesh'
import { map, merge, of, EMPTY, mergeMap, fromEventPattern } from 'rxjs'
import { type MessageUser } from './MessageList'
import { WorldRoomExtern } from '@/domain/externs/WorldRoom'
import UserInfoDomain from '@/domain/UserInfo'
import { upsert } from '@/utils'
import { nanoid } from 'nanoid'
import StatusModule from '@/domain/modules/Status'
import getSiteMeta from '@/utils/getSiteMeta'
import {
  type WorldRoomMessage,
  type WorldRoomPeerSyncMessage,
  type WorldRoomSiteMeta,
  checkWorldRoomMessage
} from '@/protocol'
import { MESSAGE_TYPE } from '@/protocol/Message'

export type FromSite = WorldRoomSiteMeta & { peerId: string }

export type RoomUser = MessageUser & { peerIds: string[]; fromSites: FromSite[]; joinedAt: number }

const WorldRoomDomain = Remesh.domain({
  name: 'WorldRoomDomain',
  impl: (domain) => {
    const userInfoDomain = domain.getDomain(UserInfoDomain())
    const worldRoomExtern = domain.getExtern(WorldRoomExtern)

    const PeerIdState = domain.state<string>({
      name: 'Room.PeerIdState',
      default: worldRoomExtern.peerId
    })

    const PeerIdQuery = domain.query({
      name: 'Room.PeerIdQuery',
      impl: ({ get }) => {
        return get(PeerIdState())
      }
    })

    const JoinStatusModule = StatusModule(domain, {
      name: 'Room.JoinStatusModule'
    })

    const UserListState = domain.state<RoomUser[]>({
      name: 'Room.UserListState',
      default: []
    })

    const UserListQuery = domain.query({
      name: 'Room.UserListQuery',
      impl: ({ get }) => {
        return get(UserListState())
      }
    })

    const SelfUserQuery = domain.query({
      name: 'Room.SelfUserQuery',
      impl: ({ get }) => {
        return get(UserListQuery()).find((user) => user.peerIds.includes(worldRoomExtern.peerId))!
      }
    })

    const JoinIsFinishedQuery = JoinStatusModule.query.IsFinishedQuery

    const JoinRoomCommand = domain.command({
      name: 'Room.JoinRoomCommand',
      impl: ({ get }) => {
        const { id, name, avatar } = get(userInfoDomain.query.UserInfoQuery())!
        return [
          UpdateUserListCommand({
            type: 'create',
            user: {
              peerId: worldRoomExtern.peerId,
              fromSite: { ...getSiteMeta(), peerId: worldRoomExtern.peerId },
              joinedAt: Date.now(),
              id,
              name,
              avatar
            }
          }),

          JoinStatusModule.command.SetFinishedCommand(),
          JoinRoomEvent(worldRoomExtern.roomId),
          SelfJoinRoomEvent(worldRoomExtern.roomId)
        ]
      }
    })

    JoinRoomCommand.after(() => {
      worldRoomExtern.joinRoom()
      return null
    })

    const LeaveRoomCommand = domain.command({
      name: 'Room.LeaveRoomCommand',
      impl: ({ get }) => {
        const { id, name, avatar } = get(userInfoDomain.query.UserInfoQuery())!
        return [
          UpdateUserListCommand({
            type: 'delete',
            user: {
              peerId: worldRoomExtern.peerId,
              fromSite: { ...getSiteMeta(), peerId: worldRoomExtern.peerId },
              joinedAt: Date.now(),
              id,
              name,
              avatar
            }
          }),
          JoinStatusModule.command.SetInitialCommand(),
          LeaveRoomEvent(worldRoomExtern.roomId),
          SelfLeaveRoomEvent(worldRoomExtern.roomId)
        ]
      }
    })

    LeaveRoomCommand.after(() => {
      worldRoomExtern.leaveRoom()
      return null
    })

    const UpdateUserListCommand = domain.command({
      name: 'Room.UpdateUserListCommand',
      impl: (
        { get },
        action: {
          type: 'create' | 'delete'
          user: Omit<RoomUser, 'peerIds' | 'fromSites'> & { peerId: string; fromSite: FromSite }
        }
      ) => {
        const userList = get(UserListState())
        const existUser = userList.find((user) => user.id === action.user.id)
        if (action.type === 'create') {
          return [
            UserListState().new(
              upsert(
                userList,
                {
                  ...action.user,
                  peerIds: [...new Set(existUser?.peerIds || []), action.user.peerId],
                  fromSites: upsert(existUser?.fromSites || [], action.user.fromSite, 'peerId')
                },
                'id'
              )
            )
          ]
        } else {
          return [
            UserListState().new(
              upsert(
                userList,
                {
                  ...action.user,
                  peerIds: existUser?.peerIds?.filter((peerId) => peerId !== action.user.peerId) || [],
                  fromSites: existUser?.fromSites?.filter((fromSite) => fromSite.peerId !== action.user.peerId) || []
                },
                'id'
              ).filter((user) => user.peerIds.length)
            )
          ]
        }
      }
    })

    const SendSyncUserMessageCommand = domain.command({
      name: 'Room.SendSyncUserMessageCommand',
      impl: ({ get }, peerId: string) => {
        const self = get(SelfUserQuery())
        const now = Date.now()

        const syncUserMessage: WorldRoomPeerSyncMessage = {
          type: MESSAGE_TYPE.PEER_SYNC,
          id: nanoid(),
          hlc: { timestamp: now, counter: 0 },
          sentAt: now,
          receivedAt: now,
          sender: {
            id: self.id,
            name: self.name,
            avatar: self.avatar
          },
          peerId: worldRoomExtern.peerId,
          joinedAt: self.joinedAt,
          siteMeta: getSiteMeta()
        }

        worldRoomExtern.sendMessage(syncUserMessage, peerId)
        return [SendSyncUserMessageEvent(syncUserMessage)]
      }
    })

    const SendSyncUserMessageEvent = domain.event<WorldRoomPeerSyncMessage>({
      name: 'Room.SendSyncUserMessageEvent'
    })

    const JoinRoomEvent = domain.event<string>({
      name: 'Room.JoinRoomEvent'
    })

    const LeaveRoomEvent = domain.event<string>({
      name: 'Room.LeaveRoomEvent'
    })

    const OnMessageEvent = domain.event<WorldRoomMessage>({
      name: 'Room.OnMessageEvent'
    })

    const OnJoinRoomEvent = domain.event<string>({
      name: 'Room.OnJoinRoomEvent'
    })

    const SelfJoinRoomEvent = domain.event<string>({
      name: 'Room.SelfJoinRoomEvent'
    })

    const OnLeaveRoomEvent = domain.event<string>({
      name: 'Room.OnLeaveRoomEvent'
    })

    const SelfLeaveRoomEvent = domain.event<string>({
      name: 'Room.SelfLeaveRoomEvent'
    })

    const OnErrorEvent = domain.event<Error>({
      name: 'Room.OnErrorEvent'
    })

    domain.effect({
      name: 'Room.OnJoinRoomEffect',
      impl: () => {
        const onJoinRoom$ = fromEventPattern<string>(worldRoomExtern.onJoinRoom).pipe(
          mergeMap((peerId) => {
            // console.log('onJoinRoom', peerId)
            if (worldRoomExtern.peerId === peerId) {
              return [OnJoinRoomEvent(peerId)]
            } else {
              return [SendSyncUserMessageCommand(peerId), OnJoinRoomEvent(peerId)]
            }
          })
        )
        return onJoinRoom$
      }
    })

    domain.effect({
      name: 'Room.OnMessageEffect',
      impl: () => {
        const onMessage$ = fromEventPattern<WorldRoomMessage>(worldRoomExtern.onMessage).pipe(
          mergeMap((message) => {
            // Filter out messages that do not conform to the format
            if (!checkWorldRoomMessage(message)) {
              console.warn('Invalid message format', message)
              return EMPTY
            }

            const messageEvent$ = of(OnMessageEvent(message))

            const messageCommand$ = (() => {
              switch (message.type) {
                case MESSAGE_TYPE.PEER_SYNC: {
                  return of(
                    UpdateUserListCommand({
                      type: 'create',
                      user: {
                        ...message.sender,
                        peerId: message.peerId,
                        fromSite: { ...message.siteMeta, peerId: message.peerId },
                        joinedAt: message.joinedAt
                      }
                    })
                  )
                }

                default:
                  console.warn('Unsupported message type', message)
                  return EMPTY
              }
            })()

            return merge(messageEvent$, messageCommand$)
          })
        )
        return onMessage$
      }
    })

    domain.effect({
      name: 'Room.OnLeaveRoomEffect',
      impl: ({ get }) => {
        const onLeaveRoom$ = fromEventPattern<string>(worldRoomExtern.onLeaveRoom).pipe(
          map((peerId) => {
            if (get(JoinStatusModule.query.IsInitialQuery())) {
              return null
            }
            // console.log('onLeaveRoom', peerId)

            const existUser = get(UserListQuery()).find((user) => user.peerIds.includes(peerId))

            if (existUser) {
              return [
                UpdateUserListCommand({
                  type: 'delete',
                  user: { ...existUser, peerId, fromSite: { ...getSiteMeta(), peerId } }
                }),
                OnLeaveRoomEvent(peerId)
              ]
            } else {
              return [OnLeaveRoomEvent(peerId)]
            }
          })
        )
        return onLeaveRoom$
      }
    })

    domain.effect({
      name: 'Room.OnErrorEffect',
      impl: () => {
        const onRoomError$ = fromEventPattern<Error>(worldRoomExtern.onError).pipe(
          map((error) => {
            console.error(error)
            return OnErrorEvent(error)
          })
        )
        return onRoomError$
      }
    })

    return {
      query: {
        PeerIdQuery,
        UserListQuery,
        JoinIsFinishedQuery
      },
      command: {
        JoinRoomCommand,
        LeaveRoomCommand,
        SendSyncUserMessageCommand
      },
      event: {
        SendSyncUserMessageEvent,
        JoinRoomEvent,
        SelfJoinRoomEvent,
        LeaveRoomEvent,
        SelfLeaveRoomEvent,
        OnMessageEvent,
        OnJoinRoomEvent,
        OnLeaveRoomEvent,
        OnErrorEvent
      }
    }
  }
})

export default WorldRoomDomain
