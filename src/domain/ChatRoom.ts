import { Remesh } from 'remesh'
import { map, merge, of, EMPTY, mergeMap, fromEventPattern, bufferTime, filter } from 'rxjs'
import type { AtUser, NormalMessage } from './MessageList'
import { type MessageUser } from './MessageList'
import { ChatRoomExtern } from '@/domain/externs/ChatRoom'
import MessageListDomain from '@/domain/MessageList'
import UserInfoDomain from '@/domain/UserInfo'
import { desert, getTextByteSize, upsert } from '@/utils'
import { nanoid } from 'nanoid'
import StatusModule from '@/domain/modules/Status'
import { SYNC_HISTORY_MAX_DAYS, WEB_RTC_MAX_MESSAGE_SIZE } from '@/constants/config'
import hash from 'hash-it'
import {
  checkChatRoomMessage,
  ChatRoomMessageType,
  ChatRoomSendType,
  type ChatRoomMessage,
  type ChatRoomTextMessage,
  type ChatRoomLikeMessage,
  type ChatRoomHateMessage,
  type ChatRoomSyncUserMessage,
  type ChatRoomSyncHistoryMessage
} from '@/protocol'

export type RoomUser = MessageUser & { peerIds: string[]; joinTime: number }

const ChatRoomDomain = Remesh.domain({
  name: 'ChatRoomDomain',
  impl: (domain) => {
    const messageListDomain = domain.getDomain(MessageListDomain())
    const userInfoDomain = domain.getDomain(UserInfoDomain())
    const chatRoomExtern = domain.getExtern(ChatRoomExtern)

    const PeerIdState = domain.state<string>({
      name: 'Room.PeerIdState',
      default: chatRoomExtern.peerId
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
        return get(UserListQuery()).find((user) => user.peerIds.includes(chatRoomExtern.peerId))!
      }
    })

    const LastMessageTimeQuery = domain.query({
      name: 'Room.LastMessageTimeQuery',
      impl: ({ get }) => {
        return (
          get(messageListDomain.query.ListQuery())
            .filter((message) => message.type === ChatRoomMessageType.Normal)
            .toSorted((a, b) => b.sendTime - a.sendTime)[0]?.sendTime ?? new Date(1970, 1, 1).getTime()
        )
      }
    })

    const JoinIsFinishedQuery = JoinStatusModule.query.IsFinishedQuery

    /**
     * Handle join/leave message deduplication
     * If the previous message is a join/leave message from the same user,
     * delete it and create a new one to avoid message spam
     */
    const HandleJoinLeaveMessageCommand = domain.command({
      name: 'Room.HandleJoinLeaveMessageCommand',
      impl: (
        { get },
        payload: { userId: string; username: string; userAvatar: string; messageType: 'join' | 'leave' }
      ) => {
        const { userId, username, userAvatar, messageType } = payload
        const now = Date.now()
        const messageBody = messageType === 'join' ? `"${username}" joined the chat` : `"${username}" left the chat`

        // Find user's most recent join/leave message
        const messageList = get(messageListDomain.query.ListQuery())
        const userPromptMessages = messageList
          .filter((msg) => msg.type === ChatRoomMessageType.Prompt && msg.userId === userId)
          .toSorted((a, b) => b.sendTime - a.sendTime)

        const lastMessage = userPromptMessages[0]

        // If the previous message is from the same user, delete it
        if (lastMessage) {
          return [
            messageListDomain.command.DeleteItemCommand(lastMessage.id),
            messageListDomain.command.CreateItemCommand({
              id: nanoid(),
              userId,
              username,
              userAvatar,
              body: messageBody,
              type: ChatRoomMessageType.Prompt,
              sendTime: now,
              receiveTime: now
            })
          ]
        }

        // Create new message (first message from this user)
        return messageListDomain.command.CreateItemCommand({
          id: nanoid(),
          userId,
          username,
          userAvatar,
          body: messageBody,
          type: ChatRoomMessageType.Prompt,
          sendTime: now,
          receiveTime: now
        })
      }
    })

    const JoinRoomCommand = domain.command({
      name: 'Room.JoinRoomCommand',
      impl: ({ get }) => {
        const { id: userId, name: username, avatar: userAvatar } = get(userInfoDomain.query.UserInfoQuery())!
        return [
          UpdateUserListCommand({
            type: 'create',
            user: { peerId: chatRoomExtern.peerId, joinTime: Date.now(), userId, username, userAvatar }
          }),
          HandleJoinLeaveMessageCommand({ userId, username, userAvatar, messageType: 'join' }),
          JoinStatusModule.command.SetFinishedCommand(),
          JoinRoomEvent(chatRoomExtern.roomId),
          SelfJoinRoomEvent(chatRoomExtern.roomId)
        ]
      }
    })

    JoinRoomCommand.after(() => {
      chatRoomExtern.joinRoom()
      return null
    })

    const LeaveRoomCommand = domain.command({
      name: 'Room.LeaveRoomCommand',
      impl: ({ get }) => {
        const { id: userId, name: username, avatar: userAvatar } = get(userInfoDomain.query.UserInfoQuery())!
        return [
          HandleJoinLeaveMessageCommand({ userId, username, userAvatar, messageType: 'leave' }),
          UpdateUserListCommand({
            type: 'delete',
            user: { peerId: chatRoomExtern.peerId, joinTime: Date.now(), userId, username, userAvatar }
          }),
          JoinStatusModule.command.SetInitialCommand(),
          LeaveRoomEvent(chatRoomExtern.roomId),
          SelfLeaveRoomEvent(chatRoomExtern.roomId)
        ]
      }
    })

    LeaveRoomCommand.after(() => {
      chatRoomExtern.leaveRoom()
      return null
    })

    const SendTextMessageCommand = domain.command({
      name: 'Room.SendTextMessageCommand',
      impl: ({ get }, message: string | { body: string; atUsers: AtUser[] }) => {
        const self = get(SelfUserQuery())

        const textMessage: ChatRoomTextMessage = {
          ...self,
          id: nanoid(),
          type: ChatRoomSendType.Text,
          sendTime: Date.now(),
          body: typeof message === 'string' ? message : message.body,
          atUsers: typeof message === 'string' ? [] : message.atUsers
        }

        const listMessage: NormalMessage = {
          ...textMessage,
          type: ChatRoomMessageType.Normal,
          receiveTime: Date.now(),
          likeUsers: [],
          hateUsers: [],
          atUsers: typeof message === 'string' ? [] : message.atUsers
        }

        chatRoomExtern.sendMessage(textMessage)
        return [messageListDomain.command.CreateItemCommand(listMessage), SendTextMessageEvent(textMessage)]
      }
    })

    const SendLikeMessageCommand = domain.command({
      name: 'Room.SendLikeMessageCommand',
      impl: ({ get }, messageId: string) => {
        const self = get(SelfUserQuery())
        const localMessage = get(messageListDomain.query.ItemQuery(messageId)) as NormalMessage

        const likeMessage: ChatRoomLikeMessage = {
          ...self,
          id: messageId,
          sendTime: Date.now(),
          type: ChatRoomSendType.Like
        }
        const listMessage: NormalMessage = {
          ...localMessage,
          likeUsers: desert(localMessage.likeUsers, likeMessage, 'userId')
        }
        chatRoomExtern.sendMessage(likeMessage)
        return [messageListDomain.command.UpdateItemCommand(listMessage), SendLikeMessageEvent(likeMessage)]
      }
    })

    const SendHateMessageCommand = domain.command({
      name: 'Room.SendHateMessageCommand',
      impl: ({ get }, messageId: string) => {
        const self = get(SelfUserQuery())
        const localMessage = get(messageListDomain.query.ItemQuery(messageId)) as NormalMessage

        const hateMessage: ChatRoomHateMessage = {
          ...self,
          id: messageId,
          sendTime: Date.now(),
          type: ChatRoomSendType.Hate
        }
        const listMessage: NormalMessage = {
          ...localMessage,
          hateUsers: desert(localMessage.hateUsers, hateMessage, 'userId')
        }
        chatRoomExtern.sendMessage(hateMessage)
        return [messageListDomain.command.UpdateItemCommand(listMessage), SendHateMessageEvent(hateMessage)]
      }
    })

    const SendSyncUserMessageCommand = domain.command({
      name: 'Room.SendSyncUserMessageCommand',
      impl: ({ get }, peerId: string) => {
        const self = get(SelfUserQuery())
        const lastMessageTime = get(LastMessageTimeQuery())

        const syncUserMessage: ChatRoomSyncUserMessage = {
          ...self,
          id: nanoid(),
          peerId: chatRoomExtern.peerId,
          sendTime: Date.now(),
          lastMessageTime,
          type: ChatRoomSendType.SyncUser
        }

        chatRoomExtern.sendMessage(syncUserMessage, peerId)
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

        const historyMessages = get(messageListDomain.query.ListQuery()).filter((message) => {
          return (
            message.type === ChatRoomMessageType.Normal &&
            message.sendTime > lastMessageTime &&
            message.sendTime >= Date.now() - SYNC_HISTORY_MAX_DAYS * 24 * 60 * 60 * 1000
          )
        })

        /**
         * Message chunking to ensure that each message does not exceed WEB_RTC_MAX_MESSAGE_SIZE
         * If the message itself exceeds the size limit, skip syncing that message directly.
         */
        const pushHistoryMessageList = historyMessages.reduce<ChatRoomSyncHistoryMessage[]>((acc, cur) => {
          const pushHistoryMessage: ChatRoomSyncHistoryMessage = {
            ...self,
            id: nanoid(),
            sendTime: Date.now(),
            type: ChatRoomSendType.SyncHistory,
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
          chatRoomExtern.sendMessage(message, peerId)
          return SendSyncHistoryMessageEvent(message)
        })
      }
    })

    const UpdateUserListCommand = domain.command({
      name: 'Room.UpdateUserListCommand',
      impl: ({ get }, action: { type: 'create' | 'delete'; user: Omit<RoomUser, 'peerIds'> & { peerId: string } }) => {
        const userList = get(UserListState())
        const existUser = userList.find((user) => user.userId === action.user.userId)
        if (action.type === 'create') {
          return [
            UserListState().new(
              upsert(
                userList,
                { ...action.user, peerIds: [...new Set(existUser?.peerIds || []), action.user.peerId] },
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
                  peerIds: existUser?.peerIds?.filter((peerId) => peerId !== action.user.peerId) || []
                },
                'userId'
              ).filter((user) => user.peerIds.length)
            )
          ]
        }
      }
    })

    const SendSyncHistoryMessageEvent = domain.event<ChatRoomSyncHistoryMessage>({
      name: 'Room.SendSyncHistoryMessageEvent'
    })

    const SendSyncUserMessageEvent = domain.event<ChatRoomSyncUserMessage>({
      name: 'Room.SendSyncUserMessageEvent'
    })

    const SendTextMessageEvent = domain.event<ChatRoomTextMessage>({
      name: 'Room.SendTextMessageEvent'
    })

    const SendLikeMessageEvent = domain.event<ChatRoomLikeMessage>({
      name: 'Room.SendLikeMessageEvent'
    })

    const SendHateMessageEvent = domain.event<ChatRoomHateMessage>({
      name: 'Room.SendHateMessageEvent'
    })

    const JoinRoomEvent = domain.event<string>({
      name: 'Room.JoinRoomEvent'
    })

    const LeaveRoomEvent = domain.event<string>({
      name: 'Room.LeaveRoomEvent'
    })

    const OnMessageEvent = domain.event<ChatRoomMessage>({
      name: 'Room.OnMessageEvent'
    })

    const OnTextMessageEvent = domain.event<ChatRoomTextMessage>({
      name: 'Room.OnTextMessageEvent'
    })

    const OnSyncUserMessageEvent = domain.event<ChatRoomSyncUserMessage>({
      name: 'Room.OnSyncUserMessageEvent'
    })

    const OnSyncHistoryMessageEvent = domain.event<ChatRoomSyncHistoryMessage>({
      name: 'Room.OnSyncHistoryMessageEvent'
    })

    const OnSyncMessageEvent = domain.event<ChatRoomSyncHistoryMessage[]>({
      name: 'Room.OnSyncMessageEvent'
    })

    const OnLikeMessageEvent = domain.event<ChatRoomLikeMessage>({
      name: 'Room.OnLikeMessageEvent'
    })

    const OnHateMessageEvent = domain.event<ChatRoomHateMessage>({
      name: 'Room.OnHateMessageEvent'
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
        const onJoinRoom$ = fromEventPattern<string>(chatRoomExtern.onJoinRoom).pipe(
          mergeMap((peerId) => {
            // console.log('onJoinRoom', peerId)
            if (chatRoomExtern.peerId === peerId) {
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
        const onMessage$ = fromEventPattern<ChatRoomMessage>(chatRoomExtern.onMessage).pipe(
          mergeMap((message) => {
            // Filter out messages that do not conform to the format
            if (!checkChatRoomMessage(message)) {
              console.warn('Invalid message format', message)
              return EMPTY
            }

            const messageEvent$ = of(OnMessageEvent(message))

            // Emit specific message type events
            const specificEvent$ = (() => {
              switch (message.type) {
                case ChatRoomSendType.Text:
                  return of(OnTextMessageEvent(message))
                case ChatRoomSendType.SyncUser:
                  return of(OnSyncUserMessageEvent(message))
                case ChatRoomSendType.SyncHistory:
                  return of(OnSyncHistoryMessageEvent(message))
                case ChatRoomSendType.Like:
                  return of(OnLikeMessageEvent(message))
                case ChatRoomSendType.Hate:
                  return of(OnHateMessageEvent(message))
                default:
                  console.warn('Unsupported message type', message)
                  return EMPTY
              }
            })()

            return merge(messageEvent$, specificEvent$)
          })
        )
        return onMessage$
      }
    })

    domain.effect({
      name: 'Room.OnTextMessageEffect',
      impl: ({ fromEvent }) => {
        return fromEvent(OnTextMessageEvent).pipe(
          map((message) => {
            return messageListDomain.command.CreateItemCommand({
              ...message,
              type: ChatRoomMessageType.Normal,
              receiveTime: Date.now(),
              likeUsers: [],
              hateUsers: []
            })
          })
        )
      }
    })

    domain.effect({
      name: 'Room.OnSyncUserMessageEffect',
      impl: ({ get, fromEvent }) => {
        return fromEvent(OnSyncUserMessageEvent).pipe(
          mergeMap((message) => {
            const selfUser = get(SelfUserQuery())

            // If a new user joins after the current user has entered the room, a join log message needs to be created.
            const existUser = get(UserListQuery()).find((user) => user.userId === message.userId)
            const isNewJoinUser = !existUser && message.joinTime > selfUser.joinTime

            const lastMessageTime = get(LastMessageTimeQuery())
            const needSyncHistory = lastMessageTime > message.lastMessageTime

            return of(
              UpdateUserListCommand({ type: 'create', user: message }),
              isNewJoinUser
                ? HandleJoinLeaveMessageCommand({
                    userId: message.userId,
                    username: message.username,
                    userAvatar: message.userAvatar,
                    messageType: 'join'
                  })
                : null,
              needSyncHistory
                ? SendSyncHistoryMessageCommand({
                    peerId: message.peerId,
                    lastMessageTime: message.lastMessageTime
                  })
                : null
            )
          })
        )
      }
    })

    domain.effect({
      name: 'Room.OnSyncHistoryMessageEffect',
      impl: ({ get, fromEvent }) => {
        return fromEvent(OnSyncHistoryMessageEvent).pipe(
          bufferTime(300), // Collect messages within 300ms time window
          filter((messages) => messages.length > 0),
          mergeMap((syncMessages) => {
            // Merge all messages from multiple sync events
            const allMessages = syncMessages.flatMap((syncMsg) => syncMsg.messages)

            // Deduplicate messages by id, keep the latest one
            const uniqueMessages = [
              ...allMessages.reduce((map, msg) => map.set(msg.id, msg), new Map<string, NormalMessage>()).values()
            ]

            // Filter out messages that haven't changed
            const changedMessages = uniqueMessages.filter((message) => {
              const hasMessage = get(messageListDomain.query.HasItemQuery(message.id))
              if (!hasMessage) {
                return true
              } else {
                return hash(message) !== hash(get(messageListDomain.query.ItemQuery(message.id)))
              }
            })

            // Return batched upsert commands and single OnSyncMessageEvent for all sync messages
            return changedMessages.length
              ? of(
                  ...changedMessages.map((message) => messageListDomain.command.UpsertItemCommand(message)),
                  OnSyncMessageEvent(syncMessages)
                )
              : EMPTY
          })
        )
      }
    })

    domain.effect({
      name: 'Room.OnLikeMessageEffect',
      impl: ({ get, fromEvent }) => {
        return fromEvent(OnLikeMessageEvent).pipe(
          mergeMap((message) => {
            if (!get(messageListDomain.query.HasItemQuery(message.id))) {
              return EMPTY
            }
            const _message = get(messageListDomain.query.ItemQuery(message.id)) as NormalMessage
            return of(
              messageListDomain.command.UpdateItemCommand({
                ..._message,
                receiveTime: Date.now(),
                likeUsers: desert(
                  _message.likeUsers,
                  {
                    userId: message.userId,
                    username: message.username,
                    userAvatar: message.userAvatar
                  },
                  'userId'
                )
              })
            )
          })
        )
      }
    })

    domain.effect({
      name: 'Room.OnHateMessageEffect',
      impl: ({ get, fromEvent }) => {
        return fromEvent(OnHateMessageEvent).pipe(
          mergeMap((message) => {
            if (!get(messageListDomain.query.HasItemQuery(message.id))) {
              return EMPTY
            }
            const _message = get(messageListDomain.query.ItemQuery(message.id)) as NormalMessage
            return of(
              messageListDomain.command.UpdateItemCommand({
                ..._message,
                receiveTime: Date.now(),
                hateUsers: desert(
                  _message.hateUsers,
                  {
                    userId: message.userId,
                    username: message.username,
                    userAvatar: message.userAvatar
                  },
                  'userId'
                )
              })
            )
          })
        )
      }
    })

    domain.effect({
      name: 'Room.OnLeaveRoomEffect',
      impl: ({ get }) => {
        const onLeaveRoom$ = fromEventPattern<string>(chatRoomExtern.onLeaveRoom).pipe(
          map((peerId) => {
            if (get(JoinStatusModule.query.IsInitialQuery())) {
              return null
            }
            // console.log('onLeaveRoom', peerId)

            const existUser = get(UserListQuery()).find((user) => user.peerIds.includes(peerId))

            if (existUser) {
              return [
                UpdateUserListCommand({ type: 'delete', user: { ...existUser, peerId } }),
                existUser.peerIds.length === 1
                  ? HandleJoinLeaveMessageCommand({
                      userId: existUser.userId,
                      username: existUser.username,
                      userAvatar: existUser.userAvatar,
                      messageType: 'leave'
                    })
                  : null,
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
        const onRoomError$ = fromEventPattern<Error>(chatRoomExtern.onError).pipe(
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
        SelfJoinRoomEvent,
        LeaveRoomEvent,
        SelfLeaveRoomEvent,
        OnMessageEvent,
        OnTextMessageEvent,
        OnSyncMessageEvent,
        OnJoinRoomEvent,
        OnLeaveRoomEvent,
        OnErrorEvent
      }
    }
  }
})

export default ChatRoomDomain
