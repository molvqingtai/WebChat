import { type MouseEvent, type FC, type ReactElement } from 'react'
import { Button } from '@/components/ui/Button'
import { cn } from '@/utils'

export interface LikeButtonIconProps {
  children: JSX.Element
}

export const LikeButtonIcon: FC<LikeButtonIconProps> = ({ children }) => children

export interface LikeButtonProps {
  count: number
  checked: boolean
  onClick?: (e: MouseEvent<HTMLButtonElement>) => void
  onChange?: (checked: boolean, count: number) => void
  children: ReactElement<LikeButtonIconProps>
}

const LikeButton: FC<LikeButtonProps> & { Icon: FC<LikeButtonIconProps> } = ({
  checked,
  count,
  onClick,
  onChange,
  children
}) => {
  const handleOnClick = (e: MouseEvent<HTMLButtonElement>) => {
    onClick?.(e)
    onChange?.(!checked, checked ? count - 1 : count + 1)
  }

  return (
    <Button
      onClick={handleOnClick}
      variant="secondary"
      className={cn(
        'grid items-center overflow-hidden rounded-full leading-none transition-all',
        checked ? 'text-orange-500' : 'text-slate-500',
        count ? 'grid-cols-[auto_1fr] gap-x-1' : 'grid-cols-[auto_0fr] gap-x-0'
      )}
      size="xs"
    >
      {children}
      {!!count && <span className="min-w-0 text-xs">{count}</span>}
    </Button>
  )
}

LikeButton.Icon = LikeButtonIcon

LikeButton.displayName = 'LikeButton'

export default LikeButton
