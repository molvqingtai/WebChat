import { Remesh } from 'remesh'
import { concatMap, filter, fromEventPattern, map } from 'rxjs'
import {
  ChatRoomExtern,
  type JoinRoomCommand as JoinRoomInput,
  type SendReactionCommand as SendReactionInput
} from '@/domain/externs/ChatRoom'
import MessageListDomain from '@/domain/MessageList'
import MessageInputDomain from '@/domain/MessageInput'
import ReadinessDomain from '@/domain/Readiness'
import UserInfoDomain from '@/domain/UserInfo'
import StatusModule from '@/domain/modules/Status'
import { MESSAGE_TYPE, REACTION_TYPE, type ChatMessage, type MentionedUser } from '@/protocol/ChatRoom'
import type { ChatSession } from '@/protocol/Session'
import { MESSAGE_RECORD_TYPE, NOTICE_TYPE, type SystemNoticeRecord, type TextMessageRecord } from '@/domain/Message'
import { projectTextRecord } from '@/domain/MessageProjection'
import { getSiteMeta, stringToHex } from '@/utils'

const noticeRecord = (type: 'join' | 'leave', session: ChatSession): SystemNoticeRecord => {
  const occurredAt = Date.now()
  const id = `notice:${stringToHex(`${type}:${session.sessionId}`)}`
  return {
    type: MESSAGE_RECORD_TYPE.SYSTEM_NOTICE,
    id,
    notice: {
      id,
      hlc: { timestamp: occurredAt, counter: 0 },
      type,
      body: `"${session.user.name}" ${type === NOTICE_TYPE.JOIN ? 'joined' : 'left'} the chat`
    },
    user: session.user,
    receivedAt: occurredAt
  }
}

const uniqueUsers = (sessions: readonly ChatSession[]) => {
  const users = new Map(sessions.map((session) => [session.user.id, session.user]))
  return [...users.values()]
}

