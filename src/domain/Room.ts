import { Remesh } from 'remesh'
import { map, merge, switchMap, tap, defer, of, EMPTY, mergeMap } from 'rxjs'
import { type MessageUser } from './MessageList'
import { PeerRoomExtern } from '@/domain/externs/PeerRoom'
import MessageListDomain from '@/domain/MessageList'
import UserInfoDomain from '@/domain/UserInfo'
import { callbackToObservable, desert } from '@/utils'
import { nanoid } from 'nanoid'
import StatusModule from './modules/Status'

export enum MessageType {
  Like = 'like',
  Hate = 'hate',
  Text = 'text'
}

export interface LikeMessage extends MessageUser {
  type: MessageType.Like
  id: string
}

export interface HateMessage extends MessageUser {
  type: MessageType.Hate
  id: string
}

export interface TextMessage extends MessageUser {
  type: MessageType.Text
  id: string
  body: string
}

export type RoomMessage = LikeMessage | HateMessage | TextMessage

const RoomDomain = Remesh.domain({
  name: 'RoomDomain',
  impl: (domain) => {
    const messageListDomain = domain.getDomain(MessageListDomain())
    const userInfoDomain = domain.getDomain(UserInfoDomain())
    const peerRoom = domain.getExtern(PeerRoomExtern)

    const MessageListQuery = messageListDomain.query.ListQuery

    const RoomStatusState = StatusModule(domain, {
      name: 'Room.RoomStatusModule'
    })

    const PeerListState = domain.state<string[]>({
      name: 'Room.PeerListState',
      default: [peerRoom.selfId]
    })

    const PeerListQuery = domain.query({
      name: 'Room.PeerListQuery',
      impl: ({ get }) => {
        return get(PeerListState())
      }
    })

    const JoinRoomCommand = domain.command({
      name: 'RoomJoinRoomCommand',
      impl: (_, roomId: string) => {
        peerRoom.joinRoom(roomId)
        return [JoinRoomEvent(roomId), RoomStatusState.command.SetFinishedCommand()]
      }
    })

    const LeaveRoomCommand = domain.command({
      name: 'RoomLeaveRoomCommand',
      impl: (_, roomId: string) => {
        peerRoom.leaveRoom()
        return [LeaveRoomEvent(roomId), RoomStatusState.command.SetInitialCommand()]
      }
    })

    const SendTextMessageCommand = domain.command({
      name: 'RoomSendTextMessageCommand',
      impl: ({ get }, message: string) => {
        const { id: userId, name: username, avatar: userAvatar } = get(userInfoDomain.query.UserInfoQuery())!
        const id = nanoid()
        return [
          messageListDomain.command.CreateItemCommand({
            id,
            body: message,
            date: Date.now(),
            userId,
            username,
            userAvatar,
            likeUsers: [],
            hateUsers: []
          }),
          SendTextMessageEvent({ id, body: message, userId, username, userAvatar, type: MessageType.Text })
        ]
      }
    })

    const SendTextMessageEvent = domain.event<RoomMessage>({
      name: 'RoomSendTextMessageEvent'
    })

    const SendLikeMessageCommand = domain.command({
      name: 'RoomSendLikeMessageCommand',
      impl: ({ get }, messageId: string) => {
        const { id: userId, name: username, avatar: userAvatar } = get(userInfoDomain.query.UserInfoQuery())!
        const _message = get(messageListDomain.query.ItemQuery(messageId))
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
          SendLikeMessageEvent({ id: messageId, userId, username, userAvatar, type: MessageType.Like })
        ]
      }
    })

    const SendLikeMessageEvent = domain.event<RoomMessage>({
      name: 'RoomSendLikeMessageEvent'
    })

    const SendHateMessageCommand = domain.command({
      name: 'RoomSendHateMessageCommand',
      impl: ({ get }, messageId: string) => {
        const { id: userId, name: username, avatar: userAvatar } = get(userInfoDomain.query.UserInfoQuery())!
        const _message = get(messageListDomain.query.ItemQuery(messageId))

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
          SendHateMessageEvent({ id: messageId, userId, username, userAvatar, type: MessageType.Hate })
        ]
      }
    })

    const SendHateMessageEvent = domain.event<RoomMessage>({
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

    const UpdatePeerListCommand = domain.command({
      name: 'RoomUpdatePeerListCommand',
      impl: ({ get }, action: { type: 'create' | 'delete'; peerId: string }) => {
        const peerList = get(PeerListState())
        if (action.type === 'create') {
          return [PeerListState().new([...new Set(peerList).add(action.peerId)])]
        }
        if (action.type === 'delete') {
          return [PeerListState().new(peerList.filter((peerId) => peerId == action.peerId))]
        }
        return null
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
            peerRoom.sendMessage<RoomMessage>(message)
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
      name: 'RoomOnMessageEffect',
      impl: ({ fromEvent, get }) => {
        const onMessage$ = fromEvent(JoinRoomEvent).pipe(
          switchMap(() => callbackToObservable<RoomMessage>(peerRoom.onMessage.bind(peerRoom))),
          mergeMap((message) => {
            console.log('onMessage', message)

            const messageEvent$ = of(OnMessageEvent(message))

            const commandEvent$ = (() => {
              switch (message.type) {
                case 'text':
                  return of(
                    messageListDomain.command.CreateItemCommand({
                      ...message,
                      date: Date.now(),
                      likeUsers: [],
                      hateUsers: []
                    })
                  )
                case 'like':
                case 'hate': {
                  if (!get(messageListDomain.query.HasItemQuery(message.id))) {
                    return EMPTY
                  }
                  const _message = get(messageListDomain.query.ItemQuery(message.id))
                  const users = message.type === 'like' ? 'likeUsers' : 'hateUsers'
                  return of(
                    messageListDomain.command.UpdateItemCommand({
                      ..._message,
                      [users]: desert(
                        _message[users],
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
      impl: ({ fromEvent }) => {
        const onJoinRoom$ = fromEvent(JoinRoomEvent).pipe(
          switchMap(() => callbackToObservable<string>(peerRoom.onJoinRoom.bind(peerRoom))),
          map((peerId) => {
            console.log('onJoinRoom', peerId)
            return [UpdatePeerListCommand({ type: 'create', peerId }), OnJoinRoomEvent(peerId)]
          })
        )
        return onJoinRoom$
      }
    })

    domain.effect({
      name: 'RoomOnLeaveRoomEffect',
      impl: ({ fromEvent }) => {
        const onLeaveRoom$ = fromEvent(JoinRoomEvent).pipe(
          switchMap(() => callbackToObservable<string>(peerRoom.onLeaveRoom.bind(peerRoom))),
          map((peerId) => {
            console.log('onLeaveRoom', peerId)
            return [UpdatePeerListCommand({ type: 'delete', peerId }), OnLeaveRoomEvent(peerId)]
          })
        )
        return onLeaveRoom$
      }
    })

    return {
      query: {
        PeerListQuery,
        MessageListQuery,
        ...RoomStatusState.query
      },
      event: {
        SendTextMessageEvent,
        SendLikeMessageEvent,
        SendHateMessageEvent,
        JoinRoomEvent,
        LeaveRoomEvent,
        OnMessageEvent,
        OnJoinRoomEvent,
        OnLeaveRoomEvent,
        ...RoomStatusState.event
      },
      command: {
        JoinRoomCommand,
        LeaveRoomCommand,
        SendTextMessageCommand,
        SendLikeMessageCommand,
        SendHateMessageCommand,
        ...RoomStatusState.command
      }
    }
  }
})

export default RoomDomain
