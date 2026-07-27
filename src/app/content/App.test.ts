import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

describe('original AppMain toast ownership', () => {
  it('renders one direct Toaster with the original parameters and no reconnect presentation component', () => {
    const appSource = readFileSync(new URL('./App.tsx', import.meta.url), 'utf8')
    const reconnectSource = readFileSync(new URL('./components/reconnect-toast.tsx', import.meta.url), 'utf8')
    const styles = readFileSync(new URL('../../assets/styles/tailwind.css', import.meta.url), 'utf8')
    const panelStart = appSource.indexOf('<AppMain>')
    const panelEnd = appSource.indexOf('</AppMain>')
    const toaster = appSource.indexOf('<Toaster')

    expect(panelStart).toBeGreaterThan(-1)
    expect(panelEnd).toBeGreaterThan(panelStart)
    expect(toaster).toBeGreaterThan(panelStart)
    expect(toaster).toBeLessThan(panelEnd)
    expect(appSource.match(/<Toaster\b/g)).toHaveLength(1)
    expect(appSource).toContain("import { Toaster } from 'sonner'")
    expect(appSource).toContain('richColors')
    expect(appSource).toContain('theme={themeMode}')
    expect(appSource).toContain('offset="70px"')
    expect(appSource).toContain('visibleToasts={1}')
    expect(appSource).toContain('position="top-center"')
    expect(appSource).toContain("toast: 'dark:bg-slate-950 border dark:border-slate-600'")
    expect(appSource).not.toMatch(/PanelToaster|LauncherToaster|ReconnectToastLifecycle/)
    expect(reconnectSource).not.toMatch(/\bToaster\b|PanelToaster|LauncherToaster|ReconnectToastLifecycle/)
    expect(styles).not.toMatch(/webchat-(?:panel|launcher|reconnect)-toaster|data-webchat-interactive/)
  })
})
