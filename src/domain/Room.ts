import { Remesh } from 'remesh'
import { map, merge, of, EMPTY, mergeMap, fromEvent, fromEventPattern } from 'rxjs'
import { AtUser, NormalMessage, type MessageUser } from './MessageList'
import { PeerRoomExtern } from '@/domain/externs/PeerRoom'
import MessageListDomain, { MessageType } from '@/domain/MessageList'
import UserInfoDomain from '@/domain/UserInfo'
import { desert, getTextByteSize, upsert } from '@/utils'
import { nanoid } from 'nanoid'
import StatusModule from '@/domain/modules/Status'
import { ToastExtern } from './externs/Toast'
import { SYNC_HISTORY_MAX_DAYS, WEB_RTC_MAX_MESSAGE_SIZE } from '@/constants/config'

export { MessageType }

export enum SendType {
  Like = 'Like',
  Hate = 'Hate',
  Text = 'Text',
  SyncUser = 'SyncUser',
  SyncHistory = 'SyncHistory'
}

export interface SyncUserMessage extends MessageUser {
  type: SendType.SyncUser
  id: string
  peerId: string
  joinTime: number
  sendTime: number
  lastMessageTime: number
}

export interface SyncHistoryMessage extends MessageUser {
  type: SendType.SyncHistory
  sendTime: number
  id: string
  messages: NormalMessage[]
}

export interface LikeMessage extends MessageUser {
  type: SendType.Like
  sendTime: number
  id: string
}

export interface HateMessage extends MessageUser {
  type: SendType.Hate
  sendTime: number
  id: string
}

export interface TextMessage extends MessageUser {
  type: SendType.Text
  id: string
  body: string
  sendTime: number
  atUsers: AtUser[]
}

export type RoomMessage = SyncUserMessage | SyncHistoryMessage | LikeMessage | HateMessage | TextMessage

export type RoomUser = MessageUser & { peerId: string; joinTime: number }

