import Header from '@/app/content/views/Header'
import Footer from '@/app/content/views/Footer'
import Main from '@/app/content/views/Main'
import AppButton from '@/app/content/views/AppButton'
import AppContainer from '@/app/content/views/AppContainer'
import { useRemeshDomain, useRemeshQuery, useRemeshSend } from 'remesh-react'
import RoomDomain from '@/domain/Room'
import { stringToHex } from '@/utils'
import { Toaster } from '@/components/ui/Sonner'
import UserInfoDomain from '@/domain/UserInfo'
import Setup from '@/app/content/views/Setup'
import MessageListDomain from '@/domain/MessageList'
import { useEffect } from 'react'

const hostRoomId = stringToHex(document.location.host)

export default function App() {
  const send = useRemeshSend()
  const roomDomain = useRemeshDomain(RoomDomain())
  const userInfoDomain = useRemeshDomain(UserInfoDomain())
  const messageListDomain = useRemeshDomain(MessageListDomain())
  const joinRoomFinished = useRemeshQuery(roomDomain.query.IsFinishedQuery())
  const userInfoFinished = useRemeshQuery(userInfoDomain.query.IsFinishedQuery())

  const userInfo = useRemeshQuery(userInfoDomain.query.UserInfoQuery())

  const notUserInfo = userInfoFinished && !userInfo

  useEffect(() => {
    if (userInfoFinished) {
      if (userInfo) {
        !joinRoomFinished && send(roomDomain.command.JoinRoomCommand(hostRoomId))
      } else {
        send(messageListDomain.command.ClearListCommand())
      }
    }
  }, [userInfoFinished, userInfo, joinRoomFinished])

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
