import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

describe('panel toast ownership', () => {
  it('mounts the only presentation inside AppMain and keeps only its headless lifecycle outside', () => {
    const source = readFileSync(new URL('./App.tsx', import.meta.url), 'utf8')
    const panelStart = source.indexOf('<AppMain>')
    const panelEnd = source.indexOf('</AppMain>')
    const toaster = source.indexOf('<PanelToaster')
    const lifecycle = source.indexOf('<ReconnectToastLifecycle')

    expect(panelStart).toBeGreaterThan(-1)
    expect(panelEnd).toBeGreaterThan(panelStart)
    expect(toaster).toBeGreaterThan(panelStart)
    expect(toaster).toBeLessThan(panelEnd)
    expect(lifecycle).toBeGreaterThan(-1)
    expect(lifecycle).toBeLessThan(panelStart)
    expect(source).not.toMatch(/from ['"]sonner['"]/)
  })
})
