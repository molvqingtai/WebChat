import { cleanup, render } from 'vitest-browser-react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { type ReactElement } from 'react'
import '@/assets/styles/tailwind.css'
import { MESSAGE_RECORD_TYPE, NOTICE_TYPE, type SystemNoticeMessage } from '@/domain/Message'
import MessageList from './message-list'
import NoticeGroup from './notice-group'

const localSendEventControl = vi.hoisted(() => ({ listener: null as null | (() => void) }))

vi.mock('remesh-react', () => ({
  useRemeshDomain: () => ({ event: { SendTextMessageEvent: 'send-text-message' } }),
  useRemeshEvent: (_event: unknown, listener: () => void) => {
    localSendEventControl.listener = listener
  }
}))

const frame = () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))
const row = (id: string, height: number): ReactElement => (
  <div data-testid={`message-${id}`} key={id} style={{ boxSizing: 'border-box', height, padding: '8px' }}>
    Message {id}
  </div>
)
const history = (count: number) =>
  Array.from({ length: count }, (_, index) => row(String(index), index % 4 === 0 ? 156 : 56 + (index % 3) * 24))
const noticeUser = { id: 'notice-user', name: 'Notice user', avatar: '' }
const notice = (id: string, timestamp: number): SystemNoticeMessage => ({
  type: MESSAGE_RECORD_TYPE.SYSTEM_NOTICE,
  id,
  hlc: { timestamp, counter: 0 },
  receivedAt: timestamp,
  user: noticeUser,
  body: id,
  noticeType: NOTICE_TYPE.INFO
})
const groupedRow = (
  <NoticeGroup
    key="notice-group"
    notices={[notice('Grouped older notice', 1), notice('Grouped latest notice', 2)]}
    last
  />
)
const harness = (historyReady: boolean, children: ReactElement[], width = 360, height = 240) => (
  <div style={{ display: 'grid', gridTemplateRows: '1fr', height: `${height}px`, width: `${width}px` }}>
    <MessageList>{historyReady ? children : null}</MessageList>
  </div>
)
const viewport = () => document.querySelector<HTMLElement>('[data-slot="scroll-area-viewport"]')!
const list = () => document.querySelector<HTMLElement>('[data-testid="virtuoso-item-list"]')
const atBottom = (element: HTMLElement) => element.scrollTop + element.clientHeight >= element.scrollHeight - 1
const settledAtBottom = (element: HTMLElement, tailTestId: string) =>
  document.querySelector(`[data-testid="${tailTestId}"]`) !== null &&
  element.scrollHeight > element.clientHeight &&
  element.scrollTop > 0 &&
  atBottom(element)
const followAction = (label: string) =>
  document.querySelector<HTMLButtonElement>(`button[aria-label="${label}"][data-state="open"]`)
const followActionElement = () => document.querySelector<HTMLButtonElement>('[data-testid="follow-latest-action"]')
type ScrollCall = ScrollToOptions | readonly [number, number | undefined]
const isScrollOptions = (call: ScrollCall): call is ScrollToOptions => !Array.isArray(call)
const suppressResizeObserverLoop = (event: ErrorEvent) => {
  if (event.message === 'ResizeObserver loop completed with undelivered notifications.') event.preventDefault()
}

beforeEach(() => {
  window.addEventListener('error', suppressResizeObserverLoop)
})
afterEach(async () => {
  window.removeEventListener('error', suppressResizeObserverLoop)
  await cleanup()
  localSendEventControl.listener = null
})

