import { useRef, type FC } from 'react'
import { CornerDownLeftIcon } from 'lucide-react'
import { useRemeshDomain, useRemeshQuery, useRemeshSend } from 'remesh-react'
import { Button } from '@/components/ui/Button'
import MessageInput from '@/components/MessageInput'
import MessageInputDomain from '@/domain/MessageInput'
import MessageListDomain from '@/domain/MessageList'
import { MESSAGE_MAX_LENGTH } from '@/constants'
import EmojiButton from '@/components/EmojiButton'
import { type Message } from '@/types'

const Footer: FC = () => {
  const send = useRemeshSend()
  const messageListDomain = useRemeshDomain(MessageListDomain())
  const messageInputDomain = useRemeshDomain(MessageInputDomain())
  const messageBody = useRemeshQuery(messageInputDomain.query.MessageQuery())

  const inputRef = useRef<HTMLTextAreaElement>(null)

  const handleInput = (value: string) => {
    send(messageInputDomain.command.InputCommand(value))
  }

  const message: Omit<Message, 'id'> = {
    username: '墨绿青苔',
    userId: '10251037',
    userAvatar: 'https://avatars.githubusercontent.com/u/10251037?v=4',
    body: messageBody.trim(),
    date: Date.now(),
    likeChecked: false,
    likeCount: 0,
    linkUsers: [],
    hateChecked: false,
    hateUsers: [],
    hateCount: 0
  }

  const handleSend = () => {
    if (!message.body) return
    send(messageListDomain.command.CreateItemCommand(message))
    send(messageInputDomain.command.ClearCommand())
  }

  const handleEmojiSelect = (emoji: string) => {
    send(messageInputDomain.command.InputCommand(`${messageBody}${emoji}`))
    inputRef.current?.focus()
  }

  return (
    <div className="relative z-10 grid gap-y-2 px-4 pb-4 pt-2 before:pointer-events-none before:absolute before:inset-x-4 before:-top-4 before:h-4 before:bg-gradient-to-t before:from-slate-50 before:from-30% before:to-transparent">
      <MessageInput
        ref={inputRef}
        value={messageBody}
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
