import { Toaster } from 'sonner'
import Main from './components/Main'
import ProfileForm from './components/ProfileForm'
import BadgeList from './components/BadgeList'
import Layout from './components/Layout'

function App() {
  return (
    <Layout>
      <Main>
        <ProfileForm></ProfileForm>
        <Toaster richColors position="top-center" />
      </Main>
      <BadgeList></BadgeList>
    </Layout>
  )
}

export default App
