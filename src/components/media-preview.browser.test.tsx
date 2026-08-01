import { page, userEvent } from 'vitest/browser'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ReactNode } from 'react'
import type * as RemeshModule from 'remesh'

interface MountedShadowUi {
  shadow: ShadowRoot
  shadowHost: HTMLElement
  uiContainer: HTMLElement
  remove: () => void
}

const fixture = vi.hoisted(() => ({
  ui: null as MountedShadowUi | null,
  send: vi.fn(),
  discard: vi.fn(),
  stopInitialization: vi.fn(),
  detachClient: vi.fn(),
  onInvalidated: vi.fn(),
  setRef: vi.fn(),
  hostClicks: 0,
  markdown:
    '![Wide](data:image/svg+xml,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%20width%3D%22120%22%20height%3D%2260%22%3E%3Crect%20width%3D%22120%22%20height%3D%2260%22%20fill%3D%22red%22%2F%3E%3C%2Fsvg%3E)\n\n![Large](data:image/svg+xml,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%20width%3D%221200%22%20height%3D%221200%22%3E%3Crect%20width%3D%221200%22%20height%3D%221200%22%20fill%3D%22green%22%2F%3E%3C%2Fsvg%3E)'
}))

vi.mock('#imports', async () => {
  const { createShadowRootUi } = await import('wxt/utils/content-script-ui/shadow-root')
  const { default: css } = await import('@/assets/styles/tailwind.css?inline')
  return {
    defineContentScript: <Definition,>(definition: Definition) => definition,
    createShadowRootUi: async (context: unknown, options: Record<string, unknown>) => {
      const ui = (await createShadowRootUi(
        context as never,
        {
          ...options,
          css: [options.css, css].filter(Boolean).join('\n')
        } as never
      )) as MountedShadowUi
      fixture.ui = ui
      return ui
    }
  }
})
vi.mock('remesh', async (importOriginal) => {
  const actual = await importOriginal<typeof RemeshModule>()
  return {
    ...actual,
    Remesh: {
      ...actual.Remesh,
      store: () => ({ discard: fixture.discard })
    }
  }
})
vi.mock('remesh-react', async () => {
  return {
    RemeshRoot: ({ children }: { children?: ReactNode }) => <>{children}</>,
    RemeshScope: ({ children }: { children?: ReactNode }) => <>{children}</>,
    useRemeshDomain: (domain: unknown) => domain,
    useRemeshSend: () => fixture.send,
    useRemeshQuery: (query: string) => {
      switch (query) {
        case 'app-ready':
        case 'app-open':
        case 'user-set':
        case 'user-loaded':
        case 'messages-loaded':
        case 'chat-joined':
        case 'world-joined':
        case 'reconnect-available':
          return true
        case 'app-position':
          return { x: 50, y: 22 }
        case 'app-phase':
          return 'ready'
        case 'user-info':
          return { danmakuEnabled: false, themeMode: 'light' }
        default:
          return false
      }
    }
  }
})
vi.mock('@/domain/AppStatus', () => ({
  default: () => ({
    query: {
      ReadyQuery: () => 'app-ready',
      OpenQuery: () => 'app-open',
      PositionQuery: () => 'app-position',
      PhaseQuery: () => 'app-phase',
      HasUnreadQuery: () => 'app-unread'
    },
    command: {
      UpdateOpenCommand: (open: boolean) => `update-open-${open}`,
      UpdatePositionCommand: () => 'update-position',
      RetryCommand: () => 'retry'
    }
  })
}))
vi.mock('@/domain/ChatRoom', () => ({
  default: () => ({
    query: {
      JoinIsFinishedQuery: () => 'chat-joined',
      ConnectionIsLoadingQuery: () => 'chat-loading',
      ReconnectAvailableQuery: () => 'reconnect-available'
    },
    command: { JoinRoomCommand: () => 'join-chat', ReconnectCommand: () => 'reconnect-chat' }
  })
}))
vi.mock('@/domain/WorldRoom', () => ({
  default: () => ({
    query: { JoinIsFinishedQuery: () => 'world-joined' },
    command: { JoinRoomCommand: () => 'join-world' }
  })
}))
vi.mock('@/domain/UserInfo', () => ({
  default: () => ({
    query: {
      UserInfoSetIsFinishedQuery: () => 'user-set',
      UserInfoLoadIsFinishedQuery: () => 'user-loaded',
      UserInfoQuery: () => 'user-info'
    },
    command: { UpdateUserInfoCommand: () => 'update-user' }
  })
}))
vi.mock('@/domain/MessageList', () => ({
  default: () => ({ query: { LoadIsFinishedQuery: () => 'messages-loaded' } })
}))
vi.mock('@/domain/Danmaku', () => ({
  default: () => ({ command: { MountCommand: () => 'mount-danmaku', UnmountCommand: () => 'unmount-danmaku' } })
}))
vi.mock('@/domain/AppAction', () => ({
  default: () => ({ command: { OpenOptionsCommand: () => 'open-options' } })
}))
vi.mock('@/domain/Notification', () => ({ default: () => ({ owner: 'notification' }) }))
vi.mock('@/domain/AppFeedback', () => ({ default: () => ({ owner: 'feedback' }) }))
vi.mock('@/app/content/Initialization', () => ({
  startInitializationLifecycle: () => fixture.stopInitialization
}))
vi.mock('@/domain/impls/Storage', () => ({
  LocalStorageImpl: {},
  BrowserSyncStorageImpl: { value: {} },
  prepareLocalConfigurationStorage: vi.fn()
}))
vi.mock('@/domain/impls/database/IndexedDB', () => ({
  createIndexedDBMessageDatabase: vi.fn(),
  prepareIndexedDBMessageDatabase: vi.fn()
}))
vi.mock('@/domain/impls/runtime/Client', () => ({
  detachClient: fixture.detachClient,
  initClient: vi.fn(),
  whenHostPhase: vi.fn()
}))
vi.mock('@/domain/impls/ChatRoom', () => ({ createChatRoomImpl: vi.fn() }))
vi.mock('@/domain/impls/WorldRoom', () => ({ createWorldRoomImpl: vi.fn() }))
vi.mock('@/domain/impls/Readiness', () => ({ createReadinessImpl: vi.fn() }))
vi.mock('@/domain/impls/Danmaku', () => ({ DanmakuImpl: {} }))
vi.mock('@/domain/impls/Notification', () => ({ NotificationImpl: {} }))
vi.mock('@/domain/impls/Toast', () => ({ ToastImpl: {} }))
vi.mock('@/domain/impls/AppAction', () => ({ AppActionImpl: {} }))
vi.mock('@/service/StoragePreparation', () => ({ requestBrowserSyncStoragePreparation: vi.fn() }))
vi.mock('@/utils/withPreparationLock', () => ({
  createDirectPreparationCoordinator: () => ({}),
  createWebLocksPreparationCoordinator: () => ({})
}))
vi.mock('@/domain/MessageStore', () => ({ MessageDatabaseExtern: { impl: () => ({}) } }))
vi.mock('@/domain/externs/ChatRoom', () => ({ ChatRoomExtern: { impl: () => ({}) } }))
vi.mock('@/domain/externs/WorldRoom', () => ({ WorldRoomExtern: { impl: () => ({}) } }))
vi.mock('@/domain/externs/Readiness', () => ({ ReadinessExtern: { impl: () => ({}) } }))
vi.mock('@/domain/externs/Storage', () => ({ BrowserSyncStorageExtern: { impl: () => ({}) } }))
vi.mock('@/domain/externs/Database', () => ({}))
vi.mock('@/app/content/views/header', () => ({ default: () => <header>WebChat</header> }))
vi.mock('@/app/content/views/main', async () => {
  const { Markdown } = await import('@/components/markdown')
  return { default: () => <main>{<Markdown>{fixture.markdown}</Markdown>}</main> }
})
vi.mock('@/app/content/views/footer', () => ({
  default: () => (
    <footer>
      <input aria-label="Message draft" />
    </footer>
  )
}))
vi.mock('@/app/content/views/setup', () => ({ default: () => null }))
vi.mock('@/hooks/useResizable', () => ({
  default: ({ initSize }: { initSize: number }) => ({ size: initSize, setRef: fixture.setRef })
}))
vi.mock('@/hooks/useDraggable', () => ({
  default: ({ initX, initY }: { initX: number; initY: number }) => ({ x: initX, y: initY, setRef: fixture.setRef })
}))
vi.mock('@/hooks/useTriggerAway', () => ({ default: () => ({ setRef: fixture.setRef }) }))
vi.mock('date-fns', () => ({ getDay: () => 0 }))
vi.mock('@/assets/images/logo-0.svg', () => ({ default: () => <svg aria-hidden="true" /> }))

