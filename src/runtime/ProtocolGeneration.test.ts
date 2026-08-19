import { describe, expect, it } from 'vitest'
import { getChatRoomId, getWorldRoomId } from '@/runtime/Server'
import stringToHex from '@/utils/stringToHex'

describe('current peer protocol generation', () => {
  it('uses only the v5 Chat and World physical namespaces', () => {
    expect(getChatRoomId('https://example.com')).toBe(stringToHex('WEB_CHAT_CHAT_ROOM_V5:https://example.com'))
    expect(getWorldRoomId()).toBe(stringToHex('WEB_CHAT_WORLD_ROOM_V5'))
  })
})