const RoomDomain = Remesh.domain({
  name: 'RoomDomain',
  impl: (domain) => {
    const messageListDomain = domain.getDomain(MessageListDomain())
    const userInfoDomain = domain.getDomain(UserInfoDomain())
    const toast = domain.getExtern(ToastExtern)
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
        return get(UserListQuery()).find((user) => user.peerId === get(PeerIdQuery()))!
      }
    })

    const LastMessageTimeQuery = domain.query({
      name: 'Room.LastMessageTimeQuery',
      impl: ({ get }) => {
        return (
          get(messageListDomain.query.ListQuery())
            .filter((message) => message.type === MessageType.Normal)
            .toSorted((a, b) => b.sendTime - a.sendTime)[0]?.sendTime ?? new Date(1970, 1, 1).getTime()
        )
      }
    })

    const JoinIsFinishedQuery = JoinStatusModule.query.IsFinishedQuery

    const JoinRoomCommand = domain.command({
      name: 'Room.JoinRoomCommand',
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
            sendTime: Date.now(),
            receiveTime: Date.now()
          }),
          JoinStatusModule.command.SetFinishedCommand(),
          JoinRoomEvent(peerRoom.roomId)
        ]
      }
    })

    const LeaveRoomCommand = domain.command({
      name: 'Room.LeaveRoomCommand',
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
            sendTime: Date.now(),
            receiveTime: Date.now()
          }),
          UpdateUserListCommand({
            type: 'delete',
            user: { peerId: peerRoom.peerId, joinTime: Date.now(), userId, username, userAvatar }
          }),
          JoinStatusModule.command.SetInitialCommand(),
          LeaveRoomEvent(peerRoom.roomId)
        ]
      }
    })

    const SendTextMessageCommand = domain.command({
      name: 'Room.SendTextMessageCommand',
      impl: ({ get }, message: string | { body: string; atUsers: AtUser[] }) => {
        const self = get(SelfUserQuery())

        const textMessage: TextMessage = {
          ...self,
          id: nanoid(),
          type: SendType.Text,
          sendTime: Date.now(),
          body: typeof message === 'string' ? message : message.body,
          atUsers: typeof message === 'string' ? [] : message.atUsers
        }

        const listMessage: NormalMessage = {
          ...textMessage,
          type: MessageType.Normal,
          receiveTime: Date.now(),
          likeUsers: [],
          hateUsers: [],
          atUsers: typeof message === 'string' ? [] : message.atUsers
        }

        peerRoom.sendMessage(textMessage)
        return [messageListDomain.command.CreateItemCommand(listMessage), SendTextMessageEvent(textMessage)]
      }
    })

    const SendLikeMessageCommand = domain.command({
      name: 'Room.SendLikeMessageCommand',
      impl: ({ get }, messageId: string) => {
        const self = get(SelfUserQuery())
        const localMessage = get(messageListDomain.query.ItemQuery(messageId)) as NormalMessage

        const likeMessage: LikeMessage = {
          ...self,
          id: messageId,
          sendTime: Date.now(),
          type: SendType.Like
        }
        const listMessage: NormalMessage = {
          ...localMessage,
          likeUsers: desert(localMessage.likeUsers, likeMessage, 'userId')
        }
        peerRoom.sendMessage(likeMessage)
        return [messageListDomain.command.UpdateItemCommand(listMessage), SendLikeMessageEvent(likeMessage)]
      }
    })

    const SendHateMessageCommand = domain.command({
      name: 'Room.SendHateMessageCommand',
      impl: ({ get }, messageId: string) => {
        const self = get(SelfUserQuery())
        const localMessage = get(messageListDomain.query.ItemQuery(messageId)) as NormalMessage

        const hateMessage: HateMessage = {
          ...self,
          id: messageId,
          sendTime: Date.now(),
          type: SendType.Hate
        }
        const listMessage: NormalMessage = {
          ...localMessage,
          hateUsers: desert(localMessage.hateUsers, hateMessage, 'userId')
        }
        peerRoom.sendMessage(hateMessage)
        return [messageListDomain.command.UpdateItemCommand(listMessage), SendHateMessageEvent(hateMessage)]
      }
    })

    const SendSyncUserMessageCommand = domain.command({
      name: 'Room.SendSyncUserMessageCommand',
      impl: ({ get }, peerId: string) => {
        const self = get(SelfUserQuery())
        const lastMessageTime = get(LastMessageTimeQuery())

        const syncUserMessage: SyncUserMessage = {
          ...self,
          id: nanoid(),
          sendTime: Date.now(),
          lastMessageTime,
          type: SendType.SyncUser
        }

        peerRoom.sendMessage(syncUserMessage, peerId)
        return [SendSyncUserMessageEvent(syncUserMessage)]
      }
    })

    /**
     * The maximum sync message is the historical records within 30 days, using the last message as the basis for judgment.
     * The number of synced messages may not be all messages within 30 days; if new messages are generated before syncing, they will not be synced.
     * Users A, B, C, D, and E: A and B are online, while C, D, and E are offline.
     * 1. A and B chat, generating two messages: messageA and messageB.
     * 2. A and B go offline.
     * 3. C and D come online, generating two messages: messageC and messageD.
     * 4. A and B come online, and C and D will push two messages, messageC and messageD, to A and B. However, A and B will not push messageA and messageB to C and D because C and D's latest message timestamps are earlier than A and B's.
     * 5. E comes online, and A, B, C, and D will all push messages messageA, messageB, messageC, and messageD to E.
     *
     * Final results:
     * A and B see 4 messages: messageC, messageD, messageA, and messageB.
     * C and D see 2 messages: messageA and messageB.
     * E sees 4 messages: messageA, messageB, messageC, and messageD.
     *
     * As shown above, C and D did not sync messages that were earlier than their own.
     * On one hand, if we want to fully sync 30 days of messages, we must diff the timestamps of messages within 30 days and then insert them. The current implementation only does incremental additions, and messages will accumulate over time.
     * For now, let's keep it this way and see if it's necessary to fully sync the data within 30 days later.
     */
    const SendSyncHistoryMessageCommand = domain.command({
      name: 'Room.SendSyncHistoryMessageCommand',
      impl: ({ get }, { peerId, lastMessageTime }: { peerId: string; lastMessageTime: number }) => {
        const self = get(SelfUserQuery())
        console.log('SendSyncHistoryMessageCommand', peerId, peerRoom.peerId)

        const historyMessages = get(messageListDomain.query.ListQuery()).filter(
          (message) =>
            message.type === MessageType.Normal &&
            message.sendTime > lastMessageTime &&
            message.sendTime - Date.now() <= SYNC_HISTORY_MAX_DAYS * 24 * 60 * 60 * 1000
        )

        /**
         * Message chunking to ensure that each message does not exceed WEB_RTC_MAX_MESSAGE_SIZE
         * If the message itself exceeds the size limit, skip syncing that message directly.
         */
        const pushHistoryMessageList = historyMessages.reduce<SyncHistoryMessage[]>((acc, cur) => {
          const pushHistoryMessage: SyncHistoryMessage = {
            ...self,
            id: nanoid(),
            sendTime: Date.now(),
            type: SendType.SyncHistory,
            messages: [cur as NormalMessage]
          }
          const pushHistoryMessageByteSize = getTextByteSize(JSON.stringify(pushHistoryMessage))

          if (pushHistoryMessageByteSize < WEB_RTC_MAX_MESSAGE_SIZE) {
            if (acc.length) {
              const mergedSize = getTextByteSize(JSON.stringify(acc[acc.length - 1])) + pushHistoryMessageByteSize
              if (mergedSize < WEB_RTC_MAX_MESSAGE_SIZE) {
                acc[acc.length - 1].messages.push(cur as NormalMessage)
              } else {
                acc.push(pushHistoryMessage)
              }
            } else {
              acc.push(pushHistoryMessage)
            }
          }
          return acc
        }, [])

        return pushHistoryMessageList.map((message) => {
          peerRoom.sendMessage(message, peerId)
          return SendSyncHistoryMessageEvent(message)
        })
      }
    })

    const UpdateUserListCommand = domain.command({
      name: 'Room.UpdateUserListCommand',
      impl: ({ get }, action: { type: 'create' | 'delete'; user: RoomUser }) => {
        const userList = get(UserListState())
        if (action.type === 'create') {
          return [UserListState().new(upsert(userList, action.user, 'userId'))]
        } else {
          return [UserListState().new(userList.filter(({ userId }) => userId !== action.user.userId))]
        }
      }
    })

    const SendSyncHistoryMessageEvent = domain.event<SyncHistoryMessage>({
      name: 'Room.SendSyncHistoryMessageEvent'
    })

    const SendSyncUserMessageEvent = domain.event<SyncUserMessage>({
      name: 'Room.SendSyncUserMessageEvent'
    })

    const SendTextMessageEvent = domain.event<TextMessage>({
      name: 'Room.SendTextMessageEvent'
    })

    const SendLikeMessageEvent = domain.event<LikeMessage>({
      name: 'Room.SendLikeMessageEvent'
    })

    const SendHateMessageEvent = domain.event<HateMessage>({
      name: 'Room.SendHateMessageEvent'
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

    const OnTextMessageEvent = domain.event<TextMessage>({
      name: 'Room.OnTextMessageEvent'
    })

    const OnJoinRoomEvent = domain.event<string>({
      name: 'Room.OnJoinRoomEvent'
    })

    const OnLeaveRoomEvent = domain.event<string>({
      name: 'Room.OnLeaveRoomEvent'
    })

    const OnErrorEvent = domain.event<Error>({
      name: 'Room.OnErrorEvent'
    })

    domain.effect({
      name: 'Room.OnJoinRoomEffect',
      impl: () => {
        const onJoinRoom$ = fromEventPattern<string>(peerRoom.onJoinRoom).pipe(
          mergeMap((peerId) => {
            // console.log('onJoinRoom', peerId)
            if (peerRoom.peerId === peerId) {
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
      impl: ({ get }) => {
        const onMessage$ = fromEventPattern<RoomMessage>(peerRoom.onMessage).pipe(
          mergeMap((message) => {
            // console.log('onMessage', message)

            const messageEvent$ = of(OnMessageEvent(message))

            const textMessageEvent$ = of(message.type === SendType.Text ? OnTextMessageEvent(message) : null)

            const messageCommand$ = (() => {
              switch (message.type) {
                case SendType.SyncUser: {
                  const userList = get(UserListQuery())
                  const selfUser = get(SelfUserQuery())
                  // If the browser has multiple tabs open, it can cause the same user to join multiple times with the same peerId but different userId
                  const isRepeatJoin = userList.some((user) => user.userId === message.userId)
                  // When a new user joins, it triggers join events for all users, i.e., newUser join event and oldUser join event
                  // Use joinTime to determine if it's a new user
                  const isNewJoinEvent = selfUser.joinTime < message.joinTime

                  const lastMessageTime = get(LastMessageTimeQuery())
                  const needSyncHistory = lastMessageTime > message.lastMessageTime

                  return isRepeatJoin
                    ? EMPTY
                    : of(
                        UpdateUserListCommand({ type: 'create', user: message }),
                        isNewJoinEvent
                          ? messageListDomain.command.CreateItemCommand({
                              ...message,
                              id: nanoid(),
                              body: `"${message.username}" joined the chat`,
                              type: MessageType.Prompt,
                              receiveTime: Date.now()
                            })
                          : null,
                        needSyncHistory
                          ? SendSyncHistoryMessageCommand({
                              peerId: message.peerId,
                              lastMessageTime: message.lastMessageTime
                            })
                          : null
                      )
                }

                case SendType.SyncHistory: {
                  toast.success('Syncing history messages.')
                  return of(...message.messages.map((message) => messageListDomain.command.UpsertItemCommand(message)))
                }

                case SendType.Text:
                  return of(
                    messageListDomain.command.CreateItemCommand({
                      ...message,
                      type: MessageType.Normal,
                      receiveTime: Date.now(),
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
                  const type = message.type === 'Like' ? 'likeUsers' : 'hateUsers'
                  return of(
                    messageListDomain.command.UpdateItemCommand({
                      ..._message,
                      receiveTime: Date.now(),
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

            return merge(messageEvent$, textMessageEvent$, messageCommand$)
          })
        )
        return onMessage$
      }
    })

    domain.effect({
      name: 'Room.OnLeaveRoomEffect',
      impl: ({ get }) => {
        const onLeaveRoom$ = fromEventPattern<string>(peerRoom.onLeaveRoom).pipe(
          map((peerId) => {
            console.log('onLeaveRoom', peerId, get(SelfUserQuery()).peerId)
            const user = get(UserListQuery()).find((user) => user.peerId === peerId)

            if (user) {
              return [
                UpdateUserListCommand({ type: 'delete', user }),
                messageListDomain.command.CreateItemCommand({
                  ...user,
                  id: nanoid(),
                  body: `"${user.username}" left the chat`,
                  type: MessageType.Prompt,
                  sendTime: Date.now(),
                  receiveTime: Date.now()
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
        const onRoomError$ = fromEventPattern<Error>(peerRoom.onError).pipe(
          map((error) => {
            console.error(error)
            return OnErrorEvent(error)
          })
        )
        return onRoomError$
      }
    })

    // TODO: Move this to a service worker in the future, so we don't need to send a leave room message every time the page refreshes
    domain.effect({
      name: 'Room.OnUnloadEffect',
      impl: ({ get }) => {
        const beforeUnload$ = fromEvent(window, 'beforeunload').pipe(
          map(() => {
            console.log('beforeunload')

            return get(JoinStatusModule.query.IsFinishedQuery()) ? LeaveRoomCommand() : null
          })
        )
        return beforeUnload$
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
        SendTextMessageCommand,
        SendLikeMessageCommand,
        SendHateMessageCommand,
        SendSyncUserMessageCommand,
        SendSyncHistoryMessageCommand
      },
      event: {
        SendTextMessageEvent,
        SendLikeMessageEvent,
        SendHateMessageEvent,
        SendSyncUserMessageEvent,
        SendSyncHistoryMessageEvent,
        JoinRoomEvent,
        LeaveRoomEvent,
        OnMessageEvent,
        OnTextMessageEvent,
        OnJoinRoomEvent,
        OnLeaveRoomEvent,
        OnErrorEvent
      }
    }
  }
})

export default RoomDomain
