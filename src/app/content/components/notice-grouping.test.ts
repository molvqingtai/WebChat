import { describe, expect, it } from 'vitest'
import { MESSAGE_RECORD_TYPE, NOTICE_TYPE, type DisplayMessage, type SystemNoticeMessage } from '@/domain/Message'
import { groupAdjacentNotices, messageRowKey } from './notice-grouping'

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

describe('notice grouping', () => {
  it('leaves a singleton unchanged and groups only adjacent notice runs', () => {
    const singleton = notice('singleton', 1)
    expect(groupAdjacentNotices([singleton])).toEqual([singleton])

    const first = notice('first', 2)
    const latest = notice('latest', 3)
    const separator = text('separator', 4)
    const secondRun = [notice('later-first', 5), notice('later-latest', 6)]
    const grouped = groupAdjacentNotices([first, latest, separator, ...secondRun])

    expect(grouped).toEqual([
      { type: 'notice-group', id: 'notice-group:first', notices: [first, latest] },
      separator,
      { type: 'notice-group', id: 'notice-group:later-first', notices: secondRun }
    ])
  })

  it('keeps a group identity when later notices extend the run', () => {
    const first = notice('first', 1)
    const second = notice('second', 2)
    const third = notice('third', 3)

    expect(groupAdjacentNotices([first, second])[0].id).toBe('notice-group:first')
    expect(groupAdjacentNotices([first, second, third])[0].id).toBe('notice-group:first')
  })

  it('recomputes collision-free groups when late canonical history changes adjacency', () => {
    const first = notice('first', 1)
    const second = notice('second', 2)
    const latest = notice('latest', 3)
    const separator = text('separator', 2.5)

    expect(groupAdjacentNotices([first, second, latest])).toEqual([
      { type: 'notice-group', id: 'notice-group:first', notices: [first, second, latest] }
    ])
    expect(groupAdjacentNotices([first, separator, second, latest])).toEqual([
      first,
      separator,
      { type: 'notice-group', id: 'notice-group:second', notices: [second, latest] }
    ])
  })

  it('projects every row kind into a disjoint identity namespace', () => {
    const singleton = notice('message:singleton', 1)
    const first = notice('single-notice:first', 2)
    const latest = notice('notice-group:latest', 3)
    const group = groupAdjacentNotices([first, latest])[0]

    expect(messageRowKey(text('notice-group:first', 0))).toBe('message:notice-group:first')
    expect(messageRowKey(singleton)).toBe('single-notice:message:singleton')
    expect(messageRowKey(group)).toBe('notice-group:single-notice:first')
  })
})
