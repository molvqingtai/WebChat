import { cleanup, render } from 'vitest-browser-react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { type ReactElement } from 'react'
import '@/assets/styles/tailwind.css'
import { MESSAGE_RECORD_TYPE, NOTICE_TYPE, type SystemNoticeMessage } from '@/domain/Message'
import MessageList from './message-list'
import NoticeGroup from './notice-group'

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
const harness = (historyReady: boolean, children: ReactElement[]) => (
  <div style={{ display: 'grid', gridTemplateRows: '1fr', height: '240px', width: '360px' }}>
    <MessageList>{historyReady ? children : null}</MessageList>
  </div>
)
const viewport = () => document.querySelector<HTMLElement>('[data-slot="scroll-area-viewport"]')!
const list = () => document.querySelector<HTMLElement>('[data-testid="virtuoso-item-list"]')
const atBottom = (element: HTMLElement) => element.scrollTop + element.clientHeight >= element.scrollHeight - 1
const followAction = (label: string) => document.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`)
type ScrollCall = ScrollToOptions | readonly [number, number | undefined]
const isScrollOptions = (call: ScrollCall): call is ScrollToOptions => !Array.isArray(call)
const suppressResizeObserverLoop = (event: ErrorEvent) => {
  if (event.message === 'ResizeObserver loop completed with undelivered notifications.') event.preventDefault()
}

beforeEach(() => window.addEventListener('error', suppressResizeObserverLoop))
afterEach(() => {
  window.removeEventListener('error', suppressResizeObserverLoop)
  cleanup()
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

    await vi.waitFor(() => expect(atBottom(scrollParent)).toBe(true))
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
    const action = followAction('1 条新消息')
    expect(action).not.toBeNull()

    action!.click()
    await vi.waitFor(() => {
      expect(atBottom(scrollParent)).toBe(true)
      expect(followAction('回到底部')).toBeNull()
    })
  })

  it('keeps click recovery current when N2 arrives before the first smooth travel reaches the bottom', async () => {
    const initialRows = history(24)
    const view = await render(harness(true, initialRows))
    const scrollParent = viewport()

    await vi.waitFor(() => {
      expect(document.querySelector('[data-testid="message-23"]')).not.toBeNull()
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
    scrollParent.dispatchEvent(new Event('scroll'))
    await vi.waitFor(() => expect(followAction('回到底部')).not.toBeNull())

    const rowsWithN1 = [...initialRows, row('n1', 72)]
    await view.rerender(harness(true, rowsWithN1))
    await vi.waitFor(() => expect(followAction('1 条新消息')).not.toBeNull())

    followAction('1 条新消息')!.click()
    await view.rerender(harness(true, [...rowsWithN1, row('n2', 104)]))

    await vi.waitFor(
      () => {
        expect(document.querySelector('[data-testid="message-n2"]')).not.toBeNull()
        expect(atBottom(scrollParent)).toBe(true)
        expect(followAction('回到底部')).toBeNull()
        expect(followAction('1 条新消息')).toBeNull()
      },
      { timeout: 5_000 }
    )
  })

  it('cancels click recovery when a manual departure occurs before N2', async () => {
    const initialRows = history(24)
    const view = await render(harness(true, initialRows))
    const scrollParent = viewport()

    await vi.waitFor(() => {
      expect(document.querySelector('[data-testid="message-23"]')).not.toBeNull()
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
    scrollParent.dispatchEvent(new Event('scroll'))
    await vi.waitFor(() => expect(followAction('回到底部')).not.toBeNull())

    const rowsWithN1 = [...initialRows, row('n1', 72)]
    await view.rerender(harness(true, rowsWithN1))
    await vi.waitFor(() => expect(followAction('1 条新消息')).not.toBeNull())

    followAction('1 条新消息')!.click()
    scrollParent.dispatchEvent(new WheelEvent('wheel', { bubbles: true, deltaY: -120 }))
    scrollParent.scrollTo({ top: 0, behavior: 'auto' })
    scrollParent.dispatchEvent(new Event('scroll'))
    await view.rerender(harness(true, [...rowsWithN1, row('n2', 104)]))

    await vi.waitFor(() => {
      expect(scrollParent.scrollTop).toBe(0)
      expect(followAction('1 条新消息')).not.toBeNull()
    })
  })

  it('shows the zero-count return action while browsing older messages', async () => {
    const initialRows = history(24)
    await render(harness(true, initialRows))
    const scrollParent = viewport()

    await vi.waitFor(() => expect(atBottom(scrollParent)).toBe(true))
    scrollParent.dispatchEvent(new WheelEvent('wheel', { bubbles: true, deltaY: -120 }))
    scrollParent.scrollTo({ top: 0, behavior: 'auto' })
    scrollParent.dispatchEvent(new Event('scroll'))

    await vi.waitFor(() => expect(followAction('回到底部')).not.toBeNull())
    followAction('回到底部')!.click()

    await vi.waitFor(() => {
      expect(atBottom(scrollParent)).toBe(true)
      expect(followAction('回到底部')).toBeNull()
    })
  })

  it('preserves the reading anchor and never counts a stable-key history prepend as a new tail message', async () => {
    const currentRows = history(36)
    const view = await render(harness(true, currentRows))
    const scrollParent = viewport()

    await vi.waitFor(() => expect(atBottom(scrollParent)).toBe(true))
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

    await vi.waitFor(() => expect(followAction('回到底部')).not.toBeNull())
    expect(followAction('1 条新消息')).toBeNull()
  })

  it('rebases the reading anchor and counts the tail in one canonical head-plus-tail snapshot', async () => {
    const currentRows = history(36)
    const view = await render(harness(true, currentRows))
    const scrollParent = viewport()

    await vi.waitFor(() => expect(atBottom(scrollParent)).toBe(true))
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
    await vi.waitFor(() => expect(followAction('1 条新消息')).not.toBeNull())
    expect(followAction('回到底部')).toBeNull()
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
