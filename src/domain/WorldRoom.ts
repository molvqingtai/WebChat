import { Remesh } from 'remesh'
import { map, merge, of, EMPTY, mergeMap, fromEventPattern } from 'rxjs'
import { type MessageUser } from './MessageList'
import { WorldRoomExtern } from '@/domain/externs/WorldRoom'
import UserInfoDomain from '@/domain/UserInfo'
import { upsert } from '@/utils'
import { nanoid } from 'nanoid'
import StatusModule from '@/domain/modules/Status'
import type { SiteInfo } from '@/utils/getSiteInfo'
import getSiteInfo from '@/utils/getSiteInfo'
import {
  WorldRoomSendType,
  type WorldRoomMessage,
  type WorldRoomSyncUserMessage,
  type WorldRoomMessageFromInfo,
  checkWorldRoomMessage
} from '@/protocol'

export type FromInfo = WorldRoomMessageFromInfo

export type RoomUser = MessageUser & { peerIds: string[]; fromInfos: FromInfo[]; joinTime: number }

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
        const { id: userId, name: username, avatar: userAvatar } = get(userInfoDomain.query.UserInfoQuery())!
        return [
          UpdateUserListCommand({
            type: 'create',
            user: {
              peerId: worldRoomExtern.peerId,
              fromInfo: { ...getSiteInfo(), peerId: worldRoomExtern.peerId },
              joinTime: Date.now(),
              userId,
              username,
              userAvatar
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
        const { id: userId, name: username, avatar: userAvatar } = get(userInfoDomain.query.UserInfoQuery())!
        return [
          UpdateUserListCommand({
            type: 'delete',
            user: {
              peerId: worldRoomExtern.peerId,
              fromInfo: { ...getSiteInfo(), peerId: worldRoomExtern.peerId },
              joinTime: Date.now(),
              userId,
              username,
              userAvatar
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
          user: Omit<RoomUser, 'peerIds' | 'fromInfos'> & { peerId: string; fromInfo: FromInfo }
        }
      ) => {
        const userList = get(UserListState())
        const existUser = userList.find((user) => user.userId === action.user.userId)
        if (action.type === 'create') {
          return [
            UserListState().new(
              upsert(
                userList,
                {
                  ...action.user,
                  peerIds: [...new Set(existUser?.peerIds || []), action.user.peerId],
                  fromInfos: upsert(existUser?.fromInfos || [], action.user.fromInfo, 'peerId')
                },
                'userId'
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
                  fromInfos: existUser?.fromInfos?.filter((fromInfo) => fromInfo.peerId !== action.user.peerId) || []
                },
                'userId'
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

        const syncUserMessage: WorldRoomSyncUserMessage = {
          ...self,
          id: nanoid(),
          peerId: worldRoomExtern.peerId,
          sendTime: Date.now(),
          fromInfo: { ...getSiteInfo(), peerId: worldRoomExtern.peerId },
          type: WorldRoomSendType.SyncUser
        }

        worldRoomExtern.sendMessage(syncUserMessage, peerId)
        return [SendSyncUserMessageEvent(syncUserMessage)]
      }
    })

    const SendSyncUserMessageEvent = domain.event<WorldRoomSyncUserMessage>({
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
                case WorldRoomSendType.SyncUser: {
                  return of(UpdateUserListCommand({ type: 'create', user: message }))
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
                  user: { ...existUser, peerId, fromInfo: { ...getSiteInfo(), peerId } }
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
