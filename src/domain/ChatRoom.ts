import { Remesh } from 'remesh'
import { EMPTY, concatMap, filter, fromEventPattern, map, mergeMap, startWith, take, timer } from 'rxjs'
import {
  ChatRoomExtern,
  type HistorySyncCompletedEvent,
  type JoinRoomCommand as JoinRoomInput,
  type SendReactionCommand as SendReactionInput
} from '@/domain/externs/ChatRoom'
import MessageListDomain from '@/domain/MessageList'
import MessageInputDomain from '@/domain/MessageInput'
import ReadinessDomain from '@/domain/Readiness'
import UserInfoDomain from '@/domain/UserInfo'
import StatusModule from '@/domain/modules/Status'
import { ConnectionLifecycleExtern } from '@/domain/externs/ConnectionLifecycle'
import { SendLifecycleExtern } from '@/domain/externs/SendLifecycle'
import { MESSAGE_TYPE, REACTION_TYPE, type ChatMessage, type MentionedUser } from '@/protocol/ChatRoom'
import type { ChatUser } from '@/protocol/Session'
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

type ReconnectRequest = {
  id: number
  intervalSettled: boolean
  outcome: { error?: Error } | null
}

const RECONNECT_FEEDBACK_MINIMUM_MS = 300

type ReconnectOperation = {
  id: number
  input: JoinRoomInput
  mode: 'retry' | 'reconnect'
}

type ConnectionOperation = {
  id: number
  input: JoinRoomInput
  mode: 'join' | 'automatic'
}

const normalizeError = (error: unknown) => (error instanceof Error ? error : new Error(String(error)))

