import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { isReconnectAvailable } from '.'

describe('reconnect action availability', () => {
  it.each([
    { panelOpen: true, joined: true, reconnecting: false, available: true },
    { panelOpen: false, joined: true, reconnecting: false, available: false },
    { panelOpen: true, joined: false, reconnecting: false, available: false },
    { panelOpen: true, joined: true, reconnecting: true, available: false }
  ])('returns $available for panel=$panelOpen joined=$joined active=$reconnecting', (state) => {
    expect(isReconnectAvailable(state.panelOpen, state.joined, state.reconnecting)).toBe(state.available)
  })

  it('binds native disabled to the shared availability and dispatches directly once enabled', () => {
    const source = readFileSync(new URL('./index.tsx', import.meta.url), 'utf8')

    expect(source).toContain('disabled={!reconnectAvailable}')
    expect(source).toMatch(
      /const handleReconnectSite = useCallback\(\(\) => \{\s*send\(chatRoomDomain\.command\.ReconnectCommand\(\)\)\s*\}/
    )
  })
})
