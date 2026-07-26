import { type FC, useState, type MouseEvent, useCallback, useEffect, useMemo } from 'react'
import { SettingsIcon, MoonIcon, SunIcon, HandIcon, RefreshCwIcon } from 'lucide-react'
import { motion, AnimatePresence } from 'framer-motion'

import { useRemeshDomain, useRemeshQuery, useRemeshSend } from 'remesh-react'
import { Button } from '@/components/ui/button'
import UserInfoDomain from '@/domain/UserInfo'
import useTriggerAway from '@/hooks/useTriggerAway'
import { checkDarkMode, cn } from '@/utils'
import LogoIcon0 from '@/assets/images/logo-0.svg'
import LogoIcon1 from '@/assets/images/logo-1.svg'
import LogoIcon2 from '@/assets/images/logo-2.svg'
import LogoIcon3 from '@/assets/images/logo-3.svg'
import LogoIcon4 from '@/assets/images/logo-4.svg'
import LogoIcon5 from '@/assets/images/logo-5.svg'
import LogoIcon6 from '@/assets/images/logo-6.svg'
import AppStatusDomain from '@/domain/AppStatus'
import { getDay } from 'date-fns'
import useDraggable from '@/hooks/useDraggable'
import useWindowResize from '@/hooks/useWindowResize'
import AppActionDomain from '@/domain/AppAction'
import ChatRoomDomain from '@/domain/ChatRoom'

export interface AppButtonProps {
  className?: string
}

