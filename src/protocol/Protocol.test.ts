import { describe, expect, it } from 'vitest'
import * as protocol from '@/protocol'
import {
  MAX_CHAT_EVENT_BYTES,
  MAX_DECODED_JSON_BYTES,
  MAX_HISTORY_RESPONSE_MESSAGES,
  MAX_USER_BYTES,
  MAX_WIRE_BYTES,
  MESSAGE_TYPE,
  checkChatRoomMessage,
  parseChatRoomMessage,
  parseWorldRoomMessage
} from '@/protocol'

const NOW = 1_800_000_000_000
const USER = { id: 'user-1', name: 'User', avatar: '' }
const byteSize = (value: unknown) => new TextEncoder().encode(JSON.stringify(value)).byteLength

const text = () => ({
  type: MESSAGE_TYPE.TEXT,
  id: 'event-1',
  hlc: { timestamp: NOW, counter: 0 },
  userId: USER.id,
  body: 'hello',
  mentions: []
})

describe('public v2 protocol contract', () => {
  it('exports the five independently enforced resource budgets', () => {
    expect(MAX_WIRE_BYTES).toBe(64 * 1024)
    expect(MAX_DECODED_JSON_BYTES).toBe(256 * 1024)
    expect(MAX_CHAT_EVENT_BYTES).toBe(48 * 1024)
    expect(MAX_USER_BYTES).toBe(8 * 1024)
    expect(MAX_HISTORY_RESPONSE_MESSAGES).toBe(100)
  })

  it('uses closed unions and rejects every self-reported or redundant envelope field', () => {
    for (const forbidden of ['peerId', 'room', 'roomId', 'sender', 'version', 'sentAt', 'receivedAt']) {
      expect(checkChatRoomMessage({ ...text(), [forbidden]: 'self-reported' }, NOW)).toBe(false)
    }
    expect(checkChatRoomMessage({ ...text(), unknown: true }, NOW)).toBe(false)
    expect(checkChatRoomMessage({ type: 'unknown' }, NOW)).toBe(false)
  })

  it('requires causal logical-presence generations and strict final-end facts', () => {
    const session = {
      type: MESSAGE_TYPE.SESSION,
      sessionId: 'session-1',
      presenceId: 'presence-1',
      user: USER
    }
    const end = { type: MESSAGE_TYPE.SESSION_END, presenceId: 'presence-1' }

    expect(parseChatRoomMessage(session)).toEqual(session)
    expect(parseChatRoomMessage({ type: session.type, sessionId: session.sessionId, user: USER })).toBeNull()
    expect(parseChatRoomMessage({ ...session, generation: session.presenceId })).toBeNull()
    expect(parseChatRoomMessage({ ...session, presenceId: '' })).toBeNull()
    expect(parseChatRoomMessage(end)).toEqual(end)
    expect(parseChatRoomMessage({ ...end, sessionId: session.sessionId })).toBeNull()
    expect(parseChatRoomMessage({ ...end, presenceId: '' })).toBeNull()
    expect(parseChatRoomMessage({ type: MESSAGE_TYPE.SESSION_END })).toBeNull()
  })

  it('accepts only the current sync, mention-range, and history-message keys', () => {
    const request = { type: MESSAGE_TYPE.HISTORY_REQUEST, syncId: 'sync-1' }
    expect(parseChatRoomMessage(request)).toEqual(request)
    expect(parseChatRoomMessage({ ...request, requestId: 'legacy' })).toBeNull()
    expect(parseChatRoomMessage({ type: request.type, requestId: 'legacy' })).toBeNull()
    expect(parseChatRoomMessage({ type: request.type })).toBeNull()
    expect(parseChatRoomMessage({ ...request, unknown: true })).toBeNull()

    const mentionedText = {
      ...text(),
      mentions: [{ ...USER, ranges: [[0, 4]] }]
    }
    expect(parseChatRoomMessage(mentionedText)).toEqual(mentionedText)
    expect(
      parseChatRoomMessage({ ...mentionedText, mentions: [{ ...USER, ranges: [[0, 4]], positions: [[0, 4]] }] })
    ).toBeNull()
    expect(parseChatRoomMessage({ ...mentionedText, mentions: [{ ...USER, positions: [[0, 4]] }] })).toBeNull()
    expect(parseChatRoomMessage({ ...mentionedText, mentions: [USER] })).toBeNull()
    expect(
      parseChatRoomMessage({ ...mentionedText, mentions: [{ ...USER, ranges: [[0, 4]], unknown: true }] })
    ).toBeNull()

    const response = {
      type: MESSAGE_TYPE.HISTORY_RESPONSE,
      syncId: 'sync-1',
      users: [USER],
      messages: [text()],
      done: true
    }
    expect(parseChatRoomMessage(response)).toEqual(response)
    expect(parseChatRoomMessage({ ...response, events: response.messages })).toBeNull()
    expect(
      parseChatRoomMessage({
        type: response.type,
        syncId: response.syncId,
        users: response.users,
        events: response.messages,
        done: response.done
      })
    ).toBeNull()
    expect(
      parseChatRoomMessage({
        type: response.type,
        syncId: response.syncId,
        users: response.users,
        done: response.done
      })
    ).toBeNull()
    expect(parseChatRoomMessage({ ...response, unknown: true })).toBeNull()
  })

  it('validates inclusive UTF-16 mention ranges against body code units', () => {
    const body = 'a😀b'
    expect(body.length).toBe(4)
    expect(
      checkChatRoomMessage(
        {
          ...text(),
          body,
          mentions: [
            {
              ...USER,
              ranges: [
                [1, 2],
                [3, 3]
              ]
            }
          ]
        },
        NOW
      )
    ).toBe(true)
    expect(checkChatRoomMessage({ ...text(), body, mentions: [{ ...USER, ranges: [[2, 1]] }] }, NOW)).toBe(false)
    expect(checkChatRoomMessage({ ...text(), body, mentions: [{ ...USER, ranges: [[4, 4]] }] }, NOW)).toBe(false)
  })

  it('applies the per-user byte limit to every mentioned user', () => {
    const mention = {
      ...USER,
      avatar: '😀'.repeat(2200),
      ranges: [[0, 0]] as [number, number][]
    }
    const message = { ...text(), body: 'x', mentions: [mention] }

    expect(byteSize({ id: mention.id, name: mention.name, avatar: mention.avatar })).toBeGreaterThan(MAX_USER_BYTES)
    expect(byteSize(message)).toBeLessThan(MAX_CHAT_EVENT_BYTES)
    expect(parseChatRoomMessage(message)).toBeNull()
    expect(checkChatRoomMessage(message, NOW)).toBe(false)
  })

  it('requires an explicit clock and rejects future HLC without hidden wall-clock access', () => {
    expect(checkChatRoomMessage(text(), NOW)).toBe(true)
    expect(checkChatRoomMessage({ ...text(), hlc: { timestamp: NOW + 5 * 60 * 1000 + 1, counter: 0 } }, NOW)).toBe(
      false
    )
  })

  it('accepts exact User/event byte ceilings and rejects values one byte larger', () => {
    const eventBase = { ...text(), body: '' }
    const exactEvent = { ...eventBase, body: 'x'.repeat(MAX_CHAT_EVENT_BYTES - byteSize(eventBase)) }
    expect(byteSize(exactEvent)).toBe(MAX_CHAT_EVENT_BYTES)
    expect(checkChatRoomMessage(exactEvent, NOW)).toBe(true)
    expect(checkChatRoomMessage({ ...exactEvent, body: `${exactEvent.body}x` }, NOW)).toBe(false)

    const userBase = { ...USER, avatar: '' }
    const exactUser = { ...userBase, avatar: 'x'.repeat(MAX_USER_BYTES - byteSize(userBase)) }
    expect(byteSize(exactUser)).toBe(MAX_USER_BYTES)
    expect(
      checkChatRoomMessage(
        { type: MESSAGE_TYPE.SESSION, sessionId: 'session-1', presenceId: 'presence-1', user: exactUser },
        NOW
      )
    ).toBe(true)
    expect(
      checkChatRoomMessage(
        {
          type: MESSAGE_TYPE.SESSION,
          sessionId: 'session-1',
          presenceId: 'presence-1',
          user: { ...exactUser, avatar: `${exactUser.avatar}x` }
        },
        NOW
      )
    ).toBe(false)
  })

  it('keeps history references complete, accepts extra users, and rejects duplicate ids', () => {
    const reaction = {
      type: MESSAGE_TYPE.REACTION,
      id: 'reaction-1',
      hlc: { timestamp: NOW, counter: 1 },
      targetId: 'event-1',
      userId: 'actor-1',
      reaction: 'like',
      active: true
    }
    expect(
      checkChatRoomMessage(
        {
          type: MESSAGE_TYPE.HISTORY_RESPONSE,
          syncId: 'request-1',
          users: [USER],
          messages: [text(), reaction],
          done: true
        },
        NOW
      )
    ).toBe(false)
    const complete = {
      type: MESSAGE_TYPE.HISTORY_RESPONSE,
      syncId: 'request-1',
      users: [USER, { id: 'actor-1', name: 'Actor', avatar: '' }],
      messages: [text(), reaction],
      done: true
    }
    expect(checkChatRoomMessage(complete, NOW)).toBe(true)
    expect(
      checkChatRoomMessage(
        { ...complete, users: [...complete.users, { id: 'unused', name: 'Unused', avatar: '' }] },
        NOW
      )
    ).toBe(true)
    expect(checkChatRoomMessage({ ...complete, users: [USER, USER, complete.users[1]] }, NOW)).toBe(false)
  })

  it('accepts the exact public history message count and rejects one more', () => {
    const response = {
      type: MESSAGE_TYPE.HISTORY_RESPONSE,
      syncId: 'request-1',
      users: [USER],
      messages: Array.from({ length: MAX_HISTORY_RESPONSE_MESSAGES }, (_, index) => ({
        ...text(),
        id: `event-${index}`
      })),
      done: false
    }
    expect(parseChatRoomMessage(response)).toEqual(response)
    expect(checkChatRoomMessage(response, NOW)).toBe(true)

    const oversized = { ...response, messages: [...response.messages, { ...text(), id: 'event-over-limit' }] }
    expect(parseChatRoomMessage(oversized)).toBeNull()
    expect(checkChatRoomMessage(oversized, NOW)).toBe(false)
  })

  it('allows only display-safe ChatSite fields and origin-only URLs', () => {
    const presence = {
      sessionId: 'world-session',
      user: USER,
      sites: [{ origin: 'https://example.com', title: 'Example', icon: '', description: 'ChatSite' }]
    }
    expect(parseWorldRoomMessage(presence)).toEqual(presence)
    expect(parseWorldRoomMessage({ ...presence, type: 'presence' })).toBeNull()
    expect(
      parseWorldRoomMessage({
        ...presence,
        sites: [{ origin: 'https://example.com/private?token=secret', href: 'https://example.com/private' }]
      })
    ).toBeNull()
    expect(
      parseWorldRoomMessage({ ...presence, sites: [{ origin: 'https://example.com', hostname: 'example.com' }] })
    ).toBeNull()
    expect(
      parseWorldRoomMessage({
        ...presence,
        sites: [{ origin: 'https://example.com' }, { origin: 'https://example.com' }]
      })
    ).toBeNull()
  })

  it('does not expose application or internal Runtime values from the public entry', () => {
    expect(protocol).not.toHaveProperty('SYSTEM_NOTICE')
    expect(protocol).not.toHaveProperty('WirePipeline')
    expect(protocol).not.toHaveProperty('RUNTIME_NAMESPACE_PREFIX')
  })
})
