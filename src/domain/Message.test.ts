import { describe, expect, it } from 'vitest'
import {
  MESSAGE_RECORD_TYPE,
  NOTICE_TYPE,
  compareEventPosition,
  compareMessageRecordPosition,
  getMessageRecordHLC,
  isChatMessageRecord,
  type MessageRecord,
  type TextMessageRecord
} from '@/domain/Message'
import { MESSAGE_TYPE } from '@/protocol/ChatRoom'

const USER = { id: 'user-1', name: 'User', avatar: '' }

const text = (id: string, counter = 0): TextMessageRecord => ({
  type: MESSAGE_RECORD_TYPE.CHAT_MESSAGE,
  id,
  message: {
    type: MESSAGE_TYPE.TEXT,
    id,
    hlc: { timestamp: 1, counter },
    userId: USER.id,
    body: id,
    mentions: []
  },
  user: USER,
  receivedAt: 2
})

describe('MessageRecord model', () => {
  it('uses the outer type as the only record discriminator', () => {
    const chat: MessageRecord = text('message-1')
    const notice: MessageRecord = {
      type: MESSAGE_RECORD_TYPE.SYSTEM_NOTICE,
      id: 'notice-1',
      notice: {
        id: 'notice-1',
        hlc: { timestamp: 1, counter: 0 },
        type: NOTICE_TYPE.JOIN,
        body: 'joined'
      },
      user: USER,
      receivedAt: 2
    }

    expect(isChatMessageRecord(chat)).toBe(true)
    expect(isChatMessageRecord(notice)).toBe(false)
    expect(getMessageRecordHLC(chat)).toEqual(chat.message.hlc)
    expect(getMessageRecordHLC(notice)).toEqual(notice.notice.hlc)
  })

  it('orders equal HLCs by stable record id', () => {
    expect(compareEventPosition(text('a').message, text('z').message)).toBeLessThan(0)
    expect(compareEventPosition(text('z', 0).message, text('a', 1).message)).toBeLessThan(0)
    expect(compareMessageRecordPosition(text('a'), text('z'))).toBeLessThan(0)
  })
})
