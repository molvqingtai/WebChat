import { existsSync, readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const file = (path: string) => new URL(path, import.meta.url)
const source = (path: string) => readFileSync(file(path), 'utf8')

const ordered = (value: string, needles: string[]) => {
  let cursor = -1
  for (const needle of needles) {
    const next = value.indexOf(needle, cursor + 1)
    expect(next, `Missing or out-of-order source token: ${needle}`).toBeGreaterThan(cursor)
    cursor = next
  }
}

describe('content component hierarchy', () => {
  it('keeps StrictMode -> RemeshRoot -> RemeshScope -> prop-free App at the content root', () => {
    const entry = source('./index.tsx')

    ordered(entry, ['<StrictMode>', '<RemeshRoot store={store}>', '<RemeshScope', '<App />'])
  })

  it('renders the App and common layout composition', () => {
    const app = source('./App.tsx')
    const appLayout = source('./views/app-layout/index.tsx')
    const appMain = source('./views/app-main/index.tsx')

    expect(app).toMatch(/(?:function App\(\)|const App = \(\) =>)/)
    ordered(app, [
      '<div id="app"',
      '<AppLayout>',
      '<Header />',
      '<Main />',
      '<Footer />',
      '<Setup',
      '<Toaster',
      '</AppLayout>',
      '<DanmakuContainer'
    ])
    expect(app.match(/<Toaster\b/g)).toHaveLength(1)
    expect(app).toContain('richColors')
    expect(app).toContain('theme={themeMode}')
    expect(app).toContain('offset="70px"')
    expect(app).toContain('visibleToasts={1}')
    expect(app).toContain('position="top-center"')
    expect(app).toContain("toast: 'dark:bg-slate-950 border dark:border-slate-600'")

    ordered(appLayout, [
      '<div className="contents"',
      '<AppMain open={appOpen} geometry={geometry.shell}>',
      '{children}',
      '</AppMain>',
      '<AppButton open={appOpen}'
    ])
    ordered(appMain, ['<AnimatePresence>', 'open &&', '<motion.div', '{memoizedChildren}', 'ref={setRef}'])
    expect(appMain).toContain('data-webchat-panel')
  })

  it('keeps shell and launcher dimensions in the geometry owner', () => {
    const appLayout = source('./views/app-layout/index.tsx')
    const appMain = source('./views/app-main/index.tsx')
    const appButton = source('./views/app-button/index.tsx')
    const geometry = source('./views/app-layout/geometry.ts')

    expect(geometry).toContain('const APP_BUTTON_SIZE = 44')
    expect(geometry).toContain('const APP_BUTTON_RADIUS = APP_BUTTON_SIZE / 2')
    expect(geometry).toContain('const APP_SHELL_TOP_INSET = 40')
    expect(geometry).toContain('const APP_SHELL_MINIMUM_SIZE = 375')
    expect(appLayout).toContain('style={geometry.style as CSSProperties}')
    expect(appMain).toContain("height: 'var(--webchat-shell-height)'")
    expect(appMain).toContain("x: 'var(--webchat-shell-translate-x)'")
    expect(appMain).not.toMatch(/inset-y-10|min-h-\[375px\]|\+ 22px/)
    expect(appButton).not.toContain('size-11')
  })

  it('keeps the high-frequency layout lifecycle below the business App root', () => {
    const app = source('./App.tsx')
    const layoutPath = file('./views/app-layout/index.tsx')
    const geometryPath = file('./views/app-layout/geometry.ts')
    const privateGeometryPath = file('./views/app-button/position.ts')

    expect(existsSync(layoutPath)).toBe(true)
    expect(existsSync(geometryPath)).toBe(true)
    expect(existsSync(privateGeometryPath)).toBe(false)

    const layout = readFileSync(layoutPath, 'utf8')
    expect(app).toContain('<AppLayout>')
    expect(app).not.toMatch(/useWindowResize|useDraggable|getAppGeometry|<AppMain|<AppButton/)
    for (const dependency of ['useWindowResize', 'useDraggable', 'getAppGeometry', '<AppMain', '<AppButton']) {
      expect(layout).toContain(dependency)
    }
  })

  it('uses the existing application status domain directly in every required consumer', () => {
    const app = source('./App.tsx')
    const appLayout = source('./views/app-layout/index.tsx')
    const appButton = source('./views/app-button/index.tsx')
    const feedback = source('../../domain/AppFeedback.ts')
    const initialization = source('./Initialization.ts')

    expect(app).toContain('useRemeshDomain(AppStatusDomain())')
    expect(appLayout).toContain('useRemeshDomain(AppStatusDomain())')
    expect(appButton).toContain('useRemeshDomain(AppStatusDomain())')
    expect(feedback).toContain('domain.getDomain(AppStatusDomain())')
    expect(initialization).toContain('store.getDomain(AppStatusDomain())')
    expect(feedback).toContain('domain.getDomain(ToastDomain())')
    expect(initialization).toContain('store.getDomain(ToastDomain())')
  })
})

describe('application status ownership', () => {
  it('keeps initialization plain and runtime module exports production-only', async () => {
    const initializationSource = source('./Initialization.ts')
    const modules = await Promise.all([
      import('@/app/content/Initialization'),
      import('@/domain/AppStatus'),
      import('@/domain/AppFeedback'),
      import('@/domain/Toast')
    ])

    expect(modules.map((module) => Object.keys(module).sort())).toEqual([
      ['startInitializationLifecycle'],
      ['default'],
      ['default'],
      ['default']
    ])
    expect(initializationSource).not.toMatch(/\bRemesh\.domain\s*\(/)
    expect(initializationSource).toContain('store.getDomain(AppStatusDomain())')
  })
})

describe('fixed test stack', () => {
  it('uses happy-dom, Testing Library, and Vitest Browser Mode without linkedom', () => {
    const packageJson = source('../../../package.json')
    const config = source('../../../vitest.config.ts')
    const configuredSuites = [
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
    expect(configuredSuites.join('\n')).not.toMatch(/linkedom|parseHTML|createRequire\(require\.resolve\('wxt'\)\)/)
  })
})
