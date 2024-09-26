import Header from '@/app/content/views/Header'
import Footer from '@/app/content/views/Footer'
import Main from '@/app/content/views/Main'
import AppButton from '@/app/content/views/AppButton'
import AppContainer from '@/app/content/views/AppContainer'
import { useRemeshDomain, useRemeshQuery, useRemeshSend } from 'remesh-react'
import RoomDomain from '@/domain/Room'
import { Toaster } from '@/components/ui/Sonner'
import UserInfoDomain from '@/domain/UserInfo'
import Setup from '@/app/content/views/Setup'
import MessageListDomain from '@/domain/MessageList'
import { useEffect } from 'react'

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
    if (userInfoSetFinished && messageListLoadFinished) {
      send(roomDomain.command.JoinRoomCommand())
    }
  }, [userInfoSetFinished, messageListLoadFinished])

  return (
    <>
      <AppContainer>
        <Header />
        <Main />
        <Footer />
        {notUserInfo && <Setup />}
      </AppContainer>
      <AppButton></AppButton>
      <Toaster richColors offset="104px" position="top-center"></Toaster>
    </>
  )
}
