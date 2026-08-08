import { describe, expect, it } from 'vitest'
import * as v from 'valibot'
import * as protocol from '@/protocol'
import {
  MAX_CHAT_EVENT_BYTES,
  MAX_DECODED_JSON_BYTES,
  MAX_HISTORY_RESPONSE_MESSAGES,
  MAX_USER_BYTES,
  MAX_WIRE_BYTES,
  MESSAGE_TYPE,
  WorldRoomMessageSchema,
  createChatRoomMessageSchema,
  type ChatRoomMessage,
  type WorldRoomMessage
} from '@/protocol'

const NOW = 1_800_000_000_000
const USER = { id: 'user-1', name: 'User', avatar: '' }
const byteSize = (value: unknown) => new TextEncoder().encode(JSON.stringify(value)).byteLength

const parseChat = (value: unknown): ChatRoomMessage | null => {
  const parsed = v.safeParse(createChatRoomMessageSchema(NOW), value)
  return parsed.success ? parsed.output : null
}

const parseWorld = (value: unknown): WorldRoomMessage | null => {
  const parsed = v.safeParse(WorldRoomMessageSchema, value)
  return parsed.success ? parsed.output : null
}

const text = () => ({
  type: MESSAGE_TYPE.TEXT,
  id: 'event-1',
  hlc: { timestamp: NOW, counter: 0 },
  userId: USER.id,
  body: 'hello',
  mentions: []
})

