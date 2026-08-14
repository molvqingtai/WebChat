import { afterEach, describe, expect, it, vi } from 'vitest'
import { Remesh } from 'remesh'
import ChatRoomDomain from '@/domain/ChatRoom'
import { type ProjectedTextMessage } from '@/domain/Message'
import { createMemoryMessageDatabase } from '@/domain/impls/database/Memory'
import { SendLifecycleExtern } from '@/domain/externs/SendLifecycle'
import { createSendLifecycle } from '@/domain/impls/SendLifecycle'
import { MessageDatabaseExtern } from '@/domain/MessageStore'
import NotificationDomain from '@/domain/Notification'
import UserInfoDomain, { type UserInfo } from '@/domain/UserInfo'
import { ChatRoomExtern, type ChatRoom, type SendMessageCommand } from '@/domain/externs/ChatRoom'
import { NotificationExtern } from '@/domain/externs/Notification'
import { ReadinessExtern } from '@/domain/externs/Readiness'
import { BrowserSyncStorageExtern, type Storage, type StorageValue } from '@/domain/externs/Storage'
import { type ChatMessage, type ChatSession } from '@/protocol'

const SELF: UserInfo = {
  id: 'local-user',
  name: 'Local',
  avatar: '',
  createTime: 1,
  themeMode: 'system',
  danmakuEnabled: true,
  notificationEnabled: true,
  notificationType: 'all'
}

const REMOTE = { id: 'remote-user', name: 'Remote', avatar: '' }
const settle = () => new Promise<void>((resolve) => setTimeout(resolve, 0))
let databaseId = 0

const createMessage = ({
  id = 'message-1',
  author = REMOTE,
  mentionSelf = false
}: {
  id?: string
  author?: typeof REMOTE
  mentionSelf?: boolean
} = {}): ProjectedTextMessage => ({
  type: 'text',
  id,
  hlc: { timestamp: 1, counter: 0 },
  userId: author.id,
  body: mentionSelf ? '@Local hello' : 'hello',
  mentions: mentionSelf ? [{ id: SELF.id, name: SELF.name, avatar: SELF.avatar, ranges: [[0, 5]] }] : [],
  receivedAt: 1,
  author,
  reactions: { likes: [], hates: [] }
})

const createFixture = (user: UserInfo, userInfoBeforeNotification = false) => {
  const push = vi.fn(async () => 'notification-1')
  const storage: Storage = {
    get: async <T extends StorageValue>() => user as T,
    set: async () => {},
    watch: async () => async () => {}
  }
  const messageListeners = new Set<(message: ChatMessage) => void>()
  const sessionListeners = new Set<(sessions: readonly ChatSession[]) => void>()
  const subscribe = <T>(listeners: Set<(value: T) => void>, listener: (value: T) => void) => {
    listeners.add(listener)
    return () => listeners.delete(listener)
  }
  const chatRoom: ChatRoom = {
    joinRoom: async () => {},
    leaveRoom: async () => {},
    sendMessage: (async (command: SendMessageCommand) => {
      if (command.type === 'reaction') throw new Error('not used')
      return {
        type: 'text',
        id: 'local-message',
        hlc: { timestamp: 2, counter: 0 },
        userId: user.id,
        body: command.body,
        mentions: command.mentions
      }
    }) as unknown as ChatRoom['sendMessage'],
    onMessage: (listener) => subscribe(messageListeners, listener),
    onJoinRoom: () => () => {},
    onLeaveRoom: () => () => {},
    onSessions: (listener) => subscribe(sessionListeners, listener),
    onError: () => () => {}
  }
  const database = createMemoryMessageDatabase(`notification-domain-${databaseId++}`)
  const store = Remesh.store({
    externs: [
      NotificationExtern.impl({ push }),
      BrowserSyncStorageExtern.impl(storage),
      ChatRoomExtern.impl(chatRoom),
      SendLifecycleExtern.impl(createSendLifecycle()),
      ReadinessExtern.impl({ onState: () => () => {} }),
      MessageDatabaseExtern.impl(database)
    ]
  })
  const notificationAction = NotificationDomain()
  const chatRoomAction = ChatRoomDomain()
  const userInfoAction = UserInfoDomain()
  const notification = store.getDomain(notificationAction)
  const room = store.getDomain(chatRoomAction)
  const userInfo = store.getDomain(userInfoAction)
  if (userInfoBeforeNotification) {
    store.send(userInfo.command.UpdateUserInfoCommand(user))
    store.igniteDomain(notificationAction)
  } else {
    store.igniteDomain(notificationAction)
    store.send(userInfo.command.UpdateUserInfoCommand(user))
  }

  return {
    push,
    store,
    notification,
    room,
    emitMessage: (message: ProjectedTextMessage) => {
      sessionListeners.forEach((listener) => {
        listener([{ sessionId: `session-${message.author.id}`, user: message.author }])
      })
      messageListeners.forEach((listener) => {
        listener(message)
      })
    },
    dispose: async () => {
      store.discard()
      await database.close()
    }
  }
}

