import { type FC, useState, type MouseEvent, useRef } from 'react'
import { SettingsIcon, MoonIcon, SunIcon } from 'lucide-react'
import { motion, AnimatePresence } from 'framer-motion'

import { browser } from 'wxt/browser'
import { useRemeshDomain, useRemeshQuery, useRemeshSend } from 'remesh-react'
import { Button } from '@/components/ui/Button'
import { EVENT } from '@/constants/event'
import UserInfoDomain from '@/domain/UserInfo'
import useClickAway from '@/hooks/useClickAway'
import { checkSystemDarkMode, cn } from '@/utils'
import ToastDomain from '@/domain/Toast'
import LogoIcon0 from '@/assets/images/logo-0.svg'
import LogoIcon1 from '@/assets/images/logo-1.svg'
import LogoIcon2 from '@/assets/images/logo-2.svg'
import LogoIcon3 from '@/assets/images/logo-3.svg'
import LogoIcon4 from '@/assets/images/logo-4.svg'
import LogoIcon5 from '@/assets/images/logo-5.svg'
import LogoIcon6 from '@/assets/images/logo-6.svg'
import AppStatusDomain from '@/domain/AppStatus'
import { getDay } from 'date-fns'

const AppButton: FC = () => {
  const send = useRemeshSend()
  const appStatusDomain = useRemeshDomain(AppStatusDomain())
  const appOpenStatus = useRemeshQuery(appStatusDomain.query.OpenQuery())
  const hasUnreadQuery = useRemeshQuery(appStatusDomain.query.HasUnreadQuery())
  const userInfoDomain = useRemeshDomain(UserInfoDomain())
  const userInfo = useRemeshQuery(userInfoDomain.query.UserInfoQuery())
  const toastDomain = useRemeshDomain(ToastDomain())
  const DayLogo = [LogoIcon0, LogoIcon1, LogoIcon2, LogoIcon3, LogoIcon4, LogoIcon5, LogoIcon6][getDay(Date())]

  const isDarkMode =
    userInfo?.themeMode === 'dark' ? true : userInfo?.themeMode === 'light' ? false : checkSystemDarkMode()

  const [menuOpen, setMenuOpen] = useState(false)

  const menuRef = useRef<HTMLDivElement>(null)

  useClickAway(menuRef, () => {
    setMenuOpen(false)
  }, ['click'])

  const handleToggleMenu = (e: MouseEvent<HTMLButtonElement>) => {
    e.preventDefault()
    setMenuOpen(!menuOpen)
  }

  const handleSwitchTheme = () => {
    if (userInfo) {
      send(toastDomain.command.WarningCommand('Developer is too lazy~'))
      send(userInfoDomain.command.UpdateUserInfoCommand({ ...userInfo, themeMode: isDarkMode ? 'light' : 'dark' }))
    } else {
      handleOpenOptionsPage()
    }
  }

  const handleOpenOptionsPage = () => {
    browser.runtime.sendMessage(EVENT.OPEN_OPTIONS_PAGE)
  }

  const handleToggleApp = () => {
    send(appStatusDomain.command.UpdateOpenCommand(!appOpenStatus))
  }

  return (
    <div ref={menuRef} className="fixed bottom-5 right-5 z-infinity grid select-none justify-center gap-y-3">
      <AnimatePresence>
        {menuOpen && (
          <motion.div
            className="z-10 grid gap-y-3"
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 12 }}
            transition={{ duration: 0.1 }}
          >
            <Button
              onClick={handleSwitchTheme}
              variant="outline"
              className="relative size-10 overflow-hidden rounded-full p-0 shadow"
            >
              <div
                className={cn(
                  'absolute grid grid-rows-[repeat(2,minmax(0,2.5rem))] w-full justify-center items-center transition-all duration-500',
                  isDarkMode ? 'top-0' : '-top-10',
                  isDarkMode ? 'bg-slate-800 text-white' : 'bg-white text-orange-400'
                )}
              >
                <MoonIcon size={20} />
                <SunIcon size={20} />
              </div>
            </Button>

            <Button
              onClick={handleOpenOptionsPage}
              variant="outline"
              className="pointer-events-auto size-10 rounded-full p-0 shadow"
            >
              <SettingsIcon size={20} />
            </Button>
          </motion.div>
        )}
      </AnimatePresence>
      <Button
        onClick={handleToggleApp}
        onContextMenu={handleToggleMenu}
        className="relative z-20 size-11 rounded-full p-0 text-xs shadow-lg shadow-slate-500/50"
      >
        <AnimatePresence>
          {hasUnreadQuery && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.1 }}
              className="absolute -right-1 -top-1 flex size-5 items-center justify-center"
            >
              <span
                className={cn('absolute inline-flex size-full animate-ping rounded-full opacity-75', 'bg-orange-400')}
              ></span>
              <span className={cn('relative inline-flex size-3 rounded-full', 'bg-orange-500')}></span>
            </motion.div>
          )}
        </AnimatePresence>
        <DayLogo className="max-h-full max-w-full"></DayLogo>
      </Button>
    </div>
  )
}

AppButton.displayName = 'AppButton'

export default AppButton
