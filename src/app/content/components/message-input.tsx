import type { CompositionEvent, ClipboardEvent, Ref } from 'react'
import { type ChangeEvent, type KeyboardEvent } from 'react'

import { cn } from '@/utils'
import { Textarea } from '@/components/ui/textarea'
import { ScrollArea } from '@/components/ui/scroll-area'
import LoadingIcon from '@/assets/images/loading.svg'

export interface MessageInputProps {
  value?: string
  className?: string
  maxLength?: number
  preview?: boolean
  autoFocus?: boolean
  disabled?: boolean
  loading?: boolean
  onInput?: (e: ChangeEvent<HTMLTextAreaElement>) => void
  onPaste?: (e: ClipboardEvent<HTMLTextAreaElement>) => void
  onKeyDown?: (e: KeyboardEvent<HTMLTextAreaElement>) => void
  onCompositionStart?: (e: CompositionEvent<HTMLTextAreaElement>) => void
  onCompositionEnd?: (e: CompositionEvent<HTMLTextAreaElement>) => void
}

/**
 *  Need @ syntax highlighting? Waiting for textarea to support Highlight API
 *
 * @see https://github.com/w3c/csswg-drafts/issues/4603
 */
const MessageInput = ({
  ref,
  value = '',
  className,
  maxLength = 500,
  onInput,
  onPaste,
  onKeyDown,
  onCompositionStart,
  onCompositionEnd,
  autoFocus,
  disabled,
  loading
}: MessageInputProps & { ref?: Ref<HTMLTextAreaElement | null> }) => {
  return (
    <div className={cn('relative', className)}>
      <ScrollArea className="box-border max-h-28 w-full rounded-md border transition-[color,box-shadow] shadow-xs border-input bg-background 2xl:max-h-40 dark:bg-input/30 has-focus-visible:ring-[3px] has-focus-visible:border-ring has-focus-visible:ring-ring/50 has-aria-invalid:ring-destructive/20 dark:has-aria-invalid:ring-destructive/40 has-aria-invalid:border-destructive">
        <Textarea
          ref={ref}
          onPaste={onPaste}
          onKeyDown={onKeyDown}
          autoFocus={autoFocus}
          maxLength={maxLength}
          rows={2}
          value={value}
          spellCheck={false}
          onCompositionStart={onCompositionStart}
          onCompositionEnd={onCompositionEnd}
          placeholder="Type your message here."
          onInput={onInput}
          disabled={disabled || loading}
          className={cn(
            'box-border resize-none whitespace-pre-wrap px-2 text-sm text-foreground break-words border-none bg-slate-100 pb-5 [word-break:break-word] focus-visible:ring-0 dark:bg-transparent',
            {
              'disabled:opacity-100': loading
            }
          )}
        ></Textarea>
      </ScrollArea>
      <div
        className={cn('absolute bottom-1 right-3 rounded-lg text-xs text-slate-400', {
          'opacity-50': disabled || loading
        })}
      >
        {value?.length ?? 0}/{maxLength}
      </div>
      {loading && (
        <div className="absolute inset-0 flex items-center justify-center text-slate-800 after:absolute after:inset-0 after:backdrop-blur-xs dark:text-slate-100">
          <LoadingIcon className="relative z-10 size-10"></LoadingIcon>
        </div>
      )}
    </div>
  )
}

MessageInput.displayName = 'MessageInput'

export default MessageInput
