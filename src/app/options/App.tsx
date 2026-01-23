import { Toaster } from 'sonner'
import Main from './components/main'
import ProfileForm from './components/profile-form'
import BadgeList from './components/badge-list'
import Layout from './components/layout'
import VersionLink from './components/version-link'
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
