import IconSliders from '~icons/pixelarticons/sliders'
import IconZap from '~icons/pixelarticons/zap'

export default function Options() {
  return (
    <main className="px-4 py-10 text-center text-gray-700 dark:text-gray-200">
      <IconSliders className="icon-btn mx-2 text-2xl" />
      <div>Options</div>
      <p className="mt-2 opacity-50">This is the options page</p>

      <div className="mt-4 flex justify-center">
        Powered by Vite <IconZap className="align-middle" />
      </div>
    </main>
  )
}
