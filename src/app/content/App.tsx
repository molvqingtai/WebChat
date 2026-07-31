import '@webcomponents/custom-elements'
import Header from '@/app/content/views/header'
import Footer from '@/app/content/views/footer'
import Main from '@/app/content/views/main'
import { useRemeshDomain, useRemeshQuery, useRemeshSend } from 'remesh-react'
import ChatRoomDomain from '@/domain/ChatRoom'
import UserInfoDomain from '@/domain/UserInfo'
import Setup from '@/app/content/views/setup'
import MessageListDomain from '@/domain/MessageList'
import { useEffect } from 'react'

import AppStatusDomain from '@/domain/AppStatus'
import { checkDarkMode } from '@/utils'
import WorldRoomDomain from '@/domain/WorldRoom'
import { useAppTheme } from '@/app/content/BootstrapShell'

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
  const userInfoSetFinished = useRemeshQuery(userInfoDomain.query.UserInfoSetIsFinishedQuery())
  const messageListLoadFinished = useRemeshQuery(messageListDomain.query.LoadIsFinishedQuery())
  const userInfoLoadFinished = useRemeshQuery(userInfoDomain.query.UserInfoLoadIsFinishedQuery())
  const appStatusDomain = useRemeshDomain(AppStatusDomain())
  const appStatusLoadIsFinished = useRemeshQuery(appStatusDomain.query.StatusLoadIsFinishedQuery())
  const chatRoomJoinIsFinished = useRemeshQuery(chatRoomDomain.query.JoinIsFinishedQuery())
  const worldRoomJoinIsFinished = useRemeshQuery(worldRoomDomain.query.JoinIsFinishedQuery())

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

  const themeMode =
    userInfo?.themeMode === 'system'
      ? checkDarkMode()
        ? 'dark'
        : 'light'
      : (userInfo?.themeMode ?? (checkDarkMode() ? 'dark' : 'light'))

  const setThemeMode = useAppTheme()

  useEffect(() => setThemeMode(themeMode), [setThemeMode, themeMode])

  return (
    appStatusLoadIsFinished && (
      <>
        <Header />
        <Main />
        <Footer />
        {notUserInfo && <Setup></Setup>}
      </>
    )
  )
}
