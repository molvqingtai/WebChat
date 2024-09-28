import Header from '@/app/content/views/Header'
import Footer from '@/app/content/views/Footer'
import Main from '@/app/content/views/Main'
import AppButton from '@/app/content/views/AppButton'
import AppContainer from '@/app/content/views/AppContainer'
import { useRemeshDomain, useRemeshQuery, useRemeshSend } from 'remesh-react'
import RoomDomain from '@/domain/Room'
import UserInfoDomain from '@/domain/UserInfo'
import Setup from '@/app/content/views/Setup'
import MessageListDomain from '@/domain/MessageList'
import { useEffect, useState } from 'react'
import { Toaster } from 'sonner'
import { indexDBStorage } from '@/domain/impls/Storage'
import { APP_OPEN_STATUS_STORAGE_KEY } from '@/constants/config'
import LogoIcon0 from '@/assets/images/logo-0.svg'
import LogoIcon1 from '@/assets/images/logo-1.svg'
import LogoIcon2 from '@/assets/images/logo-2.svg'
import LogoIcon3 from '@/assets/images/logo-3.svg'
import LogoIcon4 from '@/assets/images/logo-4.svg'
import LogoIcon5 from '@/assets/images/logo-5.svg'
import LogoIcon6 from '@/assets/images/logo-6.svg'

import { getDay } from 'date-fns'

export default function App() {
  const send = useRemeshSend()
  const roomDomain = useRemeshDomain(RoomDomain())
  const userInfoDomain = useRemeshDomain(UserInfoDomain())
  const messageListDomain = useRemeshDomain(MessageListDomain())
  const userInfoSetFinished = useRemeshQuery(userInfoDomain.query.UserInfoSetIsFinishedQuery())
  const userInfoLoadFinished = useRemeshQuery(userInfoDomain.query.UserInfoLoadIsFinishedQuery())
  const messageListLoadFinished = useRemeshQuery(messageListDomain.query.MessageListLoadIsFinishedQuery())

  const notUserInfo = userInfoLoadFinished && !userInfoSetFinished

  const DayLogo = [LogoIcon0, LogoIcon1, LogoIcon2, LogoIcon3, LogoIcon4, LogoIcon5, LogoIcon6][getDay(Date())]

  useEffect(() => {
    if (messageListLoadFinished) {
      if (userInfoSetFinished) {
        send(roomDomain.command.JoinRoomCommand())
      } else {
        // Clear simulated data when refreshing on the setup page
        send(messageListDomain.command.ClearListCommand())
      }
    }
  }, [userInfoSetFinished, messageListLoadFinished])

  const [appOpen, setAppOpen] = useState(false)

  const handleToggleApp = async () => {
    const value = !appOpen
    setAppOpen(value)
    await indexDBStorage.setItem<boolean>(APP_OPEN_STATUS_STORAGE_KEY, value)
  }

  const getAppOpenStatus = async () => {
    const value = await indexDBStorage.getItem<boolean>(APP_OPEN_STATUS_STORAGE_KEY)
    setAppOpen(!!value)
  }

  useEffect(() => {
    getAppOpenStatus()
  }, [])

  return (
    <>
      <AppContainer open={appOpen}>
        <Header />
        <Main />
        <Footer />
        {notUserInfo && <Setup />}
        <Toaster richColors offset="70px" visibleToasts={1} position="top-center"></Toaster>
      </AppContainer>
      <AppButton onClick={handleToggleApp}>
        <DayLogo className="max-h-full max-w-full"></DayLogo>
      </AppButton>
    </>
  )
}
