import { createElement, useEffect, type ReactElement, type Ref } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { act, cleanup, render } from '@testing-library/react'
import type { VirtuosoHandle, VirtuosoProps } from 'react-virtuoso'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { MESSAGE_RECORD_TYPE, NOTICE_TYPE, type DisplayMessage, type SystemNoticeMessage } from '@/domain/Message'
import MessageList from './message-list'
import NoticeGroup from './notice-group'
import { groupAdjacentNotices, messageRowKey, type GroupedMessage } from './notice-grouping'
import NoticeItem from './notice-item'

interface VirtuosoCall {
  alignToBottom?: boolean
  atBottomStateChange?: VirtuosoProps<ReactElement, unknown>['atBottomStateChange']
  customScrollParent?: HTMLElement
  data: readonly ReactElement[]
  followOutput?: VirtuosoProps<ReactElement, unknown>['followOutput']
  initialTopMostItemIndex?: VirtuosoProps<ReactElement, unknown>['initialTopMostItemIndex']
  isScrolling?: VirtuosoProps<ReactElement, unknown>['isScrolling']
  keys: (string | number | bigint)[]
  totalListHeightChanged?: VirtuosoProps<ReactElement, unknown>['totalListHeightChanged']
}

const virtuosoCalls = vi.hoisted(() => [] as VirtuosoCall[])
const virtuosoLifecycle = vi.hoisted(() => ({ mounts: 0, unmounts: 0 }))
const virtuosoRenderControl = vi.hoisted(() => ({ beforeParentLayout: null as (() => void) | null }))
const virtuosoHandle = vi.hoisted(() => ({
  autoscrollToBottom: vi.fn(),
  getState: vi.fn(),
  scrollBy: vi.fn(),
  scrollIntoView: vi.fn(),
  scrollTo: vi.fn(),
  scrollToIndex: vi.fn()
}))
const scrollAreaRefControl = vi.hoisted(() => ({ manual: false, ref: null as Ref<HTMLDivElement> | null }))

vi.mock('@/components/ui/scroll-area', async () => {
  const React = await import('react')
  return {
    ScrollArea: ({ children, ref }: { children?: ReactElement; ref?: React.Ref<HTMLDivElement> }) => {
      scrollAreaRefControl.ref = ref ?? null
      const setViewportRef = (node: HTMLDivElement | null) => {
        if (node && !Object.getOwnPropertyDescriptor(node, 'clientHeight')) {
          Object.defineProperties(node, {
            clientHeight: { configurable: true, value: 100 },
            scrollHeight: { configurable: true, value: 1_000 },
            scrollTop: { configurable: true, value: 0, writable: true }
          })
        }
        if (typeof ref === 'function') ref(node)
      }
      return React.createElement(
        'div',
        { 'data-slot': 'scroll-area', 'data-testid': 'scroll-area' },
        React.createElement(
          'div',
          { 'data-slot': 'scroll-area-viewport', ref: scrollAreaRefControl.manual ? undefined : setViewportRef },
          children
        ),
        React.createElement('div', { 'data-slot': 'scroll-area-scrollbar', 'data-testid': 'scrollbar' })
      )
    }
  }
})

vi.mock('react-virtuoso', async () => {
  const React = await import('react')
  return {
    Virtuoso: React.forwardRef<VirtuosoHandle, VirtuosoProps<ReactElement, unknown>>((props, ref) => {
      const {
        alignToBottom,
        atBottomStateChange,
        customScrollParent,
        data = [],
        followOutput,
        initialTopMostItemIndex,
        isScrolling,
        totalListHeightChanged,
        computeItemKey,
        itemContent
      } = props
      if (!computeItemKey || !itemContent) throw new TypeError('Virtuoso list callbacks are required')
      const keys = data.map((item, index) => computeItemKey(index, item, undefined))
      virtuosoCalls.push({
        alignToBottom,
        atBottomStateChange,
        customScrollParent,
        data,
        followOutput,
        initialTopMostItemIndex,
        isScrolling,
        totalListHeightChanged,
        keys
      })
      React.useImperativeHandle(ref, () => virtuosoHandle)
      React.useLayoutEffect(() => {
        virtuosoRenderControl.beforeParentLayout?.()
      })
      useEffect(() => {
        virtuosoLifecycle.mounts += 1
        return () => {
          virtuosoLifecycle.unmounts += 1
        }
      }, [])
      return React.createElement(
        'div',
        { 'data-testid': 'virtuoso' },
        data.map((item, index) =>
          React.createElement('div', { 'data-index': index, key: keys[index] }, itemContent(index, item, undefined))
        )
      )
    })
  }
})

const user = { id: 'user', name: 'User', avatar: '' }
const notice = (id: string, timestamp: number): SystemNoticeMessage => ({
  type: MESSAGE_RECORD_TYPE.SYSTEM_NOTICE,
  id,
  hlc: { timestamp, counter: 0 },
  receivedAt: timestamp,
  user,
  body: id,
  noticeType: NOTICE_TYPE.INFO
})
const text = (id: string, timestamp: number): DisplayMessage => ({
  type: 'text',
  id,
  hlc: { timestamp, counter: 0 },
  userId: user.id,
  body: id,
  mentions: [],
  receivedAt: timestamp,
  author: user,
  reactions: { likes: [], hates: [] }
})

const row = (message: GroupedMessage<DisplayMessage>, index: number, length: number): ReactElement => {
  const key = messageRowKey(message)
  if (message.type === 'notice-group') {
    return createElement(NoticeGroup, {
      key,
      notices: message.notices,
      first: index === 0,
      last: index === length - 1
    })
  }
  if (message.type === MESSAGE_RECORD_TYPE.SYSTEM_NOTICE) {
    return createElement(NoticeItem, { key, data: message })
  }
  return createElement('div', { key }, message.body)
}

const renderRows = (messages: readonly DisplayMessage[]) => {
  const grouped = groupAdjacentNotices(messages)
  render(
    createElement(
      MessageList,
      null,
      grouped.map((message, index) => row(message, index, grouped.length))
    )
  )
  return virtuosoCalls.at(-1)!.keys
}

const testRows = (...ids: string[]) => ids.map((id) => createElement('div', { key: id }, id))
const latestVirtuosoCall = () => {
  const call = virtuosoCalls.at(-1)
  if (!call) throw new TypeError('Virtuoso has not rendered')
  return call
}
const reportBottom = (atBottom: boolean) => {
  const call = latestVirtuosoCall()
  const scrollParent = call.customScrollParent
  if (scrollParent) {
    if (atBottom) {
      scrollParent.scrollTop = Math.max(0, scrollParent.scrollHeight - scrollParent.clientHeight)
    } else if (scrollParent.scrollTop + scrollParent.clientHeight >= scrollParent.scrollHeight - 1) {
      scrollParent.scrollTop = 0
    }
  }
  act(() => call.atBottomStateChange?.(atBottom))
}
const reportStaleBottom = (atBottom: boolean) => {
  act(() => latestVirtuosoCall().atBottomStateChange?.(atBottom))
}
const reportScrolling = (isScrolling: boolean) => {
  act(() => latestVirtuosoCall().isScrolling?.(isScrolling))
}
const reportTotalListHeightChanged = () => {
  act(() => latestVirtuosoCall().totalListHeightChanged?.(1_000))
}
const beginManualScroll = (view: ReturnType<typeof render>) => {
  act(() => view.getByTestId('scroll-area').dispatchEvent(new Event('wheel', { bubbles: true })))
  reportScrolling(true)
}
const setBounds = (element: HTMLElement, top: number, bottom: number) =>
  vi.spyOn(element, 'getBoundingClientRect').mockReturnValue({
    bottom,
    height: bottom - top,
    left: 0,
    right: 0,
    toJSON: () => ({}),
    top,
    width: 0,
    x: 0,
    y: top
  })

const setScrollMetrics = (element: HTMLElement, clientHeight: number, scrollHeight: number, scrollTop: number) => {
  Object.defineProperties(element, {
    clientHeight: { configurable: true, value: clientHeight },
    scrollHeight: { configurable: true, value: scrollHeight },
    scrollTop: { configurable: true, value: scrollTop, writable: true }
  })
}

