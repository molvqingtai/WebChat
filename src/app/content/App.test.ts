import { existsSync, readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const source = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8')

describe('generic AppMain Toast ownership', () => {
  it('renders one direct Toaster with the original parameters and Motion behavior', () => {
    const appSource = source('./App.tsx')
    const appMainSource = source('./views/app-main/index.tsx')
    const styles = source('../../assets/styles/tailwind.css')
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
    expect(appMainSource).toContain("initial={{ opacity: 0, y: 10, x: isOnRightSide ? '-100%' : '0' }}")
    expect(appMainSource).toContain("animate={{ opacity: 1, y: 0, x: isOnRightSide ? '-100%' : '0' }}")
    expect(appMainSource).not.toContain('transformTemplate')
    expect(styles).not.toMatch(/webchat-(?:panel|launcher|reconnect)-toaster|data-webchat-interactive/)
  })

  it('removes alternate readiness and bootstrap status views without deleting lifecycle truth', () => {
    const appSource = source('./App.tsx')
    const bootstrapSource = source('./index.tsx')
    const readinessSource = source('../../domain/Readiness.ts')

    expect(appSource).not.toMatch(/runtimeHostPhase|ReadinessDomain|WebChat connecting|WebChat unavailable|<output/)
    expect(appSource).not.toMatch(/AlertCircleIcon|LoaderCircleIcon/)
    expect(bootstrapSource).not.toMatch(/runtime-unavailable|WebChat unavailable|aria-label="Retry"|location\.reload/)
    expect(bootstrapSource).not.toMatch(/AlertCircleIcon|RefreshCwIcon|@\/components\/ui\/button/)
    expect(readinessSource).toContain("default: 'connecting'")
    expect(readinessSource).toContain('StateChangedEvent')
  })

  it('deletes reconnect presentation residue and isolates the generic adapter from business sources', () => {
    const presenterSource = source('./components/toast-presentation.tsx')
    const feedbackSource = source('../../domain/AppFeedback.ts')
    const toastSource = source('../../domain/Toast.ts')

    expect(existsSync(new URL('./components/reconnect-toast.tsx', import.meta.url))).toBe(false)
    expect(existsSync(new URL('./components/reconnect-toast.test.ts', import.meta.url))).toBe(false)
    expect(presenterSource).not.toMatch(/ChatRoom|Readiness|Runtime|Network|AppStatus|panel|reconnect/i)
    expect(presenterSource).toContain("from '@/domain/ToastPresentation'")
    expect(feedbackSource).toContain("from '@/domain/ChatRoom'")
    expect(feedbackSource).toContain("from '@/domain/Readiness'")
    expect(feedbackSource).toContain("from '@/domain/ToastPresentation'")
    expect(feedbackSource).toContain('minimumVisibleMs: 300')
    expect(toastSource).not.toMatch(/Descriptor|Presentation|SurfaceMounted|Acknowledge/)
  })
})
