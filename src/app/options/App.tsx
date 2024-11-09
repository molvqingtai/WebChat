import { Toaster } from 'sonner'
import Main from './components/Main'
import ProfileForm from './components/ProfileForm'
import BadgeList from './components/BadgeList'
import Layout from './components/Layout'
import VersionLink from './components/VersionLink'
import { useRemeshDomain, useRemeshQuery } from 'remesh-react'
import UserInfoDomain from '@/domain/UserInfo'

function App() {
  const userInfoDomain = useRemeshDomain(UserInfoDomain())
  const userInfo = useRemeshQuery(userInfoDomain.query.UserInfoQuery())
  return (
    <div className={userInfo?.themeMode}>
      <Layout>
        <VersionLink></VersionLink>
        <Main>
          <ProfileForm></ProfileForm>
          <Toaster
            richColors
            position="top-center"
            toastOptions={{
              classNames: {
                toast: 'dark:bg-slate-950 border dark:border-slate-600'
              }
            }}
          />
        </Main>
        <BadgeList></BadgeList>
      </Layout>
    </div>
  )
}

export default App
