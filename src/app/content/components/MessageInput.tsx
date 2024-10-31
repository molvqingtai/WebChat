import { forwardRef, type ChangeEvent, CompositionEvent, type KeyboardEvent, ClipboardEvent } from 'react'

import { cn } from '@/utils'
import { Textarea } from '@/components/ui/Textarea'
import { ScrollArea } from '@/components/ui/ScrollArea'
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
const MessageInput = forwardRef<HTMLTextAreaElement, MessageInputProps>(
  (
    {
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
    },
    ref
  ) => {
    return (
      <div className={cn('relative', className)}>
        <ScrollArea className="box-border max-h-28 w-full rounded-lg border border-input bg-background ring-offset-background focus-within:ring-1 focus-within:ring-ring 2xl:max-h-40">
          <Textarea
            ref={ref}
            onPaste={onPaste}
            onKeyDown={onKeyDown}
            autoFocus={autoFocus}
            maxLength={maxLength}
            className={cn(
              'box-border resize-none whitespace-pre-wrap break-words border-none bg-slate-100 pb-5 [field-sizing:content] [word-break:break-word] focus:ring-0 focus:ring-offset-0 dark:bg-slate-800',
              {
                'disabled:opacity-100': loading
              }
            )}
            rows={2}
            value={value}
            spellCheck={false}
            onCompositionStart={onCompositionStart}
            onCompositionEnd={onCompositionEnd}
            placeholder="Type your message here."
            onInput={onInput}
            disabled={disabled || loading}
          />
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
)

MessageInput.displayName = 'MessageInput'

export default MessageInput
