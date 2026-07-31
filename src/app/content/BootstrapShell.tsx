import { createContext, useContext, useState, type Dispatch, type ReactElement, type SetStateAction } from 'react'
import { LoaderCircleIcon } from 'lucide-react'
import { Toaster } from 'sonner'
import { checkDarkMode, cn } from '@/utils'
import AppButton from '@/app/content/views/app-button'
import AppMain from '@/app/content/views/app-main'
import DanmakuPresentation from '@/app/content/components/danmaku-presentation'
import { useToastPresentation } from '@/app/content/components/toast-presentation'

export type BootstrapPhase = 'connecting' | 'unavailable'

export interface BootstrapShellProps {
  phase: BootstrapPhase
  onRetry: () => void
  application?: ReactElement | null
}

type AppThemeMode = 'dark' | 'light'

const AppThemeContext = createContext<Dispatch<SetStateAction<AppThemeMode>> | null>(null)

export const useAppTheme = () => {
  const setThemeMode = useContext(AppThemeContext)
  if (!setThemeMode) throw new Error('App theme owner is unavailable')
  return setThemeMode
}

const BootstrapShell = ({ phase, onRetry, application = null }: BootstrapShellProps) => {
  const [themeMode, setThemeMode] = useState<AppThemeMode>(() => (checkDarkMode() ? 'dark' : 'light'))
  const toasterRef = useToastPresentation()
  const connecting = phase === 'connecting'
  const ready = application !== null

  return (
    <AppThemeContext.Provider value={setThemeMode}>
      <div id="app" className={cn('contents', themeMode)}>
        <AppMain>
          {application ?? (
            <section
              aria-busy={connecting}
              className="row-span-3 flex min-h-0 items-center justify-center rounded-xl bg-slate-50 p-6 text-center dark:bg-slate-950"
            >
              <div className="flex flex-col items-center gap-4 text-slate-600 dark:text-slate-100">
                <output aria-live="polite">
                  <LoaderCircleIcon aria-hidden="true" className={cn('mx-auto size-6', connecting && 'animate-spin')} />
                  <p className="mt-4 text-sm font-medium">Preparing WebChat</p>
                </output>
              </div>
            </section>
          )}
        </AppMain>
        <AppButton bootstrapPhase={ready ? undefined : phase} onBootstrapRetry={onRetry} />
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
        {ready && <DanmakuPresentation />}
      </div>
    </AppThemeContext.Provider>
  )
}

export default BootstrapShell
