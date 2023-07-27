import { FrownIcon, type LucideIcon, ThumbsUpIcon } from 'lucide-react'
import { type MouseEvent, type FC } from 'react'
import { Button } from '@/components/ui/Button'
import { cn } from '@/utils'

export interface LikeButtonProps {
  type: 'like' | 'hate'
  count: number
  checked: boolean
  onClick?: (e: MouseEvent<HTMLButtonElement>) => void
  onChange?: (checked: boolean, count: number) => void
}

const iconMapping: Record<LikeButtonProps['type'], LucideIcon> = {
  like: ThumbsUpIcon,
  hate: FrownIcon
}

const LikeButton: FC<LikeButtonProps> = ({ type, checked, count, onClick, onChange }) => {
  const Icon = iconMapping[type]

  const handleOnClick = (e: MouseEvent<HTMLButtonElement>) => {
    onClick?.(e)
    onChange?.(!checked, checked ? count - 1 : count + 1)
  }

  return (
    <Button
      onClick={handleOnClick}
      variant="secondary"
      className={cn(
        'flex items-center gap-x-1 rounded-full transition-all ',
        checked ? 'text-orange-500' : 'text-slate-500'
      )}
      size="xs"
    >
      <Icon size={14} />
      {!!count && <span className="text-xs">{count}</span>}
    </Button>
  )
}

LikeButton.displayName = 'LikeButton'

export default LikeButton
