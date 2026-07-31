import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { getChatRoomId, getWorldRoomId } from '@/runtime/Server'
import stringToHex from '@/utils/stringToHex'

describe('current peer protocol generation', () => {
  it('uses only the v3 Chat and World physical namespaces', () => {
    expect(getChatRoomId('https://example.com')).toBe(stringToHex('WEB_CHAT_CHAT_ROOM_V3:https://example.com'))
    expect(getWorldRoomId()).toBe(stringToHex('WEB_CHAT_WORLD_ROOM_V3'))
  })

  it('labels current Session and Wire rejection diagnostics as v3', () => {
    const session = readFileSync(path.resolve(process.cwd(), 'src/domain/runtime/Session.ts'), 'utf8')
    const wire = readFileSync(path.resolve(process.cwd(), 'src/domain/runtime/Wire.ts'), 'utf8')

    expect(session).toContain('Message exceeds the v3 event contract')
    expect(session).toContain('Reaction exceeds the v3 event contract')
    expect(session).toContain('Chat message does not match the v3 event contract')
    expect(wire).toContain('Dropped v3 frame')
    expect(`${session}\n${wire}`).not.toMatch(/\bv2\b/)
  })
})