const fixtures: Array<ReturnType<typeof createFixture>> = []

afterEach(async () => {
  const fixturesToDispose = fixtures.splice(0)
  await Promise.all(fixturesToDispose.map((fixture) => fixture.dispose()))
  vi.restoreAllMocks()
})

describe('NotificationDomain message eligibility', () => {
  it('exposes no state or dispatch surface', () => {
    const fixture = createFixture(SELF)
    fixtures.push(fixture)

    expect(Object.keys(fixture.notification)).toEqual([])
  })

  it.each([
    {
      name: 'disabled notifications',
      user: { ...SELF, notificationEnabled: false, notificationType: 'all' as const },
      message: createMessage(),
      expected: 0
    },
    {
      name: 'All message mode for a remote text',
      user: { ...SELF, notificationType: 'all' as const },
      message: createMessage(),
      expected: 1
    },
    {
      name: 'Only @self without a mention',
      user: { ...SELF, notificationType: 'at' as const },
      message: createMessage(),
      expected: 0
    },
    {
      name: 'Only @self with a mention',
      user: { ...SELF, notificationType: 'at' as const },
      message: createMessage({ mentionSelf: true }),
      expected: 1
    },
    {
      name: 'a self-authored text',
      user: { ...SELF, notificationType: 'all' as const },
      message: createMessage({ author: SELF }),
      expected: 0
    }
  ])('applies $name before the browser service', async ({ user, message, expected }) => {
    const fixture = createFixture(user)
    fixtures.push(fixture)

    fixture.emitMessage(message)
    await settle()

    expect(fixture.push).toHaveBeenCalledTimes(expected)
    if (expected === 1) {
      expect(fixture.push).toHaveBeenCalledWith(
        expect.objectContaining({ id: message.id, userId: message.userId, author: message.author })
      )
    }
  })

  it('does not notify from the local-send projection path', async () => {
    const fixture = createFixture(SELF)
    fixtures.push(fixture)

    fixture.store.send(fixture.room.command.SendTextMessageCommand('local message'))
    await settle()

    expect(fixture.push).not.toHaveBeenCalled()
  })

  it('reads canonical settings and contains a rejected dispatch before a later eligible message', async () => {
    const failure = new Error('notification unavailable')
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const fixture = createFixture(SELF, true)
    fixtures.push(fixture)
    fixture.push.mockRejectedValueOnce(failure).mockResolvedValueOnce('notification-2')
    const first = createMessage({ id: 'message-1' })
    const second = createMessage({ id: 'message-2' })

    fixture.emitMessage(first)
    await vi.waitFor(() => expect(fixture.push).toHaveBeenCalledTimes(1))
    await settle()
    fixture.emitMessage(second)
    await vi.waitFor(() => expect(fixture.push).toHaveBeenCalledTimes(2))

    expect(fixture.push).toHaveBeenNthCalledWith(1, expect.objectContaining({ id: first.id }))
    expect(fixture.push).toHaveBeenNthCalledWith(2, expect.objectContaining({ id: second.id }))
    expect(warning).toHaveBeenCalledOnce()
    expect(warning).toHaveBeenCalledWith('[WebChat] Notification push failed:', failure)
  })
})
