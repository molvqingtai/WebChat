import Layout from './components/Layout'
import ProfileForm from './components/ProfileForm'
import { Toaster } from '@/components/ui/Toaster'

function App() {
  return (
    <Layout>
      <ProfileForm></ProfileForm>
      <Toaster />
    </Layout>
  )
}

export default App
