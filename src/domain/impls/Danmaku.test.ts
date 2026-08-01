import type { ReactElement } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { APP_OPEN_STORAGE_KEY, APP_UNREAD_STORAGE_KEY } from '@/constants/storage'
import { EVENT } from '@/constants/event'

const fixture = vi.hoisted(() => ({
  options: null as null | { plugin: { $createNode: (manager: { node?: Element; data: unknown }) => void } },
  rendered: null as ReactElement<{ onClick: () => Promise<void> }> | null,
  get: vi.fn(),
  set: vi.fn()
}))

vi.mock('danmu', () => ({
  create: vi.fn((options) => {
    fixture.options = options
    return {
      mount: vi.fn(),
      startPlaying: vi.fn(),
      unmount: vi.fn(),
      push: vi.fn(),
      unshift: vi.fn(),
      clear: vi.fn()
    }
  })
}))

vi.mock('react-dom/client', () => ({
  createRoot: () => ({
    render: (element: ReactElement<{ onClick: () => Promise<void> }>) => {
      fixture.rendered = element
    }
  })
}))

vi.mock('./Storage', () => ({
  LocalStorageImpl: { value: { get: fixture.get, set: fixture.set } }
}))

import { Danmaku } from './Danmaku'

const renderMessage = () => {
  new Danmaku()
  fixture.options!.plugin.$createNode({ node: document.createElement('div'), data: {} })
  return fixture.rendered!
}

beforeEach(() => {
  fixture.get.mockReset()
  fixture.set.mockReset()
  fixture.rendered = null
})

describe('Danmaku AppStatus opening', () => {
  it('opens and clears unread through the shared field keys before signaling the current tab', async () => {
    fixture.get.mockResolvedValue(false)
    fixture.set.mockResolvedValue(undefined)
    const onOpen = vi.fn()
    addEventListener(EVENT.APP_OPEN, onOpen, { once: true })

    await renderMessage().props.onClick()

    expect(fixture.get).toHaveBeenCalledWith(APP_OPEN_STORAGE_KEY)
    expect(fixture.set.mock.calls).toEqual(
      expect.arrayContaining([
        [APP_OPEN_STORAGE_KEY, true],
        [APP_UNREAD_STORAGE_KEY, false]
      ])
    )
    expect(fixture.set).toHaveBeenCalledTimes(2)
    expect(onOpen).toHaveBeenCalledOnce()
  })

  it('leaves an already expanded shared status unchanged', async () => {
    fixture.get.mockResolvedValue(true)

    await renderMessage().props.onClick()

    expect(fixture.set).not.toHaveBeenCalled()
  })
})
