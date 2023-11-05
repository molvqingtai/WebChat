import Header from '@/app/content/views/Header'
import Footer from '@/app/content/views/Footer'
import Main from '@/app/content/views/Main'
import AppButton from '@/app/content/views/AppButton'
import AppContainer from '@/app/content/views/AppContainer'

export default function App() {
  return (
    <>
      <AppContainer>
        <Header />
        <Main />
        <Footer />
      </AppContainer>
      <AppButton></AppButton>
    </>
  )
}
