import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { isReconnectAvailable } from '.'

describe('reconnect action availability', () => {
  it.each([
    { joined: true, reconnecting: false, available: true },
    { joined: false, reconnecting: false, available: false },
    { joined: true, reconnecting: true, available: false }
  ])('returns $available for joined=$joined active=$reconnecting', (state) => {
    expect(isReconnectAvailable(state.joined, state.reconnecting)).toBe(state.available)
  })

  it('preserves panel state, binds native pending UI, and dispatches directly once enabled', () => {
    const source = readFileSync(new URL('./index.tsx', import.meta.url), 'utf8')

    expect(source).toContain('const reconnectAvailable = isReconnectAvailable(chatRoomJoined, reconnecting)')
    expect(source).toContain('disabled={!reconnectAvailable}')
    expect(source).toContain("reconnecting && 'animate-spin'")
    expect(source).not.toContain('isReconnectAvailable(appOpenStatus')
    expect(source).not.toContain('Open WebChat to reconnect this site')
    expect(source).not.toMatch(/Ready|success|result badge/i)
    expect(source).toMatch(
      /const handleReconnectSite = useCallback\(\(\) => \{\s*send\(chatRoomDomain\.command\.ReconnectCommand\(\)\)\s*\}/
    )
  })
})
