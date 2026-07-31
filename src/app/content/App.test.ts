import { existsSync, readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const source = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8')

const ordered = (value: string, needles: string[]) => {
  let cursor = -1
  for (const needle of needles) {
    const next = value.indexOf(needle, cursor + 1)
    expect(next, `Missing or out-of-order source token: ${needle}`).toBeGreaterThan(cursor)
    cursor = next
  }
}

describe('frozen v1.9.7 component hierarchy', () => {
  it('keeps StrictMode -> RemeshRoot -> RemeshScope -> prop-free App at the content root', () => {
    const entry = source('./index.tsx')

    ordered(entry, ['<StrictMode>', '<RemeshRoot store={store}>', '<RemeshScope', '<App />'])
    expect(entry).not.toMatch(/<App\s+[^>]*(?:dependenc|activat|ready|phase|timeout)/)
    expect(entry).not.toMatch(/ContentBootstrap|BootstrapShell|<Application\b|from ['"].*Application['"]/)
    expect(existsSync(new URL('./Application.tsx', import.meta.url))).toBe(false)
  })

  it('renders the original App and AppMain composition without whole-tree state gates', () => {
    const app = source('./App.tsx')
    const appMain = source('./views/app-main/index.tsx')

    expect(app).toMatch(/(?:function App\(\)|const App = \(\) =>)/)
    expect(app).not.toMatch(/appStatusLoadIsFinished|\bready\s*&&|<Application/)
    ordered(app, [
      '<div id="app"',
      '<AppMain>',
      '<Header />',
      '<Main />',
      '<Footer />',
      '<Setup',
      '<Toaster',
      '</AppMain>',
      '<AppButton',
      '<DanmakuContainer'
    ])
    expect(app.match(/<Toaster\b/g)).toHaveLength(1)
    expect(app).toContain('richColors')
    expect(app).toContain('theme={themeMode}')
    expect(app).toContain('offset="70px"')
    expect(app).toContain('visibleToasts={1}')
    expect(app).toContain('position="top-center"')
    expect(app).toContain("toast: 'dark:bg-slate-950 border dark:border-slate-600'")

    expect(appMain).not.toMatch(/\btoaster\??:|\{toaster\}/)
    ordered(appMain, ['<AnimatePresence>', 'appOpenStatus &&', '<motion.div', '{memoizedChildren}', 'ref={setRef}'])
    expect(appMain).toContain('data-webchat-panel')
  })

  it('keeps business dependencies at use sites instead of business-component props', () => {
    const app = source('./App.tsx')
    const appButton = source('./views/app-button/index.tsx')

    expect(app).not.toMatch(/interface AppProps|dependencies:|activateApplicationDependencies|timeoutMs/)
    expect(appButton).not.toMatch(/initializationPhase\??:|onInitializationRetry/)
    expect(app).toMatch(/AppStatusDomain/)
    expect(appButton).toMatch(/AppStatusDomain/)
    expect(`${app}\n${appButton}`).not.toMatch(/InitializationDomain/)
  })
})

describe('single application status domain', () => {
  it('keeps initialization as plain orchestration and removes the separate effects owner', () => {
    const initialization = source('./Initialization.ts')
    const feedback = source('../../domain/AppFeedback.ts')

    expect(existsSync(new URL('../../domain/AppStatusEffects.ts', import.meta.url))).toBe(false)
    expect(initialization).not.toMatch(/Remesh\.domain|InitializationDomain|export default/)
    expect(initialization).toMatch(/store\.getDomain\(AppStatusDomain\(\)\)/)
    expect(feedback).toMatch(/getDomain\(AppStatusDomain\(\)\)/)
    expect(feedback).toMatch(/getDomain\(ToastDomain\(\)\)/)
    expect(feedback).not.toMatch(/InitializationDomain/)
  })
})

describe('single existing Toast capability', () => {
  it('removes ToastPresentation and routes business feedback through Toast.ts', () => {
    const initialization = source('./Initialization.ts')
    const feedback = source('../../domain/AppFeedback.ts')

    expect(existsSync(new URL('../../domain/ToastPresentation.ts', import.meta.url))).toBe(false)
    expect(existsSync(new URL('./components/toast-presentation.tsx', import.meta.url))).toBe(false)
    expect(existsSync(new URL('./components/toast-presentation.test.ts', import.meta.url))).toBe(false)
    expect(`${initialization}\n${feedback}`).not.toMatch(
      /ToastPresentation|useToastPresentation|SurfaceMounted|Acknowledg|observeVisibleDwell/
    )
    expect(initialization).toMatch(/ToastDomain/)
    expect(feedback).toMatch(/ToastDomain/)
    expect(initialization).toContain("'Preparing WebChat'")
    expect(initialization).toContain("'WebChat unavailable'")
  })

  it('keeps file-local implementation details out of the public source surface', () => {
    const initialization = source('./Initialization.ts')
    const appStatus = source('../../domain/AppStatus.ts')
    const chatRoom = source('../../domain/ChatRoom.ts')
    const toast = source('../../domain/Toast.ts')
    const toastExtern = source('../../domain/externs/Toast.ts')

    expect(toastExtern).not.toMatch(/\btestId\??:/)
    expect(initialization).not.toMatch(
      /export (?:const (?:CONTENT_INITIALIZATION_TIMEOUT_MS|INITIALIZATION_TOAST_ID|runInitializationAttempt)|type InitializationPhase|interface InitializationLifecycleOptions)/
    )
    expect(appStatus).not.toMatch(/export const defaultStatusState|\bUnreadQuery\b/)
    expect(appStatus).toContain("name: 'AppStatus.SyncToStorageEvent'")
    expect(chatRoom).not.toMatch(/export const RECONNECT_FEEDBACK_MINIMUM_MS/)
    expect(toast).not.toMatch(/export type ToastMessage/)
  })
})

describe('fixed test stack', () => {
  it('uses happy-dom, Testing Library, and Vitest Browser Mode without linkedom', () => {
    const packageJson = source('../../../package.json')
    const config = source('../../../vitest.config.ts')
    const migratedSuites = [
      './index.test.ts',
      './App.render.test.tsx',
      './Initialization.test.ts',
      './InitializationStatus.test.tsx',
      './views/app-main/index.test.ts'
    ].map(source)

    expect(packageJson).toContain('"happy-dom"')
    expect(packageJson).toContain('"@testing-library/react"')
    expect(packageJson).toContain('"@testing-library/dom"')
    expect(packageJson).toContain('"@vitest/browser-playwright"')
    expect(packageJson).toContain('"vitest-browser-react"')
    expect(config).toContain("environment: 'happy-dom'")
    expect(config).toContain('provider: playwright()')
    expect(source('./views/app-main/index.browser.test.tsx')).toContain("from 'vitest-browser-react'")
    expect(migratedSuites.join('\n')).not.toMatch(/linkedom|parseHTML|createRequire\(require\.resolve\('wxt'\)\)/)
  })
})
