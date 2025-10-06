import { Remesh } from 'remesh'
import { map, merge, of, EMPTY, mergeMap, fromEventPattern, bufferTime, filter } from 'rxjs'
import type { MessageUser, MentionedUser } from './MessageList'
import { ChatRoomExtern } from '@/domain/externs/ChatRoom'
import MessageListDomain from '@/domain/MessageList'
import UserInfoDomain from '@/domain/UserInfo'
import HLCClockDomain from '@/domain/HLCClock'
import { desert, getTextByteSize, upsert, compareHLC, sendEvent } from '@/utils'
import { nanoid } from 'nanoid'
import StatusModule from '@/domain/modules/Status'
import { SYNC_HISTORY_MAX_DAYS, WEB_RTC_MAX_MESSAGE_SIZE } from '@/constants/config'
import hash from 'hash-it'
import {
  validateNetworkMessage,
  type NetworkMessage,
  type TextMessage,
  type ReactionMessage,
  type PeerSyncMessage,
  type HistorySyncMessage,
  MESSAGE_TYPE,
  REACTION_TYPE,
  PROMPT_TYPE
} from '@/protocol/Message'

export type RoomUser = MessageUser & { peerIds: string[]; joinedAt: number }

const ChatRoomDomain = Remesh.domain({
  name: 'ChatRoomDomain',
  impl: (domain) => {
    const messageListDomain = domain.getDomain(MessageListDomain())
    const userInfoDomain = domain.getDomain(UserInfoDomain())
    const hlcClockDomain = domain.getDomain(HLCClockDomain())
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

    const LastMessageHLCQuery = domain.query({
      name: 'Room.LastMessageHLCQuery',
      impl: ({ get }) => {
        const messages = get(messageListDomain.query.ListQuery()).filter(
          (message) => message.type === MESSAGE_TYPE.TEXT
        )

        if (!messages.length) {
          return { timestamp: 0, counter: 0 }
        }

        return messages.reduce((latest, msg) => (compareHLC(msg.hlc, latest.hlc) > 0 ? msg : latest)).hlc
      }
    })

    /**
     * Get all peerIds from UserList except self.
     * Used for sending messages to all connected peers.
     */
    const PeerListQuery = domain.query({
      name: 'Room.PeerListQuery',
      impl: ({ get }) => {
        return get(UserListQuery())
          .flatMap((user) => user.peerIds)
          .filter((peerId) => peerId !== get(PeerIdQuery()))
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
      impl: ({ get }, payload: { id: string; name: string; avatar: string; messageType: 'join' | 'leave' }) => {
        const { id, name, avatar, messageType } = payload
        const now = Date.now()
        const currentHLC = get(hlcClockDomain.query.CurrentHLCQuery())
        const newHLC = sendEvent(currentHLC)
        const messageBody = messageType === 'join' ? `"${name}" joined the chat` : `"${name}" left the chat`

        // Find user's most recent join/leave message
        const messageList = get(messageListDomain.query.ListQuery())
        const userPromptMessages = messageList
          .filter((msg) => msg.type === MESSAGE_TYPE.SYSTEM_PROMPT && msg.sender.id === id)
          .toSorted((a, b) => compareHLC(b.hlc, a.hlc))

        const lastMessage = userPromptMessages[0]

        // If the previous message is from the same user, delete it
        if (lastMessage) {
          return [
            hlcClockDomain.command.SendEventCommand(),
            messageListDomain.command.DeleteItemCommand(lastMessage.id),
            messageListDomain.command.CreateItemCommand({
              type: MESSAGE_TYPE.SYSTEM_PROMPT,
              id: nanoid(),
              hlc: newHLC,
              sentAt: now,
              receivedAt: now,
              sender: { id, name, avatar },
              body: messageBody,
              promptType: messageType === 'join' ? PROMPT_TYPE.JOIN : PROMPT_TYPE.LEAVE
            })
          ]
        }

        // Create new message (first message from this user)
        return [
          hlcClockDomain.command.SendEventCommand(),
          messageListDomain.command.CreateItemCommand({
            type: MESSAGE_TYPE.SYSTEM_PROMPT,
            id: nanoid(),
            hlc: newHLC,
            sentAt: now,
            receivedAt: now,
            sender: { id, name, avatar },
            body: messageBody,
            promptType: messageType === 'join' ? PROMPT_TYPE.JOIN : PROMPT_TYPE.LEAVE
          })
        ]
      }
    })

    const JoinRoomCommand = domain.command({
      name: 'Room.JoinRoomCommand',
      impl: ({ get }) => {
        const { id, name, avatar } = get(userInfoDomain.query.UserInfoQuery())!
        return [
          UpdateUserListCommand({
            type: 'create',
            user: { peerId: chatRoomExtern.peerId, joinedAt: Date.now(), id, name, avatar }
          }),
          HandleJoinLeaveMessageCommand({ id, name, avatar, messageType: PROMPT_TYPE.JOIN }),
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
        const { id, name, avatar } = get(userInfoDomain.query.UserInfoQuery())!
        return [
          HandleJoinLeaveMessageCommand({ id, name, avatar, messageType: PROMPT_TYPE.LEAVE }),
          UpdateUserListCommand({
            type: 'delete',
            user: { peerId: chatRoomExtern.peerId, joinedAt: Date.now(), id, name, avatar }
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
      impl: ({ get }, message: string | { body: string; mentions: MentionedUser[] }) => {
        const self = get(SelfUserQuery())
        const now = Date.now()
        const currentHLC = get(hlcClockDomain.query.CurrentHLCQuery())
        const newHLC = sendEvent(currentHLC)

        const textMessage: TextMessage = {
          type: MESSAGE_TYPE.TEXT,
          id: nanoid(),
          hlc: newHLC,
          sentAt: now,
          receivedAt: now,
          sender: {
            id: self.id,
            name: self.name,
            avatar: self.avatar
          },
          body: typeof message === 'string' ? message : message.body,
          mentions: typeof message === 'string' ? [] : message.mentions,
          reactions: {
            likes: [],
            hates: []
          }
        }

        /**
         * Why specify peerIds:
         * According to artico source code, room.send() without target will send to all calls (including connecting peers).
         * If a peer's DataChannel is not ready, it will throw "Connection is not established yet" error and interrupt the forEach loop.
         * UserList only contains peers that have sent SyncUser message, which means their DataChannel is already established.
         * So we only send to peers in UserList to avoid errors.
         *
         * @see https://github.com/matallui/artico/blob/8a4f1a185be9355f893120e9492151f1785e59fa/packages/client/src/room.ts#L114 Room.send() implementation
         * @see hhttps://github.com/matallui/artico/blob/8a4f1a185be9355f893120e9492151f1785e59fa/packages/peer/src/peer.ts#L281 Peer.send() throws error when not ready
         */
        const peerIds = get(PeerListQuery())

        // Only send to network if there are other peers, but always save to local
        peerIds.length && chatRoomExtern.sendMessage(textMessage, peerIds)

        return [
          hlcClockDomain.command.SendEventCommand(),
          messageListDomain.command.CreateItemCommand(textMessage),
          SendTextMessageEvent(textMessage)
        ]
      }
    })

    const SendReactionCommand = domain.command({
      name: 'Room.SendReactionCommand',
      impl: ({ get }, payload: { messageId: string; reaction: 'like' | 'hate' }) => {
        const { messageId, reaction } = payload
        const self = get(SelfUserQuery())
        const now = Date.now()
        const currentHLC = get(hlcClockDomain.query.CurrentHLCQuery())
        const newHLC = sendEvent(currentHLC)
        const localMessage = get(messageListDomain.query.ItemQuery(messageId)) as TextMessage

        const reactionMessage: ReactionMessage = {
          type: MESSAGE_TYPE.REACTION,
          id: nanoid(),
          hlc: newHLC,
          sentAt: now,
          receivedAt: now,
          sender: {
            id: self.id,
            name: self.name,
            avatar: self.avatar
          },
          targetId: messageId,
          reaction: reaction === REACTION_TYPE.LIKE ? REACTION_TYPE.LIKE : REACTION_TYPE.HATE
        }

        const senderInfo = { id: self.id, name: self.name, avatar: self.avatar }
        const updatedMessage: TextMessage = {
          ...localMessage,
          reactions: {
            likes:
              reaction === REACTION_TYPE.LIKE
                ? desert(localMessage.reactions.likes, senderInfo, 'id')
                : localMessage.reactions.likes,
            hates:
              reaction === REACTION_TYPE.HATE
                ? desert(localMessage.reactions.hates, senderInfo, 'id')
                : localMessage.reactions.hates
          }
        }

        /**
         * Get all peerIds from UserList except self.
         * @see SendTextMessageCommand for detailed explanation.
         */
        const peerIds = get(PeerListQuery())

        // Only send to network if there are other peers, but always save to local
        peerIds.length && chatRoomExtern.sendMessage(reactionMessage, peerIds)

        return [
          hlcClockDomain.command.SendEventCommand(),
          messageListDomain.command.UpdateItemCommand(updatedMessage),
          SendReactionMessageEvent(reactionMessage)
        ]
      }
    })

    const SendSyncUserMessageCommand = domain.command({
      name: 'Room.SendSyncUserMessageCommand',
      impl: ({ get }, peerId: string) => {
        const self = get(SelfUserQuery())
        const now = Date.now()
        const currentHLC = get(hlcClockDomain.query.CurrentHLCQuery())
        const newHLC = sendEvent(currentHLC)
        const lastMessageHLC = get(LastMessageHLCQuery())

        const syncUserMessage: PeerSyncMessage = {
          type: MESSAGE_TYPE.PEER_SYNC,
          id: nanoid(),
          hlc: newHLC,
          sentAt: now,
          receivedAt: now,
          sender: {
            id: self.id,
            name: self.name,
            avatar: self.avatar
          },
          peerId: chatRoomExtern.peerId,
          joinedAt: self.joinedAt,
          lastMessageHLC
        }

        chatRoomExtern.sendMessage(syncUserMessage, peerId)
        return [hlcClockDomain.command.SendEventCommand(), SendSyncUserMessageEvent(syncUserMessage)]
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
      impl: (
        { get },
        { peerId, lastMessageHLC }: { peerId: string; lastMessageHLC: { timestamp: number; counter: number } }
      ) => {
        const self = get(SelfUserQuery())
        const now = Date.now()

        const historyMessages = get(messageListDomain.query.ListQuery()).filter((message) => {
          return (
            message.type === MESSAGE_TYPE.TEXT &&
            compareHLC(message.hlc, lastMessageHLC) > 0 &&
            message.hlc.timestamp >= Date.now() - SYNC_HISTORY_MAX_DAYS * 24 * 60 * 60 * 1000
          )
        }) as TextMessage[]

        /**
         * Message chunking to ensure that each message does not exceed WEB_RTC_MAX_MESSAGE_SIZE
         * If the message itself exceeds the size limit, skip syncing that message directly.
         */
        const pushHistoryMessageList = historyMessages.reduce<HistorySyncMessage[]>((acc, cur) => {
          const currentHLC = get(hlcClockDomain.query.CurrentHLCQuery())
          const newHLC = sendEvent(currentHLC)

          const pushHistoryMessage: HistorySyncMessage = {
            type: MESSAGE_TYPE.HISTORY_SYNC,
            id: nanoid(),
            hlc: newHLC,
            sentAt: now,
            receivedAt: now,
            sender: {
              id: self.id,
              name: self.name,
              avatar: self.avatar
            },
            messages: [cur]
          }
          const pushHistoryMessageByteSize = getTextByteSize(JSON.stringify(pushHistoryMessage))

          if (pushHistoryMessageByteSize < WEB_RTC_MAX_MESSAGE_SIZE) {
            if (acc.length) {
              const mergedSize = getTextByteSize(JSON.stringify(acc[acc.length - 1])) + pushHistoryMessageByteSize
              if (mergedSize < WEB_RTC_MAX_MESSAGE_SIZE) {
                acc[acc.length - 1].messages.push(cur)
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
          return [hlcClockDomain.command.SendEventCommand(), SendSyncHistoryMessageEvent(message)]
        })
      }
    })

    const UpdateUserListCommand = domain.command({
      name: 'Room.UpdateUserListCommand',
      impl: ({ get }, action: { type: 'create' | 'delete'; user: Omit<RoomUser, 'peerIds'> & { peerId: string } }) => {
        const userList = get(UserListState())
        const existUser = userList.find((user) => user.id === action.user.id)
        if (action.type === 'create') {
          return [
            UserListState().new(
              upsert(
                userList,
                { ...action.user, peerIds: [...new Set(existUser?.peerIds || []), action.user.peerId] },
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
                  peerIds: existUser?.peerIds?.filter((peerId) => peerId !== action.user.peerId) || []
                },
                'id'
              ).filter((user) => user.peerIds.length)
            )
          ]
        }
      }
    })

    const SendSyncHistoryMessageEvent = domain.event<HistorySyncMessage>({
      name: 'Room.SendSyncHistoryMessageEvent'
    })

    const SendSyncUserMessageEvent = domain.event<PeerSyncMessage>({
      name: 'Room.SendSyncUserMessageEvent'
    })

    const SendTextMessageEvent = domain.event<TextMessage>({
      name: 'Room.SendTextMessageEvent'
    })

    const SendReactionMessageEvent = domain.event<ReactionMessage>({
      name: 'Room.SendReactionMessageEvent'
    })

    const JoinRoomEvent = domain.event<string>({
      name: 'Room.JoinRoomEvent'
    })

    const LeaveRoomEvent = domain.event<string>({
      name: 'Room.LeaveRoomEvent'
    })

    const OnMessageEvent = domain.event<NetworkMessage>({
      name: 'Room.OnMessageEvent'
    })

    const OnTextMessageEvent = domain.event<TextMessage>({
      name: 'Room.OnTextMessageEvent'
    })

    const OnSyncUserMessageEvent = domain.event<PeerSyncMessage>({
      name: 'Room.OnSyncUserMessageEvent'
    })

    const OnSyncHistoryMessageEvent = domain.event<HistorySyncMessage>({
      name: 'Room.OnSyncHistoryMessageEvent'
    })

    const OnSyncMessageEvent = domain.event<HistorySyncMessage[]>({
      name: 'Room.OnSyncMessageEvent'
    })

    const OnReactionMessageEvent = domain.event<ReactionMessage>({
      name: 'Room.OnReactionMessageEvent'
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
        const onMessage$ = fromEventPattern<NetworkMessage>(chatRoomExtern.onMessage).pipe(
          mergeMap((message) => {
            // Filter out messages that do not conform to the format
            if (!validateNetworkMessage(message)) {
              console.warn('Invalid message format', message)
              return EMPTY
            }

            const messageEvent$ = of(OnMessageEvent(message))

            // Emit specific message type events
            const specificEvent$ = (() => {
              switch (message.type) {
                case MESSAGE_TYPE.TEXT:
                  return of(OnTextMessageEvent(message))
                case MESSAGE_TYPE.PEER_SYNC:
                  return of(OnSyncUserMessageEvent(message))
                case MESSAGE_TYPE.HISTORY_SYNC:
                  return of(OnSyncHistoryMessageEvent(message))
                case MESSAGE_TYPE.REACTION:
                  return of(OnReactionMessageEvent(message))
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
            // Update local HLC based on received message
            const receivedMessage: TextMessage = {
              ...message,
              receivedAt: Date.now()
            }
            return [
              hlcClockDomain.command.ReceiveEventCommand(message.hlc),
              messageListDomain.command.CreateItemCommand(receivedMessage)
            ]
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
            const existUser = get(UserListQuery()).find((user) => user.id === message.sender.id)
            const isNewJoinUser = !existUser && message.joinedAt > selfUser.joinedAt

            const lastMessageHLC = get(LastMessageHLCQuery())
            const needSyncHistory = compareHLC(lastMessageHLC, message.lastMessageHLC) > 0

            const userForList = {
              ...message.sender,
              peerId: message.peerId,
              joinedAt: message.joinedAt
            }

            return of(
              hlcClockDomain.command.ReceiveEventCommand(message.hlc),
              UpdateUserListCommand({ type: 'create', user: userForList }),
              isNewJoinUser
                ? HandleJoinLeaveMessageCommand({
                    id: message.sender.id,
                    name: message.sender.name,
                    avatar: message.sender.avatar,
                    messageType: PROMPT_TYPE.JOIN
                  })
                : null,
              needSyncHistory
                ? SendSyncHistoryMessageCommand({
                    peerId: message.peerId,
                    lastMessageHLC: message.lastMessageHLC
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
              ...allMessages.reduce((map, msg) => map.set(msg.id, msg), new Map<string, TextMessage>()).values()
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

            // Update HLC for each received history message
            const maxHLC = uniqueMessages.reduce((max, msg) => (compareHLC(msg.hlc, max) > 0 ? msg.hlc : max), {
              timestamp: 0,
              counter: 0
            })

            // Return batched upsert commands and single OnSyncMessageEvent for all sync messages
            return changedMessages.length
              ? of(
                  hlcClockDomain.command.ReceiveEventCommand(maxHLC),
                  ...changedMessages.map((message) => messageListDomain.command.UpsertItemCommand(message)),
                  OnSyncMessageEvent(syncMessages)
                )
              : EMPTY
          })
        )
      }
    })

    domain.effect({
      name: 'Room.OnReactionMessageEffect',
      impl: ({ get, fromEvent }) => {
        return fromEvent(OnReactionMessageEvent).pipe(
          mergeMap((message) => {
            if (!get(messageListDomain.query.HasItemQuery(message.targetId))) {
              return EMPTY
            }
            const targetMessage = get(messageListDomain.query.ItemQuery(message.targetId)) as TextMessage

            const updatedMessage: TextMessage = {
              ...targetMessage,
              receivedAt: Date.now(),
              reactions: {
                likes:
                  message.reaction === REACTION_TYPE.LIKE
                    ? desert(targetMessage.reactions.likes, message.sender, 'id')
                    : targetMessage.reactions.likes,
                hates:
                  message.reaction === REACTION_TYPE.HATE
                    ? desert(targetMessage.reactions.hates, message.sender, 'id')
                    : targetMessage.reactions.hates
              }
            }

            return of(
              hlcClockDomain.command.ReceiveEventCommand(message.hlc),
              messageListDomain.command.UpdateItemCommand(updatedMessage)
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
                      id: existUser.id,
                      name: existUser.name,
                      avatar: existUser.avatar,
                      messageType: PROMPT_TYPE.LEAVE
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
        PeerListQuery,
        JoinIsFinishedQuery,
        LastMessageHLCQuery
      },
      command: {
        JoinRoomCommand,
        LeaveRoomCommand,
        SendTextMessageCommand,
        SendReactionCommand,
        SendSyncUserMessageCommand,
        SendSyncHistoryMessageCommand
      },
      event: {
        SendTextMessageEvent,
        SendReactionMessageEvent,
        SendSyncUserMessageEvent,
        SendSyncHistoryMessageEvent,
        JoinRoomEvent,
        SelfJoinRoomEvent,
        LeaveRoomEvent,
        SelfLeaveRoomEvent,
        OnMessageEvent,
        OnTextMessageEvent,
        OnReactionMessageEvent,
        OnSyncMessageEvent,
        OnJoinRoomEvent,
        OnLeaveRoomEvent,
        OnErrorEvent
      }
    }
  }
})

export default ChatRoomDomain
