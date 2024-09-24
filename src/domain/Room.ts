import { Remesh } from 'remesh'
import { map, merge, of, EMPTY, mergeMap } from 'rxjs'
import { NormalMessage, type MessageUser } from './MessageList'
import { PeerRoomExtern } from '@/domain/externs/PeerRoom'
import MessageListDomain, { MessageType } from '@/domain/MessageList'
import UserInfoDomain from '@/domain/UserInfo'
import { callbackToObservable, desert, upsert } from '@/utils'
import { nanoid } from 'nanoid'
import StatusModule from '@/domain/modules/Status'

export { MessageType }

export enum SendType {
  Like = 'like',
  Hate = 'hate',
  Text = 'text',
  UserSync = 'userSync'
}

export interface SyncUserMessage extends MessageUser {
  type: SendType.UserSync
  id: string
  peerId: string
  joinTime: number
}

export interface LikeMessage extends MessageUser {
  type: SendType.Like
  id: string
}

export interface HateMessage extends MessageUser {
  type: SendType.Hate
  id: string
}

export interface TextMessage extends MessageUser {
  type: SendType.Text
  id: string
  body: string
}

export type RoomMessage = SyncUserMessage | LikeMessage | HateMessage | TextMessage

export type RoomUser = MessageUser & { peerId: string; joinTime: number }