describe('public protocol schema contract', () => {
  it('exports the five independently enforced resource budgets', () => {
    expect(MAX_WIRE_BYTES).toBe(64 * 1024)
    expect(MAX_DECODED_JSON_BYTES).toBe(256 * 1024)
    expect(MAX_CHAT_EVENT_BYTES).toBe(48 * 1024)
    expect(MAX_USER_BYTES).toBe(8 * 1024)
    expect(MAX_HISTORY_RESPONSE_MESSAGES).toBe(100)
  })

  it('uses closed unions and rejects every self-reported or redundant envelope field', () => {
    for (const forbidden of ['peerId', 'room', 'roomId', 'sender', 'version', 'sentAt', 'receivedAt']) {
      expect(parseChat({ ...text(), [forbidden]: 'self-reported' })).toBeNull()
    }
    expect(parseChat({ ...text(), unknown: true })).toBeNull()
    expect(parseChat({ type: 'unknown' })).toBeNull()
  })

  it('requires causal logical-presence generations and strict final-end facts', () => {
    const session = {
      type: MESSAGE_TYPE.SESSION,
      sessionId: 'session-1',
      presenceId: 'presence-1',
      joinedAt: NOW,
      user: USER
    }
    const end = { type: MESSAGE_TYPE.SESSION_END, presenceId: 'presence-1' }

    expect(parseChat(session)).toEqual(session)
    for (const joinedAt of [undefined, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, Number.MAX_SAFE_INTEGER + 1]) {
      expect(parseChat({ ...session, joinedAt })).toBeNull()
    }
    expect(parseChat({ ...session, generation: session.presenceId })).toBeNull()
    expect(parseChat({ ...session, presenceId: '' })).toBeNull()
    expect(parseChat(end)).toEqual(end)
    expect(parseChat({ ...end, sessionId: session.sessionId })).toBeNull()
    expect(parseChat({ ...end, presenceId: '' })).toBeNull()
    expect(parseChat({ type: MESSAGE_TYPE.SESSION_END })).toBeNull()
  })

  it('accepts only the current sync, mention-range, and history-message keys', () => {
    const request = {
      type: MESSAGE_TYPE.HISTORY_MESSAGES_PULL,
      syncId: 'sync-1',
      page: 0,
      messageIds: [],
      done: true
    }
    expect(parseChat(request)).toEqual(request)
    expect(parseChat({ ...request, requestId: 'legacy' })).toBeNull()
    expect(parseChat({ type: request.type, requestId: 'legacy' })).toBeNull()
    expect(parseChat({ type: request.type })).toBeNull()
    expect(parseChat({ ...request, unknown: true })).toBeNull()
    expect(parseChat({ ...request, page: -1 })).toBeNull()
    expect(parseChat({ ...request, page: 1.5 })).toBeNull()
    // Old cursor shapes and keys are absent.
    expect(parseChat({ type: 'history-request', syncId: 'sync-1' })).toBeNull()
    expect(parseChat({ ...request, before: { hlc: { timestamp: 1, counter: 0 }, id: 'x' } })).toBeNull()
    expect(parseChat({ ...request, snapshotId: 'snap' })).toBeNull()
    expect(parseChat({ ...request, nextBefore: { hlc: { timestamp: 1, counter: 0 }, id: 'x' } })).toBeNull()

    const mentionedText = {
      ...text(),
      mentions: [{ ...USER, ranges: [[0, 4]] }]
    }
    expect(parseChat(mentionedText)).toEqual(mentionedText)
    expect(parseChat({ ...mentionedText, mentions: [{ ...USER, ranges: [[0, 4]], positions: [[0, 4]] }] })).toBeNull()
    expect(parseChat({ ...mentionedText, mentions: [{ ...USER, positions: [[0, 4]] }] })).toBeNull()
    expect(parseChat({ ...mentionedText, mentions: [USER] })).toBeNull()
    expect(parseChat({ ...mentionedText, mentions: [{ ...USER, ranges: [[0, 4]], unknown: true }] })).toBeNull()

    const response = {
      type: MESSAGE_TYPE.HISTORY_MESSAGES_PUSH,
      syncId: 'sync-1',
      page: 0,
      users: [USER],
      messages: [text()],
      done: true
    }
    expect(parseChat(response)).toEqual(response)
    expect(parseChat({ ...response, events: response.messages })).toBeNull()
    expect(
      parseChat({
        type: response.type,
        syncId: response.syncId,
        page: response.page,
        users: response.users,
        events: response.messages,
        done: response.done
      })
    ).toBeNull()
    expect(
      parseChat({
        type: response.type,
        syncId: response.syncId,
        page: response.page,
        users: response.users,
        done: response.done
      })
    ).toBeNull()
    expect(parseChat({ ...response, unknown: true })).toBeNull()
    expect(parseChat({ ...response, page: -1 })).toBeNull()
    expect(parseChat({ type: 'history-response', syncId: 'sync-1', users: [], messages: [], done: true })).toBeNull()
  })

  it('validates inclusive UTF-16 mention ranges against body code units', () => {
    const body = 'a😀b'
    expect(body.length).toBe(4)
    expect(
      parseChat({
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
      })
    ).not.toBeNull()
    expect(parseChat({ ...text(), body, mentions: [{ ...USER, ranges: [[2, 1]] }] })).toBeNull()
    expect(parseChat({ ...text(), body, mentions: [{ ...USER, ranges: [[4, 4]] }] })).toBeNull()
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
    expect(parseChat(message)).toBeNull()
  })

  it('requires an explicit clock and rejects future HLC without hidden wall-clock access', () => {
    expect(parseChat(text())).not.toBeNull()
    expect(parseChat({ ...text(), hlc: { timestamp: NOW + 5 * 60 * 1000 + 1, counter: 0 } })).toBeNull()
    // A different explicit now changes the acceptance window.
    const parsedLater = v.safeParse(createChatRoomMessageSchema(NOW + 10 * 60 * 1000), text())
    expect(parsedLater.success).toBe(true)
  })

  it('accepts exact User/event byte ceilings and rejects values one byte larger', () => {
    const eventBase = { ...text(), body: '' }
    const exactEvent = { ...eventBase, body: 'x'.repeat(MAX_CHAT_EVENT_BYTES - byteSize(eventBase)) }
    expect(byteSize(exactEvent)).toBe(MAX_CHAT_EVENT_BYTES)
    expect(parseChat(exactEvent)).not.toBeNull()
    expect(parseChat({ ...exactEvent, body: `${exactEvent.body}x` })).toBeNull()

    const userBase = { ...USER, avatar: '' }
    const exactUser = { ...userBase, avatar: 'x'.repeat(MAX_USER_BYTES - byteSize(userBase)) }
    expect(byteSize(exactUser)).toBe(MAX_USER_BYTES)
    expect(
      parseChat({
        type: MESSAGE_TYPE.SESSION,
        sessionId: 'session-1',
        presenceId: 'presence-1',
        joinedAt: NOW,
        user: exactUser
      })
    ).not.toBeNull()
    expect(
      parseChat({
        type: MESSAGE_TYPE.SESSION,
        sessionId: 'session-1',
        presenceId: 'presence-1',
        joinedAt: NOW,
        user: { ...exactUser, avatar: `${exactUser.avatar}x` }
      })
    ).toBeNull()
  })

  it('keeps history references complete, accepts extra users, and rejects duplicate ids', () => {
    const reaction = {
      type: MESSAGE_TYPE.REACTION,
      id: 'reaction-1',
      hlc: { timestamp: NOW, counter: 1 },
      targetId: 'event-1',
      userId: 'actor-1',
      reaction: 'like' as const,
      active: true
    }
    expect(
      parseChat({
        type: MESSAGE_TYPE.HISTORY_MESSAGES_PUSH,
        syncId: 'request-1',
        page: 0,
        users: [USER],
        messages: [text(), reaction],
        done: true
      })
    ).toBeNull()
    const complete = {
      type: MESSAGE_TYPE.HISTORY_MESSAGES_PUSH,
      syncId: 'request-1',
      page: 0,
      users: [USER, { id: 'actor-1', name: 'Actor', avatar: '' }],
      messages: [text(), reaction],
      done: true
    }
    expect(parseChat(complete)).not.toBeNull()
    expect(
      parseChat({ ...complete, users: [...complete.users, { id: 'unused', name: 'Unused', avatar: '' }] })
    ).not.toBeNull()
    expect(parseChat({ ...complete, users: [USER, USER, complete.users[1]] })).toBeNull()
  })

  it('accepts the exact public history message count and rejects one more', () => {
    const response = {
      type: MESSAGE_TYPE.HISTORY_MESSAGES_PUSH,
      syncId: 'request-1',
      page: 0,
      users: [USER],
      messages: Array.from({ length: MAX_HISTORY_RESPONSE_MESSAGES }, (_, index) => ({
        ...text(),
        id: `event-${index}`
      })),
      done: false
    }
    expect(parseChat(response)).toEqual(response)

    const oversized = { ...response, messages: [...response.messages, { ...text(), id: 'event-over-limit' }] }
    expect(parseChat(oversized)).toBeNull()
  })

  it('allows only display-safe ChatSite fields and origin-only URLs', () => {
    const presence = {
      sessionId: 'world-session',
      user: USER,
      sites: [{ origin: 'https://example.com', title: 'Example', icon: '', description: 'ChatSite' }]
    }
    expect(parseWorld(presence)).toEqual(presence)
    expect(parseWorld({ ...presence, type: 'presence' })).toBeNull()
    expect(
      parseWorld({
        ...presence,
        sites: [{ origin: 'https://example.com/private?token=secret', href: 'https://example.com/private' }]
      })
    ).toBeNull()
    expect(parseWorld({ ...presence, sites: [{ origin: 'https://example.com', hostname: 'example.com' }] })).toBeNull()
    expect(
      parseWorld({
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

  it('does not export standalone validators, handwritten duplicates, or post-parse helpers', () => {
    for (const name of [
      'parseChatRoomMessage',
      'parseWorldRoomMessage',
      'checkChatRoomMessage',
      'checkWorldRoomMessage',
      'isUserWithinLimit',
      'isMessageWithinLimit',
      'isHLCInRange',
      'isChatRoomMessageSemanticallyValid'
    ]) {
      expect(protocol).not.toHaveProperty(name)
    }
  })
})
