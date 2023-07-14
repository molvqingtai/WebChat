import Logo from '@/components/Logo'
import { Textarea } from '@/components/ui/textarea'
import { Button } from '@/components/ui/button'

export default function Sidebar() {
  return (
    <main className="w-[300px] px-4 py-5 text-center text-gray-700">
      <Logo />
      <div>Sidebar123</div>
      <p className="mt-2 opacity-50 text-blue-600">This is the sidebar page</p>
      <Textarea />
      <Button>test</Button>
    </main>
  )
}
