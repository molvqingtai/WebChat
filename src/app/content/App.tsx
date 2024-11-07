import Header from '@/app/content/views/Header'
import Footer from '@/app/content/views/Footer'
import Main from '@/app/content/views/Main'
import AppButton from '@/app/content/views/AppButton'
import AppMain from '@/app/content/views/AppMain'
import { useRemeshDomain, useRemeshQuery, useRemeshSend } from 'remesh-react'
import RoomDomain from '@/domain/Room'
import UserInfoDomain from '@/domain/UserInfo'
import Setup from '@/app/content/views/Setup'
import MessageListDomain from '@/domain/MessageList'
import { useEffect, useRef } from 'react'
import { Toaster } from 'sonner'

import DanmakuContainer from './components/DanmakuContainer'
import DanmakuDomain from '@/domain/Danmaku'
import AppStatusDomain from '@/domain/AppStatus'
import { cn } from '@/utils'

/**
 * Fix requestAnimationFrame error in jest
 * @see https://github.com/facebook/react/issues/16606
 * @see https://bugzilla.mozilla.org/show_bug.cgi?id=1469304
 */
if (import.meta.env.FIREFOX) {
  window.requestAnimationFrame = window.requestAnimationFrame.bind(window)
}

export default function App() {
  const send = useRemeshSend()
  const roomDomain = useRemeshDomain(RoomDomain())
  const userInfoDomain = useRemeshDomain(UserInfoDomain())
  const messageListDomain = useRemeshDomain(MessageListDomain())
  const danmakuDomain = useRemeshDomain(DanmakuDomain())
  const danmakuIsEnabled = useRemeshQuery(danmakuDomain.query.IsEnabledQuery())
  const userInfoSetFinished = useRemeshQuery(userInfoDomain.query.UserInfoSetIsFinishedQuery())
  const messageListLoadFinished = useRemeshQuery(messageListDomain.query.LoadIsFinishedQuery())
  const userInfoLoadFinished = useRemeshQuery(userInfoDomain.query.UserInfoLoadIsFinishedQuery())
  const appStatusDomain = useRemeshDomain(AppStatusDomain())
  const appStatusLoadIsFinished = useRemeshQuery(appStatusDomain.query.StatusLoadIsFinishedQuery())

  const userInfo = useRemeshQuery(userInfoDomain.query.UserInfoQuery())
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
      danmakuIsEnabled && send(danmakuDomain.command.UnmountCommand())
    }
  }, [danmakuIsEnabled])

  return (
    appStatusLoadIsFinished && (
      <div id="app" className={cn('contents', userInfo?.themeMode)}>
        <AppMain>
          <Header />
          <Main />
          <Footer />
          {notUserInfo && <Setup></Setup>}
          <Toaster richColors offset="70px" visibleToasts={1} position="top-center"></Toaster>
        </AppMain>
        <AppButton></AppButton>

        <DanmakuContainer ref={danmakuContainerRef} />
      </div>
    )
  )
}
