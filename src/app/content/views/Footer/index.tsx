import { useRef, type FC } from 'react'
import { CornerDownLeftIcon } from 'lucide-react'
import { useRemeshDomain, useRemeshQuery, useRemeshSend } from 'remesh-react'
import MessageInput from '../../components/MessageInput'
import EmojiButton from '../../components/EmojiButton'
import { Button } from '@/components/ui/Button'
import MessageInputDomain from '@/domain/MessageInput'
import { MESSAGE_MAX_LENGTH } from '@/constants/config'
import RoomDomain from '@/domain/Room'

const Footer: FC = () => {
  const send = useRemeshSend()
  const roomDomain = useRemeshDomain(RoomDomain())
  const messageInputDomain = useRemeshDomain(MessageInputDomain())
  const message = useRemeshQuery(messageInputDomain.query.MessageQuery())

  const inputRef = useRef<HTMLTextAreaElement>(null)

  const handleInput = (value: string) => {
    send(messageInputDomain.command.InputCommand(value))
  }

  const handleSend = () => {
    if (!message.trim()) return
    send(roomDomain.command.SendTextMessageCommand(message.trim()))
    send(messageInputDomain.command.ClearCommand())
  }

  const handleEmojiSelect = (emoji: string) => {
    send(messageInputDomain.command.InputCommand(`${message}${emoji}`))
    inputRef.current?.focus()
  }

  return (
    <div className="relative z-10 grid gap-y-2 px-4 pb-4 pt-2 before:pointer-events-none before:absolute before:inset-x-4 before:-top-4 before:h-4 before:bg-gradient-to-t before:from-slate-50 before:from-30% before:to-transparent">
      <MessageInput
        ref={inputRef}
        value={message}
        onEnter={handleSend}
        onInput={handleInput}
        maxLength={MESSAGE_MAX_LENGTH}
      ></MessageInput>
      <div className="flex items-center">
        <EmojiButton onSelect={handleEmojiSelect}></EmojiButton>
        {/* <Button variant="ghost" size="icon">
          <ImageIcon size={20} />
        </Button> */}
        <Button className="ml-auto" size="sm" onClick={handleSend}>
          <span className="mr-2">Send</span>
          <CornerDownLeftIcon className="text-slate-400" size={12}></CornerDownLeftIcon>
        </Button>
      </div>
    </div>
  )
}

Footer.displayName = 'Footer'

export default Footer