beforeEach(() => {
  virtuosoCalls.length = 0
  virtuosoLifecycle.mounts = 0
  virtuosoRenderControl.beforeParentLayout = null
  virtuosoLifecycle.unmounts = 0
  vi.clearAllMocks()
  scrollAreaRefControl.manual = false
  scrollAreaRefControl.ref = null
})

afterEach(cleanup)

describe('MessageList Virtuoso integration', () => {
  it('waits for non-null content and the real viewport before the first Virtuoso render', () => {
    const message = text('initial', 1)
    const view = render(createElement(MessageList, null, null))

    expect(virtuosoCalls).toHaveLength(0)
    expect(view.getByTestId('scroll-area')).not.toBeNull()

    view.rerender(createElement(MessageList, null, [row(message, 0, 1)]))

    expect(virtuosoCalls).toHaveLength(1)
    expect(virtuosoCalls[0]?.customScrollParent).toBeInstanceOf(HTMLElement)
    expect(virtuosoCalls[0]?.data).toHaveLength(1)
    expect(virtuosoCalls[0]?.initialTopMostItemIndex).toEqual({ index: 'LAST', align: 'end' })
    expect(virtuosoCalls[0]?.alignToBottom).toBeUndefined()
    expect(virtuosoLifecycle.mounts).toBe(1)
  })

  it('keeps one mounted list for empty history and later record updates', () => {
    const view = render(createElement(MessageList, null, []))
    const mountedList = view.getByTestId('virtuoso')

    expect(virtuosoLifecycle.mounts).toBe(1)
    expect(virtuosoCalls.at(-1)?.data).toHaveLength(0)

    const message = text('later', 1)
    view.rerender(createElement(MessageList, null, [row(message, 0, 1)]))

    expect(view.getByTestId('virtuoso')).toBe(mountedList)
    expect(virtuosoLifecycle).toEqual({ mounts: 1, unmounts: 0 })
    expect(virtuosoCalls.at(-1)?.data).toHaveLength(1)
  })

  it('waits for a viewport and remounts only when that viewport resource is replaced', () => {
    scrollAreaRefControl.manual = true
    const message = text('initial', 1)
    const view = render(createElement(MessageList, null, [row(message, 0, 1)]))

    expect(virtuosoCalls).toHaveLength(0)
    expect(view.queryByTestId('virtuoso')).toBeNull()
    expect(typeof scrollAreaRefControl.ref).toBe('function')

    const setViewport = scrollAreaRefControl.ref as (node: HTMLDivElement | null) => void
    const firstViewport = document.createElement('div')
    act(() => setViewport(firstViewport))

    expect(view.getByTestId('virtuoso')).not.toBeNull()
    expect(virtuosoCalls.at(-1)?.customScrollParent).toBe(firstViewport)
    expect(virtuosoLifecycle).toEqual({ mounts: 1, unmounts: 0 })

    act(() => setViewport(null))

    expect(view.queryByTestId('virtuoso')).toBeNull()
    expect(virtuosoLifecycle).toEqual({ mounts: 1, unmounts: 1 })

    const replacementViewport = document.createElement('div')
    act(() => setViewport(replacementViewport))

    expect(view.getByTestId('virtuoso')).not.toBeNull()
    expect(virtuosoCalls.at(-1)?.customScrollParent).toBe(replacementViewport)
    expect(virtuosoLifecycle).toEqual({ mounts: 2, unmounts: 1 })
  })

  it('makes the same tail-follow decision for received, sent, and synchronized child appends', () => {
    let rows = testRows('initial')
    const view = render(createElement(MessageList, null, rows))
    const scrollParent = latestVirtuosoCall().customScrollParent!

    for (const source of ['received', 'sent', 'sync']) {
      reportBottom(true)
      rows = [...rows, ...testRows(source)]
      view.rerender(createElement(MessageList, null, rows))

      const followOutput = latestVirtuosoCall().followOutput
      expect(typeof followOutput).toBe('function')
      expect((followOutput as (isAtBottom: boolean) => false | 'smooth')(true)).toBe('smooth')

      scrollParent.scrollTop = 0
      expect((followOutput as (isAtBottom: boolean) => false | 'smooth')(false)).toBe('smooth')
    }
  })

  it('does not follow a stable-key history prepend', () => {
    const rows = testRows('current-1', 'current-2')
    const view = render(createElement(MessageList, null, rows))

    view.rerender(createElement(MessageList, null, [...testRows('history-1', 'history-2'), ...rows]))

    const followOutput = latestVirtuosoCall().followOutput
    expect(followOutput).toBe(false)
    expect(virtuosoHandle.autoscrollToBottom).not.toHaveBeenCalled()
  })

  it('shows the ArrowDown-only zero-count action and follows when activated', () => {
    const view = render(createElement(MessageList, null, testRows('current')))
    reportBottom(false)

    const button = view.getByRole('button', { name: 'Scroll to latest messages' })
    expect(button.textContent).toBe('')
    expect(button.querySelector('svg.lucide-arrow-down')).not.toBeNull()
    expect(button.className).toContain('grid-cols-[auto_0fr]')
    expect(button.className).toContain('left-1/2')
    expect(button.className).toContain('-translate-x-1/2')

    act(() => button.click())

    expect(virtuosoHandle.scrollToIndex).toHaveBeenCalledWith({ index: 'LAST', align: 'end', behavior: 'smooth' })
    reportBottom(true)
    expect(view.queryByRole('button', { name: 'Scroll to latest messages' })).toBeNull()
  })

  it('pauses manual browsing, counts tail appends, and restores follow when the count action is activated', () => {
    const initialRows = testRows('current')
    const view = render(createElement(MessageList, null, initialRows))
    reportBottom(true)
    beginManualScroll(view)
    reportBottom(false)

    view.rerender(createElement(MessageList, null, [...initialRows, ...testRows('new-message')]))

    const followOutput = latestVirtuosoCall().followOutput
    expect(typeof followOutput).toBe('function')
    expect((followOutput as (isAtBottom: boolean) => false | 'smooth')(true)).toBe(false)

    const button = view.getByRole('button', { name: '1 new message' })
    expect(button.textContent).toContain('1 new message')
    expect(button.className).toContain('grid-cols-[auto_1fr]')
    expect(button.className).toContain('transition-[opacity,grid-template-columns,gap,padding]')
    act(() => button.click())

    expect(virtuosoHandle.scrollToIndex).toHaveBeenCalledWith({ index: 'LAST', align: 'end', behavior: 'smooth' })
    expect(view.getByRole('button', { name: 'Scroll to latest messages' })).not.toBeNull()
    expect((latestVirtuosoCall().followOutput as (isAtBottom: boolean) => false | 'smooth')(true)).toBe(false)
  })

  it('keeps click recovery current when N2 appends before it reaches the bottom', () => {
    const initialRows = testRows('current')
    const view = render(createElement(MessageList, null, initialRows))
    reportBottom(true)
    beginManualScroll(view)
    reportBottom(false)

    const rowsWithN1 = [...initialRows, ...testRows('n1')]
    view.rerender(createElement(MessageList, null, rowsWithN1))
    act(() => view.getByRole('button', { name: '1 new message' }).click())
    vi.clearAllMocks()

    view.rerender(createElement(MessageList, null, [...rowsWithN1, ...testRows('n2')]))

    expect(virtuosoHandle.scrollToIndex).not.toHaveBeenCalled()
    expect((latestVirtuosoCall().followOutput as (isAtBottom: boolean) => false | 'smooth')(false)).toBe('smooth')
    expect(view.queryByRole('button', { name: '1 new message' })).toBeNull()
    expect(view.getByRole('button', { name: 'Scroll to latest messages' })).not.toBeNull()
  })

  it('cancels click recovery when a manual departure occurs before N2', () => {
    const initialRows = testRows('current')
    const view = render(createElement(MessageList, null, initialRows))
    reportBottom(true)
    beginManualScroll(view)
    reportBottom(false)

    const rowsWithN1 = [...initialRows, ...testRows('n1')]
    view.rerender(createElement(MessageList, null, rowsWithN1))
    act(() => view.getByRole('button', { name: '1 new message' }).click())
    vi.clearAllMocks()

    beginManualScroll(view)
    reportBottom(false)
    view.rerender(createElement(MessageList, null, [...rowsWithN1, ...testRows('n2')]))

    expect(virtuosoHandle.scrollToIndex).not.toHaveBeenCalled()
    expect((latestVirtuosoCall().followOutput as (isAtBottom: boolean) => false | 'smooth')(false)).toBe(false)
    expect(view.getByRole('button', { name: '1 new message' })).not.toBeNull()
  })

  it('counts N1 after a native manual departure before any Virtuoso scrolling callback', () => {
    const initialRows = testRows('current')
    const view = render(createElement(MessageList, null, initialRows))
    const scrollParent = latestVirtuosoCall().customScrollParent!
    reportBottom(true)

    setScrollMetrics(scrollParent, 100, 1_000, 0)
    act(() => {
      view.getByTestId('scroll-area').dispatchEvent(new Event('wheel', { bubbles: true }))
      scrollParent.dispatchEvent(new Event('scroll'))
    })

    view.rerender(createElement(MessageList, null, [...initialRows, ...testRows('n1')]))

    expect(view.getByRole('button', { name: '1 new message' })).not.toBeNull()
  })

  it('keeps N1 pending when a native departure intent arrives before Virtuoso reports it', () => {
    const initialRows = testRows('current')
    const view = render(createElement(MessageList, null, initialRows))
    reportBottom(true)

    act(() => view.getByTestId('scroll-area').dispatchEvent(new Event('wheel', { bubbles: true })))
    view.rerender(createElement(MessageList, null, [...initialRows, ...testRows('n1')]))

    expect(view.getByTestId('follow-latest-action').getAttribute('aria-label')).toBe('1 new message')
    expect((latestVirtuosoCall().followOutput as (isAtBottom: boolean) => false | 'smooth')(true)).toBe(false)
  })

  it('caps the pending tail count at 99+ in the follow action label', () => {
    const initialRows = testRows('current')
    const view = render(createElement(MessageList, null, initialRows))
    reportBottom(true)
    beginManualScroll(view)
    reportBottom(false)

    view.rerender(
      createElement(MessageList, null, [
        ...initialRows,
        ...Array.from({ length: 100 }, (_, index) => createElement('div', { key: `new-${index}` }, index))
      ])
    )

    expect(view.getByRole('button', { name: '99+ new messages' })).not.toBeNull()
    expect(view.queryByRole('button', { name: 'Scroll to latest messages' })).toBeNull()
  })

  it('keeps the action mounted through its fade exit while removing it from interaction', () => {
    const view = render(createElement(MessageList, null, testRows('current')))
    reportBottom(false)

    const action = view.getByTestId('follow-latest-action')
    expect(action.dataset.state).toBe('open')
    expect(action.className).toContain('opacity-100')

    reportBottom(true)

    expect(view.getByTestId('follow-latest-action')).toBe(action)
    expect(action.dataset.state).toBe('closed')
    expect(action.className).toContain('opacity-0')
    expect(action.getAttribute('aria-hidden')).toBe('true')
    expect((action as HTMLButtonElement).disabled).toBe(true)
  })

  it('keeps a physical off-bottom viewport through a stale at-bottom callback and counts the next tail', () => {
    const initialRows = testRows('current')
    const view = render(createElement(MessageList, null, initialRows))
    const scrollParent = latestVirtuosoCall().customScrollParent!
    reportBottom(true)

    setScrollMetrics(scrollParent, 100, 1_000, 0)
    reportStaleBottom(true)

    expect(view.getByRole('button', { name: 'Scroll to latest messages' })).not.toBeNull()

    view.rerender(createElement(MessageList, null, [...initialRows, ...testRows('new-message')]))

    expect(view.getByRole('button', { name: '1 new message' })).not.toBeNull()
  })

  it('uses the physical bottom snapshot for a tail append without an at-bottom callback', () => {
    const initialRows = testRows('current')
    const view = render(createElement(MessageList, null, initialRows))
    const scrollParent = latestVirtuosoCall().customScrollParent!
    reportBottom(true)

    setScrollMetrics(scrollParent, 100, 1_000, 0)
    act(() => scrollParent.dispatchEvent(new Event('scroll')))
    expect(view.getByRole('button', { name: 'Scroll to latest messages' })).not.toBeNull()

    view.rerender(createElement(MessageList, null, [...initialRows, ...testRows('new-message')]))

    const followOutput = latestVirtuosoCall().followOutput
    expect(typeof followOutput).toBe('function')
    expect((followOutput as (isAtBottom: boolean) => false | 'smooth')(true)).toBe(false)
    expect(view.getByRole('button', { name: '1 new message' })).not.toBeNull()

    reportTotalListHeightChanged()
    expect(view.getByRole('button', { name: '1 new message' })).not.toBeNull()
    expect((latestVirtuosoCall().followOutput as (isAtBottom: boolean) => false | 'smooth')(true)).toBe(false)

    setScrollMetrics(scrollParent, 100, 1_000, 900)
    reportBottom(true)
    expect(view.queryByRole('button', { name: '1 new message' })).toBeNull()
    expect(view.getByTestId('follow-latest-action').dataset.state).toBe('closed')
  })

  it('retains a tail admission owner across a same-keys rerender until height settlement', () => {
    const initialRows = testRows('current')
    const view = render(createElement(MessageList, null, initialRows))
    const scrollParent = latestVirtuosoCall().customScrollParent!
    reportBottom(true)

    setScrollMetrics(scrollParent, 100, 1_000, 0)
    act(() => scrollParent.dispatchEvent(new Event('scroll')))
    const rowsWithN1 = [...initialRows, ...testRows('new-message')]
    view.rerender(createElement(MessageList, null, rowsWithN1))
    view.rerender(createElement(MessageList, null, rowsWithN1))

    setScrollMetrics(scrollParent, 100, 1_000, 900)
    reportStaleBottom(true)
    expect(view.getByRole('button', { name: '1 new message' })).not.toBeNull()

    setScrollMetrics(scrollParent, 100, 1_000, 0)
    reportTotalListHeightChanged()
    expect(view.getByRole('button', { name: '1 new message' })).not.toBeNull()

    setScrollMetrics(scrollParent, 100, 1_000, 900)
    reportBottom(true)
    expect(view.queryByRole('button', { name: '1 new message' })).toBeNull()
  })

  it('keeps one pre-tail physical snapshot when commit geometry changes before followOutput', () => {
    const initialRows = testRows('current')
    const view = render(createElement(MessageList, null, initialRows))
    const scrollParent = latestVirtuosoCall().customScrollParent!
    reportBottom(true)

    setScrollMetrics(scrollParent, 100, 1_000, 0)
    act(() => scrollParent.dispatchEvent(new Event('scroll')))
    expect(view.getByRole('button', { name: 'Scroll to latest messages' })).not.toBeNull()

    virtuosoRenderControl.beforeParentLayout = () => {
      setScrollMetrics(scrollParent, 100, 1_000, 900)
      latestVirtuosoCall().atBottomStateChange?.(true)
      latestVirtuosoCall().atBottomStateChange?.(true)
    }
    view.rerender(createElement(MessageList, null, [...initialRows, ...testRows('new-message')]))
    virtuosoRenderControl.beforeParentLayout = null
    setScrollMetrics(scrollParent, 100, 1_000, 0)

    const followOutput = latestVirtuosoCall().followOutput
    expect(typeof followOutput).toBe('function')
    expect((followOutput as (isAtBottom: boolean) => false | 'smooth')(true)).toBe(false)
    expect(view.getByRole('button', { name: '1 new message' })).not.toBeNull()
  })

  it('settles combined head and tail owners from one height callback', () => {
    const rows = testRows('current-1', 'current-2', 'current-3')
    const view = render(createElement(MessageList, null, rows))
    const scrollParent = latestVirtuosoCall().customScrollParent!
    setScrollMetrics(scrollParent, 100, 1_000, 900)
    setBounds(scrollParent, 0, 100)
    setBounds(view.container.querySelector<HTMLElement>('[data-index="0"]')!, -80, -20)
    setBounds(view.container.querySelector<HTMLElement>('[data-index="1"]')!, 20, 80)

    beginManualScroll(view)
    scrollParent.scrollTop = 100
    reportBottom(false)
    act(() => scrollParent.dispatchEvent(new Event('scroll')))
    reportBottom(false)

    const combinedRows = [...testRows('history-1', 'history-2'), ...rows, ...testRows('new-tail')]
    view.rerender(createElement(MessageList, null, combinedRows))
    expect(view.getByRole('button', { name: '1 new message' })).not.toBeNull()

    setBounds(view.container.querySelector<HTMLElement>('[data-index="3"]')!, 20, 80)
    reportTotalListHeightChanged()
    expect(virtuosoHandle.scrollToIndex).not.toHaveBeenCalled()

    setScrollMetrics(scrollParent, 100, 1_000, 900)
    reportBottom(true)
    expect(view.queryByRole('button', { name: '1 new message' })).toBeNull()
  })

  it('shows only beyond half a viewport and preserves unread state across threshold crossings', () => {
    const initialRows = testRows('current')
    const view = render(createElement(MessageList, null, initialRows))
    const scrollParent = latestVirtuosoCall().customScrollParent!
    reportBottom(true)
    beginManualScroll(view)
    reportBottom(false)
    view.rerender(createElement(MessageList, null, [...initialRows, ...testRows('new-message')]))

    setScrollMetrics(scrollParent, 100, 1_000, 851)
    reportTotalListHeightChanged()
    expect(view.queryByRole('button', { name: '1 new message' })).toBeNull()
    expect(view.getByTestId('follow-latest-action').dataset.state).toBe('closed')

    setScrollMetrics(scrollParent, 100, 1_000, 849)
    reportTotalListHeightChanged()
    expect(view.getByRole('button', { name: '1 new message' })).not.toBeNull()

    setScrollMetrics(scrollParent, 100, 1_000, 851)
    reportTotalListHeightChanged()
    expect(view.queryByRole('button', { name: '1 new message' })).toBeNull()

    setScrollMetrics(scrollParent, 100, 1_000, 849)
    reportTotalListHeightChanged()
    expect(view.getByRole('button', { name: '1 new message' })).not.toBeNull()
  })

  it('re-evaluates the half-screen threshold after a viewport resize without leaving a visible action', () => {
    const view = render(createElement(MessageList, null, testRows('current')))
    const scrollParent = latestVirtuosoCall().customScrollParent!
    reportBottom(false)

    setScrollMetrics(scrollParent, 500, 2_000, 1_000)
    reportTotalListHeightChanged()
    expect(view.getByRole('button', { name: 'Scroll to latest messages' })).not.toBeNull()

    setScrollMetrics(scrollParent, 800, 2_000, 1_000)
    reportTotalListHeightChanged()
    expect(view.queryByRole('button', { name: 'Scroll to latest messages' })).toBeNull()
    expect(view.getByTestId('follow-latest-action').dataset.state).toBe('closed')
  })

  it('keeps the eligible action visible through manual downward scrolling without resuming follow or clearing count', () => {
    const view = render(createElement(MessageList, null, testRows('current')))
    const scrollParent = latestVirtuosoCall().customScrollParent!
    const initialRows = testRows('current')
    reportBottom(true)

    beginManualScroll(view)
    reportBottom(false)
    view.rerender(createElement(MessageList, null, [...initialRows, ...testRows('new-message')]))
    vi.clearAllMocks()

    scrollParent.scrollTop = 100
    act(() => scrollParent.dispatchEvent(new Event('scroll')))
    expect(view.getByRole('button', { name: '1 new message' })).not.toBeNull()
    expect((latestVirtuosoCall().followOutput as (isAtBottom: boolean) => false | 'smooth')(false)).toBe(false)

    reportScrolling(false)
    expect(view.getByRole('button', { name: '1 new message' })).not.toBeNull()
    expect((latestVirtuosoCall().followOutput as (isAtBottom: boolean) => false | 'smooth')(false)).toBe(false)
    expect(virtuosoHandle.autoscrollToBottom).not.toHaveBeenCalled()
  })

  it('forces one current layout follow when a local send token and its projection commit together', () => {
    const initialRows = testRows('current')
    const view = render(createElement(MessageList, { localSendToken: 0 }, initialRows))
    reportBottom(true)
    beginManualScroll(view)
    reportBottom(false)
    vi.clearAllMocks()

    const rowsWithProjection = [...initialRows, ...testRows('local-projection')]
    view.rerender(createElement(MessageList, { localSendToken: 1 }, rowsWithProjection))

    expect(virtuosoHandle.scrollToIndex).toHaveBeenCalledTimes(1)
    expect(virtuosoHandle.scrollToIndex).toHaveBeenCalledWith({ index: 'LAST', align: 'end', behavior: 'smooth' })

    view.rerender(createElement(MessageList, { localSendToken: 1 }, rowsWithProjection))
    expect(virtuosoHandle.scrollToIndex).toHaveBeenCalledTimes(1)
  })

  it('consumes one committed History intent off-bottom with one existing follow command', () => {
    const initialRows = testRows('current')
    const consumed = vi.fn()
    const view = render(createElement(MessageList, null, initialRows))
    reportBottom(true)
    beginManualScroll(view)
    reportBottom(false)
    const historyRows = [...testRows('history'), ...initialRows]
    view.rerender(createElement(MessageList, null, historyRows))
    vi.clearAllMocks()

    view.rerender(
      createElement(
        MessageList,
        {
          historySyncIntent: { syncId: 'sync-1', inserted: true },
          onHistorySyncIntentConsumed: consumed
        },
        historyRows
      )
    )

    expect(virtuosoHandle.scrollToIndex).toHaveBeenCalledExactlyOnceWith({
      index: 'LAST',
      align: 'end',
      behavior: 'smooth'
    })
    expect(consumed).toHaveBeenCalledExactlyOnceWith()
  })

  it('consumes a committed History intent at bottom without another scroll command', () => {
    const consumed = vi.fn()
    const rows = testRows('current')
    const view = render(createElement(MessageList, null, rows))
    reportBottom(true)
    vi.clearAllMocks()

    view.rerender(
      createElement(
        MessageList,
        {
          historySyncIntent: { syncId: 'sync-1', inserted: true },
          onHistorySyncIntentConsumed: consumed
        },
        rows
      )
    )

    expect(virtuosoHandle.scrollToIndex).not.toHaveBeenCalled()
    expect(consumed).toHaveBeenCalledExactlyOnceWith()
    expect(view.getByTestId('follow-latest-action').dataset.state).toBe('closed')
  })

  it('keeps token-first local recovery current for the next layout without issuing a second command', () => {
    const initialRows = testRows('current')
    const view = render(createElement(MessageList, { localSendToken: 0 }, initialRows))
    reportBottom(true)
    beginManualScroll(view)
    reportBottom(false)
    vi.clearAllMocks()

    view.rerender(createElement(MessageList, { localSendToken: 1 }, initialRows))
    expect(virtuosoHandle.scrollToIndex).toHaveBeenCalledTimes(1)

    view.rerender(createElement(MessageList, { localSendToken: 1 }, [...initialRows, ...testRows('local-projection')]))
    expect(virtuosoHandle.scrollToIndex).toHaveBeenCalledTimes(1)
    expect((latestVirtuosoCall().followOutput as (isAtBottom: boolean) => false | 'smooth')(false)).toBe('smooth')
  })

  it('does not force a projection-first received tail and consumes each newer local send token once', () => {
    const initialRows = testRows('current')
    const view = render(createElement(MessageList, { localSendToken: 0 }, initialRows))
    reportBottom(true)
    beginManualScroll(view)
    reportBottom(false)
    vi.clearAllMocks()

    const receivedRows = [...initialRows, ...testRows('same-user-tail-sync')]
    view.rerender(createElement(MessageList, { localSendToken: 0 }, receivedRows))
    expect(virtuosoHandle.scrollToIndex).not.toHaveBeenCalled()
    expect((latestVirtuosoCall().followOutput as (isAtBottom: boolean) => false | 'smooth')(false)).toBe(false)

    view.rerender(createElement(MessageList, { localSendToken: 1 }, receivedRows))
    view.rerender(createElement(MessageList, { localSendToken: 2 }, receivedRows))
    view.rerender(createElement(MessageList, { localSendToken: 1 }, receivedRows))
    expect(virtuosoHandle.scrollToIndex).toHaveBeenCalledTimes(2)
  })

  it('waits for manual scrolling to end before following once at the bottom', () => {
    const view = render(createElement(MessageList, null, testRows('current')))
    const scrollParent = latestVirtuosoCall().customScrollParent!
    reportBottom(true)
    beginManualScroll(view)

    scrollParent.scrollTop = scrollParent.scrollHeight - scrollParent.clientHeight
    reportBottom(true)
    expect(virtuosoHandle.autoscrollToBottom).not.toHaveBeenCalled()

    reportScrolling(false)
    expect(virtuosoHandle.autoscrollToBottom).toHaveBeenCalledTimes(1)
  })

  it('waits for a non-bottom Virtuoso callback before replacing initial settlement', () => {
    const view = render(createElement(MessageList, null, testRows('current')))
    const scrollParent = latestVirtuosoCall().customScrollParent!
    const item = view.container.querySelector<HTMLElement>('[data-index="0"]')!
    Object.defineProperties(scrollParent, {
      clientHeight: { configurable: true, value: 100 },
      scrollHeight: { configurable: true, value: 1_000 },
      scrollTop: { configurable: true, value: 900, writable: true }
    })
    setBounds(scrollParent, 0, 100)
    setBounds(item, -20, 20)

    beginManualScroll(view)
    expect(virtuosoHandle.scrollToIndex).not.toHaveBeenCalled()

    scrollParent.scrollTop = 100
    reportBottom(false)
    expect(virtuosoHandle.scrollToIndex).not.toHaveBeenCalled()

    setBounds(item, 0, 50)
    act(() => scrollParent.dispatchEvent(new Event('scroll')))
    reportBottom(false)

    expect(virtuosoHandle.scrollTo).toHaveBeenCalledWith({ top: 100 })
  })

  it('requires a fully visible item instead of an earlier partial item to replace initial settlement', () => {
    const view = render(createElement(MessageList, null, testRows('partial', 'full')))
    const scrollParent = latestVirtuosoCall().customScrollParent!
    const partialItem = view.container.querySelector<HTMLElement>('[data-index="0"]')!
    const fullItem = view.container.querySelector<HTMLElement>('[data-index="1"]')!
    Object.defineProperties(scrollParent, {
      clientHeight: { configurable: true, value: 100 },
      scrollHeight: { configurable: true, value: 1_000 },
      scrollTop: { configurable: true, value: 900, writable: true }
    })
    setBounds(scrollParent, 0, 100)
    setBounds(partialItem, -20, 20)
    setBounds(fullItem, 60, 120)

    beginManualScroll(view)
    scrollParent.scrollTop = 100
    reportBottom(false)
    expect(virtuosoHandle.scrollToIndex).not.toHaveBeenCalled()

    setBounds(fullItem, 20, 80)
    act(() => scrollParent.dispatchEvent(new Event('scroll')))
    reportBottom(false)

    expect(virtuosoHandle.scrollTo).toHaveBeenCalledWith({ top: 100 })
  })

  it('does not replace initial settlement when every visible item is partial', () => {
    const view = render(createElement(MessageList, null, testRows('partial-top', 'partial-bottom')))
    const scrollParent = latestVirtuosoCall().customScrollParent!
    const topItem = view.container.querySelector<HTMLElement>('[data-index="0"]')!
    const bottomItem = view.container.querySelector<HTMLElement>('[data-index="1"]')!
    Object.defineProperties(scrollParent, {
      clientHeight: { configurable: true, value: 100 },
      scrollHeight: { configurable: true, value: 1_000 },
      scrollTop: { configurable: true, value: 900, writable: true }
    })
    setBounds(scrollParent, 0, 100)
    setBounds(topItem, -20, 60)
    setBounds(bottomItem, 60, 120)

    beginManualScroll(view)
    scrollParent.scrollTop = 100
    reportBottom(false)
    act(() => scrollParent.dispatchEvent(new Event('scroll')))
    reportBottom(false)

    expect(virtuosoHandle.scrollTo).not.toHaveBeenCalled()
  })

  it('keeps the action through intermediate head-rebase geometry until programmatic completion', () => {
    const rows = testRows('current-1', 'current-2', 'current-3')
    const view = render(createElement(MessageList, null, rows))
    const scrollParent = latestVirtuosoCall().customScrollParent!
    const firstItem = view.container.querySelector<HTMLElement>('[data-index="0"]')!
    const anchorItem = view.container.querySelector<HTMLElement>('[data-index="1"]')!
    setScrollMetrics(scrollParent, 100, 1_000, 900)
    setBounds(scrollParent, 0, 100)
    setBounds(firstItem, -80, -20)
    setBounds(anchorItem, 20, 80)

    beginManualScroll(view)
    scrollParent.scrollTop = 100
    reportBottom(false)
    act(() => scrollParent.dispatchEvent(new Event('scroll')))
    reportBottom(false)
    expect(view.getByRole('button', { name: 'Scroll to latest messages' })).not.toBeNull()
    vi.clearAllMocks()

    virtuosoRenderControl.beforeParentLayout = () => {
      setScrollMetrics(scrollParent, 100, 1_000, 850)
      latestVirtuosoCall().atBottomStateChange?.(false)
    }
    view.rerender(createElement(MessageList, null, [...testRows('history-1', 'history-2'), ...rows]))
    virtuosoRenderControl.beforeParentLayout = null

    expect(view.getByRole('button', { name: 'Scroll to latest messages' })).not.toBeNull()
    expect(virtuosoHandle.scrollToIndex).not.toHaveBeenCalled()
    setScrollMetrics(scrollParent, 100, 1_000, 900)
    act(() => scrollParent.dispatchEvent(new Event('scroll')))
    reportScrolling(false)
    reportBottom(true)
    expect(view.getByRole('button', { name: 'Scroll to latest messages' })).not.toBeNull()
    expect(virtuosoHandle.autoscrollToBottom).not.toHaveBeenCalled()
    setBounds(view.container.querySelector<HTMLElement>('[data-index="3"]')!, 40, 100)
    act(() => latestVirtuosoCall().totalListHeightChanged?.(1_000))
    expect(virtuosoHandle.scrollToIndex).toHaveBeenCalledWith({
      index: 3,
      align: 'start',
      offset: -20,
      behavior: 'auto'
    })

    setScrollMetrics(scrollParent, 100, 1_000, 849)
    act(() => scrollParent.dispatchEvent(new Event('scroll')))

    expect(view.getByRole('button', { name: 'Scroll to latest messages' })).not.toBeNull()
  })

  it('allows an explicit manual intent to cancel a registered head transaction before ordinary scroll handling', () => {
    const rows = testRows('current-1', 'current-2', 'current-3')
    const view = render(createElement(MessageList, null, rows))
    const scrollParent = latestVirtuosoCall().customScrollParent!
    setScrollMetrics(scrollParent, 100, 1_000, 900)
    setBounds(scrollParent, 0, 100)
    setBounds(view.container.querySelector<HTMLElement>('[data-index="0"]')!, -80, -20)
    setBounds(view.container.querySelector<HTMLElement>('[data-index="1"]')!, 20, 80)

    beginManualScroll(view)
    scrollParent.scrollTop = 100
    reportBottom(false)
    act(() => scrollParent.dispatchEvent(new Event('scroll')))
    reportBottom(false)
    view.rerender(createElement(MessageList, null, [...testRows('history-1', 'history-2'), ...rows]))

    act(() => view.getByTestId('scroll-area').dispatchEvent(new Event('wheel', { bubbles: true })))
    setScrollMetrics(scrollParent, 100, 1_000, 900)
    act(() => scrollParent.dispatchEvent(new Event('scroll')))

    expect(view.queryByRole('button', { name: 'Scroll to latest messages' })).toBeNull()
    expect(virtuosoHandle.scrollToIndex).not.toHaveBeenCalled()
  })

  it('keeps a pending head rebase guarded until its captured anchor reaches the target', () => {
    const rows = testRows('current-1', 'current-2', 'current-3')
    const view = render(createElement(MessageList, null, rows))
    const scrollParent = latestVirtuosoCall().customScrollParent!
    setScrollMetrics(scrollParent, 100, 1_000, 900)
    setBounds(scrollParent, 0, 100)
    setBounds(view.container.querySelector<HTMLElement>('[data-index="0"]')!, -80, -20)
    setBounds(view.container.querySelector<HTMLElement>('[data-index="1"]')!, 20, 80)

    beginManualScroll(view)
    scrollParent.scrollTop = 100
    reportBottom(false)
    act(() => scrollParent.dispatchEvent(new Event('scroll')))
    reportBottom(false)
    vi.clearAllMocks()

    view.rerender(createElement(MessageList, null, [...testRows('history-1', 'history-2'), ...rows]))
    const target = view.container.querySelector<HTMLElement>('[data-index="3"]')!
    setBounds(target, 0, 60)
    reportTotalListHeightChanged()
    expect(virtuosoHandle.scrollToIndex).toHaveBeenCalledTimes(1)

    setScrollMetrics(scrollParent, 100, 1_000, 850)
    act(() => scrollParent.dispatchEvent(new Event('scroll')))
    expect(view.getByRole('button', { name: 'Scroll to latest messages' })).not.toBeNull()

    setBounds(target, 20, 80)
    act(() => scrollParent.dispatchEvent(new Event('scroll')))
    expect(view.getByTestId('follow-latest-action').dataset.state).toBe('closed')
  })

  it('retargets a registered head owner across a tail append without a second command', () => {
    const rows = testRows('current-1', 'current-2', 'current-3')
    const headRows = [...testRows('history-1', 'history-2'), ...rows]
    const view = render(createElement(MessageList, null, rows))
    const scrollParent = latestVirtuosoCall().customScrollParent!
    setScrollMetrics(scrollParent, 100, 1_000, 900)
    setBounds(scrollParent, 0, 100)
    setBounds(view.container.querySelector<HTMLElement>('[data-index="0"]')!, -80, -20)
    setBounds(view.container.querySelector<HTMLElement>('[data-index="1"]')!, 20, 80)

    beginManualScroll(view)
    scrollParent.scrollTop = 100
    reportBottom(false)
    act(() => scrollParent.dispatchEvent(new Event('scroll')))
    reportBottom(false)
    vi.clearAllMocks()

    view.rerender(createElement(MessageList, null, headRows))
    view.rerender(createElement(MessageList, null, [...headRows, ...testRows('new-tail')]))
    expect(view.getByRole('button', { name: '1 new message' })).not.toBeNull()

    const target = view.container.querySelector<HTMLElement>('[data-index="3"]')!
    setBounds(target, 40, 100)
    reportTotalListHeightChanged()
    expect(virtuosoHandle.scrollToIndex).toHaveBeenCalledTimes(1)

    setBounds(target, 20, 80)
    setScrollMetrics(scrollParent, 100, 1_000, 849)
    act(() => scrollParent.dispatchEvent(new Event('scroll')))
    expect(view.getByRole('button', { name: '1 new message' })).not.toBeNull()
    expect(virtuosoHandle.scrollToIndex).toHaveBeenCalledTimes(1)
  })

  it('releases a pending head owner after its target scroll so bottom callbacks take the ordinary path', () => {
    const rows = testRows('current-1', 'current-2', 'current-3')
    const headRows = [...testRows('history-1', 'history-2'), ...rows]
    const view = render(createElement(MessageList, null, rows))
    const scrollParent = latestVirtuosoCall().customScrollParent!
    setScrollMetrics(scrollParent, 100, 1_000, 900)
    setBounds(scrollParent, 0, 100)
    setBounds(view.container.querySelector<HTMLElement>('[data-index="0"]')!, -80, -20)
    setBounds(view.container.querySelector<HTMLElement>('[data-index="1"]')!, 20, 80)

    beginManualScroll(view)
    scrollParent.scrollTop = 100
    reportBottom(false)
    act(() => scrollParent.dispatchEvent(new Event('scroll')))
    reportBottom(false)
    vi.clearAllMocks()

    view.rerender(createElement(MessageList, null, headRows))
    const initialTarget = view.container.querySelector<HTMLElement>('[data-index="3"]')!
    setBounds(initialTarget, 40, 100)
    reportTotalListHeightChanged()
    expect(virtuosoHandle.scrollToIndex).toHaveBeenCalledTimes(1)

    view.rerender(createElement(MessageList, null, [...headRows, ...testRows('new-tail')]))
    expect(view.getByRole('button', { name: '1 new message' })).not.toBeNull()
    const target = view.container.querySelector<HTMLElement>('[data-index="3"]')!
    setBounds(target, 20, 80)
    setScrollMetrics(scrollParent, 100, 1_000, 849)
    act(() => scrollParent.dispatchEvent(new Event('scroll')))

    expect(view.getByRole('button', { name: '1 new message' })).not.toBeNull()
    expect(virtuosoHandle.scrollToIndex).toHaveBeenCalledTimes(1)

    reportBottom(false)
    setScrollMetrics(scrollParent, 100, 1_000, 900)
    reportTotalListHeightChanged()
    reportBottom(true)

    expect(view.queryByRole('button', { name: '1 new message' })).toBeNull()
    expect(view.getByTestId('follow-latest-action').dataset.state).toBe('closed')
  })

  it('supersedes a registered head owner when a later head prepend overlaps it', () => {
    const rows = testRows('current-1', 'current-2', 'current-3')
    const firstHead = [...testRows('history-1', 'history-2'), ...rows]
    const secondHead = [...testRows('history-3'), ...firstHead]
    const view = render(createElement(MessageList, null, rows))
    const scrollParent = latestVirtuosoCall().customScrollParent!
    setScrollMetrics(scrollParent, 100, 1_000, 900)
    setBounds(scrollParent, 0, 100)
    setBounds(view.container.querySelector<HTMLElement>('[data-index="0"]')!, -80, -20)
    setBounds(view.container.querySelector<HTMLElement>('[data-index="1"]')!, 20, 80)

    beginManualScroll(view)
    scrollParent.scrollTop = 100
    reportBottom(false)
    act(() => scrollParent.dispatchEvent(new Event('scroll')))
    reportBottom(false)
    vi.clearAllMocks()

    view.rerender(createElement(MessageList, null, firstHead))
    const firstCall = latestVirtuosoCall()
    view.rerender(createElement(MessageList, null, secondHead))
    act(() => firstCall.totalListHeightChanged?.(1_000))
    expect(virtuosoHandle.scrollToIndex).not.toHaveBeenCalled()

    setBounds(view.container.querySelector<HTMLElement>('[data-index="4"]')!, 40, 100)
    reportTotalListHeightChanged()
    expect(virtuosoHandle.scrollToIndex).toHaveBeenCalledTimes(1)
    expect(virtuosoHandle.scrollToIndex).toHaveBeenCalledWith({
      index: 4,
      align: 'start',
      offset: -20,
      behavior: 'auto'
    })
  })

  it('supersedes a pending head owner without letting its old events settle the successor', () => {
    const rows = testRows('current-1', 'current-2', 'current-3')
    const firstHead = [...testRows('history-1', 'history-2'), ...rows]
    const secondHead = [...testRows('history-3'), ...firstHead]
    const view = render(createElement(MessageList, null, rows))
    const scrollParent = latestVirtuosoCall().customScrollParent!
    setScrollMetrics(scrollParent, 100, 1_000, 900)
    setBounds(scrollParent, 0, 100)
    setBounds(view.container.querySelector<HTMLElement>('[data-index="0"]')!, -80, -20)
    setBounds(view.container.querySelector<HTMLElement>('[data-index="1"]')!, 20, 80)

    beginManualScroll(view)
    scrollParent.scrollTop = 100
    reportBottom(false)
    act(() => scrollParent.dispatchEvent(new Event('scroll')))
    reportBottom(false)
    vi.clearAllMocks()

    view.rerender(createElement(MessageList, null, firstHead))
    const firstCall = latestVirtuosoCall()
    setBounds(view.container.querySelector<HTMLElement>('[data-index="3"]')!, 40, 100)
    act(() => firstCall.totalListHeightChanged?.(1_000))
    expect(virtuosoHandle.scrollToIndex).toHaveBeenCalledTimes(1)

    view.rerender(createElement(MessageList, null, secondHead))
    setBounds(view.container.querySelector<HTMLElement>('[data-index="4"]')!, 40, 100)
    act(() => firstCall.totalListHeightChanged?.(1_000))
    act(() => scrollParent.dispatchEvent(new Event('scroll')))
    expect(virtuosoHandle.scrollToIndex).toHaveBeenCalledTimes(1)

    reportTotalListHeightChanged()
    expect(virtuosoHandle.scrollToIndex).toHaveBeenCalledTimes(2)
    expect(virtuosoHandle.scrollToIndex).toHaveBeenLastCalledWith({
      index: 4,
      align: 'start',
      offset: -20,
      behavior: 'auto'
    })

    act(() => firstCall.atBottomStateChange?.(true))
    expect(virtuosoHandle.scrollToIndex).toHaveBeenCalledTimes(2)
    setBounds(view.container.querySelector<HTMLElement>('[data-index="4"]')!, 20, 80)
    setScrollMetrics(scrollParent, 100, 1_000, 849)
    act(() => scrollParent.dispatchEvent(new Event('scroll')))
    reportBottom(true)

    expect(view.getByTestId('follow-latest-action').dataset.state).toBe('closed')
    expect(virtuosoHandle.scrollToIndex).toHaveBeenCalledTimes(2)
  })

  it('closes the action when the final head-rebase geometry is within half a viewport', () => {
    const rows = testRows('current-1', 'current-2', 'current-3')
    const view = render(createElement(MessageList, null, rows))
    const scrollParent = latestVirtuosoCall().customScrollParent!
    const firstItem = view.container.querySelector<HTMLElement>('[data-index="0"]')!
    const anchorItem = view.container.querySelector<HTMLElement>('[data-index="1"]')!
    setScrollMetrics(scrollParent, 100, 1_000, 900)
    setBounds(scrollParent, 0, 100)
    setBounds(firstItem, -80, -20)
    setBounds(anchorItem, 20, 80)

    beginManualScroll(view)
    scrollParent.scrollTop = 100
    reportBottom(false)
    act(() => scrollParent.dispatchEvent(new Event('scroll')))
    reportBottom(false)

    virtuosoRenderControl.beforeParentLayout = () => {
      setScrollMetrics(scrollParent, 100, 1_000, 850)
      latestVirtuosoCall().atBottomStateChange?.(false)
    }
    view.rerender(createElement(MessageList, null, [...testRows('history-1', 'history-2'), ...rows]))
    virtuosoRenderControl.beforeParentLayout = null

    expect(virtuosoHandle.scrollToIndex).not.toHaveBeenCalled()
    act(() => latestVirtuosoCall().totalListHeightChanged?.(1_000))
    setScrollMetrics(scrollParent, 100, 1_000, 850)
    act(() => scrollParent.dispatchEvent(new Event('scroll')))

    expect(view.queryByRole('button', { name: 'Scroll to latest messages' })).toBeNull()
    expect(view.getByTestId('follow-latest-action').dataset.state).toBe('closed')
  })

  it('keeps a registered pure-head transaction through a same-items rerender until its sole settlement', () => {
    const rows = testRows('current-1', 'current-2', 'current-3')
    const headRows = [...testRows('history-1', 'history-2'), ...rows]
    const view = render(createElement(MessageList, null, rows))
    const scrollParent = latestVirtuosoCall().customScrollParent!
    setScrollMetrics(scrollParent, 100, 1_000, 900)
    setBounds(scrollParent, 0, 100)
    setBounds(view.container.querySelector<HTMLElement>('[data-index="0"]')!, -80, -20)
    setBounds(view.container.querySelector<HTMLElement>('[data-index="1"]')!, 20, 80)

    beginManualScroll(view)
    scrollParent.scrollTop = 100
    reportBottom(false)
    act(() => scrollParent.dispatchEvent(new Event('scroll')))
    reportBottom(false)
    vi.clearAllMocks()

    view.rerender(createElement(MessageList, null, headRows))
    const h1Call = latestVirtuosoCall()
    view.rerender(createElement(MessageList, null, [...headRows]))
    setBounds(view.container.querySelector<HTMLElement>('[data-index="3"]')!, 40, 100)
    act(() => h1Call.totalListHeightChanged?.(1_000))
    reportTotalListHeightChanged()

    expect(virtuosoHandle.scrollToIndex).toHaveBeenCalledTimes(1)
    expect(virtuosoHandle.scrollToIndex).toHaveBeenCalledWith({
      index: 3,
      align: 'start',
      offset: -20,
      behavior: 'auto'
    })
  })

  it('cancels a pending combined head transaction on replace and ignores callbacks from the old list revision', () => {
    const rows = testRows('current-1', 'current-2', 'current-3')
    const view = render(createElement(MessageList, null, rows))
    const scrollParent = latestVirtuosoCall().customScrollParent!
    setScrollMetrics(scrollParent, 100, 1_000, 900)
    setBounds(scrollParent, 0, 100)
    setBounds(view.container.querySelector<HTMLElement>('[data-index="0"]')!, -80, -20)
    setBounds(view.container.querySelector<HTMLElement>('[data-index="1"]')!, 20, 80)

    beginManualScroll(view)
    scrollParent.scrollTop = 100
    reportBottom(false)
    act(() => scrollParent.dispatchEvent(new Event('scroll')))
    reportBottom(false)
    view.rerender(
      createElement(MessageList, null, [...testRows('history-1', 'history-2'), ...rows, ...testRows('new-tail')])
    )
    setBounds(view.container.querySelector<HTMLElement>('[data-index="3"]')!, 40, 100)
    const oldCall = latestVirtuosoCall()
    act(() => oldCall.totalListHeightChanged?.(1_000))
    expect(virtuosoHandle.scrollToIndex).toHaveBeenCalledTimes(1)

    view.rerender(createElement(MessageList, null, testRows('replacement')))
    act(() => oldCall.totalListHeightChanged?.(1_000))
    act(() => oldCall.atBottomStateChange?.(true))
    setScrollMetrics(scrollParent, 100, 1_000, 800)
    act(() => scrollParent.dispatchEvent(new Event('scroll')))

    expect(virtuosoHandle.scrollToIndex).toHaveBeenCalledTimes(1)
    expect(view.getByTestId('follow-latest-action').dataset.state).toBe('open')
  })

  it('cancels a pending combined head transaction when its viewport is replaced', () => {
    scrollAreaRefControl.manual = true
    const rows = testRows('current-1', 'current-2', 'current-3')
    const view = render(createElement(MessageList, null, rows))
    const setViewport = scrollAreaRefControl.ref as (node: HTMLDivElement | null) => void
    const firstViewport = view.container.querySelector<HTMLDivElement>('[data-slot="scroll-area-viewport"]')!
    act(() => setViewport(firstViewport))
    setScrollMetrics(firstViewport, 100, 1_000, 900)
    setBounds(firstViewport, 0, 100)
    setBounds(view.container.querySelector<HTMLElement>('[data-index="0"]')!, -80, -20)
    setBounds(view.container.querySelector<HTMLElement>('[data-index="1"]')!, 20, 80)

    beginManualScroll(view)
    firstViewport.scrollTop = 100
    reportBottom(false)
    act(() => firstViewport.dispatchEvent(new Event('scroll')))
    reportBottom(false)
    view.rerender(
      createElement(MessageList, null, [...testRows('history-1', 'history-2'), ...rows, ...testRows('new-tail')])
    )
    setBounds(view.container.querySelector<HTMLElement>('[data-index="3"]')!, 40, 100)
    const oldCall = latestVirtuosoCall()
    act(() => oldCall.totalListHeightChanged?.(1_000))
    expect(virtuosoHandle.scrollToIndex).toHaveBeenCalledTimes(1)

    act(() => setViewport(null))
    const replacementViewport = document.createElement('div')
    act(() => setViewport(replacementViewport))
    act(() => oldCall.totalListHeightChanged?.(1_000))
    act(() => oldCall.atBottomStateChange?.(true))
    setScrollMetrics(replacementViewport, 100, 1_000, 800)
    act(() => replacementViewport.dispatchEvent(new Event('scroll')))

    expect(virtuosoHandle.scrollToIndex).toHaveBeenCalledTimes(1)
    expect(view.getByTestId('follow-latest-action').dataset.state).toBe('open')
  })

  it('completes an already-aligned pure-head transaction without a scroll command', () => {
    const rows = testRows('current-1', 'current-2', 'current-3')
    const view = render(createElement(MessageList, null, rows))
    const scrollParent = latestVirtuosoCall().customScrollParent!
    setScrollMetrics(scrollParent, 100, 1_000, 900)
    setBounds(scrollParent, 0, 100)
    setBounds(view.container.querySelector<HTMLElement>('[data-index="0"]')!, -80, -20)
    setBounds(view.container.querySelector<HTMLElement>('[data-index="1"]')!, 20, 80)

    beginManualScroll(view)
    scrollParent.scrollTop = 100
    reportBottom(false)
    act(() => scrollParent.dispatchEvent(new Event('scroll')))
    reportBottom(false)
    vi.clearAllMocks()

    virtuosoRenderControl.beforeParentLayout = () => {
      setScrollMetrics(scrollParent, 100, 1_000, 850)
      latestVirtuosoCall().totalListHeightChanged?.(1_000)
    }
    view.rerender(createElement(MessageList, null, [...testRows('history-1', 'history-2'), ...rows]))
    virtuosoRenderControl.beforeParentLayout = null

    expect(virtuosoHandle.scrollToIndex).not.toHaveBeenCalled()
    expect(view.queryByRole('button', { name: 'Scroll to latest messages' })).toBeNull()

    setScrollMetrics(scrollParent, 100, 1_000, 849)
    reportTotalListHeightChanged()
    expect(view.getByRole('button', { name: 'Scroll to latest messages' })).not.toBeNull()
  })

  it('rebases one manually browsed head prepend without issuing a tail command', () => {
    const rows = testRows('current-1', 'current-2', 'current-3')
    const view = render(createElement(MessageList, null, rows))
    const scrollParent = latestVirtuosoCall().customScrollParent!
    const firstItem = view.container.querySelector<HTMLElement>('[data-index="0"]')!
    const anchorItem = view.container.querySelector<HTMLElement>('[data-index="1"]')!
    Object.defineProperties(scrollParent, {
      clientHeight: { configurable: true, value: 100 },
      scrollHeight: { configurable: true, value: 1_000 },
      scrollTop: { configurable: true, value: 900, writable: true }
    })
    setBounds(scrollParent, 0, 100)
    setBounds(firstItem, -80, -20)
    setBounds(anchorItem, 20, 80)

    beginManualScroll(view)
    scrollParent.scrollTop = 100
    reportBottom(false)
    act(() => scrollParent.dispatchEvent(new Event('scroll')))
    reportBottom(false)
    expect(virtuosoHandle.scrollTo).toHaveBeenCalledWith({ top: 100 })
    vi.clearAllMocks()

    const pausedTailRows = [...rows, ...testRows('new-tail')]
    view.rerender(createElement(MessageList, null, pausedTailRows))

    const pausedTailFollowOutput = latestVirtuosoCall().followOutput
    expect(typeof pausedTailFollowOutput).toBe('function')
    expect((pausedTailFollowOutput as (isAtBottom: boolean) => false | 'smooth')(true)).toBe(false)
    expect(virtuosoHandle.scrollToIndex).not.toHaveBeenCalled()

    view.rerender(createElement(MessageList, null, [...testRows('history-1', 'history-2'), ...pausedTailRows]))
    setBounds(view.container.querySelector<HTMLElement>('[data-index="3"]')!, 40, 100)
    act(() => latestVirtuosoCall().totalListHeightChanged?.(1_000))

    expect(latestVirtuosoCall().followOutput).toBe(false)
    expect(virtuosoHandle.autoscrollToBottom).not.toHaveBeenCalled()
    expect(virtuosoHandle.scrollBy).not.toHaveBeenCalled()
    expect(virtuosoHandle.scrollIntoView).not.toHaveBeenCalled()
    expect(virtuosoHandle.scrollTo).not.toHaveBeenCalled()
    expect(virtuosoHandle.scrollToIndex).toHaveBeenCalledTimes(1)
    expect(virtuosoHandle.scrollToIndex).toHaveBeenCalledWith({
      index: 3,
      align: 'start',
      offset: -20,
      behavior: 'auto'
    })
  })

  it('rebases and counts one canonical paused head-plus-tail snapshot without a competing command', () => {
    const rows = testRows('current-1', 'current-2', 'current-3')
    const view = render(createElement(MessageList, null, rows))
    const scrollParent = latestVirtuosoCall().customScrollParent!
    const firstItem = view.container.querySelector<HTMLElement>('[data-index="0"]')!
    const anchorItem = view.container.querySelector<HTMLElement>('[data-index="1"]')!
    Object.defineProperties(scrollParent, {
      clientHeight: { configurable: true, value: 100 },
      scrollHeight: { configurable: true, value: 1_000 },
      scrollTop: { configurable: true, value: 900, writable: true }
    })
    setBounds(scrollParent, 0, 100)
    setBounds(firstItem, -80, -20)
    setBounds(anchorItem, 20, 80)

    beginManualScroll(view)
    scrollParent.scrollTop = 100
    reportBottom(false)
    act(() => scrollParent.dispatchEvent(new Event('scroll')))
    reportBottom(false)
    vi.clearAllMocks()

    view.rerender(
      createElement(MessageList, null, [...testRows('history-1', 'history-2'), ...rows, ...testRows('new-tail')])
    )

    const followOutput = latestVirtuosoCall().followOutput
    expect(typeof followOutput).toBe('function')
    expect((followOutput as (isAtBottom: boolean) => false | 'smooth')(true)).toBe(false)
    expect(view.getByRole('button', { name: '1 new message' })).not.toBeNull()
    expect(virtuosoHandle.autoscrollToBottom).not.toHaveBeenCalled()
    expect(virtuosoHandle.scrollBy).not.toHaveBeenCalled()
    expect(virtuosoHandle.scrollIntoView).not.toHaveBeenCalled()
    expect(virtuosoHandle.scrollTo).not.toHaveBeenCalled()
    expect(virtuosoHandle.scrollToIndex).not.toHaveBeenCalled()
    setBounds(view.container.querySelector<HTMLElement>('[data-index="3"]')!, 40, 100)
    reportTotalListHeightChanged()
    expect(virtuosoHandle.scrollToIndex).toHaveBeenCalledTimes(1)
    expect(virtuosoHandle.scrollToIndex).toHaveBeenCalledWith({
      index: 3,
      align: 'start',
      offset: -20,
      behavior: 'auto'
    })
  })

  it('keys text, singleton notice, and grouped notice rows from their stable projected identities', () => {
    expect(
      renderRows([notice('singleton', 1), text('separator', 2), notice('group-first', 3), notice('group-latest', 4)])
    ).toEqual(['single-notice:singleton', 'message:separator', 'notice-group:group-first'])
  })

  it('keeps the grouped row key stable when canonical recomputation extends the run', () => {
    const first = notice('first', 1)
    const second = notice('second', 2)

    expect(renderRows([first, second])).toEqual(['notice-group:first'])
    expect(renderRows([first, second, notice('third', 3)])).toEqual(['notice-group:first'])
  })

  it('keeps prefix-mimicking wire IDs in disjoint row namespaces through a late split', () => {
    const first = notice('message:notice:first', 1)
    const second = notice('single-notice:notice:second', 2)
    const latest = notice('notice-group:notice:latest', 3)

    expect(renderRows([first, second, latest])).toEqual(['notice-group:message:notice:first'])

    const splitKeys = renderRows([
      first,
      text('notice-group:single-notice:notice:second', 1.25),
      text('message:notice:separator', 1.5),
      text('single-notice:notice:separator', 1.75),
      second,
      latest
    ])
    expect(splitKeys).toEqual([
      'single-notice:message:notice:first',
      'message:notice-group:single-notice:notice:second',
      'message:message:notice:separator',
      'message:single-notice:notice:separator',
      'notice-group:single-notice:notice:second'
    ])
    expect(new Set(splitKeys).size).toBe(splitKeys.length)
  })

  it('collapses a notice group to its latest notice without a numeric count', () => {
    const markup = renderToStaticMarkup(
      createElement(NoticeGroup, { notices: [notice('older-notice', 1), notice('latest-notice', 2)] })
    )

    expect(markup).not.toContain('older-notice')
    expect(markup).toContain('latest-notice')
    expect(markup).toContain('aria-label="Expand notices"')
    expect(markup).toContain('aria-expanded="false"')
    expect(markup).not.toContain('>2<')
  })

  it('fails explicitly rather than substituting an array index for a missing row key', () => {
    expect(() => render(createElement(MessageList, null, [createElement('div')]))).toThrow(
      'MessageList items require a stable key'
    )
  })
})
