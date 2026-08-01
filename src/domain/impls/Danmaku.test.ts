import type { ReactElement } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { EVENT } from '@/constants/event'

const fixture = vi.hoisted(() => ({
  options: null as null | { plugin: { $createNode: (manager: { node?: Element; data: unknown }) => void } },
  rendered: null as ReactElement<{ onClick: () => unknown }> | null
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
    render: (element: ReactElement<{ onClick: () => unknown }>) => {
      fixture.rendered = element
    }
  })
}))

import { Danmaku } from './Danmaku'

const renderMessage = () => {
  new Danmaku()
  fixture.options!.plugin.$createNode({ node: document.createElement('div'), data: {} })
  return fixture.rendered!
}

beforeEach(() => {
  fixture.rendered = null
})

describe('Danmaku AppStatus opening', () => {
  it('emits one synchronous user open intent without owning the AppStatus transition', async () => {
    const onOpen = vi.fn()
    addEventListener(EVENT.APP_OPEN, onOpen, { once: true })

    const result = renderMessage().props.onClick()
    if (result instanceof Promise) await result

    expect(result).toBeUndefined()
    expect(onOpen).toHaveBeenCalledOnce()
  })
})
