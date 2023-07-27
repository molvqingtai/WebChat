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
    <div className="grid gap-y-2 p-4">
      <Textarea
        className="rounded-lg bg-gray-50"
        rows={is2XL ? 3 : 2}
        value={message}
        placeholder="Type your message here."
        onInput={handleInput}
      />
      <div className="grid grid-cols-[auto_auto_1fr] items-center justify-items-end">
        <Button variant="ghost" size="icon">
          <SmileIcon size={20} />
        </Button>
        <Button variant="ghost" size="icon">
          <SmileIcon size={20} />
        </Button>
        <Button size="sm">
          <span className="mr-2">Send</span>
          <CommandIcon className="text-slate-400" size={12}></CommandIcon>
          <CornerDownLeftIcon className="text-slate-400" size={12}></CornerDownLeftIcon>
        </Button>
      </div>
    </div>
  )
}

Footer.displayName = 'Footer'

export default Footer
