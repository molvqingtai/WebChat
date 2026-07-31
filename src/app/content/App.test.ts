import { existsSync, readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const source = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8')

describe('single normal-shell ownership', () => {
  it('mounts App directly without a Bootstrap UI layer', () => {
    const entrySource = source('./index.tsx')

    expect(existsSync(new URL('./Bootstrap.tsx', import.meta.url))).toBe(false)
    expect(existsSync(new URL('./BootstrapShell.tsx', import.meta.url))).toBe(false)
    expect(entrySource).toContain('<App')
    expect(entrySource).toContain('dependencies={initializationDependencies}')
    expect(entrySource).toContain('activateApplicationDependencies={activateApplicationDependencies}')
    expect(entrySource).not.toMatch(/ContentBootstrap|createReadyApplication|createApplication\(\)/)
  })

  it('keeps the sole content Toaster inside the stable normal shell', () => {
    const appSource = source('./App.tsx')
    const applicationSource = source('./Application.tsx')
    const appMainSource = source('./views/app-main/index.tsx')
    const styles = source('../../assets/styles/tailwind.css')
    const shellStart = appSource.indexOf('<AppMain')
    const shellEnd = appSource.indexOf('</AppMain>')
    const toaster = appSource.indexOf('<Toaster')

    expect(shellStart).toBeGreaterThan(-1)
    expect(shellEnd).toBeGreaterThan(shellStart)
    expect(toaster).toBeGreaterThan(shellStart)
    expect(toaster).toBeLessThan(shellEnd)
    expect(appSource.match(/<Toaster\b/g)).toHaveLength(1)
    expect(applicationSource).not.toMatch(/<Toaster\b|from 'sonner'|useToastPresentation/)
    expect(appSource).toContain("import { Toaster } from 'sonner'")
    expect(appSource).toContain('useToastPresentation()')
    expect(appSource).toContain('richColors')
    expect(appSource).toContain('theme={themeMode}')
    expect(appSource).toContain('offset="70px"')
    expect(appSource).toContain('visibleToasts={1}')
    expect(appSource).toContain('position="top-center"')
    expect(appSource).toContain("toast: 'dark:bg-slate-950 border dark:border-slate-600'")
    expect(appMainSource).toContain('data-webchat-shell')
    expect(appMainSource).toContain('{toaster}')
    expect(appMainSource.indexOf('{toaster}')).toBeLessThan(appMainSource.lastIndexOf('</div>'))
    expect(appMainSource).toContain("transform: isOnRightSide ? 'translateX(-100%)' : 'translateX(0)'")
    expect(appMainSource).toContain('initial={{ opacity: 0, y: 10 }}')
    expect(appMainSource).toContain('animate={{ opacity: 1, y: 0 }}')
    expect(appMainSource).not.toMatch(/data-webchat-toaster-owner|pointer-events/)
    expect(styles).not.toMatch(/webchat-(?:panel|launcher|reconnect)-toaster|data-webchat-interactive/)
  })

  it('uses a non-visual initialization hook and generic Toast descriptors only', () => {
    const appSource = source('./App.tsx')
    const applicationSource = source('./Application.tsx')
    const entrySource = source('./index.tsx')
    const initializationSource = source('./Initialization.ts')
    const readinessSource = source('../../domain/Readiness.ts')

    expect(initializationSource).toContain('export const useInitialization')
    expect(initializationSource).toContain("const INITIALIZATION_TOAST_ID = 'webchat-initialization'")
    expect(initializationSource.match(/id: INITIALIZATION_TOAST_ID/g)).toHaveLength(2)
    expect(initializationSource).toContain("type: 'loading'")
    expect(initializationSource).toContain("message: 'Preparing WebChat'")
    expect(initializationSource).toContain("type: 'error'")
    expect(initializationSource).toContain("message: 'WebChat unavailable'")
    expect(initializationSource).toContain('presentationDomain.command.DismissCommand(INITIALIZATION_TOAST_ID)')
    expect(initializationSource).not.toMatch(/ReactElement|ReactNode|createElement|return\s*</)
    expect(`${appSource}\n${applicationSource}`).not.toMatch(
      /<output|aria-busy|LoaderCircleIcon|AlertCircleIcon|WebChat unavailable|Preparing WebChat/
    )
    expect(entrySource).not.toMatch(/runtime-unavailable|WebChat unavailable|location\.reload/)
    expect(initializationSource).not.toMatch(/ReadinessDomain|ToastDomain|location\.reload|type:\s*'success'/)
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
