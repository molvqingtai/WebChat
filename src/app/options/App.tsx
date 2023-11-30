import { Toaster } from 'sonner'
import Layout from './components/Layout'
import ProfileForm from './components/ProfileForm'

function App() {
  return (
    <Layout>
      <ProfileForm></ProfileForm>
      <Toaster richColors position="top-center" />
    </Layout>
  )
}

export default App
