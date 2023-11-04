import Header from '@/entrypoints/content/views/Header'
import Footer from '@/entrypoints/content/views/Footer'
import Main from '@/entrypoints/content/views/Main'
import AppButton from '@/entrypoints/content/views/AppButton'
import AppContainer from '@/entrypoints/content/views/AppContainer'

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