const RoomDomain = Remesh.domain({
  name: 'RoomDomain',
  impl: (domain) => {
    const messageListDomain = domain.getDomain(MessageListDomain())
    const userInfoDomain = domain.getDomain(UserInfoDomain())
    const peerRoom = domain.getExtern(PeerRoomExtern)

    const PeerIdState = domain.state<string>({
      name: 'Room.PeerIdState',
      default: peerRoom.peerId
    })

    const PeerIdQuery = domain.query({
      name: 'Room.PeerIdQuery',
      impl: ({ get }) => {
        return get(PeerIdState())
      }
    })

    const MessageListQuery = messageListDomain.query.ListQuery

    const RoomStatusModule = StatusModule(domain, {
      name: 'Room.RoomStatusModule'
    })

    const UserListState = domain.state<RoomUser[]>({
      name: 'RoomUserListState',
      default: []
    })

    const UserListQuery = domain.query({
      name: 'Room.UserListQuery',
      impl: ({ get }) => {
        return get(UserListState())
      }
    })

    const JoinRoomCommand = domain.command({
      name: 'RoomJoinRoomCommand',
      impl: ({ get }) => {
        peerRoom.joinRoom()
        const { id: userId, name: username, avatar: userAvatar } = get(userInfoDomain.query.UserInfoQuery())!

        return [
          UpdateUserListCommand({
            type: 'create',
            user: { peerId: peerRoom.peerId, joinTime: Date.now(), userId, username, userAvatar }
          }),
          RoomStatusModule.command.SetFinishedCommand(),
          JoinRoomEvent(peerRoom.roomId)
        ]
      }
    })

    const LeaveRoomCommand = domain.command({
      name: 'RoomLeaveRoomCommand',
      impl: ({ get }, roomId: string) => {
        peerRoom.leaveRoom()
        const { id: userId, name: username, avatar: userAvatar } = get(userInfoDomain.query.UserInfoQuery())!
        return [
          UpdateUserListCommand({
            type: 'delete',
            user: { peerId: peerRoom.peerId, joinTime: Date.now(), userId, username, userAvatar }
          }),
          RoomStatusModule.command.SetInitialCommand(),
          LeaveRoomEvent(roomId)
        ]
      }
    })

    const SendTextMessageCommand = domain.command({
      name: 'RoomSendTextMessageCommand',
      impl: ({ get }, message: string) => {
        const { id: userId, name: username, avatar: userAvatar } = get(userInfoDomain.query.UserInfoQuery())!

        const textMessage: TextMessage = {
          id: nanoid(),
          type: SendType.Text,
          body: message,
          userId,
          username,
          userAvatar
        }

        const listMessage: NormalMessage = {
          ...textMessage,
          type: MessageType.Normal,
          date: Date.now(),
          likeUsers: [],
          hateUsers: []
        }

        peerRoom.sendMessage<RoomMessage>(textMessage)
        return [messageListDomain.command.CreateItemCommand(listMessage), SendTextMessageEvent(textMessage)]
      }
    })

    const SendLikeMessageCommand = domain.command({
      name: 'RoomSendLikeMessageCommand',
      impl: ({ get }, messageId: string) => {
        const { id: userId, name: username, avatar: userAvatar } = get(userInfoDomain.query.UserInfoQuery())!
        const localMessage = get(messageListDomain.query.ItemQuery(messageId)) as NormalMessage

        const likeMessage: LikeMessage = {
          id: messageId,
          userId,
          username,
          userAvatar,
          type: SendType.Like
        }
        const listMessage: NormalMessage = {
          ...localMessage,
          type: MessageType.Normal,
          date: Date.now(),
          likeUsers: desert(localMessage.likeUsers, likeMessage, 'userId')
        }
        peerRoom.sendMessage<RoomMessage>(likeMessage)
        return [messageListDomain.command.UpdateItemCommand(listMessage), SendLikeMessageEvent(likeMessage)]
      }
    })

    const SendHateMessageCommand = domain.command({
      name: 'RoomSendHateMessageCommand',
      impl: ({ get }, messageId: string) => {
        const { id: userId, name: username, avatar: userAvatar } = get(userInfoDomain.query.UserInfoQuery())!
        const localMessage = get(messageListDomain.query.ItemQuery(messageId)) as NormalMessage

        const hateMessage: HateMessage = {
          id: messageId,
          userId,
          username,
          userAvatar,
          type: SendType.Hate
        }
        const listMessage: NormalMessage = {
          ...localMessage,
          type: MessageType.Normal,
          date: Date.now(),
          hateUsers: desert(localMessage.hateUsers, hateMessage, 'userId')
        }
        peerRoom.sendMessage<RoomMessage>(hateMessage)
        return [messageListDomain.command.UpdateItemCommand(listMessage), SendHateMessageEvent(hateMessage)]
      }
    })

    const SendUserSyncMessageCommand = domain.command({
      name: 'RoomSendUserSyncMessageCommand',
      impl: ({ get }, targetPeerId: string) => {
        const self = get(UserListQuery()).find((user) => user.peerId === peerRoom.peerId)!

        const syncUserMessage: SyncUserMessage = {
          ...self,
          id: nanoid(),
          type: SendType.UserSync
        }

        peerRoom.sendMessage<RoomMessage>(syncUserMessage, targetPeerId)
        return [SendUserSyncMessageEvent(syncUserMessage)]
      }
    })

    const UpdateUserListCommand = domain.command({
      name: 'RoomUpdateUserListCommand',
      impl: ({ get }, action: { type: 'create' | 'delete'; user: RoomUser }) => {
        const userList = get(UserListState())
        if (action.type === 'create') {
          return [UserListState().new(upsert(userList, action.user, 'peerId'))]
        } else {
          return [UserListState().new(userList.filter(({ peerId }) => peerId !== action.user.peerId))]
        }
      }
    })

    const SendUserSyncMessageEvent = domain.event<SyncUserMessage>({
      name: 'RoomSendUserSyncMessageEvent'
    })

    const SendTextMessageEvent = domain.event<TextMessage>({
      name: 'RoomSendTextMessageEvent'
    })

    const SendLikeMessageEvent = domain.event<LikeMessage>({
      name: 'RoomSendLikeMessageEvent'
    })

    const SendHateMessageEvent = domain.event<HateMessage>({
      name: 'RoomSendHateMessageEvent'
    })

    const JoinRoomEvent = domain.event<string>({
      name: 'RoomJoinRoomEvent'
    })

    const LeaveRoomEvent = domain.event<string>({
      name: 'RoomLeaveRoomEvent'
    })

    const OnMessageEvent = domain.event<RoomMessage>({
      name: 'RoomOnMessageEvent'
    })

    const OnJoinRoomEvent = domain.event<string>({
      name: 'RoomOnJoinRoomEvent'
    })

    const OnLeaveRoomEvent = domain.event<string>({
      name: 'RoomOnLeaveRoomEvent'
    })

    domain.effect({
      name: 'RoomOnJoinRoomEffect',
      impl: () => {
        const onJoinRoom$ = callbackToObservable<string>(peerRoom.onJoinRoom).pipe(
          mergeMap((peerId) => {
            console.log('onJoinRoom', peerId)
            if (peerRoom.peerId === peerId) {
              return [OnJoinRoomEvent(peerId)]
            } else {
              return [SendUserSyncMessageCommand(peerId), OnJoinRoomEvent(peerId)]
            }
          })
        )
        return onJoinRoom$
      }
    })

    domain.effect({
      name: 'RoomOnMessageEffect',
      impl: ({ get }) => {
        const onMessage$ = callbackToObservable<RoomMessage>(peerRoom.onMessage).pipe(
          mergeMap((message) => {
            console.log('onMessage', message)
            const messageEvent$ = of(OnMessageEvent(message))

            const commandEvent$ = (() => {
              switch (message.type) {
                case SendType.UserSync: {
                  const self = get(UserListQuery()).find((user) => user.peerId === peerRoom.peerId)!
                  const isJoining = self.joinTime < message.joinTime
                  return of(
                    UpdateUserListCommand({ type: 'create', user: message }),
                    isJoining
                      ? messageListDomain.command.CreateItemCommand({
                          ...message,
                          id: nanoid(),
                          body: `"${message.username}" joined the chat`,
                          type: MessageType.Prompt,
                          date: Date.now()
                        })
                      : null
                  )
                }
                case SendType.Text:
                  return of(
                    messageListDomain.command.CreateItemCommand({
                      ...message,
                      type: MessageType.Normal,
                      date: Date.now(),
                      likeUsers: [],
                      hateUsers: []
                    })
                  )
                case SendType.Like:
                case SendType.Hate: {
                  if (!get(messageListDomain.query.HasItemQuery(message.id))) {
                    return EMPTY
                  }
                  const _message = get(messageListDomain.query.ItemQuery(message.id)) as NormalMessage
                  const type = message.type === 'like' ? 'likeUsers' : 'hateUsers'
                  return of(
                    messageListDomain.command.UpdateItemCommand({
                      ..._message,
                      [type]: desert(
                        _message[type],
                        {
                          userId: message.userId,
                          username: message.username,
                          userAvatar: message.userAvatar
                        },
                        'userId'
                      )
                    })
                  )
                }
                default:
                  console.warn('Unsupported message type', message)
                  return EMPTY
              }
            })()
            return merge(messageEvent$, commandEvent$)
          })
        )
        return onMessage$
      }
    })

    domain.effect({
      name: 'RoomOnLeaveRoomEffect',
      impl: ({ get }) => {
        const onLeaveRoom$ = callbackToObservable<string>(peerRoom.onLeaveRoom).pipe(
          map((peerId) => {
            console.log('onLeaveRoom', peerId)
            const user = get(UserListQuery()).find((user) => user.peerId === peerId)

            if (user) {
              return [
                UpdateUserListCommand({ type: 'delete', user }),
                messageListDomain.command.CreateItemCommand({
                  ...user,
                  id: nanoid(),
                  body: `"${user.username}" left the chat`,
                  type: MessageType.Prompt,
                  date: Date.now()
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

    return {
      query: {
        PeerIdQuery,
        UserListQuery,
        MessageListQuery,
        ...RoomStatusModule.query
      },
      command: {
        JoinRoomCommand,
        LeaveRoomCommand,
        SendTextMessageCommand,
        SendLikeMessageCommand,
        SendHateMessageCommand,
        SendUserSyncMessageCommand,
        ...RoomStatusModule.command
      },
      event: {
        SendTextMessageEvent,
        SendLikeMessageEvent,
        SendHateMessageEvent,
        SendUserSyncMessageEvent,
        JoinRoomEvent,
        LeaveRoomEvent,
        OnMessageEvent,
        OnJoinRoomEvent,
        OnLeaveRoomEvent,
        ...RoomStatusModule.event
      }
    }
  }
})

export default RoomDomain
