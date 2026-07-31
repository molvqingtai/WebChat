import { useState } from 'react'
import { AlertCircleIcon, LoaderCircleIcon, RefreshCwIcon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { checkDarkMode, cn } from '@/utils'
import { AppLauncherButton } from '@/app/content/views/app-button'
import { AppMainFrame } from '@/app/content/views/app-main'

export type BootstrapPhase = 'connecting' | 'unavailable'

export interface BootstrapShellProps {
  phase: BootstrapPhase
  onRetry: () => void
}

const BootstrapShell = ({ phase, onRetry }: BootstrapShellProps) => {
  const [open, setOpen] = useState(false)
  const unavailable = phase === 'unavailable'
  const action = open ? 'Close WebChat' : 'Open WebChat'
  const launcherLabel = unavailable ? `WebChat unavailable. ${action}` : action
  const themeMode = checkDarkMode() ? 'dark' : 'light'

  return (
    <div id="app" className={cn('contents', themeMode)}>
      <AppMainFrame open={open} position={{ x: 50, y: 22 }}>
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
              <p className="mt-4 text-sm font-medium">{unavailable ? 'WebChat unavailable' : 'Preparing WebChat'}</p>
            </div>
            {unavailable && (
              <Button type="button" onClick={onRetry} aria-label="Retry WebChat setup">
                <RefreshCwIcon aria-hidden="true" className="size-4" />
                <span>Retry</span>
              </Button>
            )}
          </div>
        </section>
      </AppMainFrame>
      <div
        className="z-infinity fixed grid w-min justify-center gap-y-3 select-none"
        style={{ right: '50px', bottom: '22px', transform: 'translateX(50%)' }}
      >
        <AppLauncherButton label={launcherLabel} onClick={() => setOpen((current) => !current)} />
      </div>
    </div>
  )
}

export default BootstrapShell
