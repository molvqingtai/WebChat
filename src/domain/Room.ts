import { Remesh } from 'remesh'
import { map, merge, switchMap, tap, of, EMPTY, mergeMap } from 'rxjs'
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
      impl: ({ get }, roomId: string) => {
        peerRoom.joinRoom(roomId)
        const { id: userId, name: username, avatar: userAvatar } = get(userInfoDomain.query.UserInfoQuery())!
        return [
          JoinRoomEvent(roomId),
          RoomStatusModule.command.SetFinishedCommand(),
          UpdateUserListCommand({
            type: 'create',
            user: { peerId: peerRoom.selfId, joinTime: Date.now(), userId, username, userAvatar }
          })
        ]
      }
    })

    const LeaveRoomCommand = domain.command({
      name: 'RoomLeaveRoomCommand',
      impl: ({ get }, roomId: string) => {
        peerRoom.leaveRoom()
        const { id: userId, name: username, avatar: userAvatar } = get(userInfoDomain.query.UserInfoQuery())!
        return [
          LeaveRoomEvent(roomId),
          RoomStatusModule.command.SetInitialCommand(),
          UpdateUserListCommand({
            type: 'delete',
            user: { peerId: peerRoom.selfId, joinTime: Date.now(), userId, username, userAvatar }
          })
        ]
      }
    })

    const SendTextMessageCommand = domain.command({
      name: 'RoomSendTextMessageCommand',
      impl: ({ get }, message: string) => {
        const { id: userId, name: username, avatar: userAvatar } = get(userInfoDomain.query.UserInfoQuery())!
        const id = nanoid()
        const date = Date.now()
        return [
          messageListDomain.command.CreateItemCommand({
            id,
            type: MessageType.Normal,
            body: message,
            date,
            userId,
            username,
            userAvatar,
            likeUsers: [],
            hateUsers: []
          }),
          SendTextMessageEvent({ id, body: message, userId, username, userAvatar, type: SendType.Text })
        ]
      }
    })

    const SendLikeMessageCommand = domain.command({
      name: 'RoomSendLikeMessageCommand',
      impl: ({ get }, messageId: string) => {
        const { id: userId, name: username, avatar: userAvatar } = get(userInfoDomain.query.UserInfoQuery())!
        const _message = get(messageListDomain.query.ItemQuery(messageId)) as NormalMessage
        return [
          messageListDomain.command.UpdateItemCommand({
            ..._message,
            likeUsers: desert(
              _message.likeUsers,
              {
                userId,
                username,
                userAvatar
              },
              'userId'
            )
          }),
          SendLikeMessageEvent({
            id: messageId,
            userId,
            username,
            userAvatar,
            type: SendType.Like
          })
        ]
      }
    })

    const SendHateMessageCommand = domain.command({
      name: 'RoomSendHateMessageCommand',
      impl: ({ get }, messageId: string) => {
        const { id: userId, name: username, avatar: userAvatar } = get(userInfoDomain.query.UserInfoQuery())!
        const _message = get(messageListDomain.query.ItemQuery(messageId)) as NormalMessage

        return [
          messageListDomain.command.UpdateItemCommand({
            ..._message,
            hateUsers: desert(
              _message.hateUsers,
              {
                userId,
                username,
                userAvatar
              },
              'userId'
            )
          }),
          SendHateMessageEvent({ id: messageId, userId, username, userAvatar, type: SendType.Hate })
        ]
      }
    })

    const SendUserSyncMessageCommand = domain.command({
      name: 'RoomSendUserSyncMessageCommand',
      impl: ({ get }, targetPeerId: string) => {
        const { id: userId, name: username, avatar: userAvatar } = get(userInfoDomain.query.UserInfoQuery())!
        const joinTime = get(UserListQuery()).find((u) => u.peerId === peerRoom.selfId)?.joinTime || Date.now()
        return [
          SendUserSyncMessageEvent({
            id: nanoid(),
            peerId: peerRoom.selfId,
            targetPeerId,
            userId,
            joinTime,
            username,
            userAvatar,
            type: SendType.UserSync
          })
        ]
      }
    })

    const SendUserSyncMessageEvent = domain.event<SyncUserMessage & { targetPeerId: string }>({
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

    domain.effect({
      name: 'RoomSendTextMessageEffect',
      impl: ({ fromEvent }) => {
        const sendMessage$ = fromEvent(SendTextMessageEvent).pipe(
          tap(async (message) => {
            peerRoom.sendMessage<RoomMessage>(message)
          })
        )
        return merge(sendMessage$).pipe(map(() => null))
      }
    })

    domain.effect({
      name: 'RoomSendLikeMessageEffect',
      impl: ({ fromEvent }) => {
        const likeMessage$ = fromEvent(SendLikeMessageEvent).pipe(
          tap(async (message) => {
            return peerRoom.sendMessage<RoomMessage>(message)
          })
        )
        return merge(likeMessage$).pipe(map(() => null))
      }
    })

    domain.effect({
      name: 'RoomSendHateMessageEffect',
      impl: ({ fromEvent }) => {
        const hateMessage$ = fromEvent(SendHateMessageEvent).pipe(
          tap(async (message) => {
            peerRoom.sendMessage<RoomMessage>(message)
          })
        )
        return merge(hateMessage$).pipe(map(() => null))
      }
    })

    domain.effect({
      name: 'RoomSendUserSyncMessageEffect',
      impl: ({ fromEvent }) => {
        const userSyncMessage$ = fromEvent(SendUserSyncMessageEvent).pipe(
          tap(async (message) => {
            console.log('sendMessage', message)

            peerRoom.sendMessage<RoomMessage>(message, message.targetPeerId)
          })
        )
        return merge(userSyncMessage$).pipe(map(() => null))
      }
    })

    domain.effect({
      name: 'RoomOnMessageEffect',
      impl: ({ fromEvent, get }) => {
        const onMessage$ = fromEvent(JoinRoomEvent).pipe(
          switchMap(() => callbackToObservable<RoomMessage>(peerRoom.onMessage.bind(peerRoom))),
          mergeMap((message) => {
            console.log('onMessage', message)

            const messageEvent$ = of(OnMessageEvent(message))

            const commandEvent$ = (() => {
              switch (message.type) {
                case SendType.UserSync: {
                  const self = get(UserListQuery()).find((user) => user.peerId === peerRoom.selfId)!
                  if (self.joinTime > message.joinTime) {
                    return EMPTY
                  }
                  return of(
                    UpdateUserListCommand({ type: 'create', user: message }),
                    messageListDomain.command.CreateItemCommand({
                      ...message,
                      id: nanoid(),
                      body: `"${message.username}" joined the chat`,
                      type: MessageType.Prompt,
                      date: Date.now()
                    })
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
                  console.warn('未知消息类型', message)
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
      name: 'RoomOnJoinRoomEffect',
      impl: ({ fromEvent, get }) => {
        const onJoinRoom$ = fromEvent(JoinRoomEvent).pipe(
          switchMap(() => callbackToObservable<string>(peerRoom.onJoinRoom.bind(peerRoom))),
          mergeMap((peerId) => {
            console.log('onJoinRoom', peerId)
            const { id: userId, name: username, avatar: userAvatar } = get(userInfoDomain.query.UserInfoQuery())!
            return [
              SendUserSyncMessageCommand(peerId),
              UpdateUserListCommand({
                type: 'create',
                user: { peerId, joinTime: Date.now(), userId, username, userAvatar }
              }),
              OnJoinRoomEvent(peerId)
            ]
          })
        )
        return onJoinRoom$
      }
    })

    domain.effect({
      name: 'RoomOnLeaveRoomEffect',
      impl: ({ fromEvent, get }) => {
        const onLeaveRoom$ = fromEvent(JoinRoomEvent).pipe(
          switchMap(() => callbackToObservable<string>(peerRoom.onLeaveRoom.bind(peerRoom))),
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
