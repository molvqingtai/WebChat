import { cdp, page, userEvent } from 'vitest/browser'
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
  viewTransitions: [] as ViewTransition[],
  markdown:
    '![Wide](data:image/svg+xml,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%20width%3D%22120%22%20height%3D%2260%22%3E%3Crect%20width%3D%22120%22%20height%3D%2260%22%20fill%3D%22red%22%2F%3E%3C%2Fsvg%3E)\n\n![Large](data:image/svg+xml,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%20width%3D%221200%22%20height%3D%221200%22%3E%3Crect%20width%3D%221200%22%20height%3D%221200%22%20fill%3D%22green%22%2F%3E%3C%2Fsvg%3E)\n\n![Landscape](data:image/svg+xml,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%20width%3D%221600%22%20height%3D%22800%22%3E%3Crect%20width%3D%221600%22%20height%3D%22800%22%20fill%3D%22blue%22%2F%3E%3C%2Fsvg%3E)\n\n![Portrait](data:image/svg+xml,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%20width%3D%22800%22%20height%3D%221600%22%3E%3Crect%20width%3D%22800%22%20height%3D%221600%22%20fill%3D%22purple%22%2F%3E%3C%2Fsvg%3E)'
}))

const MEDIA_PREVIEW_TRANSITION_NAME_PROPERTY = '--webchat-media-preview-transition-name'
const MEDIA_PREVIEW_TRANSITION_PART = 'webchat-media-preview-transition'

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
    useRemeshEvent: () => undefined,
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
        case 'app-message-author':
          return null
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
      HasUnreadQuery: () => 'app-unread',
      AppButtonAuthorQuery: () => 'app-message-author'
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
    event: { HistorySyncCompletedEvent: 'history-sync-completed' },
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
  whenHostPhase: vi.fn(),
  whenFailure: vi.fn()
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
  const { Markdown } = await import('./markdown')
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
const previewInteractionArea = () => {
  const interaction = previewImage()?.parentElement
  if (!interaction) throw new Error('Media preview interaction area is unavailable')
  return interaction
}
const previewToolbar = () => previewDialog()?.querySelector<HTMLElement>('[role="toolbar"]') ?? null
const previewBackdrop = () => currentUi().shadow.querySelector<HTMLButtonElement>('button[aria-hidden="true"]')
const previewScale = () => Number(previewImage()?.style.transform.match(/scale\(([^)]+)\)/)?.[1] ?? 0)

interface InputPoint {
  x: number
  y: number
}

const browserPoint = ({ x, y }: InputPoint): InputPoint => {
  const frame = window.frameElement as HTMLElement | null
  if (!frame) return { x, y }
  const rect = frame.getBoundingClientRect()
  const scaleX = rect.width / window.innerWidth
  const scaleY = rect.height / window.innerHeight
  return { x: rect.left + x * scaleX, y: rect.top + y * scaleY }
}

const physicalWheel = async (point: InputPoint, deltaY: number) => {
  const target = browserPoint(point)
  await cdp().send('Input.dispatchMouseEvent', { type: 'mouseMoved', ...target })
  await cdp().send('Input.dispatchMouseEvent', { type: 'mouseWheel', ...target, deltaX: 0, deltaY })
}

const physicalMouseDrag = async (start: InputPoint, end: InputPoint) => {
  const from = browserPoint(start)
  const to = browserPoint(end)
  await cdp().send('Input.dispatchMouseEvent', { type: 'mouseMoved', ...from })
  await cdp().send('Input.dispatchMouseEvent', {
    type: 'mousePressed',
    ...from,
    button: 'left',
    buttons: 1,
    clickCount: 1
  })
  await cdp().send('Input.dispatchMouseEvent', { type: 'mouseMoved', ...to, button: 'left', buttons: 1 })
  await cdp().send('Input.dispatchMouseEvent', {
    type: 'mouseReleased',
    ...to,
    button: 'left',
    buttons: 0,
    clickCount: 1
  })
}

const physicalTouch = async (type: 'touchStart' | 'touchMove' | 'touchEnd', points: InputPoint[]) => {
  await cdp().send('Input.dispatchTouchEvent', {
    type,
    touchPoints: points.map((point, index) => ({ ...browserPoint(point), id: index + 1 }))
  })
}

const settleNativeViewTransitions = async () => {
  await Promise.all(fixture.viewTransitions.map((transition) => transition.finished))
}

