import { readFileSync } from 'node:fs'
import path from 'node:path'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ProjectedTextMessage } from '@/domain/Message'

const browserFixture = vi.hoisted(() => ({
  notifications: {
    create: vi.fn(),
    onButtonClicked: { addListener: vi.fn() },
    onClicked: { addListener: vi.fn() },
    onClosed: { addListener: vi.fn() }
  },
  tabs: {
    query: vi.fn(),
    get: vi.fn(),
    update: vi.fn(),
    create: vi.fn(),
    reload: vi.fn(),
    remove: vi.fn(),
    move: vi.fn()
  },
  windows: {
    getAll: vi.fn(),
    getLastFocused: vi.fn(),
    update: vi.fn()
  }
}))

vi.mock('#imports', () => ({ browser: browserFixture }))

import { Notification } from '@/service/Notification'

type NotificationMessage = ProjectedTextMessage & { meta?: { tab?: { id?: number; url?: string } } }

const createMessage = (url: string | null = 'https://alpha.example/chat'): NotificationMessage => ({
  type: 'text',
  id: 'message-1',
  hlc: { timestamp: 1, counter: 0 },
  userId: 'remote-user',
  body: 'hello',
  mentions: [],
  receivedAt: 1,
  author: { id: 'remote-user', name: 'Remote', avatar: 'avatar.png' },
  reactions: { likes: [], hates: [] },
  ...(url === null ? {} : { meta: { tab: { id: 7, url } } })
})

const currentTab = (url: string) => ({
  id: 1,
  windowId: 1,
  index: 0,
  lastAccessed: 1,
  active: true,
  highlighted: true,
  url
})

const browserTab = (id: number, windowId: number, index: number, lastAccessed: number, url?: string) => ({
  id,
  windowId,
  index,
  lastAccessed,
  ...(url === undefined ? {} : { url })
})

const expectNoTabOrWindowMutation = () => {
  expect(browserFixture.tabs.get).not.toHaveBeenCalled()
  expect(browserFixture.tabs.update).not.toHaveBeenCalled()
  expect(browserFixture.tabs.create).not.toHaveBeenCalled()
  expect(browserFixture.tabs.reload).not.toHaveBeenCalled()
  expect(browserFixture.tabs.remove).not.toHaveBeenCalled()
  expect(browserFixture.tabs.move).not.toHaveBeenCalled()
  expect(browserFixture.windows.update).not.toHaveBeenCalled()
}

const clickNotification = async (message: NotificationMessage = createMessage(), id = 'notification-1') => {
  const notification = new Notification()
  await notification.push(message)
  const onClicked = browserFixture.notifications.onClicked.addListener.mock.calls[0]![0] as (
    id: string
  ) => Promise<void>
  await onClicked(id)
  return notification
}

beforeEach(() => {
  vi.resetAllMocks()
  browserFixture.notifications.create.mockResolvedValue('notification-1')
  browserFixture.tabs.query.mockResolvedValue([])
  browserFixture.windows.getAll.mockResolvedValue([])
  browserFixture.windows.getLastFocused.mockResolvedValue({
    id: 1,
    focused: true,
    tabs: [currentTab('https://beta.example/home')]
  })
})

