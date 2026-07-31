import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { getReconnectLabel } from '.'

describe('reconnect action availability', () => {
  it.each([
    {
      state: { userConfigured: false, joined: false, reconnecting: false, available: false },
      label: 'Refresh unavailable until your profile is set up'
    },
    {
      state: { userConfigured: true, joined: false, reconnecting: false, available: false },
      label: 'Connecting this site chat'
    },
    {
      state: { userConfigured: true, joined: false, reconnecting: false, available: true },
      label: 'Retry connecting this site chat'
    },
    {
      state: { userConfigured: true, joined: true, reconnecting: true, available: false },
      label: 'Reconnecting this site'
    },
    {
      state: { userConfigured: true, joined: true, reconnecting: false, available: true },
      label: 'Reconnect this site'
    }
  ])('returns the accessible $label label', ({ state, label }) => {
    expect(getReconnectLabel(state)).toBe(label)
  })

  it('uses the Domain eligibility truth while preserving panel state and native pending UI', () => {
    const source = readFileSync(new URL('./index.tsx', import.meta.url), 'utf8')

    expect(source).toContain(
      'const reconnectAvailable = useRemeshQuery(chatRoomDomain.query.ReconnectAvailableQuery())'
    )
    expect(source).toContain('disabled={!reconnectAvailable}')
    expect(source).toContain("reconnecting && 'animate-spin'")
    expect(source).not.toContain('ReconnectAvailableQuery(appOpenStatus')
    expect(source).not.toContain('isReconnectAvailable')
    expect(source).not.toContain('Open WebChat to reconnect this site')
    expect(source).not.toMatch(/Ready|success|result badge/i)
    expect(source).toMatch(
      /const handleReconnectSite = useCallback\(\(\) => \{\s*send\(chatRoomDomain\.command\.ReconnectCommand\(\)\)\s*\}/
    )
  })

  it('projects direct, automatic, recovery, and manual connection loading through one control query', () => {
    const source = readFileSync(new URL('./index.tsx', import.meta.url), 'utf8')

    expect(source).toContain('const reconnecting = useRemeshQuery(chatRoomDomain.query.ConnectionIsLoadingQuery())')
    expect(source).toContain('disabled={!reconnectAvailable}')
    expect(source).toContain("reconnecting && 'animate-spin'")
    expect(source).not.toContain('query.ReconnectIsLoadingQuery()')
  })

  it('keeps pre-ready Refresh reachable without constructing ready-only domains', () => {
    const source = readFileSync(new URL('./index.tsx', import.meta.url), 'utf8')
    const initializationMenuStart = source.indexOf('const InitializationAppButtonMenu')
    const applicationMenuStart = source.indexOf('const ApplicationAppButtonMenu')
    const initializationMenu = source.slice(initializationMenuStart, applicationMenuStart)

    expect(initializationMenuStart).toBeGreaterThan(-1)
    expect(applicationMenuStart).toBeGreaterThan(initializationMenuStart)
    expect(initializationMenu).toContain("initializationPhase === 'connecting'")
    expect(initializationMenu).toContain('disabled={connecting}')
    expect(initializationMenu).toContain("connecting && 'animate-spin'")
    expect(initializationMenu).toContain('onClick={onInitializationRetry}')
    expect(initializationMenu).toContain('Retry WebChat setup')
    expect(initializationMenu).not.toMatch(/ChatRoomDomain|UserInfoDomain|AppActionDomain|ReconnectCommand/)
    expect(source).toContain('onContextMenu={handleToggleMenu}')
    expect(source).not.toContain('onContextMenu={applicationAvailable ? handleToggleMenu : undefined}')
  })

  it('does not persist automatic default position before shell status hydration', () => {
    const source = readFileSync(new URL('./index.tsx', import.meta.url), 'utf8')
    const resizeEffect = source.slice(source.indexOf('useWindowResize(() => {'), source.indexOf('const {\n    x,'))

    expect(source).toContain(
      'const statusLoadIsFinished = useRemeshQuery(appStatusDomain.query.StatusLoadIsFinishedQuery())'
    )
    expect(resizeEffect.indexOf('if (!statusLoadIsFinished) return')).toBeGreaterThan(-1)
    expect(resizeEffect.indexOf('if (!statusLoadIsFinished) return')).toBeLessThan(
      resizeEffect.indexOf('send(appStatusDomain.command.UpdatePositionCommand')
    )
    expect(source).toContain('const positionPersistenceStarted = useRef(false)')
    expect(source).toMatch(
      /useEffect\(\(\) => \{\s*if \(!statusLoadIsFinished\) return\s*if \(!positionPersistenceStarted\.current\) \{[\s\S]*?return\s*\}\s*send\(appStatusDomain\.command\.UpdatePositionCommand\(\{ x, y \}\)\)/
    )
  })
})
