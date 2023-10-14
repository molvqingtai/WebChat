import Header from '@/views/Header'
import Footer from '@/views/Footer'
import Main from '@/views/Main'
import AppButton from '@/views/AppButton'
import AppContainer from '@/views/AppContainer'

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