const ChatRoomDomain = Remesh.domain({
  name: 'ChatRoomDomain',
  impl: (domain) => {
    const chatRoom = domain.getExtern(ChatRoomExtern)
    const messageListDomain = domain.getDomain(MessageListDomain())
    const messageInputDomain = domain.getDomain(MessageInputDomain())
    const readinessDomain = domain.getDomain(ReadinessDomain())
    const userInfoDomain = domain.getDomain(UserInfoDomain())
    const JoinStatus = StatusModule(domain, { name: 'Room.JoinStatusModule' })

    const SessionsState = domain.state<readonly ChatSession[]>({ name: 'Room.SessionsState', default: [] })
    const JoinInputState = domain.state<JoinRoomInput | null>({ name: 'Room.JoinInputState', default: null })
    const ReconnectingState = domain.state({ name: 'Room.ReconnectingState', default: false })

    const UserListQuery = domain.query({
      name: 'Room.UserListQuery',
      impl: ({ get }) => uniqueUsers(get(SessionsState()))
    })
    const JoinIsFinishedQuery = JoinStatus.query.IsFinishedQuery
    const ReconnectIsLoadingQuery = domain.query({
      name: 'Room.ReconnectIsLoadingQuery',
      impl: ({ get }) => get(ReconnectingState())
    })

    const ApplySessionsCommand = domain.command({
      name: 'Room.ApplySessionsCommand',
      impl: (_, sessions: readonly ChatSession[]) => SessionsState().new(sessions)
    })

    const JoinRequestedEvent = domain.event({ name: 'Room.JoinRequestedEvent' })
    const JoinRoomCommand = domain.command({
      name: 'Room.JoinRoomCommand',
      impl: ({ get }) =>
        get(JoinStatus.query.IsInitialQuery()) ? [JoinStatus.command.SetLoadingCommand(), JoinRequestedEvent()] : null
    })

    const SendTextRequestedEvent = domain.event<{ body: string; mentions: MentionedUser[] }>({
      name: 'Room.SendTextRequestedEvent'
    })
    const SendTextMessageCommand = domain.command({
      name: 'Room.SendTextMessageCommand',
      impl: (_, message: string | { body: string; mentions: MentionedUser[] }) =>
        SendTextRequestedEvent(typeof message === 'string' ? { body: message, mentions: [] } : message)
    })

    const SendReactionRequestedEvent = domain.event<{ messageId: string; reaction: 'like' | 'hate' }>({
      name: 'Room.SendReactionRequestedEvent'
    })
    const SendReactionCommand = domain.command({
      name: 'Room.SendReactionCommand',
      impl: (_, payload: { messageId: string; reaction: 'like' | 'hate' }) => SendReactionRequestedEvent(payload)
    })

    const ReconnectRequestedEvent = domain.event({ name: 'Room.ReconnectRequestedEvent' })
    const ReconnectStartedEvent = domain.event({ name: 'Room.ReconnectStartedEvent' })
    const ReconnectFinishedEvent = domain.event({ name: 'Room.ReconnectFinishedEvent' })
    const ReconnectCommand = domain.command({
      name: 'Room.ReconnectCommand',
      impl: ({ get }) =>
        get(JoinIsFinishedQuery()) && !get(ReconnectingState())
          ? [ReconnectingState().new(true), ReconnectStartedEvent(), ReconnectRequestedEvent()]
          : null
    })

    const SendTextMessageEvent = domain.event<ReturnType<typeof projectTextRecord>>({
      name: 'Room.SendTextMessageEvent'
    })
    const OnTextMessageEvent = domain.event<ReturnType<typeof projectTextRecord>>({
      name: 'Room.OnTextMessageEvent'
    })
    const SelfJoinRoomEvent = domain.event({ name: 'Room.SelfJoinRoomEvent' })
    const OnErrorEvent = domain.event<Error>({ name: 'Room.OnErrorEvent' })

    const CompleteReconnectCommand = domain.command({
      name: 'Room.CompleteReconnectCommand',
      impl: (_, error?: Error) => [
        ReconnectingState().new(false),
        ReconnectFinishedEvent(),
        ...(error ? [OnErrorEvent(error)] : [])
      ]
    })

    const RetainJoinInputCommand = domain.command({
      name: 'Room.RetainJoinInputCommand',
      impl: (_, input: JoinRoomInput) => JoinInputState().new(input)
    })

    const FailJoinCommand = domain.command({
      name: 'Room.FailJoinCommand',
      impl: (_, error: Error) => [JoinStatus.command.SetInitialCommand(), OnErrorEvent(error)]
    })

    const CompleteJoinCommand = domain.command({
      name: 'Room.CompleteJoinCommand',
      impl: (_, input: JoinRoomInput) => [
        RetainJoinInputCommand(input),
        messageListDomain.command.ReloadCommand(),
        JoinStatus.command.SetFinishedCommand(),
        SelfJoinRoomEvent()
      ]
    })

    const ApplyLiveMessageCommand = domain.command({
      name: 'Room.ApplyLiveMessageCommand',
      impl: ({ get }, message: ChatMessage) => {
        const reload = messageListDomain.command.ReloadCommand()
        if (message.type !== MESSAGE_TYPE.TEXT) return reload
        const user = get(SessionsState()).find((session) => session.user.id === message.userId)?.user
        if (!user) return reload
        const record: TextMessageRecord = {
          type: MESSAGE_RECORD_TYPE.CHAT_MESSAGE,
          id: message.id,
          message,
          user,
          receivedAt: Date.now()
        }
        return [reload, OnTextMessageEvent(projectTextRecord(record))]
      }
    })

    const PersistNoticeCommand = domain.command({
      name: 'Room.PersistNoticeCommand',
      impl: (_, payload: { type: 'join' | 'leave'; session: ChatSession }) =>
        messageListDomain.command.PersistRecordCommand(noticeRecord(payload.type, payload.session))
    })

    domain.effect({
      name: 'Room.JoinEffect',
      impl: ({ fromEvent, get }) =>
        fromEvent(JoinRequestedEvent).pipe(
          concatMap(async () => {
            const user = get(userInfoDomain.query.UserInfoQuery())
            if (!user) return FailJoinCommand(new Error('User identity is unavailable'))
            const input = { user, site: getSiteMeta() }
            try {
              await chatRoom.joinRoom(input)
              return CompleteJoinCommand(input)
            } catch (error) {
              return FailJoinCommand(error as Error)
            }
          })
        )
    })

    domain.effect({
      name: 'Room.HostRecoveryEffect',
      impl: ({ fromEvent, get }) =>
        fromEvent(readinessDomain.event.StateChangedEvent).pipe(
          filter((state) => state === 'ready'),
          concatMap(async () => {
            const input = get(JoinInputState())
            if (!input || !get(JoinIsFinishedQuery())) return null
            try {
              await chatRoom.joinRoom(input)
              return null
            } catch (error) {
              return OnErrorEvent(error as Error)
            }
          })
        )
    })

    domain.effect({
      name: 'Room.RefreshIdentityEffect',
      impl: ({ fromEvent, get }) =>
        fromEvent(userInfoDomain.event.UpdateUserInfoEvent).pipe(
          filter((user): user is NonNullable<typeof user> => Boolean(user) && get(JoinIsFinishedQuery())),
          concatMap(async (user) => {
            const input = { user, site: getSiteMeta() }
            try {
              await chatRoom.joinRoom(input)
              return RetainJoinInputCommand(input)
            } catch (error) {
              return OnErrorEvent(error as Error)
            }
          })
        )
    })

    domain.effect({
      name: 'Room.SendTextEffect',
      impl: ({ fromEvent, get }) =>
        fromEvent(SendTextRequestedEvent).pipe(
          concatMap(async (command) => {
            const user = get(userInfoDomain.query.UserInfoQuery())
            if (!user) return OnErrorEvent(new Error('User identity is unavailable'))
            try {
              const message = await chatRoom.sendMessage({ type: 'text', ...command })
              if (message.type !== MESSAGE_TYPE.TEXT || message.userId !== user.id) {
                throw new Error('ChatRoom returned an invalid local text message')
              }
              const record: TextMessageRecord = {
                type: MESSAGE_RECORD_TYPE.CHAT_MESSAGE,
                id: message.id,
                message,
                user,
                receivedAt: Date.now()
              }
              return [messageInputDomain.command.ClearCommand(), SendTextMessageEvent(projectTextRecord(record))]
            } catch (error) {
              return OnErrorEvent(error as Error)
            }
          })
        )
    })

    domain.effect({
      name: 'Room.SendReactionEffect',
      impl: ({ fromEvent, get }) =>
        fromEvent(SendReactionRequestedEvent).pipe(
          concatMap(async ({ messageId, reaction }) => {
            try {
              const message = get(messageListDomain.query.ItemQuery(messageId))
              const selfId = get(userInfoDomain.query.UserInfoQuery())?.id
              if (!message || message.type !== MESSAGE_TYPE.TEXT || !selfId) return null
              const users = reaction === REACTION_TYPE.LIKE ? message.reactions.likes : message.reactions.hates
              const command: SendReactionInput = {
                type: 'reaction',
                targetId: messageId,
                reaction,
                active: !users.some((user) => user.id === selfId)
              }
              await chatRoom.sendMessage(command)
              return null
            } catch (error) {
              return OnErrorEvent(error as Error)
            }
          })
        )
    })

    domain.effect({
      name: 'Room.ReconnectEffect',
      impl: ({ fromEvent, get }) =>
        fromEvent(ReconnectRequestedEvent).pipe(
          concatMap(async () => {
            const input = get(JoinInputState())
            if (!input) return CompleteReconnectCommand()
            try {
              await chatRoom.leaveRoom()
              await chatRoom.joinRoom(input)
              return CompleteReconnectCommand()
            } catch (error) {
              return CompleteReconnectCommand(error instanceof Error ? error : new Error(String(error)))
            }
          })
        )
    })

    domain.effect({
      name: 'Room.OnMessageEffect',
      impl: () =>
        fromEventPattern<ChatMessage>(chatRoom.onMessage.bind(chatRoom), (_handler, dispose) => dispose()).pipe(
          map(ApplyLiveMessageCommand)
        )
    })

    domain.effect({
      name: 'Room.OnSessionsEffect',
      impl: () =>
        fromEventPattern<readonly ChatSession[]>(chatRoom.onSessions.bind(chatRoom), (_handler, dispose) =>
          dispose()
        ).pipe(map(ApplySessionsCommand))
    })

    domain.effect({
      name: 'Room.OnJoinEffect',
      impl: () =>
        fromEventPattern<ChatSession>(chatRoom.onJoinRoom.bind(chatRoom), (_handler, dispose) => dispose()).pipe(
          map((session) => PersistNoticeCommand({ type: 'join', session }))
        )
    })

    domain.effect({
      name: 'Room.OnLeaveEffect',
      impl: () =>
        fromEventPattern<ChatSession>(chatRoom.onLeaveRoom.bind(chatRoom), (_handler, dispose) => dispose()).pipe(
          map((session) => PersistNoticeCommand({ type: 'leave', session }))
        )
    })

    domain.effect({
      name: 'Room.OnErrorEffect',
      impl: () =>
        fromEventPattern<Error>(chatRoom.onError.bind(chatRoom), (_handler, dispose) => dispose()).pipe(
          map(OnErrorEvent)
        )
    })

    return {
      query: { UserListQuery, JoinIsFinishedQuery, ReconnectIsLoadingQuery },
      command: { JoinRoomCommand, SendTextMessageCommand, SendReactionCommand, ReconnectCommand },
      event: {
        SendTextMessageEvent,
        OnTextMessageEvent,
        SelfJoinRoomEvent,
        ReconnectStartedEvent,
        ReconnectFinishedEvent,
        OnErrorEvent
      }
    }
  }
})

export default ChatRoomDomain
