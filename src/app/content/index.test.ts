import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act } from 'react'
import type { Root } from 'react-dom/client'
import type * as RemeshExports from 'remesh'

interface ContentOwner {
  root: Root
  store: { discard: () => void }
  stopInitialization: () => void
}

interface ShadowRootOptions {
  position: string
  isolateEvents?: string[]
  onMount: (container: HTMLElement) => ContentOwner
  onRemove: (owner: ContentOwner | undefined) => void
}

const fixture = vi.hoisted(() => ({
  createShadowRootUi: vi.fn(),
  mount: vi.fn(),
  createStore: vi.fn(),
  discard: vi.fn(),
  startInitializationLifecycle: vi.fn(),
  stopInitialization: vi.fn(),
  initializationOptions: [] as Array<Record<string, unknown>>,
  owners: [] as ContentOwner[],
  removeUis: [] as Array<() => void>,
  appProps: [] as Array<Record<string, unknown>>,
  requestBrowserSyncStoragePreparation: vi.fn(),
  prepareLocalConfigurationStorage: vi.fn(),
  prepareIndexedDBMessageDatabase: vi.fn(),
  createIndexedDBMessageDatabase: vi.fn(),
  initClient: vi.fn(),
  detachClient: vi.fn(),
  whenHostPhase: vi.fn(),
  whenFailure: vi.fn(),
  createChatRoomImpl: vi.fn(),
  createWorldRoomImpl: vi.fn(),
  createReadinessImpl: vi.fn(),
  createElement: vi.fn(),
  scope: vi.fn(),
  actions: {
    notification: { owner: 'notification' },
    appFeedback: { owner: 'app-feedback' }
  },
  database: { read: vi.fn(), write: vi.fn(), watch: vi.fn(), close: vi.fn() },
  chat: {},
  world: {},
  readiness: {},
  browserStorage: {}
}))

vi.mock('#imports', () => ({
  defineContentScript: <Definition>(definition: Definition) => definition,
  createShadowRootUi: fixture.createShadowRootUi
}))
vi.mock('remesh', async (importOriginal) => {
  const actual = await importOriginal<typeof RemeshExports>()
  return { ...actual, Remesh: { ...actual.Remesh, store: fixture.createStore } }
})
vi.mock('remesh-react', async () => {
  const React = await import('react')
  return {
    RemeshRoot: ({ children }: { children?: React.ReactNode }) => React.createElement(React.Fragment, null, children),
    RemeshScope: ({ children, domains }: { children?: React.ReactNode; domains: unknown[] }) => {
      fixture.scope(domains)
      return React.createElement(React.Fragment, null, children)
    }
  }
})
vi.mock('@/app/content/App', async () => {
  const React = await import('react')
  return {
    default: (props: Record<string, unknown>) => {
      fixture.appProps.push(props)
      return React.createElement('section', { 'data-testid': 'application-shell' })
    }
  }
})
vi.mock('@/app/content/Initialization', () => ({
  startInitializationLifecycle: (options: Record<string, unknown>) => {
    fixture.initializationOptions.push(options)
    fixture.startInitializationLifecycle(options)
    return fixture.stopInitialization
  }
}))
vi.mock('@/domain/impls/Storage', () => ({
  LocalStorageImpl: {},
  BrowserSyncStorageImpl: { value: fixture.browserStorage },
  prepareLocalConfigurationStorage: fixture.prepareLocalConfigurationStorage
}))
vi.mock('@/domain/impls/database/IndexedDB', () => ({
  createIndexedDBMessageDatabase: fixture.createIndexedDBMessageDatabase,
  prepareIndexedDBMessageDatabase: fixture.prepareIndexedDBMessageDatabase
}))
vi.mock('@/domain/impls/runtime/Client', () => ({
  detachClient: fixture.detachClient,
  initClient: fixture.initClient,
  whenHostPhase: fixture.whenHostPhase,
  whenFailure: fixture.whenFailure
}))
vi.mock('@/domain/impls/ChatRoom', () => ({ createChatRoomImpl: fixture.createChatRoomImpl }))
vi.mock('@/domain/impls/WorldRoom', () => ({ createWorldRoomImpl: fixture.createWorldRoomImpl }))
vi.mock('@/domain/impls/Readiness', () => ({ createReadinessImpl: fixture.createReadinessImpl }))
vi.mock('@/domain/impls/Danmaku', () => ({ DanmakuImpl: {} }))
vi.mock('@/domain/impls/Notification', () => ({ NotificationImpl: {} }))
vi.mock('@/domain/impls/Toast', () => ({ ToastImpl: {} }))
vi.mock('@/domain/impls/AppAction', () => ({ AppActionImpl: {} }))
vi.mock('@/domain/Notification', () => ({ default: () => fixture.actions.notification }))
vi.mock('@/domain/AppFeedback', () => ({ default: () => fixture.actions.appFeedback }))
vi.mock('@/utils', () => ({ createElement: fixture.createElement }))
vi.mock('@/service/StoragePreparation', () => ({
  requestBrowserSyncStoragePreparation: fixture.requestBrowserSyncStoragePreparation
}))

