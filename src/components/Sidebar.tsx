import Logo from '@/components/Logo'

export default function Sidebar() {
  return (
    <main className="w-[300px] px-4 py-5 text-center text-gray-700">
      <Logo />
      <div>Sidebar</div>
      <p className="mt-2 opacity-50 text-blue-600">This is the sidebar page</p>
    </main>
  )
}
