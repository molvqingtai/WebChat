import { Toaster } from 'sonner'
import Main from './components/Main'
import ProfileForm from './components/ProfileForm'
import BadgeList from './components/BadgeList'
import Meteors from '@/components/magicui/meteors'

function App() {
  return (
    <>
      <Meteors number={30} />
      <BadgeList></BadgeList>
      <Main>
        <ProfileForm></ProfileForm>
        <Toaster richColors position="top-center" />
      </Main>
    </>
  )
}

export default App