const { default: content } = await import('@/app/content')

const startContent = async () => {
  if (typeof content.main !== 'function') throw new Error('Content main is unavailable')
  await act(async () => content.main({} as never))
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.stubGlobal('__NAME__', 'WEB-CHAT')
  fixture.initializationOptions.length = 0
  fixture.owners.length = 0
  fixture.removeUis.length = 0
  fixture.appProps.length = 0
  fixture.createStore.mockImplementation(() => ({ discard: fixture.discard }))
  fixture.createIndexedDBMessageDatabase.mockReturnValue(fixture.database)
  fixture.createChatRoomImpl.mockReturnValue({ value: fixture.chat })
  fixture.createWorldRoomImpl.mockReturnValue({ value: fixture.world })
  fixture.createReadinessImpl.mockReturnValue({ value: fixture.readiness })
  fixture.createElement.mockImplementation(() => {
    const element = document.createElement('div')
    element.id = 'root'
    return element
  })
  fixture.createShadowRootUi.mockImplementation(async (_context: unknown, options: ShadowRootOptions) => {
    const container = document.createElement('div')
    const shadowHost = document.createElement('web-chat-unit')
    document.body.append(container)
    const remove = () => options.onRemove(fixture.owners.shift())
    fixture.removeUis.push(remove)
    return {
      shadowHost,
      mount: () => {
        fixture.mount()
        fixture.owners.push(options.onMount(container))
      },
      remove
    }
  })
})

afterEach(async () => {
  await act(async () => {
    fixture.removeUis.splice(0).forEach((remove) => remove())
    fixture.owners.splice(0).forEach((owner) => {
      owner.stopInitialization()
      owner.root.unmount()
      owner.store.discard()
    })
  })
  document.body.replaceChildren()
  window.removeEventListener('beforeunload', fixture.detachClient)
  vi.unstubAllGlobals()
})

describe('content composition root', () => {
  it('mounts the prop-free normal shell with the current required Domain scope before activation', async () => {
    await startContent()

    expect(fixture.createShadowRootUi).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        position: 'overlay',
        isolateEvents: ['keyup', 'keydown', 'keypress']
      })
    )
    expect(document.querySelector('[data-testid="application-shell"]')).not.toBeNull()
    expect(fixture.createStore).toHaveBeenCalledOnce()
    expect(fixture.startInitializationLifecycle).toHaveBeenCalledOnce()
    expect(fixture.scope).toHaveBeenCalled()
    expect(fixture.scope).toHaveBeenLastCalledWith([fixture.actions.notification, fixture.actions.appFeedback])
    expect(fixture.appProps.every((props) => Object.keys(props).length === 0)).toBe(true)
    expect(fixture.createIndexedDBMessageDatabase).not.toHaveBeenCalled()
    expect(fixture.createChatRoomImpl).not.toHaveBeenCalled()
    expect(fixture.createWorldRoomImpl).not.toHaveBeenCalled()
    expect(fixture.createReadinessImpl).not.toHaveBeenCalled()
  })

  it('owns one document-scope part bridge per Shadow UI and removes it during UI cleanup', async () => {
    await startContent()

    const styles = document.head.querySelectorAll<HTMLStyleElement>('[data-webchat-media-preview-transition]')
    expect(styles).toHaveLength(1)
    expect(styles[0]!.textContent).toBe(
      'web-chat-unit::part(webchat-media-preview-transition) {\n' +
        '  view-transition-name: var(--webchat-media-preview-transition-name, none);\n' +
        '}'
    )

    await act(async () => {
      fixture.removeUis.shift()?.()
    })

    expect(styles[0]!.isConnected).toBe(false)
  })

  it('constructs each deferred application dependency exactly once only when initialization activates it', async () => {
    await startContent()
    const activate = fixture.initializationOptions[0]?.activateApplicationDependencies
    if (typeof activate !== 'function') throw new Error('Activation boundary is unavailable')

    activate()

    expect(fixture.createIndexedDBMessageDatabase).toHaveBeenCalledOnce()
    expect(fixture.createChatRoomImpl).toHaveBeenCalledOnce()
    expect(fixture.createChatRoomImpl).toHaveBeenCalledWith(fixture.database)
    expect(fixture.createWorldRoomImpl).toHaveBeenCalledOnce()
    expect(fixture.createReadinessImpl).toHaveBeenCalledOnce()
    expect(fixture.createReadinessImpl).toHaveBeenCalledWith(fixture.whenHostPhase)
  })

  it('creates one store and initialization owner per document generation', async () => {
    await startContent()
    await startContent()

    expect(fixture.createStore).toHaveBeenCalledTimes(2)
    expect(fixture.startInitializationLifecycle).toHaveBeenCalledTimes(2)
    expect(fixture.createShadowRootUi).toHaveBeenCalledTimes(2)
    expect(fixture.mount).toHaveBeenCalledTimes(2)
  })
})
