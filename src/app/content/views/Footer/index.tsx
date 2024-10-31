import { ChangeEvent, useMemo, useRef, useState, KeyboardEvent, type FC, ClipboardEvent } from 'react'
import { CornerDownLeftIcon } from 'lucide-react'
import { useRemeshDomain, useRemeshQuery, useRemeshSend } from 'remesh-react'
import MessageInput from '../../components/MessageInput'
import EmojiButton from '../../components/EmojiButton'
import { Button } from '@/components/ui/Button'
import MessageInputDomain from '@/domain/MessageInput'
import { MESSAGE_MAX_LENGTH } from '@/constants/config'
import RoomDomain from '@/domain/Room'
import useCursorPosition from '@/hooks/useCursorPosition'
import useShareRef from '@/hooks/useShareRef'
import { Presence } from '@radix-ui/react-presence'
import { Portal } from '@radix-ui/react-portal'
import useTriggerAway from '@/hooks/useTriggerAway'
import { ScrollArea } from '@/components/ui/ScrollArea'
import { Virtuoso, VirtuosoHandle } from 'react-virtuoso'
import UserInfoDomain from '@/domain/UserInfo'
import { blobToBase64, cn, compressImage, getRootNode, getTextSimilarity } from '@/utils'
import { Avatar, AvatarFallback } from '@/components/ui/Avatar'
import { AvatarImage } from '@radix-ui/react-avatar'
import ToastDomain from '@/domain/Toast'
import ImageButton from '../../components/ImageButton'
import { nanoid } from 'nanoid'

