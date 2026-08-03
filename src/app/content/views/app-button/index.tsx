import {
  type FC,
  useState,
  type MouseEvent,
  type MouseEventHandler,
  type RefCallback,
  useCallback,
  useMemo
} from 'react'
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
import AppActionDomain from '@/domain/AppAction'
import ChatRoomDomain from '@/domain/ChatRoom'

export const getReconnectLabel = ({
  userConfigured,
  joined,
  reconnecting,
  available
}: {
  userConfigured: boolean
  joined: boolean
  reconnecting: boolean
  available: boolean
}) => {
  if (reconnecting) return 'Reconnecting this site'
  if (!userConfigured) return 'Refresh unavailable until your profile is set up'
  if (!available) return 'Connecting this site chat'
  return joined ? 'Reconnect this site' : 'Retry connecting this site chat'
}

export interface AppLauncherButtonProps {
  hasUnread?: boolean
  label: string
  size: number
  onClick: MouseEventHandler<HTMLButtonElement>
  onContextMenu?: MouseEventHandler<HTMLButtonElement>
}

export const AppLauncherButton: FC<AppLauncherButtonProps> = ({
  hasUnread = false,
  label,
  size,
  onClick,
  onContextMenu
}) => {
  const DayLogo = [LogoIcon0, LogoIcon1, LogoIcon2, LogoIcon3, LogoIcon4, LogoIcon5, LogoIcon6][getDay(Date())]
  const content = useMemo(
    () => (
      <>
        <AnimatePresence>
          {hasUnread && (
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
    [hasUnread, DayLogo]
  )

  return (
    <Button
      type="button"
      onClick={onClick}
      onContextMenu={onContextMenu}
      aria-label={label}
      title={label}
      style={{ width: `${size}px`, height: `${size}px` }}
      className="relative z-20 rounded-full text-xs shadow-lg shadow-slate-500/50 after:absolute after:-inset-0.5 after:z-10 after:animate-[shimmer_2s_linear_infinite] after:rounded-full after:bg-[conic-gradient(from_var(--shimmer-angle),theme(colors.slate.500)_0%,theme(colors.white)_10%,theme(colors.slate.500)_20%)] has-[>svg]:p-0"
    >
      {content}
    </Button>
  )
}

interface AppButtonMenuProps {
  open: boolean
  appButtonRef: RefCallback<HTMLElement>
}

const AppButtonMenu: FC<AppButtonMenuProps> = ({ open, appButtonRef }) => {
  const send = useRemeshSend()
  const appStatusDomain = useRemeshDomain(AppStatusDomain())
  const initializationPhase = useRemeshQuery(appStatusDomain.query.PhaseQuery())
  const applicationReady = initializationPhase === 'ready'
  const appActionDomain = useRemeshDomain(AppActionDomain())
  const userInfoDomain = useRemeshDomain(UserInfoDomain())
  const userInfo = useRemeshQuery(userInfoDomain.query.UserInfoQuery())
  const isDarkMode = userInfo?.themeMode === 'dark' ? true : userInfo?.themeMode === 'light' ? false : checkDarkMode()

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

  const chatRoomDomain = useRemeshDomain(ChatRoomDomain())
  const chatRoomJoined = useRemeshQuery(chatRoomDomain.query.JoinIsFinishedQuery())
  const reconnecting = useRemeshQuery(chatRoomDomain.query.ConnectionIsLoadingQuery())
  const reconnectAvailable = useRemeshQuery(chatRoomDomain.query.ReconnectAvailableQuery())
  const reconnectLabel = getReconnectLabel({
    userConfigured: userInfo !== null,
    joined: chatRoomJoined,
    reconnecting,
    available: reconnectAvailable
  })
  const initializationConnecting = initializationPhase === 'connecting'
  const refreshLabel = applicationReady
    ? reconnectLabel
    : initializationConnecting
      ? 'Preparing WebChat setup'
      : 'Retry WebChat setup'
  const refreshDisabled = applicationReady ? !reconnectAvailable : initializationConnecting
  const refreshLoading = applicationReady ? reconnecting : initializationConnecting

  const handleRefresh = useCallback(() => {
    send(applicationReady ? chatRoomDomain.command.ReconnectCommand() : appStatusDomain.command.RetryCommand())
  }, [applicationReady, appStatusDomain.command, chatRoomDomain.command, send])

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
          onClick={handleRefresh}
          variant="outline"
          disabled={refreshDisabled}
          aria-label={refreshLabel}
          title={refreshLabel}
          className="dark:bg-background dark:text-foreground dark:hover:bg-accent size-10 rounded-full p-0 shadow dark:border-slate-600"
        >
          <RefreshCwIcon className={cn('size-5', refreshLoading && 'animate-spin')} />
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
      handleRefresh,
      appButtonRef,
      refreshDisabled,
      refreshLabel,
      refreshLoading
    ]
  )

  return (
    <AnimatePresence>
      {open && (
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
  )
}

interface AppButtonProps {
  open: boolean
  launcherSize: number
  appButtonRef: RefCallback<HTMLElement>
}

const AppButton: FC<AppButtonProps> = ({ open, launcherSize, appButtonRef }) => {
  const send = useRemeshSend()
  const appStatusDomain = useRemeshDomain(AppStatusDomain())
  const hasUnreadQuery = useRemeshQuery(appStatusDomain.query.HasUnreadQuery())
  const [menuOpen, setMenuOpen] = useState(false)

  const { setRef: appMenuRef } = useTriggerAway(['click'], () => setMenuOpen(false))

  const handleToggleMenu = (event: MouseEvent<HTMLButtonElement>) => {
    event.preventDefault()
    setMenuOpen((current) => !current)
  }

  const handleToggleApp = () => {
    send(appStatusDomain.command.UpdateOpenCommand(!open))
  }

  const action = open ? 'Close WebChat' : 'Open WebChat'

  return (
    <div
      ref={appMenuRef}
      className="z-infinity fixed grid w-min justify-center gap-y-3 select-none"
      style={{
        left: 'var(--webchat-launcher-left)',
        bottom: 'var(--webchat-launcher-bottom)',
        transform: 'translateX(-50%)'
      }}
    >
      <AppButtonMenu open={menuOpen} appButtonRef={appButtonRef} />
      <AppLauncherButton
        onClick={handleToggleApp}
        onContextMenu={handleToggleMenu}
        hasUnread={hasUnreadQuery}
        label={action}
        size={launcherSize}
      />
    </div>
  )
}

AppButton.displayName = 'AppButton'

export default AppButton