const { default: content } = await import('@/app/content')

const currentUi = () => {
  if (!fixture.ui) throw new Error('Shadow UI is not mounted')
  return fixture.ui
}
const previewDialog = () => currentUi().shadow.querySelector<HTMLDialogElement>('dialog[aria-label="Image preview"]')
const previewImage = () => previewDialog()?.querySelector<HTMLImageElement>('img') ?? null
const previewBackdrop = () => currentUi().shadow.querySelector<HTMLButtonElement>('button[aria-hidden="true"]')
const previewScale = () => Number(previewImage()?.style.transform.match(/scale\(([^)]+)\)/)?.[1] ?? 0)

const startContent = async () => {
  const hostile = document.createElement('button')
  hostile.type = 'button'
  hostile.ariaLabel = 'Host page overlay'
  hostile.style.cssText = 'position:fixed;inset:0;z-index:2147483647;background:rgb(255 0 0);border:0;padding:0;'
  hostile.style.viewTransitionName = 'host-owned'
  hostile.addEventListener('click', () => {
    fixture.hostClicks += 1
  })
  document.body.append(hostile)

  if (typeof content.main !== 'function') throw new Error('Content main is unavailable')
  await content.main({ options: {}, onInvalidated: fixture.onInvalidated } as never)
  await vi.waitFor(() => expect(currentUi().shadow.querySelector('#app')).not.toBeNull())
  return hostile
}

