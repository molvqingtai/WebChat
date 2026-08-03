import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { getReconnectLabel } from '.'

const source = () => readFileSync(path.resolve(process.cwd(), 'src/app/content/views/app-button/index.tsx'), 'utf8')

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
    const value = source()

    expect(value).toContain('const reconnectAvailable = useRemeshQuery(chatRoomDomain.query.ReconnectAvailableQuery())')
    expect(value).toContain('const refreshDisabled = applicationReady ? !reconnectAvailable : initializationConnecting')
    expect(value).toContain('const refreshLoading = applicationReady ? reconnecting : initializationConnecting')
    expect(value).toContain('disabled={refreshDisabled}')
    expect(value).toContain("refreshLoading && 'animate-spin'")
    expect(value).toMatch(/applicationReady[\s\S]*chatRoomDomain\.command\.ReconnectCommand\(\)/)
  })

  it('projects direct, automatic, recovery, and manual connection loading through one control query', () => {
    const value = source()

    expect(value).toContain('const reconnecting = useRemeshQuery(chatRoomDomain.query.ConnectionIsLoadingQuery())')
    expect(value).toContain('disabled={refreshDisabled}')
    expect(value).toContain("refreshLoading && 'animate-spin'")
  })

  it('keeps one actions menu and dispatches pre-ready Retry from the same Refresh slot', () => {
    const value = source()

    expect(value).toContain('const AppButtonMenu')
    expect(value).toContain('const appStatusDomain = useRemeshDomain(AppStatusDomain())')
    expect(value).toContain("const initializationConnecting = initializationPhase === 'connecting'")
    expect(value).toContain("'Retry WebChat setup'")
    expect(value).toContain('appStatusDomain.command.RetryCommand()')
    expect(value).toMatch(
      /applicationReady\s*\?\s*chatRoomDomain\.command\.ReconnectCommand\(\)\s*:\s*appStatusDomain\.command\.RetryCommand\(\)/
    )
    expect(value).toContain('onContextMenu={handleToggleMenu}')
    expect(value.match(/<RefreshCwIcon/g)).toHaveLength(1)
  })

  it('reprojects resize locally and persists only user drag coordinates', () => {
    const value = source()
    const app = readFileSync(path.resolve(process.cwd(), 'src/app/content/App.tsx'), 'utf8')

    expect(app).toContain('const viewport = useWindowResize()')
    expect(app).toContain('const geometry = getAppGeometry(appPosition, viewport, appOpen)')
    expect(app).toContain('captureAppButtonPosition(position, viewport, appOpen)')
    expect(app).toContain('x: geometry.point.x')
    expect(app).toContain('y: geometry.point.y')
    expect(app).toContain('...geometry.bounds')
    expect(app).toContain('onChange: handlePositionChange')
    expect(app).toContain('<AppMain open={appOpen} geometry={geometry.shell}>')
    expect(app).toContain('launcherSize={geometry.launcher.size}')
    expect(value).not.toContain('useWindowResize')
    expect(value).not.toContain('positionPersistenceStarted')
  })
})
