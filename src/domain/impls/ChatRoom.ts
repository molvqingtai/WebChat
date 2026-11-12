import EventHub from '@resreq/event-hub'
import { isInvalidMessageRecordError, type MessageStore } from '@/domain/MessageStore'
import type {
  ChatRoom as ChatRoomPort,
  JoinRoomCommand,
  SendMessageCommand,
  SendReactionCommand,
  SendTextCommand
} from '@/domain/externs/ChatRoom'
import type { WorldRoom as WorldRoomPort, WorldState } from '@/domain/externs/WorldRoom'
import type { Readiness } from '@/domain/externs/Readiness'
import { MESSAGE_RECORD_TYPE, NOTICE_TYPE, isChatMessageRecord, type SystemNoticeRecord } from '@/domain/Message'
import type { Unsubscribe } from '@/domain/Subscription'
import type { ChatMessage, ChatSession, ReactionMessage, TextMessage } from '@/protocol'
import type { HostLocator, PageService, RuntimeEvent, RuntimeSession } from '@/runtime/core/Contract'
import { stringToHex } from '@/utils'
import { createRuntimeClient } from './Runtime'

export interface HistoryFeedbackEvent {
  ownerId: string
  type: 'loading' | 'dismiss'
}

type SessionsEvent = Extract<RuntimeEvent, { type: 'sessions' }>

const toChatSession = ({ sessionId, user }: RuntimeSession): ChatSession => ({ sessionId, user })

const selfJoinNotice = ({ user, joinedAt }: RuntimeSession): SystemNoticeRecord => {
  const id = `notice:${stringToHex(`self:join:${user.id}:${joinedAt}`)}`
  return {
    type: MESSAGE_RECORD_TYPE.SYSTEM_NOTICE,
    id,
    notice: {
      id,
      hlc: { timestamp: joinedAt, counter: 0 },
      type: NOTICE_TYPE.JOIN,
      body: `"${user.name}" joined the chat`
    },
    user,
    receivedAt: joinedAt
  }
}

/**
 * The page's side of the Runtime: implements the application ports on top of the Runtime
 * service, and serves the Runtime's requests against this site's own message store.
 */
export const createRuntimePorts = (locator: HostLocator, messageStore: MessageStore) => {
  const hub = new EventHub()
  /** Handed back on every join so a restarted host continues the same presence. */
  let presence: { presenceId: string; joinedAt: number } | null = null
  /** Remote sessions of the last projection; null means the next one is only a baseline. */
  let applied: RuntimeSession[] | null = null
  let loading: string[] = []
  let world: WorldState = []

  // oxlint-disable-next-line anti-slop/no-unknown-parameters -- normalization of an arbitrary thrown value
  const emitError = (error: unknown) => hub.emit('error', error instanceof Error ? error : new Error(String(error)))
  const subscribe =
    <Value>(event: string) =>
    (listener: (value: Value) => void): Unsubscribe => {
      hub.on(event, listener)
      return () => hub.off(event, listener)
    }

  const applySessions = ({ local, remote }: SessionsEvent) => {
    const previous = applied
    applied = remote
    hub.emit('sessions', [local, ...remote].map(toChatSession))
    if (previous === null) return
    // The local user counts as one presence of its own id, so its other tabs raise no notice.
    const count = (list: RuntimeSession[], userId: string) =>
      list.filter((session) => session.user.id === userId).length + (local.user.id === userId ? 1 : 0)
    new Set([...previous, ...remote].map((session) => session.user.id)).forEach((userId) => {
      const before = count(previous, userId)
      const after = count(remote, userId)
      if (before === 0 && after > 0) {
        const joined = remote.find((session) => session.user.id === userId)!
        // Users who were already here when we joined never produce a join notice.
        if (joined.joinedAt > local.joinedAt) hub.emit('join', toChatSession(joined))
      } else if (before > 0 && after === 0) {
        hub.emit('leave', toChatSession(previous.find((session) => session.user.id === userId)!))
      }
    })
  }

  const applyLoading = (syncIds: string[]) => {
    const emit = (ownerId: string, type: HistoryFeedbackEvent['type']) =>
      hub.emit('historyFeedback', { ownerId, type } satisfies HistoryFeedbackEvent)
    syncIds.filter((id) => !loading.includes(id)).forEach((id) => emit(id, 'loading'))
    loading.filter((id) => !syncIds.includes(id)).forEach((id) => emit(id, 'dismiss'))
    loading = syncIds
  }

  const service: PageService = {
    persist: async (records, live) => {
      let inserted = 0
      for (const record of records) {
        try {
          if (!(await messageStore.insert(record)).inserted) continue
          inserted += 1
          if (live) hub.emit('message', record.message)
        } catch (error) {
          if (!isInvalidMessageRecordError(error)) throw error
          emitError(error)
        }
      }
      return inserted
    },
    readHistory: async (cutoff) => {
      const records = await messageStore.query({ type: MESSAGE_RECORD_TYPE.CHAT_MESSAGE })
      return records.filter(isChatMessageRecord).filter((record) => record.message.hlc.timestamp >= cutoff)
    },
    publish: (event) => {
      if (event.type === 'sessions') applySessions(event)
      else if (event.type === 'history') applyLoading(event.syncIds)
      else if (event.type === 'error') emitError(new Error(event.message))
      else {
        world = event.sites
        hub.emit('world', world)
      }
    }
  }

  const client = createRuntimeClient({
    locator,
    service,
    onDisconnect: () => {
      applied = null
      applyLoading([])
    }
  })

  async function sendMessage(command: SendTextCommand): Promise<TextMessage>
  async function sendMessage(command: SendReactionCommand): Promise<ReactionMessage>
  async function sendMessage(command: SendMessageCommand): Promise<ChatMessage>
  async function sendMessage(command: SendMessageCommand): Promise<ChatMessage> {
    const record = await (await client.runtime()).send(command)
    // Text returns as soon as it is on its way; a reaction is visible only once stored.
    if (command.type === 'text') void messageStore.insert(record).catch(emitError)
    else await messageStore.insert(record)
    return record.message
  }

  const chatRoom: ChatRoomPort = {
    joinRoom: async (command: JoinRoomCommand) => {
      const runtime = await client.runtime()
      const session = await runtime.join(presence ? { ...command, resume: presence } : command)
      presence = { presenceId: session.presenceId, joinedAt: session.joinedAt }
      // The id is derived from the presence, so every tab and every replay writes the same row.
      await messageStore.insert(selfJoinNotice(session))
    },
    /** The application only "leaves" to rebuild its connections; a real leave is closing the page. */
    leaveRoom: async () => (await client.runtime()).reconnect(),
    sendMessage,
    onMessage: subscribe<ChatMessage>('message'),
    onJoinRoom: subscribe<ChatSession>('join'),
    onLeaveRoom: subscribe<ChatSession>('leave'),
    onSessions: subscribe<readonly ChatSession[]>('sessions'),
    onError: subscribe<Error>('error')
  }

  const worldRoom: WorldRoomPort = {
    getState: async () => world,
    onState: subscribe<WorldState>('world'),
    onError: () => () => {}
  }

  const readiness: Readiness = { onState: client.onState }

  return {
    chatRoom,
    worldRoom,
    readiness,
    onHistoryFeedback: subscribe<HistoryFeedbackEvent>('historyFeedback'),
    start: client.start,
    stop: client.stop
  }
}
