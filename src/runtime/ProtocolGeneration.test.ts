import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { getChatRoomId, getWorldRoomId } from '@/runtime/Server'
import stringToHex from '@/utils/stringToHex'

describe('current peer protocol generation', () => {
  it('uses only the v5 Chat and World physical namespaces', () => {
    expect(getChatRoomId('https://example.com')).toBe(stringToHex('WEB_CHAT_CHAT_ROOM_V5:https://example.com'))
    expect(getWorldRoomId()).toBe(stringToHex('WEB_CHAT_WORLD_ROOM_V5'))
  })

  it('labels current Session and Wire rejection diagnostics as v5', () => {
    const session = readFileSync(path.resolve(process.cwd(), 'src/domain/runtime/Session.ts'), 'utf8')
    const wire = readFileSync(path.resolve(process.cwd(), 'src/domain/runtime/Wire.ts'), 'utf8')

    // Local production no longer revalidates protocol shape, so those diagnostics are gone;
    // the remaining Wire rejection diagnostic keeps the v5 label.
    expect(session).not.toContain('Message exceeds the v5 event contract')
    expect(wire).toContain('Dropped v5 frame')
    expect(`${session}\n${wire}`).not.toMatch(/\bv4\b/)
  })
})
