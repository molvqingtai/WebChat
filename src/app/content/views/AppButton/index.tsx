import { type ReactNode, type FC, useState, type MouseEvent, useRef } from 'react'
import { SettingsIcon, MoonIcon, SunIcon } from 'lucide-react'

import { browser } from 'wxt/browser'
import { useRemeshDomain, useRemeshQuery, useRemeshSend } from 'remesh-react'
import { Button } from '@/components/ui/Button'
import { EVENT } from '@/constants/event'
import UserInfoDomain from '@/domain/UserInfo'
import useClickAway from '@/hooks/useClickAway'
import { checkSystemDarkMode, cn } from '@/utils'

export interface AppButtonProps {
  children?: ReactNode
}

const AppButton: FC<AppButtonProps> = ({ children }) => {
  const send = useRemeshSend()
  const userInfoDomain = useRemeshDomain(UserInfoDomain())
  const userInfo = useRemeshQuery(userInfoDomain.query.UserInfoQuery())

  const isDarkMode =
    userInfo?.themeMode === 'dark' ? true : userInfo?.themeMode === 'light' ? false : checkSystemDarkMode()

  const [open, setOpen] = useState(false)

  const menuRef = useRef<HTMLDivElement>(null)

  /**
   * Waiting for PR merge
   * https://github.com/streamich/react-use/pull/2528
   */
  useClickAway(
    menuRef,
    () => {
      setOpen(false)
    },
    ['click']
  )

  const handleToggleMenu = (e: MouseEvent<HTMLButtonElement>) => {
    e.preventDefault()
    setOpen(!open)
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
    <div ref={menuRef} className="fixed bottom-5 right-5 z-top grid select-none justify-center gap-y-3">
      {/* <div className="grid gap-y-3" inert={!open && ''}> */}
      <div className="pointer-events-none grid gap-y-3">
        <Button
          onClick={handleSwitchTheme}
          variant="outline"
          data-state={open ? 'open' : 'closed'}
          className="pointer-events-auto relative size-10 overflow-hidden rounded-full p-0 shadow fill-mode-forwards data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out data-[state=open]:fade-in data-[state=closed]:slide-out-to-bottom data-[state=open]:slide-in-from-bottom"
        >
          <div
            className={cn(
              'absolute -top-10 grid grid-rows-[repeat(2,minmax(0,2.5rem))] w-full justify-center items-center transition-all duration-500',
              isDarkMode ? 'top-0' : '-top-10 ',
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
          data-state={open ? 'open' : 'closed'}
          className="pointer-events-auto size-10 rounded-full  p-0 shadow fill-mode-forwards data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out data-[state=open]:fade-in data-[state=closed]:slide-out-to-bottom data-[state=open]:slide-in-from-bottom"
        >
          <SettingsIcon size={20} />
        </Button>
      </div>
      <Button onContextMenu={handleToggleMenu} className="relative z-10 size-10 rounded-full p-0 text-xs shadow">
        {children}
      </Button>
    </div>
  )
}

AppButton.displayName = 'AppButton'

export default AppButton
