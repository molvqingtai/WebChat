import type { InputEventHandler, KeyboardEvent, ClipboardEvent } from 'react'
import { useEffect, useMemo, useRef, useState, type FC } from 'react'
import { CornerDownLeftIcon } from 'lucide-react'
import { useRemeshDomain, useRemeshQuery, useRemeshSend } from 'remesh-react'
import MessageInput from '../../components/message-input'
import EmojiButton from '../../components/emoji-button'
import { Button } from '@/components/ui/button'
import MessageInputDomain from '@/domain/MessageInput'
import { MESSAGE_IMAGE_TARGET_SIZE, MESSAGE_MAX_LENGTH } from '@/constants/config'
import { MAX_CHAT_MESSAGE_BYTES } from '@/protocol/Limits'
import ChatRoomDomain from '@/domain/ChatRoom'
import type { MentionedUser } from '@/protocol'
import useCursorPosition from '@/hooks/useCursorPosition'
import useShareRef from '@/hooks/useShareRef'
import useThrottle from '@/hooks/useThrottle'
import { Presence } from '@radix-ui/react-presence'
import { Portal } from '@radix-ui/react-portal'
import useTriggerAway from '@/hooks/useTriggerAway'
import { ScrollArea } from '@/components/ui/scroll-area'
import type { VirtuosoHandle } from 'react-virtuoso'
import { Virtuoso } from 'react-virtuoso'
import UserInfoDomain from '@/domain/UserInfo'
import { blobToBase64, cn, getTextByteSize, getTextSimilarity } from '@/utils'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import { AvatarImage } from '@radix-ui/react-avatar'
import ToastDomain from '@/domain/Toast'
import ImageButton from '../../components/image-button'
import imgcap from 'imgcap'
import useRoot from '@/hooks/useRoot'

