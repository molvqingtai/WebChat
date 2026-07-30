import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

type ClickListener = () => unknown

type ActionNamespace = {
  onClicked?: {
    addListener?: (listener: ClickListener) => void
  }
}

const fixture = vi.hoisted(() => ({
  browser: { runtime: { id: 'background-test' } } as Record<string, unknown> & {
    runtime: { id: string }
  },
  openOptionsPage: vi.fn(async () => {}),
  provideNotification: vi.fn(),
  provideCoordinator: vi.fn(),
  registerChangelogLifecycle: vi.fn()
}))

vi.mock('#imports', () => ({
  browser: fixture.browser,
  defineBackground: <Definition>(definition: Definition) => definition
}))

vi.mock('@/service/adapter/runtime', () => ({ ProvideAdapter: class ProvideAdapter {} }))
vi.mock('comctx', () => ({ defineProxy: () => [fixture.provideCoordinator] }))
vi.mock('@/service/AppAction', () => ({ AppAction: class AppAction {} }))
vi.mock('@/service/Contract', () => ({
  defineAppActionProxy: () => [() => ({ openOptionsPage: fixture.openOptionsPage })],
  defineNotificationProxy: () => [fixture.provideNotification]
}))
vi.mock('@/service/Notification', () => ({ Notification: class Notification {} }))
vi.mock('@/runtime/Contract', () => ({ COORDINATOR_NAMESPACE: 'test-coordinator' }))
vi.mock('@/runtime/Background', () => ({
  ensureHost: vi.fn(),
  registerPage: vi.fn(),
  relayOffscreenMessages: vi.fn(),
  restore: vi.fn(),
  watchTabs: vi.fn(),
  watchOffscreenClosed: vi.fn()
}))
vi.mock('@/changelog/Browser', () => ({ registerChangelogLifecycle: fixture.registerChangelogLifecycle }))

import background from '@/app/background'

const createAction = () => {
  const listeners = new Set<ClickListener>()
  const addListener = vi.fn((listener: ClickListener) => listeners.add(listener))

  return {
    namespace: { onClicked: { addListener } },
    addListener,
    listeners,
    click: async () => {
      await Promise.all([...listeners].map((listener) => listener()))
    }
  }
}

const usePlatform = (firefox: boolean, selectedNamespace: ActionNamespace | undefined) => {
  vi.stubEnv('FIREFOX', firefox ? 'true' : undefined)

  const selectedKey = firefox ? 'browserAction' : 'action'
  const unusedKey = firefox ? 'action' : 'browserAction'
  const unusedRead = vi.fn(() => {
    throw new Error(`browser.${unusedKey} must not be read`)
  })

  Object.defineProperty(fixture.browser, selectedKey, {
    configurable: true,
    value: selectedNamespace
  })
  Object.defineProperty(fixture.browser, unusedKey, {
    configurable: true,
    get: unusedRead
  })

  return { selectedKey, unusedRead }
}

const startBackground = () => {
  if (typeof background.main !== 'function') throw new Error('Background main is unavailable')
  return background.main()
}

beforeEach(() => {
  vi.clearAllMocks()
})

afterEach(() => {
  vi.unstubAllEnvs()
})

describe.each([
  { platform: 'Chrome MV3', firefox: false },
  { platform: 'Firefox MV2', firefox: true }
])('$platform action registration', ({ firefox }) => {
  it('selects only the declared namespace and opens options exactly once', async () => {
    const action = createAction()
    const { unusedRead } = usePlatform(firefox, action.namespace)

    expect(startBackground).not.toThrow()
    expect(fixture.registerChangelogLifecycle.mock.calls[0]?.[0]).toBe(fixture.browser)
    expect(unusedRead).not.toHaveBeenCalled()
    expect(action.addListener).toHaveBeenCalledTimes(1)
    expect(action.listeners.size).toBe(1)

    await action.click()

    expect(fixture.openOptionsPage).toHaveBeenCalledTimes(1)
  })

  it('fails explicitly when the selected namespace is missing', () => {
    const { selectedKey, unusedRead } = usePlatform(firefox, undefined)

    expect(startBackground).toThrowError(`browser.${selectedKey} is unavailable`)
    expect(unusedRead).not.toHaveBeenCalled()
  })

  it.each([
    { boundary: 'onClicked', namespace: {} },
    { boundary: 'onClicked.addListener', namespace: { onClicked: {} } }
  ])('fails explicitly when the selected $boundary boundary is missing', ({ namespace }) => {
    const { selectedKey, unusedRead } = usePlatform(firefox, namespace)

    expect(startBackground).toThrowError(`browser.${selectedKey}.onClicked.addListener is unavailable`)
    expect(unusedRead).not.toHaveBeenCalled()
  })
})

it('registers one current listener across repeated Firefox background generations', async () => {
  const generations = [createAction(), createAction(), createAction()]

  for (const [index, generation] of generations.entries()) {
    const { unusedRead } = usePlatform(true, generation.namespace)

    expect(startBackground).not.toThrow()
    expect(unusedRead).not.toHaveBeenCalled()
    expect(generation.addListener).toHaveBeenCalledTimes(1)
    expect(generation.listeners.size).toBe(1)

    await generation.click()
    expect(fixture.openOptionsPage).toHaveBeenCalledTimes(index + 1)
  }

  expect(generations.map(({ listeners }) => listeners.size)).toEqual([1, 1, 1])
})