const AppButton: FC<AppButtonProps> = ({ className }) => {
  const send = useRemeshSend()
  const appActionDomain = useRemeshDomain(AppActionDomain())
  const appStatusDomain = useRemeshDomain(AppStatusDomain())
  const appOpenStatus = useRemeshQuery(appStatusDomain.query.OpenQuery())
  const hasUnreadQuery = useRemeshQuery(appStatusDomain.query.HasUnreadQuery())
  const userInfoDomain = useRemeshDomain(UserInfoDomain())
  const userInfo = useRemeshQuery(userInfoDomain.query.UserInfoQuery())
  const appPosition = useRemeshQuery(appStatusDomain.query.PositionQuery())

  const DayLogo = [LogoIcon0, LogoIcon1, LogoIcon2, LogoIcon3, LogoIcon4, LogoIcon5, LogoIcon6][getDay(Date())]

  const isDarkMode = userInfo?.themeMode === 'dark' ? true : userInfo?.themeMode === 'light' ? false : checkDarkMode()

  const [menuOpen, setMenuOpen] = useState(false)

  // Get current window size to recalculate position on resize
  const windowSize = useWindowResize(() => {
    // Reset to default position when window resizes
    send(appStatusDomain.command.UpdatePositionCommand({ x: 50, y: 22 }))
  })

  const {
    x,
    y,
    setRef: appButtonRef
  } = useDraggable({
    initX: appPosition.x,
    initY: appPosition.y,
    minX: 50,
    maxX: windowSize.width - 50,
    maxY: windowSize.height - 22,
    minY: 750,
    reverse: true
  })

  useEffect(() => {
    send(appStatusDomain.command.UpdatePositionCommand({ x, y }))
  }, [x, y, send, appStatusDomain.command])

  const { setRef: appMenuRef } = useTriggerAway(['click'], () => setMenuOpen(false))

  const handleToggleMenu = (e: MouseEvent<HTMLButtonElement>) => {
    e.preventDefault()
    setMenuOpen(!menuOpen)
  }

  const handleOpenOptionsPage = useCallback(() => {
    send(appActionDomain.command.OpenOptionsCommand())
  }, [appActionDomain.command, send])

  const handleSwitchTheme = useCallback(() => {
    if (userInfo) {
      send(userInfoDomain.command.UpdateUserInfoCommand({ ...userInfo, themeMode: isDarkMode ? 'light' : 'dark' }))
    } else {
      handleOpenOptionsPage()
    }
  }, [handleOpenOptionsPage, isDarkMode, send, userInfo, userInfoDomain.command])

  const handleToggleApp = () => {
    send(appStatusDomain.command.UpdateOpenCommand(!appOpenStatus))
  }

  const chatRoomDomain = useRemeshDomain(ChatRoomDomain())
  const chatRoomJoined = useRemeshQuery(chatRoomDomain.query.JoinIsFinishedQuery())
  const reconnecting = useRemeshQuery(chatRoomDomain.query.ReconnectIsLoadingQuery())

  // Rebuilds only this domain's ChatRoom; the shared WorldRoom is untouched.
  const handleReconnectSite = useCallback(() => {
    if (chatRoomJoined && !reconnecting) send(chatRoomDomain.command.ReconnectCommand())
  }, [chatRoomDomain.command, chatRoomJoined, reconnecting, send])

  // Memoize menu buttons to prevent re-render when position changes
  const menuButtons = useMemo(
    () => (
      <>
        <Button
          onClick={handleSwitchTheme}
          variant="outline"
          className="relative size-10 overflow-hidden rounded-full p-0 shadow dark:border-slate-600"
        >
          <div
            className={cn(
              'absolute grid grid-rows-[repeat(2,minmax(0,2.5rem))] w-full justify-center items-center transition-all duration-300 hover:bg-accent dark:hover:bg-accent',
              isDarkMode ? 'top-0' : '-top-10',
              isDarkMode ? 'bg-slate-950 text-white' : 'bg-white text-orange-400'
            )}
          >
            <MoonIcon className="size-5" />
            <SunIcon className="size-5" />
          </div>
        </Button>

        <Button
          onClick={handleOpenOptionsPage}
          variant="outline"
          className="dark:bg-background dark:text-foreground dark:hover:bg-accent size-10 rounded-full p-0 shadow dark:border-slate-600"
        >
          <SettingsIcon className="size-5" />
        </Button>
        <Button
          onClick={handleReconnectSite}
          variant="outline"
          disabled={!chatRoomJoined || reconnecting}
          aria-label={reconnecting ? 'Reconnecting this site' : 'Reconnect this site'}
          title={reconnecting ? 'Reconnecting this site' : 'Reconnect this site'}
          className="dark:bg-background dark:text-foreground dark:hover:bg-accent size-10 rounded-full p-0 shadow dark:border-slate-600"
        >
          <RefreshCwIcon className={cn('size-5', reconnecting && 'animate-spin')} />
        </Button>
        <Button
          ref={appButtonRef}
          variant="outline"
          className="dark:bg-background dark:text-foreground dark:hover:bg-accent size-10 cursor-grab rounded-full p-0 shadow dark:border-slate-600"
        >
          <HandIcon className="size-5" />
        </Button>
      </>
    ),
    [
      isDarkMode,
      handleSwitchTheme,
      handleOpenOptionsPage,
      handleReconnectSite,
      appButtonRef,
      chatRoomJoined,
      reconnecting
    ]
  )

  // Memoize main button content to prevent re-render when position changes
  const mainButtonContent = useMemo(
    () => (
      <>
        <AnimatePresence>
          {hasUnreadQuery && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.1 }}
              className="absolute -top-1 -right-1 z-30 flex size-5 items-center justify-center"
            >
              <span
                className={cn('absolute inline-flex size-full animate-ping rounded-full opacity-75', 'bg-orange-400')}
              ></span>
              <span className={cn('relative inline-flex size-3 rounded-full', 'bg-orange-500')}></span>
            </motion.div>
          )}
        </AnimatePresence>

        <DayLogo className="relative z-20 size-full max-h-full max-w-full overflow-hidden"></DayLogo>
      </>
    ),
    [hasUnreadQuery, DayLogo]
  )

  return (
    <div
      ref={appMenuRef}
      className={cn('fixed z-infinity grid w-min select-none justify-center gap-y-3', className)}
      style={{
        right: `${x}px`,
        bottom: `${y}px`,
        transform: 'translateX(50%)'
      }}
    >
      <AnimatePresence>
        {menuOpen && (
          <motion.div
            className="z-10 grid gap-y-3"
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 12 }}
            transition={{ duration: 0.1 }}
          >
            {menuButtons}
          </motion.div>
        )}
      </AnimatePresence>
      <Button
        onClick={handleToggleApp}
        onContextMenu={handleToggleMenu}
        className="relative z-20 size-11 rounded-full text-xs shadow-lg shadow-slate-500/50 after:absolute after:-inset-0.5 after:z-10 after:animate-[shimmer_2s_linear_infinite] after:rounded-full after:bg-[conic-gradient(from_var(--shimmer-angle),theme(colors.slate.500)_0%,theme(colors.white)_10%,theme(colors.slate.500)_20%)] has-[>svg]:p-0"
      >
        {mainButtonContent}
      </Button>
    </div>
  )
}

AppButton.displayName = 'AppButton'

export default AppButton
