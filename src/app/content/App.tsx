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
import { useEffect, useRef } from 'react'
import { Toaster } from 'sonner'

import DanmakuContainer from './components/DanmakuContainer'
import DanmakuDomain from '@/domain/Danmaku'

export default function App() {
  const send = useRemeshSend()
  const roomDomain = useRemeshDomain(RoomDomain())
  const userInfoDomain = useRemeshDomain(UserInfoDomain())
  const messageListDomain = useRemeshDomain(MessageListDomain())
  const danmakuDomain = useRemeshDomain(DanmakuDomain())
  const danmakuIsEnabled = useRemeshQuery(danmakuDomain.query.IsEnabledQuery())
  const userInfoSetFinished = useRemeshQuery(userInfoDomain.query.UserInfoSetIsFinishedQuery())
  const userInfoLoadFinished = useRemeshQuery(userInfoDomain.query.UserInfoLoadIsFinishedQuery())
  const messageListLoadFinished = useRemeshQuery(messageListDomain.query.LoadIsFinishedQuery())

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

  const danmakuContainerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    danmakuIsEnabled && send(danmakuDomain.command.MountCommand(danmakuContainerRef.current!))
    return () => {
      danmakuIsEnabled && send(danmakuDomain.command.DestroyCommand())
    }
  }, [danmakuIsEnabled])
  console.log(1)

  return (
    <>
      <AppContainer>
        <Header />
        <Main />
        <Footer />
        {notUserInfo && <Setup />}
        <Toaster richColors offset="70px" visibleToasts={1} position="top-center"></Toaster>
      </AppContainer>
      <AppButton></AppButton>
      <DanmakuContainer ref={danmakuContainerRef} />
    </>
  )
}
