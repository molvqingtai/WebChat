import { StrictMode, useMemo, useState } from 'react'
import { RemeshScope } from 'remesh-react'
import { Toaster } from 'sonner'
import Application from '@/app/content/Application'
import AppButton from '@/app/content/views/app-button'
import AppMain from '@/app/content/views/app-main'
import DanmakuPresentation from '@/app/content/components/danmaku-presentation'
import { useToastPresentation } from '@/app/content/components/toast-presentation'
import { useInitialization, type InitializationDependencies } from '@/app/content/Initialization'
import AppStatusEffectsDomain from '@/domain/AppStatusEffects'
import NotificationDomain from '@/domain/Notification'
import ToastDomain from '@/domain/Toast'
import AppFeedbackDomain from '@/domain/AppFeedback'
import { checkDarkMode, cn } from '@/utils'

export interface AppProps {
  dependencies: InitializationDependencies
  activateApplicationDependencies: () => void
  timeoutMs?: number
}

const App = ({ dependencies, activateApplicationDependencies, timeoutMs }: AppProps) => {
  const [themeMode, setThemeMode] = useState<'dark' | 'light'>(() => (checkDarkMode() ? 'dark' : 'light'))
  const toasterRef = useToastPresentation()
  const { phase, retry } = useInitialization({ dependencies, activateApplicationDependencies, timeoutMs })
  const ready = phase === 'ready'
  const initializationPhase = ready ? undefined : phase
  const applicationDomains = useMemo(
    () => (ready ? [AppStatusEffectsDomain(), NotificationDomain(), ToastDomain(), AppFeedbackDomain()] : []),
    [ready]
  )

  return (
    <RemeshScope domains={applicationDomains}>
      <div id="app" className={cn('contents', themeMode)}>
        <AppMain
          toaster={
            <Toaster
              ref={toasterRef}
              richColors
              theme={themeMode}
              offset="70px"
              visibleToasts={1}
              toastOptions={{
                classNames: {
                  toast: 'dark:bg-slate-950 border dark:border-slate-600'
                }
              }}
              position="top-center"
            ></Toaster>
          }
        >
          {ready && (
            <StrictMode>
              <Application onThemeModeChange={setThemeMode} />
            </StrictMode>
          )}
        </AppMain>
        <AppButton initializationPhase={initializationPhase} onInitializationRetry={retry} />
        {ready && <DanmakuPresentation />}
      </div>
    </RemeshScope>
  )
}

export default App
