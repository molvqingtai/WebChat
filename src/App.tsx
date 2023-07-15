import Header from '@/components/Header'
import Footer from '@/components/Footer'
import Main from '@/components/Main'
import Sidebar from '@/components/Sidebar'
import AppButton from './components/AppButton'

export default function App() {
  return (
    <>
      <main className="main">
        <Header />
        <Main />
        <Sidebar />
        <Footer />
      </main>
      <AppButton></AppButton>
    </>

    // <>
    //   <div className="fixed left-0 bottom-0 m-5 z-100 flex font-sans select-none leading-1em">
    //     <div
    //       className="flex justify-center items-center w-10 h-10 rounded-full shadow cursor-pointer bg-blue-400 hover:bg-blue-600"
    //       onClick={() => {
    //         setOpen((open) => !open)
    //         setOpenedOnce(true)
    //       }}
    //     >
    //       <IconPower />
    //     </div>
    //   </div>
    //   {openedOnce && (
    //     <div
    //       className={`fixed top-0 right-0 h-full w-1/4 z-50 bg-white drop-shadow-xl transition-transform ${
    //         open ? 'translate-x-0' : 'translate-x-full'
    //       }`}
    //     >
    //       <Sidebar></Sidebar>
    //     </div>
    //   )}
    // </>
  )
}
