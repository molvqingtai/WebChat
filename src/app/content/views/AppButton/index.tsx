import { type ReactNode, type FC, useState, type MouseEvent, useRef, useEffect } from 'react'
import { SettingsIcon, MoonIcon, SunIcon } from 'lucide-react'
import { motion, AnimatePresence } from 'framer-motion'

import { browser } from 'wxt/browser'
import { useRemeshDomain, useRemeshQuery, useRemeshSend } from 'remesh-react'
import { Button } from '@/components/ui/Button'
import { EVENT } from '@/constants/event'
import UserInfoDomain from '@/domain/UserInfo'
import useClickAway from '@/hooks/useClickAway'
import { checkSystemDarkMode, cn } from '@/utils'

export interface AppButtonProps {
  children?: ReactNode
  onClick?: (e: MouseEvent<HTMLButtonElement>) => void
}

const AppButton: FC<AppButtonProps> = ({ children, onClick }) => {
  const send = useRemeshSend()
  const userInfoDomain = useRemeshDomain(UserInfoDomain())
  const userInfo = useRemeshQuery(userInfoDomain.query.UserInfoQuery())

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
      send(userInfoDomain.command.UpdateUserInfoCommand({ ...userInfo, themeMode: isDarkMode ? 'light' : 'dark' }))
    } else {
      // TODO
    }
  }

  const handleOpenOptionsPage = () => {
    browser.runtime.sendMessage(EVENT.OPEN_OPTIONS_PAGE)
  }

  return (
    <div ref={menuRef} className="fixed bottom-5 right-5 z-infinity grid select-none justify-center gap-y-3">
      <AnimatePresence>
        {menuOpen && (
          <motion.div
            className="grid gap-y-3"
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
        onClick={onClick}
        onContextMenu={handleToggleMenu}
        className="relative z-10 size-10 rounded-full p-0 text-xs shadow"
      >
        {children}
      </Button>
    </div>
  )
}

AppButton.displayName = 'AppButton'

export default AppButton
