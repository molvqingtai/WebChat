import { createElement, type ReactElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import type { VirtuosoProps } from 'react-virtuoso'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { MESSAGE_RECORD_TYPE, NOTICE_TYPE, type DisplayMessage, type SystemNoticeMessage } from '@/domain/Message'
import MessageList from './message-list'
import NoticeGroup from './notice-group'
import { groupAdjacentNotices, messageRowKey, type GroupedMessage } from './notice-grouping'
import NoticeItem from './notice-item'

interface VirtuosoCall {
  keys: (string | number | bigint)[]
}

const virtuosoCalls = vi.hoisted(() => [] as VirtuosoCall[])

vi.mock('react-virtuoso', async () => {
  const React = await import('react')
  return {
    Virtuoso: ({ data = [], computeItemKey, itemContent }: VirtuosoProps<ReactElement, unknown>) => {
      if (!computeItemKey || !itemContent) throw new TypeError('Virtuoso list callbacks are required')
      const keys = data.map((item, index) => computeItemKey(index, item, undefined))
      virtuosoCalls.push({ keys })
      return React.createElement(
        'div',
        null,
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
  renderToStaticMarkup(
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
})

describe('MessageList Virtuoso integration', () => {
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

  it('fails explicitly rather than substituting an array index for a missing row key', () => {
    expect(() => renderToStaticMarkup(createElement(MessageList, null, [createElement('div')]))).toThrow(
      'MessageList items require a stable key'
    )
  })
})
