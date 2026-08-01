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
    create: vi.fn()
  },
  windows: {
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
  active: true,
  highlighted: true,
  url
})

const expectNoTabOrWindowMutation = () => {
  expect(browserFixture.tabs.get).not.toHaveBeenCalled()
  expect(browserFixture.tabs.update).not.toHaveBeenCalled()
  expect(browserFixture.tabs.create).not.toHaveBeenCalled()
  expect(browserFixture.windows.update).not.toHaveBeenCalled()
}

beforeEach(() => {
  vi.resetAllMocks()
  browserFixture.notifications.create.mockResolvedValue('notification-1')
  browserFixture.tabs.query.mockResolvedValue([])
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

  it('preserves the separate user-initiated notification click behavior', async () => {
    browserFixture.tabs.get.mockResolvedValue({
      id: 7,
      windowId: 2,
      url: 'https://alpha.example/chat'
    })
    const notification = new Notification()
    await notification.push(createMessage())
    const onClicked = browserFixture.notifications.onClicked.addListener.mock.calls[0]![0] as (
      id: string
    ) => Promise<void>
    const onButtonClicked = browserFixture.notifications.onButtonClicked.addListener.mock.calls[0]![0] as (
      id: string
    ) => Promise<void>

    await onClicked('notification-1')
    expect(browserFixture.tabs.update).toHaveBeenLastCalledWith(7, { active: true })

    await onButtonClicked('notification-1')
    expect(browserFixture.tabs.update).toHaveBeenLastCalledWith(7, { active: true, highlighted: true })
    expect(browserFixture.windows.update).toHaveBeenCalledWith(2, { focused: true })
    expect(browserFixture.tabs.create).not.toHaveBeenCalled()
  })
})
