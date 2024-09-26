import { Remesh } from 'remesh'
import { map, merge, of, EMPTY, mergeMap, fromEvent, Observable, tap, fromEventPattern } from 'rxjs'
import { NormalMessage, type MessageUser } from './MessageList'
import { PeerRoomExtern } from '@/domain/externs/PeerRoom'
import MessageListDomain, { MessageType } from '@/domain/MessageList'
import UserInfoDomain from '@/domain/UserInfo'
import { desert, upsert } from '@/utils'
import { nanoid } from 'nanoid'
import StatusModule from '@/domain/modules/Status'
import { ToastExtern } from './externs/Toast'

export { MessageType }

export enum SendType {
  Like = 'like',
  Hate = 'hate',
  Text = 'text',
  Join = 'join'
}

export interface SyncUserMessage extends MessageUser {
  type: SendType.Join
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
    const toast = domain.getExtern(ToastExtern)

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

    const RoomJoinStatusModule = StatusModule(domain, {
      name: 'RoomJoinStatusModule'
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
          messageListDomain.command.CreateItemCommand({
            id: nanoid(),
            userId,
            username,
            userAvatar,
            body: `"${username}" joined the chat`,
            type: MessageType.Prompt,
            date: Date.now()
          }),
          RoomJoinStatusModule.command.SetFinishedCommand(),
          JoinRoomEvent(peerRoom.roomId)
        ]
      }
    })

    const LeaveRoomCommand = domain.command({
      name: 'RoomLeaveRoomCommand',
      impl: ({ get }) => {
        peerRoom.leaveRoom()
        const { id: userId, name: username, avatar: userAvatar } = get(userInfoDomain.query.UserInfoQuery())!
        return [
          messageListDomain.command.CreateItemCommand({
            id: nanoid(),
            userId,
            username,
            userAvatar,
            body: `"${username}" left the chat`,
            type: MessageType.Prompt,
            date: Date.now()
          }),
          UpdateUserListCommand({
            type: 'delete',
            user: { peerId: peerRoom.peerId, joinTime: Date.now(), userId, username, userAvatar }
          }),
          RoomJoinStatusModule.command.SetInitialCommand(),
          LeaveRoomEvent(peerRoom.roomId)
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
          hateUsers: desert(localMessage.hateUsers, hateMessage, 'userId')
        }
        peerRoom.sendMessage<RoomMessage>(hateMessage)
        return [messageListDomain.command.UpdateItemCommand(listMessage), SendHateMessageEvent(hateMessage)]
      }
    })

    const SendJoinMessageCommand = domain.command({
      name: 'RoomSendJoinMessageCommand',
      impl: ({ get }, targetPeerId: string) => {
        const self = get(UserListQuery()).find((user) => user.peerId === peerRoom.peerId)!

        const syncUserMessage: SyncUserMessage = {
          ...self,
          id: nanoid(),
          type: SendType.Join
        }

        peerRoom.sendMessage<RoomMessage>(syncUserMessage, targetPeerId)
        return [SendJoinMessageEvent(syncUserMessage)]
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

    const SendJoinMessageEvent = domain.event<SyncUserMessage>({
      name: 'RoomSendJoinMessageEvent'
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
        const onJoinRoom$ = fromEventPattern<string>(peerRoom.onJoinRoom).pipe(
          mergeMap((peerId) => {
            // console.log('onJoinRoom', peerId)
            if (peerRoom.peerId === peerId) {
              return [OnJoinRoomEvent(peerId)]
            } else {
              return [SendJoinMessageCommand(peerId), OnJoinRoomEvent(peerId)]
            }
          })
        )
        return onJoinRoom$
      }
    })

    domain.effect({
      name: 'RoomOnMessageEffect',
      impl: ({ get }) => {
        const onMessage$ = fromEventPattern<RoomMessage>(peerRoom.onMessage).pipe(
          mergeMap((message) => {
            // console.log('onMessage', message)
            const messageEvent$ = of(OnMessageEvent(message))

            const commandEvent$ = (() => {
              switch (message.type) {
                case SendType.Join: {
                  const userList = get(UserListQuery())
                  const selfUser = userList.find((user) => user.peerId === peerRoom.peerId)!
                  // If the browser has multiple tabs open, it can cause the same user to join multiple times with the same peerId but different userId
                  const isSelfJoinEvent = !!userList.find((user) => user.userId === message.userId)
                  // When a new user joins, it triggers join events for all users, i.e., newUser join event and oldUser join event
                  // Use joinTime to determine if it's a new user
                  const isNewJoinEvent = selfUser.joinTime < message.joinTime

                  return isSelfJoinEvent
                    ? EMPTY
                    : of(
                        UpdateUserListCommand({ type: 'create', user: message }),
                        isNewJoinEvent
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
        const onLeaveRoom$ = fromEventPattern<string>(peerRoom.onLeaveRoom).pipe(
          map((peerId) => {
            // console.log('onLeaveRoom', peerId)
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

    domain.effect({
      name: 'RoomOnErrorEffect',
      impl: () => {
        const onRoomError$ = fromEventPattern<Error>(peerRoom.onError).pipe(
          map((error) => {
            console.error(error)
            toast.error(error.message)
            return null
          })
        )
        return onRoomError$
      }
    })

    // TODO: Move this to a service worker in the future, so we don't need to send a leave room message every time the page refreshes
    domain.effect({
      name: 'RoomOnUnloadEffect',
      impl: () => {
        const beforeUnload$ = fromEvent(window, 'beforeunload').pipe(
          map(() => {
            return [LeaveRoomCommand()]
          })
        )
        return beforeUnload$
      }
    })

    return {
      query: {
        PeerIdQuery,
        UserListQuery,
        RoomJoinIsFinishedQuery: RoomJoinStatusModule.query.IsFinishedQuery
      },
      command: {
        JoinRoomCommand,
        LeaveRoomCommand,
        SendTextMessageCommand,
        SendLikeMessageCommand,
        SendHateMessageCommand,
        SendJoinMessageCommand
      },
      event: {
        SendTextMessageEvent,
        SendLikeMessageEvent,
        SendHateMessageEvent,
        SendJoinMessageEvent,
        JoinRoomEvent,
        LeaveRoomEvent,
        OnMessageEvent,
        OnJoinRoomEvent,
        OnLeaveRoomEvent
      }
    }
  }
})

export default RoomDomain