const ChatRoomDomain = Remesh.domain({
  name: 'ChatRoomDomain',
  impl: (domain) => {
    const chatRoom = domain.getExtern(ChatRoomExtern)
    const lifecycle = domain.getExtern(ConnectionLifecycleExtern)
    const sendLifecycle = domain.getExtern(SendLifecycleExtern)
    const messageListDomain = domain.getDomain(MessageListDomain())
    const messageInputDomain = domain.getDomain(MessageInputDomain())
    const readinessDomain = domain.getDomain(ReadinessDomain())
    const userInfoDomain = domain.getDomain(UserInfoDomain())
    const JoinStatus = StatusModule(domain, { name: 'Room.JoinStatusModule' })

    const SessionsState = domain.state<readonly ChatSession[]>({ name: 'Room.SessionsState', default: [] })
    const JoinInputState = domain.state<JoinRoomInput | null>({ name: 'Room.JoinInputState', default: null })
    const ConnectionSequenceState = domain.state({ name: 'Room.ConnectionSequenceState', default: 0 })
    const ReconnectSequenceState = domain.state({ name: 'Room.ReconnectSequenceState', default: 0 })
    const ConnectionRequestState = domain.state<{ id: number } | null>({
      name: 'Room.ConnectionRequestState',
      default: null
    })
    const ReconnectRequestState = domain.state<ReconnectRequest | null>({
      name: 'Room.ReconnectRequestState',
      default: null
    })

    const UserListQuery = domain.query({
      name: 'Room.UserListQuery',
      impl: ({ get }) => uniqueUsers(get(SessionsState()))
    })
    const JoinIsFinishedQuery = JoinStatus.query.IsFinishedQuery
    const ReconnectRequestQuery = domain.query({
      name: 'Room.ReconnectRequestQuery',
      impl: ({ get }) => get(ReconnectRequestState())
    })
    const ReconnectIsLoadingQuery = domain.query({
      name: 'Room.ReconnectIsLoadingQuery',
      impl: ({ get }) => get(ReconnectRequestQuery()) !== null
    })
    const ConnectionOperationIsLoadingQuery = domain.query({
      name: 'Room.ConnectionOperationIsLoadingQuery',
      impl: ({ get }) => get(ConnectionRequestState()) !== null
    })
    const ConnectionIsLoadingQuery = domain.query({
      name: 'Room.ConnectionIsLoadingQuery',
      impl: ({ get }) =>
        get(ConnectionOperationIsLoadingQuery()) ||
        get(ReconnectIsLoadingQuery()) ||
        get(readinessDomain.query.StateQuery()) === 'connecting'
    })
    const SendIsReadyQuery = domain.query({
      name: 'Room.SendIsReadyQuery',
      impl: ({ get }) =>
        get(readinessDomain.query.StateQuery()) === 'ready' &&
        !get(ConnectionOperationIsLoadingQuery()) &&
        !get(ReconnectIsLoadingQuery())
    })
    // Single shared submit truth for both the UI handoff and the domain command gate: the local
    // Room generation has committed its join, the runtime is ready, and no connection or reconnect
    // operation is loading. Peers, WebRTC handshake, and History are deliberately not part of it.
    const CanSubmitTextQuery = domain.query({
      name: 'Room.CanSubmitTextQuery',
      impl: ({ get }) => get(JoinIsFinishedQuery()) && get(SendIsReadyQuery())
    })
    const ReconnectAvailableQuery = domain.query({
      name: 'Room.ReconnectAvailableQuery',
      impl: ({ get }) => get(userInfoDomain.query.UserInfoQuery()) !== null && !get(ConnectionIsLoadingQuery())
    })

    const ApplySessionsCommand = domain.command({
      name: 'Room.ApplySessionsCommand',
      impl: ({ get }, sessions: readonly ChatSession[]) => {
        const next = SessionsState().new(sessions)
        // One current-generation commit terminal: when the domain commits after the original
        // public attempt already reported its exact failure, the retained join input completes the
        // page join instead of leaving it logically unjoined. The synthesized completion yields to
        // both request owners: a live connection or reconnect/retry request keeps its own terminal.
        if (get(JoinIsFinishedQuery()) || get(ConnectionRequestState()) || get(ReconnectRequestState())) {
          return next
        }
        const input = get(JoinInputState())
        if (!input) return next
        if (!sessions.some((session) => session.user.id === input.user.id)) return next
        return [next, CompleteJoinCommand(input)]
      }
    })

    const ConnectionRequestedEvent = domain.event<ConnectionOperation>({ name: 'Room.ConnectionRequestedEvent' })
    const StartConnectionCommand = domain.command({
      name: 'Room.StartConnectionCommand',
      impl: ({ get }, operation: Omit<ConnectionOperation, 'id'>) => {
        const id = get(ConnectionSequenceState()) + 1
        return [
          ConnectionSequenceState().new(id),
          ConnectionRequestState().new({ id }),
          ...(operation.mode === 'join' ? [RetainJoinInputCommand(operation.input)] : []),
          ConnectionRequestedEvent({ id, ...operation })
        ]
      }
    })

    const JoinRoomCommand = domain.command({
      name: 'Room.JoinRoomCommand',
      impl: ({ get }) => {
        if (!get(JoinStatus.query.IsInitialQuery())) return null
        const user = get(userInfoDomain.query.UserInfoQuery())
        if (!user) return OnErrorEvent(new Error('User identity is unavailable'))
        // Application-to-protocol boundary: the broader UserInfo model is explicitly mapped to
        // the schema-owned ChatUser shape here; downstream consumers pass it through unchanged.
        const wireUser: ChatUser = { id: user.id, name: user.name, avatar: user.avatar }
        return [
          JoinStatus.command.SetLoadingCommand(),
          StartConnectionCommand({ input: { user: wireUser, site: getSiteMeta() }, mode: 'join' })
        ]
      }
    })

    const SendTextRequestedEvent = domain.event<{ body: string; mentions: MentionedUser[] }>({
      name: 'Room.SendTextRequestedEvent'
    })
    const HistorySyncCompletedEvent = domain.event<HistorySyncCompletedEvent>({
      name: 'Room.HistorySyncCompletedEvent'
    })
    const SendTextMessageCommand = domain.command({
      name: 'Room.SendTextMessageCommand',
      // Step-4 gate: a TEXT is only submitted after the local Room generation has finished its
      // join and the runtime is ready with no connection/reconnect loading. Before that the
      // command is a strict no-op: zero runtime command/request/allocation/validation/
      // projection/persistence, and the user's draft is left untouched. Recovery never re-runs
      // it; the user must submit again explicitly.
      impl: ({ get }, message: string | { body: string; mentions: MentionedUser[] }) =>
        get(CanSubmitTextQuery())
          ? SendTextRequestedEvent(typeof message === 'string' ? { body: message, mentions: [] } : message)
          : null
    })

    const SendReactionRequestedEvent = domain.event<{ messageId: string; reaction: 'like' | 'hate' }>({
      name: 'Room.SendReactionRequestedEvent'
    })
    const SendReactionCommand = domain.command({
      name: 'Room.SendReactionCommand',
      impl: (_, payload: { messageId: string; reaction: 'like' | 'hate' }) => SendReactionRequestedEvent(payload)
    })

    const ReconnectRequestedEvent = domain.event<ReconnectOperation>({ name: 'Room.ReconnectRequestedEvent' })
    const ReconnectStartedEvent = domain.event<number>({ name: 'Room.ReconnectStartedEvent' })
    const ReconnectFinishedEvent = domain.event<{ id: number; error?: Error }>({
      name: 'Room.ReconnectFinishedEvent'
    })

    const settleReconnectRequest = (request: ReconnectRequest) => {
      if (!request.intervalSettled || request.outcome === null) {
        return ReconnectRequestState().new(request)
      }
      return [ReconnectRequestState().new(null), ReconnectFinishedEvent({ id: request.id, ...request.outcome })]
    }

    const ReconnectCommand = domain.command({
      name: 'Room.ReconnectCommand',
      impl: ({ get }) => {
        if (!get(ReconnectAvailableQuery())) return null
        const joined = get(JoinIsFinishedQuery())
        const user = get(userInfoDomain.query.UserInfoQuery())!
        const wireUser: ChatUser = { id: user.id, name: user.name, avatar: user.avatar }
        const input = joined ? get(JoinInputState())! : { user: wireUser, site: getSiteMeta() }
        const id = get(ReconnectSequenceState()) + 1
        return [
          ReconnectSequenceState().new(id),
          ReconnectRequestState().new({
            id,
            intervalSettled: false,
            outcome: null
          }),
          ...(joined ? [] : [JoinStatus.command.SetLoadingCommand()]),
          ReconnectRequestedEvent({ id, input, mode: joined ? 'reconnect' : 'retry' }),
          ReconnectStartedEvent(id)
        ]
      }
    })

    const SettleReconnectIntervalCommand = domain.command({
      name: 'Room.SettleReconnectIntervalCommand',
      impl: ({ get }, id: number) => {
        const request = get(ReconnectRequestQuery())
        if (request?.id !== id || request.intervalSettled) return null
        return settleReconnectRequest({ ...request, intervalSettled: true })
      }
    })

    const SendTextMessageEvent = domain.event<ReturnType<typeof projectTextRecord>>({
      name: 'Room.SendTextMessageEvent'
    })
    const OnTextMessageEvent = domain.event<ReturnType<typeof projectTextRecord>>({
      name: 'Room.OnTextMessageEvent'
    })
    const SelfJoinRoomEvent = domain.event({ name: 'Room.SelfJoinRoomEvent' })
    const OnErrorEvent = domain.event<Error>({ name: 'Room.OnErrorEvent' })

    const CompleteReconnectOperationCommand = domain.command({
      name: 'Room.CompleteReconnectOperationCommand',
      impl: ({ get }, result: { id: number; error?: Error }) => {
        const request = get(ReconnectRequestQuery())
        if (request?.id !== result.id || request.outcome !== null) return null
        return settleReconnectRequest({ ...request, outcome: result.error ? { error: result.error } : {} })
      }
    })

    const RetainJoinInputCommand = domain.command({
      name: 'Room.RetainJoinInputCommand',
      impl: (_, input: JoinRoomInput) => JoinInputState().new(input)
    })

    const FailJoinCommand = domain.command({
      name: 'Room.FailJoinCommand',
      impl: () => JoinStatus.command.SetInitialCommand()
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

    const CompleteRetryOperationCommand = domain.command({
      name: 'Room.CompleteRetryOperationCommand',
      impl: ({ get }, result: { id: number; input: JoinRoomInput; error?: Error; cancelled?: boolean }) => {
        const request = get(ReconnectRequestQuery())
        if (request?.id !== result.id || request.outcome !== null) return null
        return [
          result.cancelled
            ? JoinStatus.command.SetInitialCommand()
            : result.error
              ? [FailJoinCommand(), OnErrorEvent(result.error)]
              : CompleteJoinCommand(result.input),
          CompleteReconnectOperationCommand({ id: result.id, error: result.error })
        ]
      }
    })

    const CompleteConnectionOperationCommand = domain.command({
      name: 'Room.CompleteConnectionOperationCommand',
      impl: (
        { get },
        result: ConnectionOperation & {
          error?: Error
          cancelled?: boolean
        }
      ) => {
        if (get(ConnectionRequestState())?.id !== result.id) return null
        const finished = ConnectionRequestState().new(null)
        if (result.cancelled) {
          return result.mode === 'join' ? [JoinStatus.command.SetInitialCommand(), finished] : finished
        }
        if (result.error) {
          return result.mode === 'join'
            ? [
                FailJoinCommand(),
                finished,
                ReconnectFinishedEvent({ id: result.id, error: result.error }),
                OnErrorEvent(result.error)
              ]
            : [finished, ReconnectFinishedEvent({ id: result.id, error: result.error }), OnErrorEvent(result.error)]
        }
        return [
          result.mode === 'join' ? CompleteJoinCommand(result.input) : RetainJoinInputCommand(result.input),
          finished
        ]
      }
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
      name: 'Room.ConnectionEffect',
      impl: ({ fromEvent, get }) =>
        fromEvent(ConnectionRequestedEvent).pipe(
          mergeMap(async (operation) => {
            const task = chatRoom.joinRoom(operation.input)
            try {
              await task
              // Consume (release) the invocation's terminal token on success too.
              lifecycle.getTaskResult(task)
              return CompleteConnectionOperationCommand(operation)
            } catch (error) {
              // Consume the exact task's result once (releases its terminal state) before any
              // request-staleness branching, so a superseded operation never leaks its result.
              const result = lifecycle.getTaskResult(task)
              // A completion is silent cancellation only when it is no longer the current live request
              // (superseded) or that exact public-port task's own token is `cancelled`. It is never
              // classified from the caught error's content.
              const cancelled = get(ConnectionRequestState())?.id !== operation.id || result === 'cancelled'
              return CompleteConnectionOperationCommand({
                ...operation,
                ...(cancelled ? { cancelled: true } : { error: normalizeError(error) })
              })
            }
          })
        )
    })

    domain.effect({
      name: 'Room.HostRecoveryEffect',
      impl: ({ fromEvent, get }) =>
        fromEvent(readinessDomain.event.StateChangedEvent).pipe(
          filter((state) => state === 'ready'),
          map(() => {
            const input = get(JoinInputState())
            if (!input || !get(JoinIsFinishedQuery())) return null
            return StartConnectionCommand({ input, mode: 'automatic' })
          })
        )
    })

    domain.effect({
      name: 'Room.RefreshIdentityEffect',
      impl: ({ fromEvent, get }) =>
        fromEvent(userInfoDomain.event.UpdateUserInfoEvent).pipe(
          filter((user): user is NonNullable<typeof user> => Boolean(user) && get(JoinIsFinishedQuery())),
          map((user) => {
            const wireUser: ChatUser = { id: user.id, name: user.name, avatar: user.avatar }
            return StartConnectionCommand({ input: { user: wireUser, site: getSiteMeta() }, mode: 'automatic' })
          })
        )
    })

    domain.effect({
      name: 'Room.SendTextEffect',
      impl: ({ fromEvent, get }) =>
        fromEvent(SendTextRequestedEvent).pipe(
          // Local projection must not wait for room readiness, connection/reconnect loading, or
          // transport/persistence: a protocol-valid local text is accepted and displayed here;
          // the physical send continues as background work (Wire queues it when the room is not
          // yet trusted) and never gates or rolls back this local display.
          concatMap(async (command) => {
            const user = get(userInfoDomain.query.UserInfoQuery())
            if (!user) return OnErrorEvent(new Error('User identity is unavailable'))
            const token = sendLifecycle.beginSend()
            try {
              const message = await chatRoom.sendMessage({ type: 'text', ...command })
              sendLifecycle.settleSend(token, 'accepted')
              const record: TextMessageRecord = {
                type: MESSAGE_RECORD_TYPE.CHAT_MESSAGE,
                id: message.id,
                message,
                user,
                receivedAt: Date.now()
              }
              return [messageInputDomain.command.ClearCommand(), SendTextMessageEvent(projectTextRecord(record))]
            } catch (error) {
              // A send is silent cancellation only when its own exact token was cancelled by final
              // release; otherwise the owning invocation settles it as a real failure.
              if (sendLifecycle.getSendResult(token) === 'cancelled') return null
              sendLifecycle.settleSend(token, 'failed')
              return OnErrorEvent(normalizeError(error))
            }
          })
        )
    })

    domain.effect({
      name: 'Room.SendReactionEffect',
      impl: ({ fromEvent, fromQuery, get }) =>
        fromEvent(SendReactionRequestedEvent).pipe(
          concatMap(({ messageId, reaction }) =>
            fromQuery(SendIsReadyQuery()).pipe(
              startWith(get(SendIsReadyQuery())),
              filter(Boolean),
              take(1),
              concatMap(async () => {
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
                const token = sendLifecycle.beginSend()
                try {
                  await chatRoom.sendMessage(command)
                  sendLifecycle.settleSend(token, 'accepted')
                  return null
                } catch (error) {
                  // A send is silent cancellation only when its own exact token was cancelled by final
                  // release; otherwise the owning invocation settles it as a real failure.
                  if (sendLifecycle.getSendResult(token) === 'cancelled') return null
                  sendLifecycle.settleSend(token, 'failed')
                  return OnErrorEvent(normalizeError(error))
                }
              })
            )
          )
        )
    })

    domain.effect({
      name: 'Room.ReconnectEffect',
      impl: ({ fromEvent }) =>
        fromEvent(ReconnectRequestedEvent).pipe(
          concatMap(async ({ id, input, mode }) => {
            let leaveTask: Promise<void> | undefined
            let joinTask: Promise<void> | undefined
            try {
              if (mode === 'reconnect') {
                // Leave is its own public-port invocation with its own exact token.
                leaveTask = chatRoom.leaveRoom()
                await leaveTask
              }
              joinTask = chatRoom.joinRoom(input)
              await joinTask
              // Consume (release) the invocation's terminal tokens on success too.
              if (leaveTask) lifecycle.getTaskResult(leaveTask)
              if (joinTask) lifecycle.getTaskResult(joinTask)
              return mode === 'retry'
                ? CompleteRetryOperationCommand({ id, input })
                : CompleteReconnectOperationCommand({ id })
            } catch (error) {
              // Consume each started task's result exactly once (releases terminal state) before deciding,
              // so a reconnect's leave/join results are never leaked. A reconnect request is single-lived
              // (ReconnectCommand is gated while one is in flight), so there is no reachable
              // request-staleness branch to short-circuit here; cancellation is solely by the exact leave/
              // join task's own token. Late/dropped completions are fenced by CompleteReconnectOperation
              // Command's own request-id gate.
              const leaveResult = leaveTask ? lifecycle.getTaskResult(leaveTask) === 'cancelled' : false
              const joinResult = joinTask ? lifecycle.getTaskResult(joinTask) === 'cancelled' : false
              const cancelled = leaveResult || joinResult
              if (cancelled) {
                return mode === 'retry'
                  ? CompleteRetryOperationCommand({ id, input, cancelled: true })
                  : CompleteReconnectOperationCommand({ id })
              }
              const normalizedError = normalizeError(error)
              return mode === 'retry'
                ? CompleteRetryOperationCommand({ id, input, error: normalizedError })
                : CompleteReconnectOperationCommand({ id, error: normalizedError })
            }
          })
        )
    })

    domain.effect({
      name: 'Room.ReconnectIntervalEffect',
      impl: ({ fromEvent }) =>
        fromEvent(ReconnectStartedEvent).pipe(
          mergeMap((id) => timer(RECONNECT_FEEDBACK_MINIMUM_MS).pipe(map(() => SettleReconnectIntervalCommand(id))))
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

    domain.effect({
      name: 'Room.OnHistorySyncCompletedEffect',
      impl: () =>
        chatRoom.onHistorySyncCompleted
          ? fromEventPattern<HistorySyncCompletedEvent>(
              chatRoom.onHistorySyncCompleted.bind(chatRoom),
              (_handler, dispose) => dispose()
            ).pipe(map(HistorySyncCompletedEvent))
          : EMPTY
    })

    return {
      query: {
        UserListQuery,
        JoinIsFinishedQuery,
        CanSubmitTextQuery,
        ReconnectRequestQuery,
        ReconnectIsLoadingQuery,
        ConnectionOperationIsLoadingQuery,
        ConnectionIsLoadingQuery,
        ReconnectAvailableQuery
      },
      command: {
        JoinRoomCommand,
        SendTextMessageCommand,
        SendReactionCommand,
        ReconnectCommand,
        SettleReconnectIntervalCommand
      },
      event: {
        SendTextMessageEvent,
        HistorySyncCompletedEvent,
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
