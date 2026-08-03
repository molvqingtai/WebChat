import { type CSSProperties, type FC, type ReactNode, useCallback } from 'react'
import { useRemeshDomain, useRemeshQuery, useRemeshSend } from 'remesh-react'
import AppButton from '@/app/content/views/app-button'
import AppMain from '@/app/content/views/app-main'
import AppStatusDomain from '@/domain/AppStatus'
import useDraggable from '@/hooks/useDraggable'
import useWindowResize from '@/hooks/useWindowResize'
import { captureAppButtonPosition, getAppGeometry } from './geometry'

export interface AppLayoutProps {
  children?: ReactNode
}

const AppLayout: FC<AppLayoutProps> = ({ children }) => {
  const send = useRemeshSend()
  const appStatusDomain = useRemeshDomain(AppStatusDomain())
  const appOpen = useRemeshQuery(appStatusDomain.query.OpenQuery())
  const appPosition = useRemeshQuery(appStatusDomain.query.PositionQuery())
  const viewport = useWindowResize()
  const geometry = getAppGeometry(appPosition, viewport, appOpen)
  const handlePositionChange = useCallback(
    (position: { x: number; y: number }) => {
      send(appStatusDomain.command.UpdatePositionCommand(captureAppButtonPosition(position, viewport, appOpen)))
    },
    [appOpen, appStatusDomain.command, send, viewport]
  )
  const { setRef: appButtonRef } = useDraggable({
    x: geometry.point.x,
    y: geometry.point.y,
    ...geometry.bounds,
    onChange: handlePositionChange
  })

  return (
    <div className="contents" style={geometry.style as CSSProperties}>
      <AppMain open={appOpen} geometry={geometry.shell}>
        {children}
      </AppMain>
      <AppButton open={appOpen} launcherSize={geometry.launcher.size} appButtonRef={appButtonRef} />
    </div>
  )
}

AppLayout.displayName = 'AppLayout'

export default AppLayout
