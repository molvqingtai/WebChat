import { type FC } from 'react'

import Highlight from '@tiptap/extension-highlight'
import Typography from '@tiptap/extension-typography'
import { EditorContent, Extension, useEditor } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import CharacterCount from '@tiptap/extension-character-count'
import { cn } from '@/utils'

export interface MessageInputProps {
  value?: string
  className?: string
  maxLength?: number
  enterClear?: boolean
  onInput?: (value: string) => void
  onEnter?: (value: string) => void
}

const MessageInput: FC<MessageInputProps> = ({
  value = '',
  className,
  maxLength = 500,
  enterClear = false,
  onInput,
  onEnter
}) => {
  const editor = useEditor({
    extensions: [
      StarterKit,
      Highlight,
      Typography,
      CharacterCount.configure({
        limit: maxLength
      }),
      Extension.create({
        addKeyboardShortcuts: () => ({
          Enter: ({ editor }) => {
            onEnter?.(editor.getHTML())
            enterClear && editor.commands.clearContent()
            return true
          }
        })
      })
    ],
    content: value,
    editorProps: {
      attributes: {
        class: cn(
          'prose prose-sm prose-slate box-border text-sm break-words max-h-28 overflow-y-auto overflow-x-hidden min-h-[60px] w-full rounded-lg border border-input bg-gray-50 px-3 py-2 pb-5 text-sm shadow-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50 2xl:max-h-4'
        )
      }
    },
    onUpdate({ editor }) {
      onInput?.(editor.getHTML())
    }
  })

  return (
    <div className={cn('relative', className)}>
      <EditorContent editor={editor} />
      <div className="absolute bottom-1 right-3 rounded-lg text-xs text-slate-400">
        {editor?.storage.characterCount.characters()}/{maxLength}
      </div>
    </div>
  )
}

MessageInput.displayName = 'MessageInput'

export default MessageInput
