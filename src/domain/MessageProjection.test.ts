import { describe, expect, it } from 'vitest'
import { MESSAGE_RECORD_TYPE, NOTICE_TYPE, type MessageRecord } from '@/domain/Message'
import { projectRecords } from '@/domain/MessageProjection'
import { MESSAGE_TYPE, REACTION_TYPE } from '@/protocol/ChatRoom'

const AUTHOR = { id: 'author', name: 'Author', avatar: '' }
const REACTOR = { id: 'reactor', name: 'Reactor', avatar: '' }

const text: MessageRecord = {
  type: MESSAGE_RECORD_TYPE.CHAT_MESSAGE,
  id: 'text-1',
  message: {
    type: MESSAGE_TYPE.TEXT,
    id: 'text-1',
    hlc: { timestamp: 1, counter: 0 },
    userId: AUTHOR.id,
    body: 'hello',
    mentions: []
  },
  user: AUTHOR,
  receivedAt: 1
}

const reaction = (id: string, counter: number, active: boolean): MessageRecord => ({
  type: MESSAGE_RECORD_TYPE.CHAT_MESSAGE,
  id,
  message: {
    type: MESSAGE_TYPE.REACTION,
    id,
    hlc: { timestamp: 2, counter },
    targetId: 'text-1',
    userId: REACTOR.id,
    reaction: REACTION_TYPE.LIKE,
    active
  },
  user: REACTOR,
  receivedAt: 2
})

describe('MessageProjection', () => {
  it('applies reaction LWW independently of arrival order', () => {
    const inactive = reaction('reaction-z', 2, false)
    const active = reaction('reaction-a', 1, true)

    expect(projectRecords([text, inactive, active])[0]).toMatchObject({ reactions: { likes: [], hates: [] } })
    expect(projectRecords([text, active, inactive])[0]).toMatchObject({ reactions: { likes: [], hates: [] } })
  })

  it('projects nested local notices without exposing their storage wrapper', () => {
    const notice: MessageRecord = {
      type: MESSAGE_RECORD_TYPE.SYSTEM_NOTICE,
      id: 'notice-1',
      notice: {
        id: 'notice-1',
        hlc: { timestamp: 3, counter: 0 },
        type: NOTICE_TYPE.JOIN,
        body: 'joined'
      },
      user: AUTHOR,
      receivedAt: 3
    }

    expect(projectRecords([notice])).toEqual([
      {
        type: MESSAGE_RECORD_TYPE.SYSTEM_NOTICE,
        id: 'notice-1',
        hlc: { timestamp: 3, counter: 0 },
        receivedAt: 3,
        user: AUTHOR,
        body: 'joined',
        noticeType: NOTICE_TYPE.JOIN
      }
    ])
  })
})
