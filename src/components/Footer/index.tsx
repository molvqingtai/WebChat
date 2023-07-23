import { useState, type FC, type ChangeEvent } from 'react'
import { Textarea } from '@/components/ui/Textarea'
import { Button } from '@/components/ui/Button'
import { Smile, Command, CornerDownLeft } from 'lucide-react'
import { useBreakpoint } from '@/hooks/useBreakpoint'

const Footer: FC = () => {
  const { is2XL } = useBreakpoint()
  const [message, setMessage] = useState('')

  const handleInput = (e: ChangeEvent<HTMLTextAreaElement>) => {
    setMessage(e.target.value)
  }

  return (
    <div className="grid grid-cols-2 gap-y-2 p-4">
      <Textarea
        className="col-span-2"
        rows={is2XL ? 3 : 2}
        value={message}
        placeholder="Type your message here."
        onInput={handleInput}
      />

      <Button variant="ghost" size="sm" className="place-self-start">
        <Smile size={20} />
      </Button>
      <Button size="sm" className="place-self-end">
        <span className="mr-2">Send</span>
        <Command className="text-slate-400" size={12}></Command>
        <CornerDownLeft className="text-slate-400" size={12}></CornerDownLeft>
      </Button>
    </div>
  )
}

Footer.displayName = 'Footer'

export default Footer
