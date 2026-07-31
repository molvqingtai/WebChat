import '@webcomponents/custom-elements'
import { useEffect, useRef } from 'react'
import { useRemeshDomain, useRemeshQuery, useRemeshSend } from 'remesh-react'
import { Toaster } from 'sonner'
import Header from '@/app/content/views/header'
import Footer from '@/app/content/views/footer'
import Main from '@/app/content/views/main'
import Setup from '@/app/content/views/setup'
import AppButton from '@/app/content/views/app-button'
import AppMain from '@/app/content/views/app-main'
import DanmakuContainer from '@/app/content/components/danmaku-container'
import ChatRoomDomain from '@/domain/ChatRoom'
import UserInfoDomain from '@/domain/UserInfo'
import MessageListDomain from '@/domain/MessageList'
import WorldRoomDomain from '@/domain/WorldRoom'
import DanmakuDomain from '@/domain/Danmaku'
import AppStatusDomain from '@/domain/AppStatus'
import { checkDarkMode, cn } from '@/utils'

if (import.meta.env.FIREFOX) {
  window.requestAnimationFrame = window.requestAnimationFrame.bind(window)
}

const App = () => {
  const send = useRemeshSend()
  const appStatusDomain = useRemeshDomain(AppStatusDomain())
  const initializationReady = useRemeshQuery(appStatusDomain.query.ReadyQuery())
  const chatRoomDomain = useRemeshDomain(ChatRoomDomain())
  const worldRoomDomain = useRemeshDomain(WorldRoomDomain())
  const userInfoDomain = useRemeshDomain(UserInfoDomain())
  const messageListDomain = useRemeshDomain(MessageListDomain())
  const danmakuDomain = useRemeshDomain(DanmakuDomain())
  const danmakuIsEnabled = useRemeshQuery(danmakuDomain.query.IsEnabledQuery())
  const userInfoSetFinished = useRemeshQuery(userInfoDomain.query.UserInfoSetIsFinishedQuery())
  const messageListLoadFinished = useRemeshQuery(messageListDomain.query.LoadIsFinishedQuery())
  const userInfoLoadFinished = useRemeshQuery(userInfoDomain.query.UserInfoLoadIsFinishedQuery())
  const chatRoomJoinIsFinished = useRemeshQuery(chatRoomDomain.query.JoinIsFinishedQuery())
  const worldRoomJoinIsFinished = useRemeshQuery(worldRoomDomain.query.JoinIsFinishedQuery())
  const userInfo = useRemeshQuery(userInfoDomain.query.UserInfoQuery())
  const danmakuContainerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (initializationReady && messageListLoadFinished && userInfoSetFinished) {
      send(chatRoomDomain.command.JoinRoomCommand())
    }
  }, [initializationReady, userInfoSetFinished, messageListLoadFinished, send, chatRoomDomain.command])

  useEffect(() => {
    if (initializationReady && chatRoomJoinIsFinished && !worldRoomJoinIsFinished) {
      send(worldRoomDomain.command.JoinRoomCommand())
    }
  }, [initializationReady, chatRoomJoinIsFinished, worldRoomJoinIsFinished, send, worldRoomDomain.command])

  useEffect(() => {
    if (danmakuIsEnabled) send(danmakuDomain.command.MountCommand(danmakuContainerRef.current!))
    return () => {
      if (danmakuIsEnabled) send(danmakuDomain.command.UnmountCommand())
    }
  }, [danmakuIsEnabled, send, danmakuDomain.command])

  const notUserInfo = userInfoLoadFinished && !userInfoSetFinished
  const themeMode =
    userInfo?.themeMode === 'system'
      ? checkDarkMode()
        ? 'dark'
        : 'light'
      : (userInfo?.themeMode ?? (checkDarkMode() ? 'dark' : 'light'))

  return (
    <div id="app" className={cn('contents', themeMode)}>
      <AppMain>
        <Header />
        <Main />
        <Footer />
        {notUserInfo && <Setup />}
        <Toaster
          richColors
          theme={themeMode}
          offset="70px"
          visibleToasts={1}
          toastOptions={{
            classNames: {
              toast: 'dark:bg-slate-950 border dark:border-slate-600'
            }
          }}
          position="top-center"
        />
      </AppMain>
      <AppButton />
      <DanmakuContainer ref={danmakuContainerRef} />
    </div>
  )
}

export default App
