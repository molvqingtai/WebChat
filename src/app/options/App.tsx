import { Toaster } from 'sonner'
import Main from './components/Main'
import ProfileForm from './components/ProfileForm'
import BadgeList from './components/BadgeList'

function App() {
  return (
    <>
      <BadgeList></BadgeList>
      <Main>
        <ProfileForm></ProfileForm>
        <Toaster richColors position="top-center" />
      </Main>
    </>
  )
}

export default App