describe('MessageList initial settlement', () => {
  it('first presents overflowing variable-height history at the end without a smooth settlement scroll', async () => {
    const rows = [...history(23), groupedRow]
    const view = await render(harness(false, rows))

    expect(list()).toBeNull()

    const scrollParent = viewport()
    const calls: ScrollCall[] = []
    const originalScrollTo = scrollParent.scrollTo
    const originalScrollBy = scrollParent.scrollBy
    scrollParent.scrollTo = ((...args: [ScrollToOptions] | [number, number]) => {
      const first = args[0]
      calls.push(typeof first === 'object' ? { ...first } : ([first, args[1]] as const))
      if (typeof first === 'object') {
        return Reflect.apply(originalScrollTo, scrollParent, [{ ...first, behavior: 'auto' }])
      }
      return Reflect.apply(originalScrollTo, scrollParent, args)
    }) as typeof scrollParent.scrollTo
    scrollParent.scrollBy = ((...args: [ScrollToOptions] | [number, number]) => {
      const first = args[0]
      calls.push(typeof first === 'object' ? { ...first } : ([first, args[1]] as const))
      if (typeof first === 'object') {
        return Reflect.apply(originalScrollBy, scrollParent, [{ ...first, behavior: 'auto' }])
      }
      return Reflect.apply(originalScrollBy, scrollParent, args)
    }) as typeof scrollParent.scrollBy

    const visibleOffsets: number[] = []
    let sampling = true
    const sample = () => {
      const currentList = list()
      if (currentList && getComputedStyle(currentList).visibility !== 'hidden') {
        visibleOffsets.push(scrollParent.scrollTop)
      }
      if (sampling) requestAnimationFrame(sample)
    }
    requestAnimationFrame(sample)

    await view.rerender(harness(true, rows))
    await vi.waitFor(() => {
      expect(document.body.textContent).toContain('Grouped latest notice')
      expect(document.body.textContent).not.toContain('Grouped older notice')
      expect(atBottom(scrollParent)).toBe(true)
      expect(visibleOffsets.length).toBeGreaterThan(0)
    })
    sampling = false

    expect(visibleOffsets.every((offset) => offset + scrollParent.clientHeight >= scrollParent.scrollHeight - 1)).toBe(
      true
    )
    expect(calls.some((call) => isScrollOptions(call) && call.behavior === 'smooth')).toBe(false)
  })

  it('follows an append when the user is already at the bottom', async () => {
    const initialRows = history(24)
    const view = await render(harness(true, initialRows))
    const scrollParent = viewport()

    await vi.waitFor(() => expect(settledAtBottom(scrollParent, 'message-23')).toBe(true))
    scrollParent.dispatchEvent(new Event('scroll'))
    await frame()
    await frame()
    const bottomBeforeAppend = scrollParent.scrollTop

    await view.rerender(harness(true, [...initialRows, row('bottom-append', 72)]))
    await vi.waitFor(() => {
      expect(document.querySelector('[data-testid="message-bottom-append"]')).not.toBeNull()
      expect(scrollParent.scrollTop).toBeGreaterThan(bottomBeforeAppend)
      expect(atBottom(scrollParent)).toBe(true)
    })
  })

  it('preserves a non-bottom reading position when a message arrives', async () => {
    const initialRows = history(24)
    const view = await render(harness(true, initialRows))
    const scrollParent = viewport()

    await vi.waitFor(() => {
      expect(document.querySelector('[data-testid="message-23"]')).not.toBeNull()
      expect(getComputedStyle(list()!).visibility).not.toBe('hidden')
      expect(atBottom(scrollParent)).toBe(true)
    })
    await frame()
    await frame()

    scrollParent.dispatchEvent(new WheelEvent('wheel', { bubbles: true, deltaY: -120 }))
    scrollParent.scrollTo({ top: 0, behavior: 'auto' })
    scrollParent.dispatchEvent(new Event('scroll'))
    await vi.waitFor(() => {
      expect(scrollParent.scrollTop).toBe(0)
      expect(document.querySelector('[data-testid="message-0"]')).not.toBeNull()
    })
    await frame()
    await frame()
    const scrollHeightBeforeAppend = scrollParent.scrollHeight

    await view.rerender(harness(true, [...initialRows, row('history-append', 88)]))
    await vi.waitFor(() => expect(scrollParent.scrollHeight).toBeGreaterThan(scrollHeightBeforeAppend))
    await frame()
    await frame()

    expect(scrollParent.scrollTop).toBe(0)
    const action = followAction('1 new message')
    expect(action).not.toBeNull()

    action!.click()
    await vi.waitFor(() => {
      expect(atBottom(scrollParent)).toBe(true)
      expect(followAction('Scroll to latest messages')).toBeNull()
    })
  })

  it('centers the ArrowDown action across desktop and narrow list widths and retains its fade exit node', async () => {
    const initialRows = history(24)
    const view = await render(harness(true, initialRows, 360))
    const scrollParent = viewport()

    await vi.waitFor(() => expect(settledAtBottom(scrollParent, 'message-23')).toBe(true))
    scrollParent.dispatchEvent(new WheelEvent('wheel', { bubbles: true, deltaY: -120 }))
    scrollParent.scrollTo({ top: 0, behavior: 'auto' })
    scrollParent.dispatchEvent(new Event('scroll'))

    const assertCentered = () => {
      const action = followAction('Scroll to latest messages')
      expect(action).not.toBeNull()
      expect(action!.textContent).toBe('')
      const viewportBounds = scrollParent.getBoundingClientRect()
      const actionBounds = action!.getBoundingClientRect()
      expect(
        Math.abs(actionBounds.left + actionBounds.width / 2 - (viewportBounds.left + viewportBounds.width / 2))
      ).toBeLessThan(1)
    }

    await vi.waitFor(assertCentered)
    await view.rerender(harness(true, initialRows, 220))
    await vi.waitFor(assertCentered)

    const action = followActionElement()
    expect(action).not.toBeNull()
    expect(action!.className).toContain('transition-[opacity,grid-template-columns,gap,padding]')

    scrollParent.scrollTo({ top: scrollParent.scrollHeight - scrollParent.clientHeight, behavior: 'auto' })
    scrollParent.dispatchEvent(new Event('scroll'))
    await vi.waitFor(() => expect(followAction('Scroll to latest messages')).toBeNull())
    expect(followActionElement()).toBe(action)
    expect(action!.dataset.state).toBe('closed')
  })

  it('shows only beyond a half-screen of remaining distance and hides at or below it', async () => {
    const initialRows = history(32)
    await render(harness(true, initialRows))
    const scrollParent = viewport()

    await vi.waitFor(() => expect(settledAtBottom(scrollParent, 'message-31')).toBe(true))
    scrollParent.dispatchEvent(new WheelEvent('wheel', { bubbles: true, deltaY: -120 }))

    const maxScrollTop = scrollParent.scrollHeight - scrollParent.clientHeight
    const beyondHalfDistance = Math.ceil(scrollParent.clientHeight * 0.51)
    scrollParent.scrollTo({ top: maxScrollTop - beyondHalfDistance, behavior: 'auto' })
    scrollParent.dispatchEvent(new Event('scroll'))
    await vi.waitFor(() => expect(followAction('Scroll to latest messages')).not.toBeNull())

    const withinHalfDistance = Math.floor(scrollParent.clientHeight * 0.49)
    scrollParent.scrollTo({ top: maxScrollTop - withinHalfDistance, behavior: 'auto' })
    scrollParent.dispatchEvent(new Event('scroll'))
    await vi.waitFor(() => expect(followAction('Scroll to latest messages')).toBeNull())
    expect(followActionElement()?.dataset.state).toBe('closed')
  })

  it('forces the latest local projection to the bottom after a successful local send', async () => {
    const initialRows = history(24)
    const view = await render(harness(true, initialRows))
    const scrollParent = viewport()

    await vi.waitFor(() => expect(settledAtBottom(scrollParent, 'message-23')).toBe(true))
    scrollParent.dispatchEvent(new WheelEvent('wheel', { bubbles: true, deltaY: -120 }))
    scrollParent.scrollTo({ top: 0, behavior: 'auto' })
    scrollParent.dispatchEvent(new Event('scroll'))
    await vi.waitFor(() => expect(followAction('Scroll to latest messages')).not.toBeNull())

    await view.rerender(harness(true, [...initialRows, row('local-send', 88)]))
    localSendEventControl.listener?.()
    await vi.waitFor(() => {
      expect(document.querySelector('[data-testid="message-local-send"]')).not.toBeNull()
      expect(atBottom(scrollParent)).toBe(true)
      expect(followAction('Scroll to latest messages')).toBeNull()
    })
  })

  it('animates a local projection from the previous bottom to its new physical bottom', async () => {
    const initialRows = history(24)
    const view = await render(harness(true, initialRows))
    const scrollParent = viewport()

    await vi.waitFor(() => expect(settledAtBottom(scrollParent, 'message-23')).toBe(true))
    const offsets = [scrollParent.scrollTop]
    let sampling = true
    const sample = () => {
      offsets.push(scrollParent.scrollTop)
      if (sampling) requestAnimationFrame(sample)
    }
    requestAnimationFrame(sample)

    localSendEventControl.listener?.()
    await view.rerender(harness(true, [...initialRows, row('local-send-bottom', 88)]))
    await vi.waitFor(() => {
      expect(document.querySelector('[data-testid="message-local-send-bottom"]')).not.toBeNull()
      expect(atBottom(scrollParent)).toBe(true)
    })
    sampling = false

    const finalOffset = scrollParent.scrollTop
    const initialOffset = offsets[0]
    expect(offsets.some((offset) => offset > initialOffset && offset < finalOffset)).toBe(true)
  })

  it('animates a local projection from more than half a viewport away from the bottom', async () => {
    const initialRows = history(24)
    const view = await render(harness(true, initialRows))
    const scrollParent = viewport()

    await vi.waitFor(() => expect(settledAtBottom(scrollParent, 'message-23')).toBe(true))
    scrollParent.dispatchEvent(new WheelEvent('wheel', { bubbles: true, deltaY: -120 }))
    const maxScrollTop = scrollParent.scrollHeight - scrollParent.clientHeight
    scrollParent.scrollTo({ top: maxScrollTop - Math.ceil(scrollParent.clientHeight * 0.51), behavior: 'auto' })
    scrollParent.dispatchEvent(new Event('scroll'))
    await vi.waitFor(() => expect(followAction('Scroll to latest messages')).not.toBeNull())

    const offsets = [scrollParent.scrollTop]
    let sampling = true
    const sample = () => {
      offsets.push(scrollParent.scrollTop)
      if (sampling) requestAnimationFrame(sample)
    }
    requestAnimationFrame(sample)

    localSendEventControl.listener?.()
    await view.rerender(harness(true, [...initialRows, row('local-send-far', 88)]))
    await vi.waitFor(() => {
      expect(document.querySelector('[data-testid="message-local-send-far"]')).not.toBeNull()
      expect(atBottom(scrollParent)).toBe(true)
    })
    sampling = false

    const finalOffset = scrollParent.scrollTop
    const initialOffset = offsets[0]
    expect(offsets.some((offset) => offset > initialOffset && offset < finalOffset)).toBe(true)
  })

  it('keeps a second local projection smooth while the first local follow is in flight', async () => {
    const initialRows = history(24)
    const firstLocal = row('local-send-first', 720)
    const view = await render(harness(true, initialRows))
    const scrollParent = viewport()

    await vi.waitFor(() => expect(settledAtBottom(scrollParent, 'message-23')).toBe(true))
    const initialOffset = scrollParent.scrollTop
    localSendEventControl.listener?.()
    await view.rerender(harness(true, [...initialRows, firstLocal]))
    await vi.waitFor(() => {
      expect(document.querySelector('[data-testid="message-local-send-first"]')).not.toBeNull()
      expect(scrollParent.scrollTop).toBeGreaterThan(initialOffset)
      expect(atBottom(scrollParent)).toBe(false)
    })

    const secondStart = scrollParent.scrollTop
    const offsets: number[] = []
    let sampling = true
    const sample = () => {
      if (document.querySelector('[data-testid="message-local-send-second"]')) offsets.push(scrollParent.scrollTop)
      if (sampling) requestAnimationFrame(sample)
    }
    requestAnimationFrame(sample)

    localSendEventControl.listener?.()
    await view.rerender(harness(true, [...initialRows, firstLocal, row('local-send-second', 88)]))
    await vi.waitFor(() => {
      expect(document.querySelector('[data-testid="message-local-send-second"]')).not.toBeNull()
      expect(atBottom(scrollParent)).toBe(true)
    })
    sampling = false

    const finalOffset = scrollParent.scrollTop
    expect(offsets.some((offset) => offset > secondStart && offset < finalOffset)).toBe(true)
  })

  it('keeps click recovery current when N2 arrives before the first smooth travel reaches the bottom', async () => {
    const initialRows = history(24)
    const view = await render(harness(true, initialRows))
    const scrollParent = viewport()

    await vi.waitFor(() => {
      expect(settledAtBottom(scrollParent, 'message-23')).toBe(true)
    })
    await frame()
    await frame()
    scrollParent.dispatchEvent(new WheelEvent('wheel', { bubbles: true, deltaY: -120 }))
    scrollParent.scrollTo({ top: 0, behavior: 'auto' })
    scrollParent.dispatchEvent(new Event('scroll'))
    await vi.waitFor(() => {
      expect(scrollParent.scrollTop).toBe(0)
      expect(document.querySelector('[data-testid="message-0"]')).not.toBeNull()
    })
    scrollParent.dispatchEvent(new Event('scroll'))
    await vi.waitFor(() => expect(followAction('Scroll to latest messages')).not.toBeNull())

    const rowsWithN1 = [...initialRows, row('n1', 72)]
    await view.rerender(harness(true, rowsWithN1))
    await vi.waitFor(() => expect(followAction('1 new message')).not.toBeNull())

    followAction('1 new message')!.click()
    await view.rerender(harness(true, [...rowsWithN1, row('n2', 104)]))

    await vi.waitFor(
      () => {
        expect(document.querySelector('[data-testid="message-n2"]')).not.toBeNull()
        expect(atBottom(scrollParent)).toBe(true)
        expect(followAction('Scroll to latest messages')).toBeNull()
        expect(followAction('1 new message')).toBeNull()
      },
      { timeout: 5_000 }
    )
  })

  it('cancels click recovery when a manual departure occurs before N2', async () => {
    const initialRows = history(24)
    const view = await render(harness(true, initialRows))
    const scrollParent = viewport()

    await vi.waitFor(() => {
      expect(settledAtBottom(scrollParent, 'message-23')).toBe(true)
    })
    await frame()
    await frame()
    scrollParent.dispatchEvent(new WheelEvent('wheel', { bubbles: true, deltaY: -120 }))
    scrollParent.scrollTo({ top: 0, behavior: 'auto' })
    scrollParent.dispatchEvent(new Event('scroll'))
    await vi.waitFor(() => {
      expect(scrollParent.scrollTop).toBe(0)
      expect(document.querySelector('[data-testid="message-0"]')).not.toBeNull()
    })
    scrollParent.dispatchEvent(new Event('scroll'))
    await vi.waitFor(() => expect(followAction('Scroll to latest messages')).not.toBeNull())

    const rowsWithN1 = [...initialRows, row('n1', 72)]
    await view.rerender(harness(true, rowsWithN1))
    await vi.waitFor(() => expect(followAction('1 new message')).not.toBeNull())

    followAction('1 new message')!.click()
    scrollParent.dispatchEvent(new WheelEvent('wheel', { bubbles: true, deltaY: -120 }))
    scrollParent.scrollTo({ top: 0, behavior: 'auto' })
    scrollParent.dispatchEvent(new Event('scroll'))
    await view.rerender(harness(true, [...rowsWithN1, row('n2', 104)]))

    await vi.waitFor(() => {
      expect(scrollParent.scrollTop).toBe(0)
      expect(followAction('1 new message')).not.toBeNull()
    })
  })

  it('shows the zero-count return action while browsing older messages', async () => {
    const initialRows = history(24)
    await render(harness(true, initialRows))
    const scrollParent = viewport()

    await vi.waitFor(() => expect(settledAtBottom(scrollParent, 'message-23')).toBe(true))
    scrollParent.dispatchEvent(new WheelEvent('wheel', { bubbles: true, deltaY: -120 }))
    scrollParent.scrollTo({ top: 0, behavior: 'auto' })
    scrollParent.dispatchEvent(new Event('scroll'))

    await vi.waitFor(() => expect(followAction('Scroll to latest messages')).not.toBeNull())
    followAction('Scroll to latest messages')!.click()

    await vi.waitFor(() => {
      expect(atBottom(scrollParent)).toBe(true)
      expect(followAction('Scroll to latest messages')).toBeNull()
    })
  })

  it('preserves the reading anchor and never counts a stable-key history prepend as a new tail message', async () => {
    const currentRows = history(36)
    const view = await render(harness(true, currentRows))
    const scrollParent = viewport()

    await vi.waitFor(() => expect(settledAtBottom(scrollParent, 'message-35')).toBe(true))
    await vi.waitFor(() => expect(scrollParent.scrollHeight).toBeGreaterThan(scrollParent.clientHeight))
    await vi.waitFor(() => {
      expect(document.querySelector('[data-testid="message-35"]')).not.toBeNull()
      expect(getComputedStyle(list()!).visibility).not.toBe('hidden')
    })
    const manualScrollTop = scrollParent.scrollHeight - scrollParent.clientHeight - 160
    expect(manualScrollTop).toBeGreaterThan(0)
    scrollParent.dispatchEvent(new WheelEvent('wheel', { bubbles: true, deltaY: -120 }))
    scrollParent.scrollTo({ top: manualScrollTop, behavior: 'auto' })
    scrollParent.dispatchEvent(new Event('scroll'))

    const viewportBounds = scrollParent.getBoundingClientRect()
    const anchor = Array.from(document.querySelectorAll<HTMLElement>('[data-testid^="message-"]')).find((row) => {
      const bounds = row.getBoundingClientRect()
      return bounds.top >= viewportBounds.top && bounds.bottom <= viewportBounds.bottom
    })
    expect(scrollParent.scrollTop).toBe(manualScrollTop)
    expect(anchor).toBeDefined()
    const anchorTestId = anchor!.dataset.testid!
    const anchorOffset = anchor!.getBoundingClientRect().top - scrollParent.getBoundingClientRect().top
    const scrollHeightBeforePrepend = scrollParent.scrollHeight
    await view.rerender(harness(true, [row('history-head-1', 88), row('history-head-2', 120), ...currentRows]))
    const readAnchorPosition = () => {
      const currentAnchor = document.querySelector<HTMLElement>(`[data-testid="${anchorTestId}"]`)
      expect(currentAnchor).not.toBeNull()
      return {
        offset: currentAnchor!.getBoundingClientRect().top - scrollParent.getBoundingClientRect().top,
        scrollHeight: scrollParent.scrollHeight,
        scrollTop: scrollParent.scrollTop
      }
    }
    await vi.waitFor(() => {
      const position = readAnchorPosition()

      expect(position.scrollHeight).toBeGreaterThan(scrollHeightBeforePrepend)
      expect(Math.abs(position.offset - anchorOffset)).toBeLessThan(2)
    })

    await vi.waitFor(() => expect(followAction('Scroll to latest messages')).not.toBeNull())
    expect(followAction('1 new message')).toBeNull()
  })

  it('rebases the reading anchor and counts the tail in one canonical head-plus-tail snapshot', async () => {
    const currentRows = history(36)
    const view = await render(harness(true, currentRows))
    const scrollParent = viewport()

    await vi.waitFor(() => expect(settledAtBottom(scrollParent, 'message-35')).toBe(true))
    await vi.waitFor(() => expect(scrollParent.scrollHeight).toBeGreaterThan(scrollParent.clientHeight))
    await vi.waitFor(() => {
      expect(document.querySelector('[data-testid="message-35"]')).not.toBeNull()
      expect(getComputedStyle(list()!).visibility).not.toBe('hidden')
    })
    const manualScrollTop = scrollParent.scrollHeight - scrollParent.clientHeight - 160
    expect(manualScrollTop).toBeGreaterThan(0)
    scrollParent.dispatchEvent(new WheelEvent('wheel', { bubbles: true, deltaY: -120 }))
    scrollParent.scrollTo({ top: manualScrollTop, behavior: 'auto' })
    scrollParent.dispatchEvent(new Event('scroll'))

    const viewportBounds = scrollParent.getBoundingClientRect()
    const anchor = Array.from(document.querySelectorAll<HTMLElement>('[data-testid^="message-"]')).find((row) => {
      const bounds = row.getBoundingClientRect()
      return bounds.top >= viewportBounds.top && bounds.bottom <= viewportBounds.bottom
    })
    expect(scrollParent.scrollTop).toBe(manualScrollTop)
    expect(anchor).toBeDefined()
    const anchorTestId = anchor!.dataset.testid!
    const anchorOffset = anchor!.getBoundingClientRect().top - scrollParent.getBoundingClientRect().top

    await view.rerender(
      harness(true, [row('history-head-1', 88), row('history-head-2', 120), ...currentRows, row('new-tail', 104)])
    )

    await vi.waitFor(() => {
      const currentAnchor = document.querySelector<HTMLElement>(`[data-testid="${anchorTestId}"]`)
      expect(currentAnchor).not.toBeNull()
      expect(
        Math.abs(currentAnchor!.getBoundingClientRect().top - scrollParent.getBoundingClientRect().top - anchorOffset)
      ).toBeLessThan(2)
    })
    await vi.waitFor(() => expect(followAction('1 new message')).not.toBeNull())
    expect(followAction('Scroll to latest messages')).toBeNull()
  })

  it('first presents a non-empty short history at its natural position without a settlement scroll', async () => {
    const rows = [row('short-first', 48), row('short-latest', 64)]
    const view = await render(harness(false, rows))

    expect(list()).toBeNull()

    const scrollParent = viewport()
    const calls: ScrollCall[] = []
    const originalScrollTo = scrollParent.scrollTo
    const originalScrollBy = scrollParent.scrollBy
    scrollParent.scrollTo = ((...args: [ScrollToOptions] | [number, number]) => {
      const first = args[0]
      calls.push(typeof first === 'object' ? { ...first } : ([first, args[1]] as const))
      if (typeof first === 'object') {
        return Reflect.apply(originalScrollTo, scrollParent, [{ ...first, behavior: 'auto' }])
      }
      return Reflect.apply(originalScrollTo, scrollParent, args)
    }) as typeof scrollParent.scrollTo
    scrollParent.scrollBy = ((...args: [ScrollToOptions] | [number, number]) => {
      const first = args[0]
      calls.push(typeof first === 'object' ? { ...first } : ([first, args[1]] as const))
      if (typeof first === 'object') {
        return Reflect.apply(originalScrollBy, scrollParent, [{ ...first, behavior: 'auto' }])
      }
      return Reflect.apply(originalScrollBy, scrollParent, args)
    }) as typeof scrollParent.scrollBy

    const visibleOffsets: number[] = []
    let sampling = true
    const sample = () => {
      const currentList = list()
      if (currentList && getComputedStyle(currentList).visibility !== 'hidden') {
        visibleOffsets.push(scrollParent.scrollTop)
      }
      if (sampling) requestAnimationFrame(sample)
    }
    requestAnimationFrame(sample)

    await view.rerender(harness(true, rows))
    await vi.waitFor(() => {
      const first = document.querySelector<HTMLElement>('[data-testid="message-short-first"]')
      const latest = document.querySelector<HTMLElement>('[data-testid="message-short-latest"]')
      const viewportBounds = viewport().getBoundingClientRect()
      expect(first).not.toBeNull()
      expect(latest).not.toBeNull()
      expect(Math.abs(first!.getBoundingClientRect().top - viewportBounds.top)).toBeLessThan(1)
      expect(latest!.getBoundingClientRect().bottom).toBeLessThanOrEqual(viewportBounds.bottom)
      expect(visibleOffsets.length).toBeGreaterThan(0)
    })
    sampling = false

    expect(visibleOffsets.every((offset) => offset === 0)).toBe(true)
    expect(calls).toHaveLength(0)
  })

  it('mounts loaded empty history once and accepts its first append without replacement', async () => {
    const view = await render(harness(true, []))
    await vi.waitFor(() => expect(list()).not.toBeNull())
    const mountedList = list()

    await view.rerender(harness(true, [row('first', 48)]))
    await vi.waitFor(() => expect(document.querySelector('[data-testid="message-first"]')).not.toBeNull())

    expect(list()).toBe(mountedList)
    expect(atBottom(viewport())).toBe(true)
  })
})
