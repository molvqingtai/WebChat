import { SmileIcon } from 'lucide-react'
import { useState, type FC } from 'react'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/Popover'
import { ScrollArea } from '@/components/ui/ScrollArea'
import { Button } from '@/components/ui/Button'
import { EMOJI_LIST } from '@/constants'
import { chunk } from '@/utils'

export interface EmojiButtonProps {
  onSelect?: (value: string) => void
}

const emojiGroups = chunk(EMOJI_LIST, 8)

// BUG: https://github.com/radix-ui/primitives/pull/2433
// BUG https://github.com/radix-ui/primitives/issues/1666
const EmojiButton: FC<EmojiButtonProps> = ({ onSelect }) => {
  const [open, setOpen] = useState(false)

  const handleSelect = (value: string) => {
    onSelect?.(value)
    setOpen(false)
  }
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="icon">
          <SmileIcon size={20} />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="z-top w-72 px-0">
        <ScrollArea className="h-72 w-72 px-3">
          {emojiGroups.map((group, index) => {
            return (
              <div key={index} className="grid grid-cols-8">
                {group.map((emoji, index) => (
                  <Button
                    key={index}
                    size="sm"
                    className="text-base"
                    variant="ghost"
                    onClick={() => handleSelect(emoji)}
                  >
                    {emoji}
                  </Button>
                ))}
              </div>
            )
          })}
        </ScrollArea>
      </PopoverContent>
    </Popover>
  )
}

EmojiButton.displayName = 'EmojiButton'

export default EmojiButton
