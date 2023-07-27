import { useState, type FC, type ChangeEvent } from 'react'
import { Textarea } from '@/components/ui/Textarea'
import { Button } from '@/components/ui/Button'
import { SmileIcon, CommandIcon, CornerDownLeftIcon } from 'lucide-react'
import { useBreakpoint } from '@/hooks/useBreakpoint'

const Footer: FC = () => {
  const { is2XL } = useBreakpoint()
  const [message, setMessage] = useState('')

  const handleInput = (e: ChangeEvent<HTMLTextAreaElement>) => {
    setMessage(e.target.value)
  }

  return (
    <div className="grid grid-cols-2 gap-y-2  p-4">
      <Textarea
        className="col-span-2 rounded-lg bg-gray-50"
        rows={is2XL ? 3 : 2}
        value={message}
        placeholder="Type your message here."
        onInput={handleInput}
      />

      <Button variant="ghost" size="icon" className="place-self-start">
        <SmileIcon size={20} />
      </Button>
      <Button size="sm" className="place-self-end">
        <span className="mr-2">Send</span>
        <CommandIcon className="text-slate-400" size={12}></CommandIcon>
        <CornerDownLeftIcon className="text-slate-400" size={12}></CornerDownLeftIcon>
      </Button>
    </div>
  )
}

Footer.displayName = 'Footer'

export default Footer
