import type { ReactElement } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const fixture = vi.hoisted(() => ({
  options: null as null | { plugin: { $createNode: (manager: { node?: Element; data: unknown }) => void } },
  rendered: null as ReactElement<{ onClick: () => unknown }> | null,
  lifecycle: [] as string[]
}))

vi.mock('danmu', () => ({
  create: vi.fn((options) => {
    fixture.options = options
    return {
      mount: vi.fn(),
      startPlaying: vi.fn(),
      unmount: vi.fn(() => fixture.lifecycle.push('unmount')),
      push: vi.fn(),
      unshift: vi.fn(),
      clear: vi.fn(() => fixture.lifecycle.push('clear'))
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

const renderMessage = (onOpen: () => void) => {
  const danmaku = new Danmaku()
  danmaku.mount(document.createElement('div'), onOpen)
  fixture.options!.plugin.$createNode({ node: document.createElement('div'), data: {} })
  return fixture.rendered!
}

beforeEach(() => {
  fixture.rendered = null
  fixture.lifecycle = []
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('Danmaku AppStatus opening', () => {
  it('routes one synchronous click through its private mount callback', () => {
    const onOpen = vi.fn()
    const dispatchEvent = vi.spyOn(window, 'dispatchEvent')

    const result = renderMessage(onOpen).props.onClick()

    expect(result).toBeUndefined()
    expect(onOpen).toHaveBeenCalledOnce()
    expect(dispatchEvent).not.toHaveBeenCalled()
  })

  it('clears rendered and pending items before detaching its container', () => {
    const danmaku = new Danmaku()
    danmaku.mount(document.createElement('div'), () => {})

    danmaku.unmount()

    expect(fixture.lifecycle).toEqual(['clear', 'unmount'])
  })
})