const activeViewTransitionPseudos = (root: Document | ShadowRoot) =>
  root.getAnimations().flatMap((animation) => {
    const effect = animation.effect as KeyframeEffect | null
    const pseudoElement = effect?.pseudoElement
    return pseudoElement ? [pseudoElement] : []
  })

const recordHostDocumentClick = () => {
  fixture.hostClicks += 1
}

const startContent = async () => {
  const hostile = document.createElement('button')
  hostile.type = 'button'
  hostile.ariaLabel = 'Host page overlay'
  hostile.style.cssText = 'position:fixed;inset:0;z-index:2147483647;background:rgb(255 0 0);border:0;padding:0;'
  hostile.style.viewTransitionName = 'host-owned'
  document.body.append(hostile)
  document.addEventListener('click', recordHostDocumentClick)

  if (typeof content.main !== 'function') throw new Error('Content main is unavailable')
  await content.main({ options: {}, onInvalidated: fixture.onInvalidated } as never)
  await vi.waitFor(() => expect(currentUi().shadow.querySelector('#app')).not.toBeNull())
  return hostile
}

beforeEach(async () => {
  await page.viewport(900, 700)
  document.body.replaceChildren()
  document.body.removeAttribute('style')
  document.documentElement.removeAttribute('style')
  window.scrollTo(0, 0)
  fixture.ui = null
  fixture.hostClicks = 0
  fixture.viewTransitions = []
  fixture.send.mockClear()
  fixture.discard.mockClear()
  fixture.stopInitialization.mockClear()
  fixture.detachClient.mockClear()
  fixture.onInvalidated.mockClear()
  vi.stubGlobal('__NAME__', 'web-chat-browser')
  const nativeStartViewTransition = document.startViewTransition?.bind(document)
  if (nativeStartViewTransition) {
    vi.spyOn(document, 'startViewTransition').mockImplementation((operation) => {
      const transition = nativeStartViewTransition(operation)
      fixture.viewTransitions.push(transition)
      return transition
    })
  }
})

