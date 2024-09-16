import { Remesh } from 'remesh'
import { map, merge, tap } from 'rxjs'
import { type MessageUser } from './MessageList'
import { PeerRoomExtern } from '@/domain/externs/PeerRoom'
import MessageListDomain from '@/domain/MessageList'
import UserInfoDomain from '@/domain/UserInfo'
import { callbackToObservable, desert, stringToHex } from '@/utils'
import { nanoid } from 'nanoid'

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

const hostRoomId = stringToHex(document.location.host)

const RoomDomain = Remesh.domain({
  name: 'RoomDomain',
  impl: (domain) => {
    const messageListDomain = domain.getDomain(MessageListDomain())
    const userInfoDomain = domain.getDomain(UserInfoDomain())
    const peerRoom = domain.getExtern(PeerRoomExtern)
    peerRoom.joinRoom(hostRoomId)

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
            likeUsers: desert(_message.likeUsers, 'userId', {
              userId,
              username,
              userAvatar
            })
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
            hateUsers: desert(_message.hateUsers, 'userId', {
              userId,
              username,
              userAvatar
            })
          }),
          SendHateMessageEvent({ id: messageId, userId, username, userAvatar, type: MessageType.Hate })
        ]
      }
    })

    const SendHateMessageEvent = domain.event<RoomMessage>({
      name: 'RoomSendHateMessageEvent'
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
      impl: ({ get }) => {
        const onMessage$ = callbackToObservable<RoomMessage>(peerRoom.onMessage.bind(peerRoom))
        return onMessage$.pipe(
          map((message) => {
            console.log(message)
            switch (message.type) {
              case 'text':
                return messageListDomain.command.CreateItemCommand({
                  ...message,
                  date: Date.now(),
                  likeUsers: [],
                  hateUsers: []
                })
              case 'like': {
                const _message = get(messageListDomain.query.ItemQuery(message.id))
                return messageListDomain.command.UpdateItemCommand({
                  ..._message,
                  likeUsers: desert(_message.likeUsers, 'userId', {
                    userId: message.userId,
                    username: message.username,
                    userAvatar: message.userAvatar
                  })
                })
              }
              case 'hate': {
                const _message = get(messageListDomain.query.ItemQuery(message.id))
                return messageListDomain.command.UpdateItemCommand({
                  ..._message,
                  hateUsers: desert(_message.hateUsers, 'userId', {
                    userId: message.userId,
                    username: message.username,
                    userAvatar: message.userAvatar
                  })
                })
              }
              default:
                console.warn('unknown message type', message)
                return null
            }
          })
        )
      }
    })

    return {
      event: {
        SendTextMessageEvent,
        SendLikeMessageEvent,
        SendHateMessageEvent
      },
      command: {
        SendTextMessageCommand,
        SendLikeMessageCommand,
        SendHateMessageCommand
      }
    }
  }
})

export default RoomDomain
