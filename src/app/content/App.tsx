import '@webcomponents/custom-elements'
import Header from '@/app/content/views/header'
import Footer from '@/app/content/views/footer'
import Main from '@/app/content/views/main'
import AppButton from '@/app/content/views/app-button'
import AppMain from '@/app/content/views/app-main'
import { useRemeshDomain, useRemeshQuery, useRemeshSend } from 'remesh-react'
import ChatRoomDomain from '@/domain/ChatRoom'
import UserInfoDomain from '@/domain/UserInfo'
import Setup from '@/app/content/views/setup'
import MessageListDomain from '@/domain/MessageList'
import { useEffect, useRef } from 'react'
import { Toaster } from 'sonner'

import DanmakuContainer from './components/danmaku-container'
import DanmakuDomain from '@/domain/Danmaku'
import AppStatusDomain from '@/domain/AppStatus'
import { checkDarkMode, cn } from '@/utils'
import WorldRoomDomain from '@/domain/WorldRoom'
import ReadinessDomain from '@/domain/Readiness'
import { AlertCircleIcon, LoaderCircleIcon } from 'lucide-react'
import { useReconnectToast } from './components/reconnect-toast'

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
  const chatRoomDomain = useRemeshDomain(ChatRoomDomain())
  const worldRoomDomain = useRemeshDomain(WorldRoomDomain())
  const userInfoDomain = useRemeshDomain(UserInfoDomain())
  const messageListDomain = useRemeshDomain(MessageListDomain())
  const danmakuDomain = useRemeshDomain(DanmakuDomain())
  const danmakuIsEnabled = useRemeshQuery(danmakuDomain.query.IsEnabledQuery())
  const userInfoSetFinished = useRemeshQuery(userInfoDomain.query.UserInfoSetIsFinishedQuery())
  const messageListLoadFinished = useRemeshQuery(messageListDomain.query.LoadIsFinishedQuery())
  const userInfoLoadFinished = useRemeshQuery(userInfoDomain.query.UserInfoLoadIsFinishedQuery())
  const appStatusDomain = useRemeshDomain(AppStatusDomain())
  const appStatusLoadIsFinished = useRemeshQuery(appStatusDomain.query.StatusLoadIsFinishedQuery())
  const chatRoomJoinIsFinished = useRemeshQuery(chatRoomDomain.query.JoinIsFinishedQuery())
  const worldRoomJoinIsFinished = useRemeshQuery(worldRoomDomain.query.JoinIsFinishedQuery())
  const readinessDomain = useRemeshDomain(ReadinessDomain())
  const runtimeHostPhase = useRemeshQuery(readinessDomain.query.StateQuery())
  const reconnectToasterRef = useReconnectToast()

  const userInfo = useRemeshQuery(userInfoDomain.query.UserInfoQuery())
  const notUserInfo = userInfoLoadFinished && !userInfoSetFinished

  useEffect(() => {
    if (messageListLoadFinished && userInfoSetFinished) send(chatRoomDomain.command.JoinRoomCommand())
  }, [userInfoSetFinished, messageListLoadFinished, send, chatRoomDomain.command])

  useEffect(() => {
    if (chatRoomJoinIsFinished && !worldRoomJoinIsFinished) {
      send(worldRoomDomain.command.JoinRoomCommand())
    }
  }, [chatRoomJoinIsFinished, worldRoomJoinIsFinished, send, worldRoomDomain.command])

  useEffect(() => {
    if (danmakuIsEnabled) send(danmakuDomain.command.MountCommand(danmakuContainerRef.current!))
    return () => {
      if (danmakuIsEnabled) send(danmakuDomain.command.UnmountCommand())
    }
  }, [danmakuIsEnabled, send, danmakuDomain.command])

  const themeMode =
    userInfo?.themeMode === 'system'
      ? checkDarkMode()
        ? 'dark'
        : 'light'
      : (userInfo?.themeMode ?? (checkDarkMode() ? 'dark' : 'light'))

  const danmakuContainerRef = useRef<HTMLDivElement>(null)

  return (
    <div id="app" className={cn('contents', themeMode)}>
      {runtimeHostPhase !== 'ready' && (
        <output
          aria-live="polite"
          className="z-infinity fixed right-4 bottom-4 flex items-center gap-2 rounded-md border border-slate-300 bg-white p-2 text-sm text-slate-700 shadow-lg dark:border-slate-700 dark:bg-slate-950 dark:text-slate-200"
        >
          {runtimeHostPhase === 'connecting' ? (
            <LoaderCircleIcon className="size-4 animate-spin" />
          ) : (
            <AlertCircleIcon className="size-4 text-red-600 dark:text-red-400" />
          )}
          <span>{runtimeHostPhase === 'connecting' ? 'WebChat connecting' : 'WebChat unavailable'}</span>
        </output>
      )}
      {appStatusLoadIsFinished && (
        <>
          <AppMain>
            <Header />
            <Main />
            <Footer />
            {notUserInfo && <Setup></Setup>}
            <Toaster
              ref={reconnectToasterRef}
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
            ></Toaster>
          </AppMain>
          <AppButton></AppButton>
        </>
      )}
      <DanmakuContainer ref={danmakuContainerRef} />
    </div>
  )
}
