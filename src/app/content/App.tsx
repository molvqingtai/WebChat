import Header from '@/app/content/views/Header'
import Footer from '@/app/content/views/Footer'
import Main from '@/app/content/views/Main'
import AppButton from '@/app/content/views/AppButton'
import AppContainer from '@/app/content/views/AppContainer'
import { useRemeshDomain, useRemeshSend } from 'remesh-react'
import RoomDomain from '@/domain/Room'
import { stringToHex } from '@/utils'
import { Toaster } from '@/components/ui/Sonner'

const hostRoomId = stringToHex(document.location.host)

export default function App() {
  const send = useRemeshSend()
  const roomDomain = useRemeshDomain(RoomDomain())

  send(roomDomain.command.JoinRoomCommand(hostRoomId))

  return (
    <>
      <AppContainer>
        <Header />
        <Main />
        <Footer />
      </AppContainer>
      <AppButton></AppButton>
      <Toaster richColors offset="104px" position="top-center"></Toaster>
    </>
  )
}