afterEach(() => {
  fixture.ui?.remove()
  fixture.ui = null
  document.body.replaceChildren()
  document.body.removeAttribute('style')
  document.documentElement.removeAttribute('style')
  window.scrollTo(0, 0)
  window.removeEventListener('beforeunload', fixture.detachClient)
  document.removeEventListener('click', recordHostDocumentClick)
  Reflect.deleteProperty(document, 'startViewTransition')
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('MediaPreview production browser boundary', () => {
  it('uses the real WXT Shadow/App stack above a hostile host while splitting backdrop, shell, and body layers', async () => {
    expect(document.startViewTransition).toBeTypeOf('function')
    const hostile = await startContent()
    const trigger = await page.getByRole('button', { name: 'Preview Large' }).findElement()
    const inlineImage = trigger.querySelector<HTMLImageElement>('img')!
    expect(new URL(inlineImage.src).protocol).toBe('blob:')
    await page.elementLocator(trigger).click()
    await vi.waitFor(() => expect(fixture.viewTransitions).toHaveLength(1))
    const openingTransition = fixture.viewTransitions[0]!
    await openingTransition.updateCallbackDone

    const { shadow, shadowHost } = currentUi()
    const dialog = previewDialog()!
    const image = previewImage()!
    const toolbar = previewToolbar()!
    const backdrop = previewBackdrop()!
    const panel = shadow.querySelector<HTMLElement>('[data-webchat-panel]')!
    const launcher = shadow.querySelector<HTMLButtonElement>('button[aria-label="Close WebChat"]')!
    const danmaku = shadow.querySelector<HTMLElement>('.pointer-events-none')!

    const previewTransitionName = image.style.getPropertyValue(MEDIA_PREVIEW_TRANSITION_NAME_PROPERTY)
    expect(previewTransitionName).toMatch(/^webchat-media-preview-/)
    expect(image.src).toBe(inlineImage.src)
    expect(image.getAttribute('part')).toBe(MEDIA_PREVIEW_TRANSITION_PART)
    expect(image.style.viewTransitionName).toBe('')
    expect(getComputedStyle(image).viewTransitionName).toBe(previewTransitionName)
    const transitionStyle = document.head.querySelector<HTMLStyleElement>('[data-webchat-media-preview-transition]')
    expect(transitionStyle?.textContent).toContain(`${shadowHost.localName}::part(${MEDIA_PREVIEW_TRANSITION_PART})`)
    await openingTransition.ready
    const documentPseudos = activeViewTransitionPseudos(document)
    const shadowPseudos = activeViewTransitionPseudos(shadow)
    expect(documentPseudos.some((pseudo) => pseudo.includes('view-transition') && pseudo.includes('root'))).toBe(true)
    expect(
      documentPseudos.some((pseudo) => pseudo.includes(previewTransitionName)),
      JSON.stringify({ previewTransitionName, documentPseudos, shadowPseudos })
    ).toBe(true)
    expect(shadowPseudos.some((pseudo) => pseudo.includes(previewTransitionName))).toBe(false)
    await openingTransition.finished

    expect(getComputedStyle(shadowHost).position).toBe('relative')
    expect(Number.parseInt(getComputedStyle(shadowHost).zIndex, 10)).toBe(2147483647)
    expect(document.elementFromPoint(8, 8)).toBe(shadowHost)
    expect(getComputedStyle(backdrop).backgroundColor).toMatch(/0\.18|18%/)

    const backdropLayer = Number.parseInt(getComputedStyle(backdrop).zIndex, 10)
    const dialogLayer = Number.parseInt(getComputedStyle(dialog).zIndex, 10)
    ;[panel, launcher.parentElement!, danmaku].forEach((surface) => {
      const shellLayer = Number.parseInt(getComputedStyle(surface).zIndex, 10)
      expect(backdropLayer).toBeLessThan(shellLayer)
      expect(dialogLayer).toBeGreaterThanOrEqual(shellLayer)
      expect(surface.compareDocumentPosition(dialog) & Node.DOCUMENT_POSITION_FOLLOWING).not.toBe(0)
    })

    await vi.waitFor(() => expect(image.complete && image.naturalWidth > 0).toBe(true))
    const imageRect = image.getBoundingClientRect()
    const toolbarRect = toolbar.getBoundingClientRect()
    expect(toolbarRect.top).toBeGreaterThanOrEqual(imageRect.bottom + 11)
    expect(toolbarRect.bottom).toBeLessThanOrEqual(window.innerHeight - 23)
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

    fixture.hostClicks = 0
    await page.elementLocator(backdrop).click({ position: { x: 8, y: 8 } })
    await vi.waitFor(() => expect(previewDialog()).toBeNull())
    await settleNativeViewTransitions()
    expect(fixture.hostClicks).toBe(0)
    expect(hostile.style.viewTransitionName).toBe('host-owned')
  })

  it('replaces an open image without old close motion and gives the new image a complete opening', async () => {
    await startContent()
    const firstTrigger = await page.getByRole('button', { name: 'Preview Wide' }).findElement()
    const secondTrigger = await page.getByRole('button', { name: 'Preview Large' }).findElement()
    await page.elementLocator(firstTrigger).click()
    await vi.waitFor(() => expect(previewImage()?.complete && previewImage()!.naturalWidth > 0).toBe(true))
    await settleNativeViewTransitions()
    await page.getByRole('button', { name: 'Zoom in' }).click()
    const dialog = previewDialog()!
    const backdrop = previewBackdrop()!
    const previewBody = previewInteractionArea()
    const toolbar = previewToolbar()!

    const transitionCount = fixture.viewTransitions.length
    await page.elementLocator(secondTrigger).click()
    await vi.waitFor(() => expect(fixture.viewTransitions).toHaveLength(transitionCount + 1))
    const replacementTransition = fixture.viewTransitions.at(-1)!
    await replacementTransition.ready

    expect(previewDialog()).toBe(dialog)
    expect(previewBackdrop()).toBe(backdrop)
    expect(previewInteractionArea()).toBe(previewBody)
    expect(previewToolbar()).toBe(toolbar)
    expect(previewImage()!.alt).toBe('Large')
    expect(previewImage()!.src).toBe(secondTrigger.querySelector('img')!.src)
    expect(previewImage()!.style.transform).toBe('translate3d(0px, 0px, 0px) scale(1)')
    const replacementIdentity = previewImage()!.style.getPropertyValue(MEDIA_PREVIEW_TRANSITION_NAME_PROPERTY)
    expect(activeViewTransitionPseudos(document).some((pseudo) => pseudo.includes(replacementIdentity))).toBe(true)

    await replacementTransition.finished
    await page.getByRole('button', { name: 'Close preview' }).click()
    await vi.waitFor(() => expect(previewDialog()).toBeNull())
    expect(currentUi().shadow.activeElement).toBe(secondTrigger)
  })

  it('clips a zoomed and vertically panned image above the independent toolbar band', async () => {
    await startContent()
    await page.getByRole('button', { name: 'Preview Large' }).click()
    await vi.waitFor(() => expect(previewImage()?.complete && previewImage()!.naturalWidth > 0).toBe(true))
    await settleNativeViewTransitions()

    const image = previewImage()!
    const toolbar = previewToolbar()!
    await page.getByRole('button', { name: 'Zoom in' }).click()
    await vi.waitFor(() => expect(previewScale()).toBe(1.25))
    const beforePan = image.style.transform
    const imageRect = image.getBoundingClientRect()
    const center = { x: imageRect.left + imageRect.width / 2, y: imageRect.top + imageRect.height / 2 }
    await physicalMouseDrag(center, { x: center.x, y: center.y + 160 })
    await vi.waitFor(() => expect(image.style.transform).not.toBe(beforePan))

    const interaction = previewInteractionArea()
    const interactionRect = interaction.getBoundingClientRect()
    const transformedImageRect = image.getBoundingClientRect()
    const toolbarRect = toolbar.getBoundingClientRect()
    const visibleImageBottom = Math.min(transformedImageRect.bottom, interactionRect.bottom)

    expect(visibleImageBottom).toBeLessThanOrEqual(toolbarRect.top - 11)
    expect(getComputedStyle(interaction).overflow).toBe('hidden')
    expect(toolbarRect.bottom).toBeLessThanOrEqual(window.innerHeight - 23)
  })

  it('rotates landscape and portrait previews through 90 and 270 degrees with swapped fit and clamped pan', async () => {
    await startContent()

    const verifyQuarterTurns = async (name: string, rotatedIsPortrait: boolean) => {
      const trigger = await page.getByRole('button', { name: `Preview ${name}` }).findElement()
      await page.elementLocator(trigger).click()
      await vi.waitFor(() => expect(previewImage()?.complete && previewImage()!.naturalWidth > 0).toBe(true))
      await settleNativeViewTransitions()

      const image = previewImage()!
      for (let click = 0; click < 12; click += 1) {
        await page.getByRole('button', { name: 'Zoom in' }).click()
      }
      await vi.waitFor(() => expect(previewScale()).toBe(4))

      const rotate = page.getByRole('button', { name: 'Rotate clockwise' })
      await rotate.click()
      await vi.waitFor(() => expect(image.style.transform).toContain('rotate(90deg)'))
      expect(previewScale()).toBe(4)

      const interactionRect = previewInteractionArea().getBoundingClientRect()
      const assertClamped = () => {
        const rect = image.getBoundingClientRect()
        expect(rect.left).toBeLessThanOrEqual(interactionRect.left + 0.5)
        expect(rect.right).toBeGreaterThanOrEqual(interactionRect.right - 0.5)
        expect(rect.top).toBeLessThanOrEqual(interactionRect.top + 0.5)
        expect(rect.bottom).toBeGreaterThanOrEqual(interactionRect.bottom - 0.5)
      }
      const ninetyDegreeRect = image.getBoundingClientRect()
      if (rotatedIsPortrait) expect(ninetyDegreeRect.width).toBeLessThan(ninetyDegreeRect.height)
      else expect(ninetyDegreeRect.width).toBeGreaterThan(ninetyDegreeRect.height)
      const center = {
        x: interactionRect.left + interactionRect.width / 2,
        y: interactionRect.top + interactionRect.height / 2
      }
      await physicalMouseDrag(center, { x: interactionRect.right + 400, y: interactionRect.bottom + 400 })
      await vi.waitFor(assertClamped)

      await rotate.click()
      await rotate.click()
      await vi.waitFor(() => expect(image.style.transform).toContain('rotate(270deg)'))
      expect(previewScale()).toBe(4)
      const twoSeventyDegreeRect = image.getBoundingClientRect()
      if (rotatedIsPortrait) expect(twoSeventyDegreeRect.width).toBeLessThan(twoSeventyDegreeRect.height)
      else expect(twoSeventyDegreeRect.width).toBeGreaterThan(twoSeventyDegreeRect.height)
      await physicalMouseDrag(center, { x: interactionRect.left - 400, y: interactionRect.top - 400 })
      await vi.waitFor(assertClamped)

      await page.getByRole('button', { name: 'Close preview' }).click()
      await vi.waitFor(() => expect(previewDialog()).toBeNull())
      await settleNativeViewTransitions()
    }

    await verifyQuarterTurns('Landscape', true)
    await verifyQuarterTurns('Portrait', false)
  })

  it('contains composed preview clicks while preserving an outside host control click', async () => {
    const hostile = await startContent()
    const trigger = await page.getByRole('button', { name: 'Preview Large' }).findElement()
    await page.elementLocator(trigger).click()
    await vi.waitFor(() => expect(previewImage()?.complete && previewImage()!.naturalWidth > 0).toBe(true))
    await settleNativeViewTransitions()
    fixture.hostClicks = 0

    await page.elementLocator(previewImage()!).click()
    await page.getByRole('button', { name: 'Zoom in' }).click()
    await page.getByRole('button', { name: 'Zoom out' }).click()
    await page.getByRole('button', { name: 'Zoom in' }).click()
    await page.getByRole('button', { name: 'Rotate clockwise' }).click()
    await page.getByRole('button', { name: 'Close preview' }).click()
    await vi.waitFor(() => expect(previewDialog()).toBeNull())
    await settleNativeViewTransitions()
    expect(fixture.hostClicks).toBe(0)

    await page.elementLocator(trigger).click()
    await vi.waitFor(() => expect(previewImage()).not.toBeNull())
    await settleNativeViewTransitions()
    fixture.hostClicks = 0
    await page.elementLocator(previewBackdrop()!).click({ position: { x: 8, y: 8 } })
    await vi.waitFor(() => expect(previewDialog()).toBeNull())
    await settleNativeViewTransitions()
    expect(fixture.hostClicks).toBe(0)

    hostile.click()
    expect(fixture.hostClicks).toBe(1)
  })

  it('owns preview keys inside the isolated Shadow subtree without consuming editable shell input', async () => {
    await startContent()
    const trigger = await page.getByRole('button', { name: 'Preview Wide' }).findElement()
    await page.elementLocator(trigger).click()
    await vi.waitFor(() => expect(currentUi().shadow.activeElement).toBe(previewDialog()))
    await settleNativeViewTransitions()

    await userEvent.keyboard('+')
    await vi.waitFor(() => expect(previewScale()).toBe(1.25))

    const input = currentUi().shadow.querySelector<HTMLInputElement>('input[aria-label="Message draft"]')!
    await page.elementLocator(input).click()
    await userEvent.type(input, '0-')
    expect(input.value).toBe('0-')
    expect(previewScale()).toBe(1.25)

    await userEvent.keyboard('0')
    expect(input.value).toBe('0-0')
    expect(previewScale()).toBe(1.25)
    await userEvent.keyboard('{Escape}')
    await vi.waitFor(() => expect(previewDialog()).toBeNull())
    expect(currentUi().shadow.activeElement).toBe(trigger)

    await page.elementLocator(trigger).click()
    await settleNativeViewTransitions()
    await userEvent.keyboard('+')
    await vi.waitFor(() => expect(previewScale()).toBe(1.25))
    const launcher = currentUi().shadow.querySelector<HTMLButtonElement>('button[aria-label="Close WebChat"]')!
    await page.elementLocator(launcher).click()
    await userEvent.keyboard('0')
    await vi.waitFor(() => expect(previewScale()).toBe(1))
    await userEvent.keyboard('{Escape}')
    await vi.waitFor(() => expect(previewDialog()).toBeNull())
    expect(currentUi().shadow.activeElement).toBe(trigger)
  })

  it('consumes physical wheel zoom without host scroll while leaving outside-preview scrolling intact', async () => {
    document.body.style.minHeight = '3000px'
    const hostile = await startContent()
    await page.getByRole('button', { name: 'Preview Large' }).click()
    await vi.waitFor(() => expect(previewImage()?.complete && previewImage()!.naturalWidth > 0).toBe(true))
    await settleNativeViewTransitions()
    window.scrollTo(0, 600)
    await vi.waitFor(() => expect(window.scrollY).toBe(600))

    const image = previewImage()!
    const initialScroll = window.scrollY
    await page.elementLocator(image).wheel({ delta: { y: -200 } })
    await vi.waitFor(() => expect(previewScale()).toBe(1.5))
    expect(window.scrollY).toBe(initialScroll)

    await userEvent.keyboard('0')
    await vi.waitFor(() => expect(previewScale()).toBe(1))
    await physicalWheel({ x: 8, y: 8 }, -100)
    await vi.waitFor(() => expect(previewScale()).toBe(1.25))
    expect(window.scrollY).toBe(initialScroll)

    await page.getByRole('button', { name: 'Close preview' }).click()
    await vi.waitFor(() => expect(previewDialog()).toBeNull())
    await settleNativeViewTransitions()
    await page.elementLocator(hostile).wheel({ delta: { y: 200 } })
    await vi.waitFor(() => expect(window.scrollY).toBeGreaterThan(initialScroll))
  })

  it('keeps wheel and pinch zoom below 1x centered, non-pannable, and clamped at 0.25x', async () => {
    await startContent()
    await page.getByRole('button', { name: 'Preview Large' }).click()
    await vi.waitFor(() => expect(previewImage()?.complete && previewImage()!.naturalWidth > 0).toBe(true))
    await settleNativeViewTransitions()

    const image = previewImage()!
    const imageRect = image.getBoundingClientRect()
    const center = { x: imageRect.left + imageRect.width / 2, y: imageRect.top + imageRect.height / 2 }

    await cdp().send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 2 })
    try {
      await physicalTouch('touchStart', [
        { x: center.x - 100, y: center.y },
        { x: center.x + 100, y: center.y }
      ])
      await physicalTouch('touchMove', [
        { x: center.x - 50, y: center.y },
        { x: center.x + 50, y: center.y }
      ])
      await vi.waitFor(() => expect(previewScale()).toBe(0.5))
      expect(image.style.transform).toBe('translate3d(0px, 0px, 0px) scale(0.5)')
      await physicalTouch('touchEnd', [])
    } finally {
      await cdp().send('Emulation.setTouchEmulationEnabled', { enabled: false })
    }

    await physicalWheel(center, 100)
    await vi.waitFor(() => expect(previewScale()).toBe(0.25))
    expect(image.style.transform).toBe('translate3d(0px, 0px, 0px) scale(0.25)')

    const zoomOut = (await page.getByRole('button', { name: 'Zoom out' }).findElement()) as HTMLButtonElement
    expect(zoomOut.disabled).toBe(true)
    const lowerBoundary = image.style.transform
    await physicalWheel(center, 400)
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))
    expect(image.style.transform).toBe(lowerBoundary)

    await physicalMouseDrag(center, { x: center.x + 200, y: center.y + 160 })
    expect(image.style.transform).toBe(lowerBoundary)
  })

  it('drives keyboard, touch pinch and pan, and captured mouse drag through the real Shadow boundary', async () => {
    await startContent()
    const trigger = await page.getByRole('button', { name: 'Preview Large' }).findElement()
    trigger.focus()
    await userEvent.keyboard('{Enter}')
    await vi.waitFor(() => expect(previewImage()?.complete && previewImage()!.naturalWidth > 0).toBe(true))
    await settleNativeViewTransitions()
    await page.getByRole('button', { name: 'Close preview' }).click()
    await vi.waitFor(() => expect(previewDialog()).toBeNull())
    await settleNativeViewTransitions()

    trigger.focus()
    await userEvent.keyboard(' ')
    await vi.waitFor(() => expect(previewImage()?.complete && previewImage()!.naturalWidth > 0).toBe(true))
    await settleNativeViewTransitions()
    await page.getByRole('button', { name: 'Close preview' }).click()
    await vi.waitFor(() => expect(previewDialog()).toBeNull())
    await settleNativeViewTransitions()

    await cdp().send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 2 })
    const triggerRect = trigger.getBoundingClientRect()
    const triggerCenter = { x: triggerRect.left + triggerRect.width / 2, y: triggerRect.top + triggerRect.height / 2 }
    await physicalTouch('touchStart', [triggerCenter])
    await physicalTouch('touchEnd', [])
    await vi.waitFor(() => expect(previewImage()?.complete && previewImage()!.naturalWidth > 0).toBe(true))
    await settleNativeViewTransitions()

    const image = previewImage()!
    const imageRect = image.getBoundingClientRect()
    const center = { x: imageRect.left + imageRect.width / 2, y: imageRect.top + imageRect.height / 2 }
    await physicalTouch('touchStart', [
      { x: center.x - 50, y: center.y },
      { x: center.x + 50, y: center.y }
    ])
    await physicalTouch('touchMove', [
      { x: center.x - 150, y: center.y },
      { x: center.x + 150, y: center.y }
    ])
    await vi.waitFor(() => expect(previewScale()).toBeGreaterThan(1))
    await physicalTouch('touchEnd', [])

    const beforeTouchPan = image.style.transform
    await physicalTouch('touchStart', [center])
    await physicalTouch('touchMove', [{ x: center.x + 250, y: center.y + 200 }])
    await physicalTouch('touchEnd', [])
    await vi.waitFor(() => expect(image.style.transform).not.toBe(beforeTouchPan))

    const beforeMouseDrag = image.style.transform
    await physicalMouseDrag(center, { x: 4, y: 4 })
    await vi.waitFor(() => expect(image.style.transform).not.toBe(beforeMouseDrag))
    const bounded = image.getBoundingClientRect()
    const interactionRect = previewInteractionArea().getBoundingClientRect()
    expect(bounded.left).toBeLessThanOrEqual(interactionRect.left + 0.5)
    expect(bounded.right).toBeGreaterThanOrEqual(interactionRect.right - 0.5)
    expect(bounded.top).toBeLessThanOrEqual(interactionRect.top + 0.5)
    expect(bounded.bottom).toBeGreaterThanOrEqual(interactionRect.bottom - 0.5)
    expect(previewDialog()).not.toBeNull()
    await cdp().send('Emulation.setTouchEmulationEnabled', { enabled: false })
  })

  it('never renders an out-of-bounds transform while both viewport axes shrink', async () => {
    await startContent()
    await page.getByRole('button', { name: 'Preview Large' }).click()
    await vi.waitFor(() => expect(previewImage()?.complete && previewImage()!.naturalWidth > 0).toBe(true))
    await settleNativeViewTransitions()
    const image = previewImage()!
    const initial = image.getBoundingClientRect()
    await physicalWheel({ x: initial.right - 1, y: initial.bottom - 1 }, -1200)
    await vi.waitFor(() => expect(previewScale()).toBe(4))

    const observed: Array<{
      left: number
      right: number
      top: number
      bottom: number
      viewportWidth: number
      viewportHeight: number
      interactionLeft: number
      interactionRight: number
      interactionTop: number
      interactionBottom: number
    }> = []
    let pendingSampleFrame: number | null
    const sampleFrame = () => {
      const rect = image.getBoundingClientRect()
      const interactionRect = previewInteractionArea().getBoundingClientRect()
      observed.push({
        left: rect.left,
        right: rect.right,
        top: rect.top,
        bottom: rect.bottom,
        viewportWidth: window.innerWidth,
        viewportHeight: window.innerHeight,
        interactionLeft: interactionRect.left,
        interactionRight: interactionRect.right,
        interactionTop: interactionRect.top,
        interactionBottom: interactionRect.bottom
      })
      pendingSampleFrame = requestAnimationFrame(sampleFrame)
    }
    pendingSampleFrame = requestAnimationFrame(sampleFrame)

    try {
      await page.viewport(500, 400)
      await new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => requestAnimationFrame(() => resolve())))
      )
      await vi.waitFor(() => {
        const rect = image.getBoundingClientRect()
        const interactionRect = previewInteractionArea().getBoundingClientRect()
        expect(rect.left).toBeLessThanOrEqual(interactionRect.left + 0.5)
        expect(rect.right).toBeGreaterThanOrEqual(interactionRect.right - 0.5)
        expect(rect.top).toBeLessThanOrEqual(interactionRect.top + 0.5)
        expect(rect.bottom).toBeGreaterThanOrEqual(interactionRect.bottom - 0.5)
      })

      const resizedFrames = observed.filter(
        ({ viewportWidth, viewportHeight }) => viewportWidth === 500 && viewportHeight === 400
      )
      expect(resizedFrames.length).toBeGreaterThan(0)
      resizedFrames.forEach((rect) => {
        expect(rect.left).toBeLessThanOrEqual(rect.interactionLeft + 0.5)
        expect(rect.right).toBeGreaterThanOrEqual(rect.interactionRight - 0.5)
        expect(rect.top).toBeLessThanOrEqual(rect.interactionTop + 0.5)
        expect(rect.bottom).toBeGreaterThanOrEqual(rect.interactionBottom - 0.5)
      })
    } finally {
      cancelAnimationFrame(pendingSampleFrame)
      pendingSampleFrame = null
    }
    const settledFrameCount = observed.length
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))
    expect(observed).toHaveLength(settledFrameCount)
  })
})