beforeEach(async () => {
  await page.viewport(900, 700)
  document.body.replaceChildren()
  fixture.ui = null
  fixture.hostClicks = 0
  fixture.send.mockClear()
  fixture.discard.mockClear()
  fixture.stopInitialization.mockClear()
  fixture.detachClient.mockClear()
  fixture.onInvalidated.mockClear()
  vi.stubGlobal('__NAME__', 'web-chat-browser')
  Object.defineProperty(document, 'startViewTransition', { configurable: true, value: undefined })
})

afterEach(() => {
  fixture.ui?.remove()
  fixture.ui = null
  document.body.replaceChildren()
  window.removeEventListener('beforeunload', fixture.detachClient)
  Reflect.deleteProperty(document, 'startViewTransition')
  vi.unstubAllGlobals()
})

describe('MediaPreview production browser boundary', () => {
  it('uses the real WXT Shadow/App stack above a hostile host while splitting backdrop, shell, and body layers', async () => {
    const hostile = await startContent()
    await page.getByRole('button', { name: 'Preview Large' }).click()
    await vi.waitFor(() => expect(previewImage()?.complete && previewImage()!.naturalWidth > 0).toBe(true))

    const { shadow, shadowHost } = currentUi()
    const dialog = previewDialog()!
    const image = previewImage()!
    const backdrop = previewBackdrop()!
    const panel = shadow.querySelector<HTMLElement>('[data-webchat-panel]')!
    const launcher = shadow.querySelector<HTMLButtonElement>('button[aria-label="Close WebChat"]')!
    const danmaku = shadow.querySelector<HTMLElement>('.pointer-events-none')!

    expect(getComputedStyle(shadowHost).position).toBe('relative')
    expect(Number.parseInt(getComputedStyle(shadowHost).zIndex, 10)).toBe(2147483647)
    expect(document.elementFromPoint(8, 8)).toBe(shadowHost)
    expect(getComputedStyle(backdrop).backgroundColor).toMatch(/0\.18|18%/)

    const backdropLayer = Number.parseInt(getComputedStyle(backdrop).zIndex, 10)
    const dialogLayer = Number.parseInt(getComputedStyle(dialog).zIndex, 10)
    for (const surface of [panel, launcher.parentElement!, danmaku]) {
      const shellLayer = Number.parseInt(getComputedStyle(surface).zIndex, 10)
      expect(backdropLayer).toBeLessThan(shellLayer)
      expect(dialogLayer).toBeGreaterThanOrEqual(shellLayer)
      expect(surface.compareDocumentPosition(dialog) & Node.DOCUMENT_POSITION_FOLLOWING).not.toBe(0)
    }

    const imageRect = image.getBoundingClientRect()
    const panelRect = panel.getBoundingClientRect()
    const overlapLeft = Math.max(imageRect.left, panelRect.left)
    const overlapRight = Math.min(imageRect.right, panelRect.right)
    const overlapTop = Math.max(imageRect.top, panelRect.top)
    const overlapBottom = Math.min(imageRect.bottom, panelRect.bottom)
    expect(overlapRight).toBeGreaterThan(overlapLeft)
    expect(overlapBottom).toBeGreaterThan(overlapTop)
    const shadowAtOverlap = (
      shadow as ShadowRoot & { elementFromPoint: Document['elementFromPoint'] }
    ).elementFromPoint((overlapLeft + overlapRight) / 2, (overlapTop + overlapBottom) / 2)
    expect(shadowAtOverlap).toBe(image)

    await page.elementLocator(backdrop).click({ position: { x: 8, y: 8 } })
    await vi.waitFor(() => expect(previewDialog()).toBeNull())
    expect(fixture.hostClicks).toBe(0)
    expect(hostile.style.viewTransitionName).toBe('host-owned')
  })

  it('owns preview keys inside the isolated Shadow subtree without consuming editable shell input', async () => {
    await startContent()
    const trigger = await page.getByRole('button', { name: 'Preview Wide' }).findElement()
    await page.elementLocator(trigger).click()
    await vi.waitFor(() => expect(currentUi().shadow.activeElement).toBe(previewDialog()))

    await userEvent.keyboard('+')
    await vi.waitFor(() => expect(previewScale()).toBe(1.25))

    const input = currentUi().shadow.querySelector<HTMLInputElement>('input[aria-label="Message draft"]')!
    await page.elementLocator(input).click()
    await userEvent.type(input, '0-')
    expect(input.value).toBe('0-')
    expect(previewScale()).toBe(1.25)

    previewDialog()!.focus()
    await userEvent.keyboard('0')
    await vi.waitFor(() => expect(previewScale()).toBe(1))
    await userEvent.keyboard('{Escape}')
    await vi.waitFor(() => expect(previewDialog()).toBeNull())
    expect(currentUi().shadow.activeElement).toBe(trigger)
  })

  it('never renders an out-of-bounds transform while both viewport axes shrink', async () => {
    await startContent()
    await page.getByRole('button', { name: 'Preview Large' }).click()
    await vi.waitFor(() => expect(previewImage()?.complete && previewImage()!.naturalWidth > 0).toBe(true))
    const image = previewImage()!
    const initial = image.getBoundingClientRect()
    image.dispatchEvent(
      new WheelEvent('wheel', {
        bubbles: true,
        cancelable: true,
        deltaY: -1200,
        clientX: initial.right - 1,
        clientY: initial.bottom - 1
      })
    )
    await vi.waitFor(() => expect(previewScale()).toBe(4))

    const observed: Array<{ left: number; right: number; top: number; bottom: number }> = []
    const observer = new MutationObserver(() => {
      const rect = image.getBoundingClientRect()
      observed.push({ left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom })
    })
    observer.observe(image, { attributes: true, attributeFilter: ['style'] })

    await page.viewport(500, 400)
    await vi.waitFor(() => expect(observed.length).toBeGreaterThan(0))
    await vi.waitFor(() => {
      const rect = image.getBoundingClientRect()
      expect(rect.left).toBeLessThanOrEqual(24.5)
      expect(rect.right).toBeGreaterThanOrEqual(window.innerWidth - 24.5)
      expect(rect.top).toBeLessThanOrEqual(24.5)
      expect(rect.bottom).toBeGreaterThanOrEqual(window.innerHeight - 24.5)
    })
    observer.disconnect()

    for (const rect of observed) {
      expect(rect.left).toBeLessThanOrEqual(24.5)
      expect(rect.right).toBeGreaterThanOrEqual(window.innerWidth - 24.5)
      expect(rect.top).toBeLessThanOrEqual(24.5)
      expect(rect.bottom).toBeGreaterThanOrEqual(window.innerHeight - 24.5)
    }
  })
})
