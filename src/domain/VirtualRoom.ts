import { Remesh } from 'remesh'
import { map, merge, of, EMPTY, mergeMap, fromEventPattern } from 'rxjs'
import { type MessageUser } from './MessageList'
import { VirtualRoomExtern } from '@/domain/externs/VirtualRoom'
import UserInfoDomain from '@/domain/UserInfo'
import { upsert } from '@/utils'
import { nanoid } from 'nanoid'
import StatusModule from '@/domain/modules/Status'
import * as v from 'valibot'
import getSiteInfo, { SiteInfo } from '@/utils/getSiteInfo'

export enum SendType {
  SyncUser = 'SyncUser'
}

export interface FromInfo extends SiteInfo {
  peerId: string
}

export interface SyncUserMessage extends MessageUser {
  type: SendType.SyncUser
  id: string
  peerId: string
  joinTime: number
  sendTime: number
  fromInfo: FromInfo
}

export type RoomMessage = SyncUserMessage

export type RoomUser = MessageUser & { peerIds: string[]; fromInfos: FromInfo[]; joinTime: number }

const MessageUserSchema = {
  userId: v.string(),
  username: v.string(),
  userAvatar: v.string()
}

const FromInfoSchema = {
  peerId: v.string(),
  host: v.string(),
  hostname: v.string(),
  href: v.string(),
  origin: v.string(),
  title: v.string(),
  icon: v.string(),
  description: v.string()
}

const RoomMessageSchema = v.union([
  v.object({
    type: v.literal(SendType.SyncUser),
    id: v.string(),
    peerId: v.string(),
    joinTime: v.number(),
    sendTime: v.number(),
    fromInfo: v.object(FromInfoSchema),
    ...MessageUserSchema
  })
])

// Check if the message conforms to the format
const checkMessageFormat = (message: v.InferInput<typeof RoomMessageSchema>) =>
  v.safeParse(RoomMessageSchema, message).success

const VirtualRoomDomain = Remesh.domain({
  name: 'VirtualRoomDomain',
  impl: (domain) => {
    const userInfoDomain = domain.getDomain(UserInfoDomain())
    const virtualRoomExtern = domain.getExtern(VirtualRoomExtern)

    const PeerIdState = domain.state<string>({
      name: 'Room.PeerIdState',
      default: virtualRoomExtern.peerId
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
        return get(UserListQuery()).find((user) => user.peerIds.includes(virtualRoomExtern.peerId))!
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
              peerId: virtualRoomExtern.peerId,
              fromInfo: { ...getSiteInfo(), peerId: virtualRoomExtern.peerId },
              joinTime: Date.now(),
              userId,
              username,
              userAvatar
            }
          }),

          JoinStatusModule.command.SetFinishedCommand(),
          JoinRoomEvent(virtualRoomExtern.roomId),
          SelfJoinRoomEvent(virtualRoomExtern.roomId)
        ]
      }
    })

    JoinRoomCommand.after(() => {
      virtualRoomExtern.joinRoom()
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
              peerId: virtualRoomExtern.peerId,
              fromInfo: { ...getSiteInfo(), peerId: virtualRoomExtern.peerId },
              joinTime: Date.now(),
              userId,
              username,
              userAvatar
            }
          }),
          JoinStatusModule.command.SetInitialCommand(),
          LeaveRoomEvent(virtualRoomExtern.roomId),
          SelfLeaveRoomEvent(virtualRoomExtern.roomId)
        ]
      }
    })

    LeaveRoomCommand.after(() => {
      virtualRoomExtern.leaveRoom()
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

        const syncUserMessage: SyncUserMessage = {
          ...self,
          id: nanoid(),
          peerId: virtualRoomExtern.peerId,
          sendTime: Date.now(),
          fromInfo: { ...getSiteInfo(), peerId: virtualRoomExtern.peerId },
          type: SendType.SyncUser
        }

        virtualRoomExtern.sendMessage(syncUserMessage, peerId)
        return [SendSyncUserMessageEvent(syncUserMessage)]
      }
    })

    const SendSyncUserMessageEvent = domain.event<SyncUserMessage>({
      name: 'Room.SendSyncUserMessageEvent'
    })

    const JoinRoomEvent = domain.event<string>({
      name: 'Room.JoinRoomEvent'
    })

    const LeaveRoomEvent = domain.event<string>({
      name: 'Room.LeaveRoomEvent'
    })

    const OnMessageEvent = domain.event<RoomMessage>({
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
        const onJoinRoom$ = fromEventPattern<string>(virtualRoomExtern.onJoinRoom).pipe(
          mergeMap((peerId) => {
            // console.log('onJoinRoom', peerId)
            if (virtualRoomExtern.peerId === peerId) {
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
        const onMessage$ = fromEventPattern<RoomMessage>(virtualRoomExtern.onMessage).pipe(
          mergeMap((message) => {
            // Filter out messages that do not conform to the format
            if (!checkMessageFormat(message)) {
              console.warn('Invalid message format', message)
              return EMPTY
            }

            const messageEvent$ = of(OnMessageEvent(message))

            const messageCommand$ = (() => {
              switch (message.type) {
                case SendType.SyncUser: {
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
        const onLeaveRoom$ = fromEventPattern<string>(virtualRoomExtern.onLeaveRoom).pipe(
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
        const onRoomError$ = fromEventPattern<Error>(virtualRoomExtern.onError).pipe(
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

export default VirtualRoomDomain