const Footer: FC = () => {
  const send = useRemeshSend()
  const toastDomain = useRemeshDomain(ToastDomain())
  const chatRoomDomain = useRemeshDomain(ChatRoomDomain())
  const messageInputDomain = useRemeshDomain(MessageInputDomain())
  const message = useRemeshQuery(messageInputDomain.query.MessageQuery())
  const userInfoDomain = useRemeshDomain(UserInfoDomain())
  const userInfo = useRemeshQuery(userInfoDomain.query.UserInfoQuery())
  const userList = useRemeshQuery(chatRoomDomain.query.UserListQuery())

  const inputRef = useRef<HTMLTextAreaElement>(null)
  const { x, y, selectionStart, selectionEnd, setRef } = useCursorPosition()

  const [autoCompleteListShow, setAutoCompleteListShow] = useState(false)
  const [scrollParentRef, setScrollParentRef] = useState<HTMLDivElement | null>(null)
  const autoCompleteListRef = useRef<HTMLDivElement>(null)
  const { setRef: setAutoCompleteListRef } = useTriggerAway<HTMLDivElement>(['click'], () =>
    setAutoCompleteListShow(false)
  )
  const shareAutoCompleteListRef = useShareRef<HTMLDivElement>(setAutoCompleteListRef, autoCompleteListRef)
  const isComposing = useRef(false)
  const virtuosoRef = useRef<VirtuosoHandle>(null)
  const [inputLoading, setInputLoading] = useState(false)

  const shareRef = useShareRef<HTMLTextAreaElement | null>(inputRef, setRef)

  /**
   * When inserting a username using the @ syntax, record the username's position information and the mapping relationship between the position information and userId to distinguish between users with the same name.
   */
  const atUserRecord = useRef<Map<string, Set<[number, number]>>>(new Map())
  const ownedImageUrls = useRef<Set<string>>(new Set())
  /** Monotonic draft revision; every InputCommand bumps it so async send resolution can fence stale completions. */
  const draftGeneration = useRef(0)

  const updateAtUserAtRecord = useMemo(
    () => (message: string, start: number, end: number, offset: number, atUserId?: string) => {
      const ranges: [number, number] = [start, end]

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
        atUserRecord.current.set(atUserId, atUserRecord.current.get(atUserId)?.add(ranges) ?? new Set([ranges]))
      }

      // After moving, check if the @user in the message matches the saved position record. If not, it means the @user has been edited, so delete that record.
      // Filter out records where the stored position does not match the actual position.
      atUserRecord.current.forEach((item, userId) => {
        // Pre-calculate the offset after InputCommand
        const positionList = [...item].filter((item) => {
          const name = message.slice(item[0], item[1] + 1)
          return name === `@${userList.find((user) => user.id === userId)?.name}`
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
      .filter((user) => user.id !== userInfo?.id)
      .map((item) => ({
        ...item,
        similarity: getTextSimilarity(searchNameKeyword.toLowerCase(), item.name.toLowerCase())
      }))
      .toSorted((a, b) => b.similarity - a.similarity)
  }, [searchNameKeyword, userList, userInfo])

  const selectedUser = autoCompleteList.find((_, index) => index === selectedUserIndex)!

  // Resolve the editor's owned blob references into data URLs inside a temporary send
  // candidate: the expanded text and its shifted mention ranges are derived only in local
  // state, so the visible draft and its live mention map are never polluted unless the whole
  // send succeeds. Only currently referenced, live object URLs owned by this editor resolve.
  const resolveImageDraft = async (
    draft: string,
    ranges: Map<string, Set<[number, number]>>
  ): Promise<{ expanded: string; mentions: MentionedUser[] }> => {
    let expanded = draft
    let runningDelta = 0
    let working = new Map<string, Set<[number, number]>>()
    ranges.forEach((value, key) => working.set(key, new Set(value)))
    const matchList = [...draft.matchAll(/!\[Image\]\((blob:[^\s)]+)\)/g)]
    for (const match of matchList) {
      const url = match[1]
      if (!ownedImageUrls.current.has(url)) throw new Error('Image reference is no longer owned by this editor')
      const blob = await (await fetch(url)).blob()
      const dataUrl = await blobToBase64(blob)
      const dataSyntax = `![Image](${dataUrl})`
      const blobSyntax = match[0]
      // Original-draft match positions are corrected by the cumulative expansion offset so
      // later replacements never re-shift intermediate mention ranges.
      const startIndex = match.index + runningDelta
      const delta = dataSyntax.length - blobSyntax.length
      expanded = expanded.replace(blobSyntax, dataSyntax)
      runningDelta += delta
      const shifted = new Map<string, Set<[number, number]>>()
      working.forEach((positionList, userId) => {
        const positionListNext = [...positionList].map<[number, number]>((item) => {
          const inBefore = startIndex <= item[1]
          return inBefore ? [item[0] + delta, item[1] + delta] : item
        })
        const filtered = positionListNext.filter((item) => {
          const name = expanded.slice(item[0], item[1] + 1)
          return name === `@${userList.find((user) => user.id === userId)?.name}`
        })
        if (filtered.length) shifted.set(userId, new Set(filtered))
      })
      working = shifted
    }
    const mentions = [...working]
      .map(([userId, positionList]) => {
        const user = userList.find((user) => user.id === userId)
        return (user ? { ...user, ranges: [...positionList] } : undefined)!
      })
      .filter(Boolean)
    return { expanded, mentions }
  }

  const handleSendMessage = async () => {
    if (!`${message}`.trim()) {
      inputRef.current?.focus()
      return
    }
    const snapshot = message
    const generation = draftGeneration.current
    let expanded: string
    let mentions: MentionedUser[]
    try {
      const resolved = await resolveImageDraft(snapshot, atUserRecord.current)
      expanded = resolved.expanded
      mentions = resolved.mentions
    } catch (error) {
      // A stale async completion (the draft was edited, cleared, or a reference was removed
      // while reading) is ignored: the current draft owns the send lane and stays untouched.
      if (generation !== draftGeneration.current) return
      send(toastDomain.command.ErrorCommand((error as Error).message))
      return
    }
    // Fence the whole conversion: nothing is sent unless the captured draft revision is still
    // current after every await.
    if (generation !== draftGeneration.current) return

    const candidate = { body: expanded, mentions }
    const byteSize = getTextByteSize(JSON.stringify(candidate))

    if (byteSize > MAX_CHAT_MESSAGE_BYTES) {
      return send(toastDomain.command.WarningCommand('Message size cannot exceed 192KiB.'))
    }

    send(chatRoomDomain.command.SendTextMessageCommand({ body: expanded, mentions }))
    // The draft revision advances with the send itself: any conversion that captured the
    // previous revision is now stale, even before the external clear lands.
    draftGeneration.current += 1
  }

  // Revoke every owned blob URL whose final draft reference disappeared (edit, clear, or send
  // success), and revoke all owned URLs when the editor unmounts.
  useEffect(() => {
    // Every actual draft revision advances the generation, including clears performed through
    // the external MessageInput.ClearCommand, so stale async completions are always fenced.
    draftGeneration.current += 1
    const referenced = new Set([...message.matchAll(/!\[Image\]\((blob:[^\s)]+)\)/g)].map((match) => match[1]))
    ownedImageUrls.current.forEach((url) => {
      if (!referenced.has(url)) {
        URL.revokeObjectURL(url)
        ownedImageUrls.current.delete(url)
      }
    })
  }, [message])

  useEffect(
    () => () => {
      ownedImageUrls.current.forEach((url) => URL.revokeObjectURL(url))
      ownedImageUrls.current.clear()
    },
    []
  )

  const handleSend = useThrottle(handleSendMessage, 1000)

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
        handleInjectAtSyntax(selectedUser.name)
      } else {
        handleSend()
      }
      e.preventDefault()
    }
  }

  const handleInput: InputEventHandler<HTMLTextAreaElement> = (e) => {
    const target = e.target as HTMLTextAreaElement
    const currentMessage = target.value

    if (autoCompleteListShow) {
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

    draftGeneration.current += 1
    send(messageInputDomain.command.InputCommand(currentMessage))
  }

  const handlePaste = async (e: ClipboardEvent<HTMLTextAreaElement>) => {
    const file = e.nativeEvent.clipboardData?.files[0]
    if (['image/png', 'image/jpeg', 'image/webp'].includes(file?.type ?? '')) {
      handleInjectImage(file!)
    }
  }

  const handleToggleComposing = (composing: boolean) => {
    isComposing.current = composing
  }

  const handleInjectEmoji = (emoji: string) => {
    const newMessage = `${message.slice(0, selectionEnd)}${emoji}${message.slice(selectionEnd)}`

    // Pre-calculate the offset after InputCommand
    const start = selectionStart
    const end = selectionEnd + newMessage.length - message.length

    updateAtUserAtRecord(newMessage, start, end, 0)

    draftGeneration.current += 1
    send(messageInputDomain.command.InputCommand(newMessage))

    requestIdleCallback(() => {
      inputRef.current?.setSelectionRange(end, end)
      inputRef.current?.focus()
    })
  }

  const handleInjectImage = async (file: File) => {
    const generation = draftGeneration.current
    try {
      setInputLoading(true)

      const blob = await imgcap(file, {
        targetSize: MESSAGE_IMAGE_TARGET_SIZE,
        outputType: file.size > MESSAGE_IMAGE_TARGET_SIZE ? 'image/webp' : undefined
      })
      // The draft changed while compressing: the insertion would derive from stale render
      // state, so it is abandoned and the owned-URL set stays untouched.
      if (generation !== draftGeneration.current) return

      const url = URL.createObjectURL(blob)
      ownedImageUrls.current.add(url)
      // URL.createObjectURL already returns a blob: URL; the Markdown reference must be the
      // actual object URL, never a doubled blob:blob: form.
      const newMessage = `${message.slice(0, selectionEnd)}![Image](${url})${message.slice(selectionEnd)}`

      const start = selectionStart
      const end = selectionEnd + newMessage.length - message.length

      updateAtUserAtRecord(newMessage, start, end, 0)

      draftGeneration.current += 1
      send(messageInputDomain.command.InputCommand(newMessage))

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

    updateAtUserAtRecord(newMessage, ...atUserPosition, offset, selectedUser.id)

    draftGeneration.current += 1
    send(messageInputDomain.command.InputCommand(newMessage))
    requestIdleCallback(() => {
      inputRef.current!.setSelectionRange(end, end)
      inputRef.current!.focus()
    })
  }

  const root = useRoot()

  return (
    <div className="relative grid gap-y-2 rounded-b-xl px-4 pt-2 pb-4 before:pointer-events-none before:absolute before:inset-x-4 before:-top-2 before:h-2 before:bg-gradient-to-t before:from-slate-50 before:from-30% before:to-transparent dark:bg-slate-900 dark:before:from-slate-900">
      <Presence present={autoCompleteListShow}>
        <Portal
          container={root}
          ref={shareAutoCompleteListRef}
          className="z-infinity bg-popover text-popover-foreground data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 fixed w-36 -translate-y-full overflow-hidden rounded-lg border shadow-md duration-300"
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
                <button
                  type="button"
                  key={user.id}
                  onClick={() => handleInjectAtSyntax(user.name)}
                  onMouseEnter={() => setSelectedUserIndex(index)}
                  className={cn(
                    'flex w-full cursor-pointer select-none items-center gap-x-2 rounded-md px-2 py-1.5 text-left outline-none',
                    {
                      'bg-accent text-accent-foreground': index === selectedUserIndex
                    }
                  )}
                >
                  <Avatar className="size-4 shrink-0">
                    <AvatarImage className="size-full" src={user.avatar} alt="avatar" />
                    <AvatarFallback>{user.name.at(0)}</AvatarFallback>
                  </Avatar>
                  <div className="flex-1 truncate text-xs text-slate-500 dark:text-slate-50">{user.name}</div>
                </button>
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
        onCompositionStart={() => handleToggleComposing(true)}
        onCompositionEnd={() => handleToggleComposing(false)}
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