describe('Notification browser service', () => {
  it('notifies when only an unfocused window has an active tab for the message domain', async () => {
    browserFixture.tabs.query.mockResolvedValue([
      currentTab('https://beta.example/home'),
      {
        id: 2,
        windowId: 2,
        active: true,
        highlighted: true,
        url: 'https://alpha.example/other'
      }
    ])

    await new Notification().push(createMessage())

    expect(browserFixture.notifications.create).toHaveBeenCalledTimes(1)
    expect(browserFixture.windows.getLastFocused).toHaveBeenCalledWith({ populate: true })
    expect(browserFixture.tabs.query).not.toHaveBeenCalled()
    expectNoTabOrWindowMutation()
  })

  it('suppresses only an exact origin match in the focused current tab', async () => {
    browserFixture.windows.getLastFocused.mockResolvedValue({
      id: 1,
      focused: true,
      tabs: [currentTab('https://alpha.example/other?query=1#hash')]
    })

    await new Notification().push(createMessage('https://alpha.example/chat'))

    expect(browserFixture.notifications.create).not.toHaveBeenCalled()
    expectNoTabOrWindowMutation()
  })

  it('creates one notification for a different focused current-tab origin', async () => {
    const notification = new Notification()

    await notification.push(createMessage())

    expect(browserFixture.notifications.create).toHaveBeenCalledOnce()
    expect(browserFixture.notifications.create).toHaveBeenCalledWith({
      type: 'basic',
      iconUrl: 'avatar.png',
      title: 'Remote',
      message: 'hello',
      contextMessage: 'https://alpha.example/chat'
    })
    expect(notification.historyNotificationTabs.get('notification-1')).toEqual({
      id: 7,
      url: 'https://alpha.example/chat'
    })
    expectNoTabOrWindowMutation()
  })

  it.each([
    {
      name: 'no focused browser window',
      window: { id: 1, focused: false, tabs: [currentTab('https://alpha.example/other')] }
    },
    { name: 'no current tab', window: { id: 1, focused: true, tabs: [] } },
    {
      name: 'no highlighted active tab',
      window: {
        id: 1,
        focused: true,
        tabs: [{ ...currentTab('https://alpha.example/other'), highlighted: false }]
      }
    },
    {
      name: 'invalid current-tab URL',
      window: { id: 1, focused: true, tabs: [currentTab('not a URL')] }
    }
  ])('notifies when there is $name', async ({ window }) => {
    browserFixture.windows.getLastFocused.mockResolvedValue(window)

    await new Notification().push(createMessage())

    expect(browserFixture.notifications.create).toHaveBeenCalledOnce()
    expectNoTabOrWindowMutation()
  })

  it('notifies when the focused-window lookup is unavailable', async () => {
    browserFixture.windows.getLastFocused.mockRejectedValue(new Error('No current window'))

    await new Notification().push(createMessage())

    expect(browserFixture.notifications.create).toHaveBeenCalledOnce()
    expectNoTabOrWindowMutation()
  })

  it('notifies when the message has no comparable source domain', async () => {
    browserFixture.windows.getLastFocused.mockResolvedValue({
      id: 1,
      focused: true,
      tabs: [currentTab('https://alpha.example/other')]
    })

    await new Notification().push(createMessage(null))

    expect(browserFixture.notifications.create).toHaveBeenCalledOnce()
    expectNoTabOrWindowMutation()
  })

  it('activates the focused window rightmost exact-domain match', async () => {
    browserFixture.windows.getAll.mockResolvedValue([
      {
        id: 1,
        focused: true,
        tabs: [
          browserTab(11, 1, 1, 10, 'https://alpha.example/first'),
          browserTab(12, 1, 4, 20, 'https://alpha.example/rightmost'),
          browserTab(13, 1, 5, 30, 'https://beta.example/')
        ]
      },
      {
        id: 2,
        focused: false,
        tabs: [browserTab(21, 2, 8, 1000, 'https://alpha.example/recent')]
      }
    ])

    await clickNotification()

    expect(browserFixture.windows.getAll).toHaveBeenCalledOnce()
    expect(browserFixture.windows.getAll).toHaveBeenCalledWith({ populate: true })
    expect(browserFixture.tabs.update).toHaveBeenCalledOnce()
    expect(browserFixture.tabs.update).toHaveBeenCalledWith(12, { active: true })
    expect(browserFixture.windows.update).not.toHaveBeenCalled()
    expect(browserFixture.tabs.get).not.toHaveBeenCalled()
    expect(browserFixture.tabs.query).not.toHaveBeenCalled()
    expect(browserFixture.tabs.create).not.toHaveBeenCalled()
  })

  it('keeps focused-window priority over a more recently accessed match elsewhere', async () => {
    browserFixture.windows.getAll.mockResolvedValue([
      {
        id: 1,
        focused: true,
        tabs: [browserTab(11, 1, 1, 1, 'https://alpha.example/focused')]
      },
      {
        id: 2,
        focused: false,
        tabs: [browserTab(21, 2, 1, 1000, 'https://alpha.example/recent')]
      }
    ])

    await clickNotification()

    expect(browserFixture.tabs.update).toHaveBeenCalledOnce()
    expect(browserFixture.tabs.update).toHaveBeenCalledWith(11, { active: true })
    expect(browserFixture.windows.update).not.toHaveBeenCalled()
    expect(browserFixture.tabs.create).not.toHaveBeenCalled()
  })

  it('falls back to the greatest lastAccessed match and focuses its window', async () => {
    browserFixture.windows.getAll.mockResolvedValue([
      {
        id: 1,
        focused: true,
        tabs: [browserTab(11, 1, 1, 500, 'https://beta.example/')]
      },
      {
        id: 2,
        focused: false,
        tabs: [browserTab(21, 2, 1, 100, 'https://alpha.example/older')]
      },
      {
        id: 3,
        focused: false,
        tabs: [browserTab(31, 3, 1, 300, 'https://alpha.example/newer')]
      }
    ])

    await clickNotification()

    expect(browserFixture.tabs.update).toHaveBeenCalledOnce()
    expect(browserFixture.tabs.update).toHaveBeenCalledWith(31, { active: true })
    expect(browserFixture.windows.update).toHaveBeenCalledOnce()
    expect(browserFixture.windows.update).toHaveBeenCalledWith(3, { focused: true })
    expect(browserFixture.tabs.create).not.toHaveBeenCalled()
  })

  it('uses the same lastAccessed fallback when no browser window is focused', async () => {
    browserFixture.windows.getAll.mockResolvedValue([
      {
        id: 2,
        focused: false,
        tabs: [browserTab(21, 2, 1, 200, 'https://alpha.example/older')]
      },
      {
        id: 3,
        focused: false,
        tabs: [browserTab(31, 3, 1, 400, 'https://alpha.example/newer')]
      }
    ])

    await clickNotification()

    expect(browserFixture.tabs.update).toHaveBeenCalledOnce()
    expect(browserFixture.tabs.update).toHaveBeenCalledWith(31, { active: true })
    expect(browserFixture.windows.update).toHaveBeenCalledOnce()
    expect(browserFixture.windows.update).toHaveBeenCalledWith(3, { focused: true })
    expect(browserFixture.tabs.create).not.toHaveBeenCalled()
  })

  it('matches only the exact valid WebChat origin', async () => {
    browserFixture.windows.getAll.mockResolvedValue([
      {
        id: 1,
        focused: true,
        tabs: [
          browserTab(11, 1, 1, 10, 'https://alpha.example/other?query=1#hash'),
          browserTab(12, 1, 2, 20, 'http://alpha.example/'),
          browserTab(13, 1, 3, 30, 'https://sub.alpha.example/'),
          browserTab(14, 1, 4, 40, 'https://alpha.example:8443/'),
          browserTab(15, 1, 5, 50, 'not a URL'),
          browserTab(16, 1, 6, 60),
          browserTab(17, 1, 7, 70, 'chrome-extension://extension-id/options.html')
        ]
      }
    ])

    await clickNotification()

    expect(browserFixture.tabs.update).toHaveBeenCalledOnce()
    expect(browserFixture.tabs.update).toHaveBeenCalledWith(11, { active: true })
    expect(browserFixture.windows.update).not.toHaveBeenCalled()
    expect(browserFixture.tabs.create).not.toHaveBeenCalled()
  })

  it('leaves all tabs and windows unchanged when no exact-domain match exists', async () => {
    browserFixture.windows.getAll.mockResolvedValue([
      {
        id: 1,
        focused: true,
        tabs: [
          browserTab(11, 1, 1, 10, 'https://beta.example/'),
          browserTab(12, 1, 2, 20, 'not a URL'),
          browserTab(13, 1, 3, 30)
        ]
      }
    ])

    await clickNotification()

    expect(browserFixture.windows.getAll).toHaveBeenCalledOnce()
    expectNoTabOrWindowMutation()
  })

  it.each([
    { name: 'missing notification context', message: createMessage(null) },
    { name: 'invalid notification context', message: createMessage('not a URL') }
  ])('leaves all tabs and windows unchanged for $name', async ({ message }) => {
    await clickNotification(message)

    expect(browserFixture.windows.getAll).not.toHaveBeenCalled()
    expectNoTabOrWindowMutation()
  })

  it('removes closed notification context before a later click', async () => {
    const notification = new Notification()
    await notification.push(createMessage())
    const onClosed = browserFixture.notifications.onClosed.addListener.mock.calls[0]![0] as (
      id: string
    ) => Promise<void>
    const onClicked = browserFixture.notifications.onClicked.addListener.mock.calls[0]![0] as (
      id: string
    ) => Promise<void>

    await onClosed('notification-1')
    await onClicked('notification-1')

    expect(notification.historyNotificationTabs.has('notification-1')).toBe(false)
    expect(browserFixture.windows.getAll).not.toHaveBeenCalled()
    expectNoTabOrWindowMutation()
  })

  it('preserves the separate notification button behavior', async () => {
    browserFixture.tabs.get.mockResolvedValue({
      id: 7,
      windowId: 2,
      url: 'https://alpha.example/chat'
    })
    const notification = new Notification()
    await notification.push(createMessage())
    const onButtonClicked = browserFixture.notifications.onButtonClicked.addListener.mock.calls[0]![0] as (
      id: string
    ) => Promise<void>

    await onButtonClicked('notification-1')
    expect(browserFixture.tabs.update).toHaveBeenLastCalledWith(7, { active: true, highlighted: true })
    expect(browserFixture.windows.update).toHaveBeenCalledWith(2, { focused: true })
    expect(browserFixture.tabs.create).not.toHaveBeenCalled()
  })

  it('creates no tab when the notification button target is unavailable', async () => {
    browserFixture.tabs.get.mockRejectedValue(new Error('No tab'))
    const notification = new Notification()
    await notification.push(createMessage())
    const onButtonClicked = browserFixture.notifications.onButtonClicked.addListener.mock.calls[0]![0] as (
      id: string
    ) => Promise<void>

    await onButtonClicked('notification-1')

    expect(browserFixture.tabs.get).toHaveBeenCalledWith(7)
    expect(browserFixture.tabs.update).not.toHaveBeenCalled()
    expect(browserFixture.tabs.create).not.toHaveBeenCalled()
    expect(browserFixture.windows.update).not.toHaveBeenCalled()
  })

  it('uses no custom ordering timestamp, persistence, listener, ledger, or cache', () => {
    const source = readFileSync(path.resolve(process.cwd(), 'src/service/Notification/index.ts'), 'utf8')

    expect(source).not.toMatch(
      /Date\.now|new Date|timeStamp|timestamp|browser\.storage|localStorage|sessionStorage|indexedDB|browser\.tabs\.create|tabs\.onCreated|tabs\.onActivated|tabs\.onMoved|windows\.onFocusChanged|setTimeout|setInterval/
    )
    expect(source.match(/new Map/g)).toHaveLength(1)
  })
})
