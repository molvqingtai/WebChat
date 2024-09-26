import Header from '@/app/content/views/Header'
import Footer from '@/app/content/views/Footer'
import Main from '@/app/content/views/Main'
import AppButton from '@/app/content/views/AppButton'
import AppContainer from '@/app/content/views/AppContainer'
import { useRemeshDomain, useRemeshQuery, useRemeshSend } from 'remesh-react'
import RoomDomain from '@/domain/Room'
import UserInfoDomain from '@/domain/UserInfo'
import Setup from '@/app/content/views/Setup'
import MessageListDomain, { MessageType } from '@/domain/MessageList'
import { useEffect, useState } from 'react'
import { Toaster } from 'sonner'
import { indexDBStorage } from '@/domain/impls/Storage'
import { APP_OPEN_STATUS_STORAGE_KEY } from '@/constants/config'

export default function App() {
  const send = useRemeshSend()
  const roomDomain = useRemeshDomain(RoomDomain())
  const userInfoDomain = useRemeshDomain(UserInfoDomain())
  const messageListDomain = useRemeshDomain(MessageListDomain())
  const userInfoSetFinished = useRemeshQuery(userInfoDomain.query.UserInfoSetIsFinishedQuery())
  const userInfoLoadFinished = useRemeshQuery(userInfoDomain.query.UserInfoLoadIsFinishedQuery())
  const messageListLoadFinished = useRemeshQuery(messageListDomain.query.MessageListLoadIsFinishedQuery())

  const notUserInfo = userInfoLoadFinished && !userInfoSetFinished

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
        <Toaster richColors offset="70px" visibleToasts={1} duration={5000} position="top-center"></Toaster>
      </AppContainer>
      <AppButton onClick={handleToggleApp}></AppButton>
    </>
  )
}
