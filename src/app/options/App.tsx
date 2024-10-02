import { Toaster } from 'sonner'
import Main from './components/Main'
import ProfileForm from './components/ProfileForm'
import BadgeList from './components/BadgeList'
import Layout from './components/Layout'
import VersionLink from './components/VersionLink'

function App() {
  return (
    <Layout>
      <VersionLink></VersionLink>
      <Main>
        <ProfileForm></ProfileForm>
        <Toaster richColors position="top-center" />
      </Main>
      <BadgeList></BadgeList>
    </Layout>
  )
}

export default App