const Footer: FC = () => {
  const send = useRemeshSend()
  const toastDomain = useRemeshDomain(ToastDomain())
  const roomDomain = useRemeshDomain(RoomDomain())
  const messageInputDomain = useRemeshDomain(MessageInputDomain())
  const message = useRemeshQuery(messageInputDomain.query.MessageQuery())
  const userInfoDomain = useRemeshDomain(UserInfoDomain())
  const userInfo = useRemeshQuery(userInfoDomain.query.UserInfoQuery())
  const userList = useRemeshQuery(roomDomain.query.UserListQuery())

  const inputRef = useRef<HTMLTextAreaElement>(null)
  const { x, y, selectionStart, selectionEnd, setRef } = useCursorPosition()

  const [autoCompleteListShow, setAutoCompleteListShow] = useState(false)
  const [scrollParentRef, setScrollParentRef] = useState<HTMLDivElement | null>(null)
  const autoCompleteListRef = useRef<HTMLDivElement>(null)
  const { setRef: setAutoCompleteListRef } = useTriggerAway(['click'], () => setAutoCompleteListShow(false))
  const shareAutoCompleteListRef = useShareRef(setAutoCompleteListRef, autoCompleteListRef)
  const isComposing = useRef(false)
  const virtuosoRef = useRef<VirtuosoHandle>(null)
  const [inputLoading, setInputLoading] = useState(false)

  const shareRef = useShareRef(inputRef, setRef)

  /**
   * When inserting a username using the @ syntax, record the username's position information and the mapping relationship between the position information and userId to distinguish between users with the same name.
   */
  const atUserRecord = useRef<Map<string, Set<[number, number]>>>(new Map())
  const imageRecord = useRef<Map<string, string>>(new Map())

  const updateAtUserAtRecord = useMemo(
    () => (message: string, start: number, end: number, offset: number, atUserId?: string) => {
      const positions: [number, number] = [start, end]

      // If the editing position is before the end position of @user, update the editing position.
      // "@user" => "E@user"
      // "@user" => "@useEr"
      // "@user" => "@user @user"
      atUserRecord.current.forEach((item, userId) => {
        const positionList = [...item].map<[number, number]>((item) => {
          const inBefore = Math.min(start, end) <= item[1]
          return inBefore ? [item[0] + offset + (end - start), item[1] + offset + (end - start)] : item
        })
        atUserRecord.current.set(userId, new Set(positionList))
      })

      // Insert a new @user record
      if (atUserId) {
        atUserRecord.current.set(atUserId, atUserRecord.current.get(atUserId)?.add(positions) ?? new Set([positions]))
      }

      // After moving, check if the @user in the message matches the saved position record. If not, it means the @user has been edited, so delete that record.
      // Filter out records where the stored position does not match the actual position.
      atUserRecord.current.forEach((item, userId) => {
        // Pre-calculate the offset after InputCommand
        const positionList = [...item].filter((item) => {
          const username = message.slice(item[0], item[1] + 1)
          return username === `@${userList.find((user) => user.userId === userId)?.username}`
        })
        if (positionList.length) {
          atUserRecord.current.set(userId, new Set(positionList))
        } else {
          atUserRecord.current.delete(userId)
        }
      })
    },
    [userList]
  )

  const [selectedUserIndex, setSelectedUserIndex] = useState(0)
  const [searchNameKeyword, setSearchNameKeyword] = useState('')

  const autoCompleteList = useMemo(() => {
    return userList
      .filter((user) => user.userId !== userInfo?.id)
      .map((item) => ({
        ...item,
        similarity: getTextSimilarity(searchNameKeyword.toLowerCase(), item.username.toLowerCase())
      }))
      .toSorted((a, b) => b.similarity - a.similarity)
  }, [searchNameKeyword, userList, userInfo])

  const selectedUser = autoCompleteList.find((_, index) => index === selectedUserIndex)!

  // Replace the hash URL in ![Image](hash:${hash}) with base64 and update the atUserRecord.
  const transformMessage = async (message: string) => {
    let newMessage = message
    const matchList = [...message.matchAll(/!\[Image\]\(hash:([^\s)]+)\)/g)]
    matchList?.forEach((match) => {
      const base64 = imageRecord.current.get(match[1])
      if (base64) {
        const base64Syntax = `![Image](${base64})`
        const hashSyntax = match[0]
        const startIndex = match.index
        const endIndex = startIndex + base64Syntax.length - hashSyntax.length
        newMessage = newMessage.replace(hashSyntax, base64Syntax)
        updateAtUserAtRecord(newMessage, startIndex, endIndex, 0)
      }
    })
    return newMessage
  }

  const handleSend = async () => {
    if (!`${message}`.trim()) {
      return send(toastDomain.command.WarningCommand('Message cannot be empty.'))
    }
    const transformedMessage = await transformMessage(message)
    const atUsers = [...atUserRecord.current]
      .map(([userId, positions]) => {
        const user = userList.find((user) => user.userId === userId)
        return (user ? { ...user, positions: [...positions] } : undefined)!
      })
      .filter(Boolean)

    send(roomDomain.command.SendTextMessageCommand({ body: transformedMessage, atUsers }))
    send(messageInputDomain.command.ClearCommand())
  }

  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (autoCompleteListShow && autoCompleteList.length) {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        const length = autoCompleteList.length
        const prevIndex = selectedUserIndex

        if (e.key === 'ArrowDown') {
          const index = (prevIndex + 1) % length
          setSelectedUserIndex(index)
          virtuosoRef.current?.scrollIntoView({ index })
          e.preventDefault()
        }
        if (e.key === 'ArrowUp') {
          const index = (prevIndex - 1 + length) % length
          setSelectedUserIndex(index)
          virtuosoRef.current?.scrollIntoView({ index })
          e.preventDefault()
        }
      }

      if (['Escape', 'Backspace', 'Delete', 'ArrowLeft', 'ArrowRight'].includes(e.key)) {
        if (e.key === 'Delete' || e.key === 'Backspace') {
          const isDeleteAt = message.at(selectionStart - 1) === '@'
          setAutoCompleteListShow(!isDeleteAt)
        } else {
          setAutoCompleteListShow(false)
        }
        setSelectedUserIndex(0)
      }
    }

    if (e.key === 'Enter' && !(e.shiftKey || e.ctrlKey || e.altKey || e.metaKey)) {
      if (isComposing.current) return

      if (autoCompleteListShow && autoCompleteList.length) {
        handleInjectAtSyntax(selectedUser.username)
      } else {
        handleSend()
      }
      e.preventDefault()
    }
  }

  const handleInput = (e: ChangeEvent<HTMLTextAreaElement>) => {
    const currentMessage = e.target.value

    if (autoCompleteListShow) {
      const target = e.target as HTMLTextAreaElement
      if (target.value) {
        const atIndex = target.value.lastIndexOf('@', selectionEnd - 1)
        if (atIndex !== -1) {
          const keyword = target.value.slice(atIndex + 1, selectionEnd)
          setSearchNameKeyword(keyword)
          setSelectedUserIndex(0)
          virtuosoRef.current?.scrollIntoView({ index: 0 })
        }
      } else {
        setAutoCompleteListShow(false)
      }
    }

    const event = e.nativeEvent as InputEvent

    if (event.data === '@' && autoCompleteList.length) {
      setAutoCompleteListShow(true)
    }

    // Pre-calculate the offset after InputCommand
    const start = selectionStart
    const end = selectionStart + currentMessage.length - message.length

    updateAtUserAtRecord(currentMessage, start, end, 0)

    send(messageInputDomain.command.InputCommand(currentMessage))
  }

  const handlePaste = async (e: ClipboardEvent<HTMLTextAreaElement>) => {
    const file = e.nativeEvent.clipboardData?.files[0]
    if (['image/png', 'image/jpeg', 'image/webp'].includes(file?.type ?? '')) {
      handleInjectImage(file!)
    }
  }

  const handleInjectEmoji = (emoji: string) => {
    const newMessage = `${message.slice(0, selectionEnd)}${emoji}${message.slice(selectionEnd)}`

    // Pre-calculate the offset after InputCommand
    const start = selectionStart
    const end = selectionEnd + newMessage.length - message.length

    updateAtUserAtRecord(newMessage, start, end, 0)

    send(messageInputDomain.command.InputCommand(newMessage))

    requestIdleCallback(() => {
      inputRef.current?.setSelectionRange(end, end)
      inputRef.current?.focus()
    })
  }

  const handleInjectImage = async (file: File) => {
    try {
      setInputLoading(true)
      const blob = await compressImage({ input: file, targetSize: 30 * 1024, outputType: 'image/webp' })
      const base64 = await blobToBase64(blob)
      const hash = nanoid()
      const newMessage = `${message.slice(0, selectionEnd)}![Image](hash:${hash})${message.slice(selectionEnd)}`

      const start = selectionStart
      const end = selectionEnd + newMessage.length - message.length

      updateAtUserAtRecord(newMessage, start, end, 0)
      send(messageInputDomain.command.InputCommand(newMessage))

      imageRecord.current.set(hash, base64)

      requestIdleCallback(() => {
        inputRef.current?.setSelectionRange(end, end)
        inputRef.current?.focus()
      })
    } catch (error) {
      send(toastDomain.command.ErrorCommand((error as Error).message))
    } finally {
      setInputLoading(false)
    }
  }

  const handleInjectAtSyntax = (username: string) => {
    const atIndex = message.lastIndexOf('@', selectionEnd - 1)
    // Determine if there is a space before @
    const hasBeforeSpace = message.slice(atIndex - 1, atIndex) === ' '
    const hasAfterSpace = message.slice(selectionEnd, selectionEnd + 1) === ' '

    const atText = `${hasBeforeSpace ? '' : ' '}@${username}${hasAfterSpace ? '' : ' '}`
    const newMessage = message.slice(0, atIndex) + `${atText}` + message.slice(selectionEnd)

    setAutoCompleteListShow(false)

    // Pre-calculate the offset after InputCommand
    const start = atIndex
    const end = selectionStart + newMessage.length - message.length

    const atUserPosition: [number, number] = [start + (hasBeforeSpace ? 0 : +1), end - 1 + (hasAfterSpace ? 0 : -1)]

    // Calculate the difference after replacing @text with @user
    const offset = newMessage.length - message.length - (atUserPosition[1] - atUserPosition[0])

    updateAtUserAtRecord(newMessage, ...atUserPosition, offset, selectedUser.userId)

    send(messageInputDomain.command.InputCommand(newMessage))
    requestIdleCallback(() => {
      inputRef.current!.setSelectionRange(end, end)
      inputRef.current!.focus()
    })
  }

  const root = getRootNode()

  return (
    <div className="relative z-10 grid gap-y-2 rounded-b-xl px-4 pb-4 pt-2 before:pointer-events-none before:absolute before:inset-x-4 before:-top-2 before:h-2 before:bg-gradient-to-t before:from-slate-50 before:from-30%  before:to-transparent dark:bg-slate-900 before:dark:from-slate-900">
      <Presence present={autoCompleteListShow}>
        <Portal
          container={root}
          ref={shareAutoCompleteListRef}
          className="fixed z-infinity w-36 -translate-y-full overflow-hidden rounded-lg border bg-popover text-popover-foreground shadow-md duration-300 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95"
          style={{ left: `min(${x}px, 100vw - 160px)`, top: `${y}px` }}
        >
          <ScrollArea className="max-h-[204px] min-h-9 p-1" ref={setScrollParentRef}>
            <Virtuoso
              ref={virtuosoRef}
              data={autoCompleteList}
              defaultItemHeight={28}
              context={{ currentItemIndex: selectedUserIndex }}
              customScrollParent={scrollParentRef!}
              itemContent={(index, user) => (
                <div
                  key={user.userId}
                  onClick={() => handleInjectAtSyntax(user.username)}
                  onMouseEnter={() => setSelectedUserIndex(index)}
                  className={cn(
                    'flex cursor-pointer select-none items-center gap-x-2 rounded-md px-2 py-1.5 outline-none',
                    {
                      'bg-accent text-accent-foreground': index === selectedUserIndex
                    }
                  )}
                >
                  <Avatar className="size-4 shrink-0">
                    <AvatarImage className="size-full" src={user.userAvatar} alt="avatar" />
                    <AvatarFallback>{user.username.at(0)}</AvatarFallback>
                  </Avatar>
                  <div className="flex-1 truncate text-xs text-slate-500 dark:text-slate-50">{user.username}</div>
                </div>
              )}
            ></Virtuoso>
          </ScrollArea>
        </Portal>
      </Presence>
      <MessageInput
        ref={shareRef}
        value={message}
        onInput={handleInput}
        loading={inputLoading}
        onPaste={handlePaste}
        onKeyDown={handleKeyDown}
        maxLength={MESSAGE_MAX_LENGTH}
      ></MessageInput>
      <div className="flex items-center">
        <EmojiButton onSelect={handleInjectEmoji}></EmojiButton>
        <ImageButton disabled={inputLoading} onSelect={handleInjectImage}></ImageButton>
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
