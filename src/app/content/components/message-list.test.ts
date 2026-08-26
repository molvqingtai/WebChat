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
}

const virtuosoCalls = vi.hoisted(() => [] as VirtuosoCall[])
const virtuosoLifecycle = vi.hoisted(() => ({ mounts: 0, unmounts: 0 }))
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
      return React.createElement(
        'div',
        { 'data-slot': 'scroll-area', 'data-testid': 'scroll-area' },
        React.createElement(
          'div',
          { 'data-slot': 'scroll-area-viewport', ref: scrollAreaRefControl.manual ? undefined : ref },
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
        keys
      })
      React.useImperativeHandle(ref, () => virtuosoHandle)
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
  act(() => latestVirtuosoCall().atBottomStateChange?.(atBottom))
}
const reportScrolling = (isScrolling: boolean) => {
  act(() => latestVirtuosoCall().isScrolling?.(isScrolling))
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

beforeEach(() => {
  virtuosoCalls.length = 0
  virtuosoLifecycle.mounts = 0
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

    for (const source of ['received', 'sent', 'sync']) {
      rows = [...rows, ...testRows(source)]
      view.rerender(createElement(MessageList, null, rows))

      const followOutput = latestVirtuosoCall().followOutput
      expect(typeof followOutput).toBe('function')
      expect((followOutput as (isAtBottom: boolean) => false | 'smooth')(true)).toBe('smooth')
      expect((followOutput as (isAtBottom: boolean) => false | 'smooth')(false)).toBe(false)
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

  it('shows the zero-count bottom action with the down-arrow icon and follows when activated', () => {
    const view = render(createElement(MessageList, null, testRows('current')))
    reportBottom(false)

    const button = view.getByRole('button', { name: '回到底部' })
    expect(button.textContent).toContain('回到底部')
    expect(button.querySelector('svg.lucide-arrow-down')).not.toBeNull()

    act(() => button.click())

    expect(virtuosoHandle.scrollToIndex).toHaveBeenCalledWith({ index: 'LAST', align: 'end', behavior: 'smooth' })
    reportBottom(true)
    expect(view.queryByRole('button', { name: '回到底部' })).toBeNull()
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

    const button = view.getByRole('button', { name: '1 条新消息' })
    expect(button.textContent).toContain('1 条新消息')
    act(() => button.click())

    expect(virtuosoHandle.scrollToIndex).toHaveBeenCalledWith({ index: 'LAST', align: 'end', behavior: 'smooth' })
    expect(view.getByRole('button', { name: '回到底部' })).not.toBeNull()
    expect((latestVirtuosoCall().followOutput as (isAtBottom: boolean) => false | 'smooth')(true)).toBe('smooth')
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

    expect(view.getByRole('button', { name: '99+ 条新消息' })).not.toBeNull()
    expect(view.queryByRole('button', { name: '回到底部' })).toBeNull()
  })

  it('waits for manual scrolling to end before following once at the bottom', () => {
    const view = render(createElement(MessageList, null, testRows('current')))
    reportBottom(true)
    beginManualScroll(view)

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
    setBounds(item, 0, 50)

    beginManualScroll(view)
    expect(virtuosoHandle.scrollToIndex).not.toHaveBeenCalled()

    reportBottom(false)
    expect(virtuosoHandle.scrollToIndex).not.toHaveBeenCalled()

    scrollParent.scrollTop = 100
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
    setBounds(fullItem, 20, 80)

    beginManualScroll(view)
    reportBottom(false)
    expect(virtuosoHandle.scrollToIndex).not.toHaveBeenCalled()

    scrollParent.scrollTop = 100
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
    reportBottom(false)
    scrollParent.scrollTop = 100
    act(() => scrollParent.dispatchEvent(new Event('scroll')))
    reportBottom(false)

    expect(virtuosoHandle.scrollTo).not.toHaveBeenCalled()
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
    reportBottom(false)
    scrollParent.scrollTop = 100
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
