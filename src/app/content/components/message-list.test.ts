import { createElement, useEffect, type ReactElement, type Ref } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { act, cleanup, render } from '@testing-library/react'
import type { VirtuosoProps } from 'react-virtuoso'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { MESSAGE_RECORD_TYPE, NOTICE_TYPE, type DisplayMessage, type SystemNoticeMessage } from '@/domain/Message'
import MessageList from './message-list'
import NoticeGroup from './notice-group'
import { groupAdjacentNotices, messageRowKey, type GroupedMessage } from './notice-grouping'
import NoticeItem from './notice-item'

interface VirtuosoCall {
  alignToBottom?: boolean
  customScrollParent?: HTMLElement
  data: readonly ReactElement[]
  followOutput?: VirtuosoProps<ReactElement, unknown>['followOutput']
  initialTopMostItemIndex?: VirtuosoProps<ReactElement, unknown>['initialTopMostItemIndex']
  keys: (string | number | bigint)[]
}

const virtuosoCalls = vi.hoisted(() => [] as VirtuosoCall[])
const virtuosoLifecycle = vi.hoisted(() => ({ mounts: 0, unmounts: 0 }))
const scrollAreaRefControl = vi.hoisted(() => ({ manual: false, ref: null as Ref<HTMLDivElement> | null }))

vi.mock('@/components/ui/scroll-area', async () => {
  const React = await import('react')
  return {
    ScrollArea: ({ children, ref }: { children?: ReactElement; ref?: React.Ref<HTMLDivElement> }) => {
      scrollAreaRefControl.ref = ref ?? null
      return React.createElement(
        'div',
        { 'data-testid': 'scroll-area' },
        React.createElement('div', { ref: scrollAreaRefControl.manual ? undefined : ref }, children)
      )
    }
  }
})

vi.mock('react-virtuoso', async () => {
  const React = await import('react')
  return {
    Virtuoso: (props: VirtuosoProps<ReactElement, unknown>) => {
      const {
        alignToBottom,
        customScrollParent,
        data = [],
        followOutput,
        initialTopMostItemIndex,
        computeItemKey,
        itemContent
      } = props
      if (!computeItemKey || !itemContent) throw new TypeError('Virtuoso list callbacks are required')
      const keys = data.map((item, index) => computeItemKey(index, item, undefined))
      virtuosoCalls.push({ alignToBottom, customScrollParent, data, followOutput, initialTopMostItemIndex, keys })
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
          React.createElement(React.Fragment, { key: keys[index] }, itemContent(index, item, undefined))
        )
      )
    }
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

beforeEach(() => {
  virtuosoCalls.length = 0
  virtuosoLifecycle.mounts = 0
  virtuosoLifecycle.unmounts = 0
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

  it('smooth-follows only when Virtuoso reports that the list was already at the bottom', () => {
    renderRows([text('message', 1)])

    const followOutput = virtuosoCalls.at(-1)?.followOutput
    expect(typeof followOutput).toBe('function')
    expect((followOutput as (isAtBottom: boolean) => false | 'smooth')(true)).toBe('smooth')
    expect((followOutput as (isAtBottom: boolean) => false | 'smooth')(false)).toBe(false)
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
