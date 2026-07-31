import { createContext, useContext, useState, type Dispatch, type ReactElement, type SetStateAction } from 'react'
import { AlertCircleIcon, LoaderCircleIcon, RefreshCwIcon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { checkDarkMode, cn } from '@/utils'
import AppButton from '@/app/content/views/app-button'
import AppMain from '@/app/content/views/app-main'
import DanmakuPresentation from '@/app/content/components/danmaku-presentation'

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
  const unavailable = phase === 'unavailable'
  const ready = application !== null

  return (
    <AppThemeContext.Provider value={setThemeMode}>
      <div id="app" className={cn('contents', themeMode)}>
        <AppMain>
          {application ?? (
            <section
              aria-busy={!unavailable}
              className="row-span-3 flex min-h-0 items-center justify-center rounded-xl bg-slate-50 p-6 text-center dark:bg-slate-950"
            >
              <div className="flex flex-col items-center gap-4 text-slate-600 dark:text-slate-100">
                <div role={unavailable ? 'alert' : 'status'} aria-live={unavailable ? 'assertive' : 'polite'}>
                  {unavailable ? (
                    <AlertCircleIcon aria-hidden="true" className="mx-auto size-6 text-red-500" />
                  ) : (
                    <LoaderCircleIcon aria-hidden="true" className="mx-auto size-6 animate-spin" />
                  )}
                  <p className="mt-4 text-sm font-medium">
                    {unavailable ? 'WebChat unavailable' : 'Preparing WebChat'}
                  </p>
                </div>
                {unavailable && (
                  <Button type="button" onClick={onRetry} aria-label="Retry WebChat setup">
                    <RefreshCwIcon aria-hidden="true" className="size-4" />
                    <span>Retry</span>
                  </Button>
                )}
              </div>
            </section>
          )}
        </AppMain>
        <AppButton bootstrapPhase={ready ? undefined : phase} />
        {ready && <DanmakuPresentation />}
      </div>
    </AppThemeContext.Provider>
  )
}

export default BootstrapShell
