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
  ChatRoomMessageSchema,
  type ChatRoomMessage,
  type WorldRoomMessage
} from '@/protocol'

const NOW = 1_800_000_000_000
const USER = { id: 'user-1', name: 'User', avatar: '' }

const parseChat = (value: unknown): ChatRoomMessage | null => {
  const parsed = v.safeParse(ChatRoomMessageSchema, value)
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
    expect(MAX_WIRE_BYTES).toBe(256 * 1024)
    expect(MAX_DECODED_JSON_BYTES).toBe(1024 * 1024)
    expect(MAX_CHAT_EVENT_BYTES).toBe(192 * 1024)
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

  it('requires causal logical-presence generations and rejects the removed end type', () => {
    const session = {
      type: MESSAGE_TYPE.SESSION,
      sessionId: 'session-1',
      presenceId: 'presence-1',
      joinedAt: NOW,
      user: USER
    }

    expect(parseChat(session)).toEqual(session)
    for (const joinedAt of [undefined, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, Number.MAX_SAFE_INTEGER + 1]) {
      expect(parseChat({ ...session, joinedAt })).toBeNull()
    }
    expect(parseChat({ ...session, generation: session.presenceId })).toBeNull()
    expect(parseChat({ ...session, presenceId: '' })).toBeNull()
    // The v5 Chat schema contains no end surface: `session-end` is rejected as an unknown type.
    expect(parseChat({ type: 'session-end', presenceId: 'presence-1' })).toBeNull()
    expect(parseChat({ type: 'session-end', presenceId: 'presence-1', sessionId: session.sessionId })).toBeNull()
    expect(parseChat({ type: 'session-end' })).toBeNull()
  })

  it('accepts only the current sync, mention, and history keys', () => {
    const pull = {
      type: MESSAGE_TYPE.HISTORY_MESSAGES_PULL,
      syncId: 'sync-1',
      page: 0,
      messageIds: [],
      done: true
    }
    expect(parseChat(pull)).toEqual(pull)
    // Every safe-integer field is directly covered for non-finite values: page, and HLC
    // timestamp/counter inside text and reaction messages.
    for (const page of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY, Number.MAX_SAFE_INTEGER + 1]) {
      expect(parseChat({ ...pull, page })).toBeNull()
    }
    for (const timestamp of [Number.NaN, Number.POSITIVE_INFINITY, Number.MAX_SAFE_INTEGER + 1]) {
      expect(parseChat({ ...text(), hlc: { timestamp, counter: 0 } })).toBeNull()
    }
    for (const counter of [Number.NaN, Number.POSITIVE_INFINITY, Number.MAX_SAFE_INTEGER + 1]) {
      expect(parseChat({ ...text(), hlc: { timestamp: 1, counter } })).toBeNull()
    }
    expect(parseChat({ ...pull, requestId: 'legacy' })).toBeNull()
    expect(parseChat({ type: pull.type, requestId: 'legacy' })).toBeNull()
    expect(parseChat({ type: pull.type })).toBeNull()
    expect(parseChat({ ...pull, unknown: true })).toBeNull()
    expect(parseChat({ ...pull, page: -1 })).toBeNull()
    expect(parseChat({ ...pull, page: 1.5 })).toBeNull()
    // Old cursor shapes and keys are absent.
    expect(parseChat({ type: 'history-request', syncId: 'sync-1' })).toBeNull()
    expect(parseChat({ ...pull, before: { hlc: { timestamp: 1, counter: 0 }, id: 'x' } })).toBeNull()
    expect(parseChat({ ...pull, snapshotId: 'snap' })).toBeNull()
    expect(parseChat({ ...pull, nextBefore: { hlc: { timestamp: 1, counter: 0 }, id: 'x' } })).toBeNull()

    const mentionedText = {
      ...text(),
      mentions: [{ ...USER, ranges: [[0, 4]] }]
    }
    expect(parseChat(mentionedText)).toEqual(mentionedText)
    expect(parseChat({ ...mentionedText, mentions: [{ ...USER, ranges: [[0, 4]], positions: [[0, 4]] }] })).toBeNull()
    expect(parseChat({ ...mentionedText, mentions: [{ ...USER, positions: [[0, 4]] }] })).toBeNull()
    expect(parseChat({ ...mentionedText, mentions: [USER] })).toBeNull()
    expect(parseChat({ ...mentionedText, mentions: [{ ...USER, ranges: [[0, 4]], unknown: true }] })).toBeNull()

    const push = {
      type: MESSAGE_TYPE.HISTORY_MESSAGES_PUSH,
      syncId: 'sync-1',
      page: 0,
      users: [USER],
      messages: [text()],
      done: true
    }
    expect(parseChat(push)).toEqual(push)
    expect(parseChat({ ...push, events: push.messages })).toBeNull()
    expect(
      parseChat({
        type: push.type,
        syncId: push.syncId,
        page: push.page,
        users: push.users,
        events: push.messages,
        done: push.done
      })
    ).toBeNull()
    expect(
      parseChat({
        type: push.type,
        syncId: push.syncId,
        page: push.page,
        users: push.users,
        done: push.done
      })
    ).toBeNull()
    expect(parseChat({ ...push, unknown: true })).toBeNull()
    expect(parseChat({ ...push, page: -1 })).toBeNull()
    expect(parseChat({ type: 'history-response', syncId: 'sync-1', users: [], messages: [], done: true })).toBeNull()
  })

  it('accepts exact declarative field and array ceilings and rejects one more', () => {
    const eventBase = { ...text(), body: '' }
    // The body field ceiling is declarative (MAX_CHAT_EVENT_BYTES characters).
    const exactBody = { ...eventBase, body: 'x'.repeat(MAX_CHAT_EVENT_BYTES) }
    expect(parseChat(exactBody)).not.toBeNull()
    expect(parseChat({ ...exactBody, body: `${exactBody.body}x` })).toBeNull()

    const push = {
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
    expect(parseChat(push)).toEqual(push)
    const oversized = { ...push, messages: [...push.messages, { ...text(), id: 'event-over-limit' }] }
    expect(parseChat(oversized)).toBeNull()
  })

  it('rejects invalid World payloads with strict keys (the World schema has no numeric fields)', () => {
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
  })

  it('does not expose application or internal Runtime values from the public entry', () => {
    expect(protocol).not.toHaveProperty('SYSTEM_NOTICE')
    expect(protocol).not.toHaveProperty('WirePipeline')
    expect(protocol).not.toHaveProperty('RUNTIME_NAMESPACE_PREFIX')
  })

  it('exports exactly the declarative schemas, inferred types surface, limits, constants, and codec', () => {
    // The public entry exposes only the schema-owned data authority: schemas, constants/limits,
    // and the codec surface; no standalone validator, factory, or duplicate alias exists.
    expect(Object.keys(protocol).sort()).toEqual(
      [
        'ChatMessageSchema',
        'ChatRoomMessageSchema',
        'ChatSessionSchema',
        'ChatSiteSchema',
        'ChatUserSchema',
        'HLCSchema',
        'HistoryMessagesPullSchema',
        'HistoryMessagesPushSchema',
        'MAX_CHAT_EVENT_BYTES',
        'MAX_DECODED_JSON_BYTES',
        'MAX_HISTORY_RESPONSE_MESSAGES',
        'MAX_USER_BYTES',
        'MAX_WIRE_BYTES',
        'MESSAGE_TYPE',
        'MentionedUserSchema',
        'NativeWireCodec',
        'REACTION_TYPE',
        'ReactionMessageSchema',
        'ReactionTypeSchema',
        'SessionMessageSchema',
        'TextMessageSchema',
        'WireCodecError',
        'WorldRoomMessageSchema'
      ].sort()
    )
  })

  it('does not export standalone validators, schema factories, handwritten duplicates, or legacy names', () => {
    for (const name of [
      'parseChatRoomMessage',
      'SessionEndMessage',
      'SessionEndMessageSchema',
      'parseWorldRoomMessage',
      'checkChatRoomMessage',
      'checkWorldRoomMessage',
      'isUserWithinLimit',
      'isMessageWithinLimit',
      'isHLCInRange',
      'isChatRoomMessageSemanticallyValid',
      'isWireFrameWithinLimit',
      'isHistoryPageFrameWithinLimit',
      'createChatRoomMessageSchema',
      'createChatMessageSchema',
      'CompleteChatRoomMessage',
      'HistoryMessagesRequest',
      'HistoryMessagesRequestSchema',
      'HistoryMessagesResponse',
      'HistoryMessagesResponseSchema'
    ]) {
      expect(protocol).not.toHaveProperty(name)
    }
  })
})
