import { type MouseEvent, type FC, type ReactElement } from 'react'
import { Button } from '@/components/ui/Button'
import { cn } from '@/utils'
import NumberFlow from '@number-flow/react'

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
  const handleClick = (e: MouseEvent<HTMLButtonElement>) => {
    onClick?.(e)
    onChange?.(!checked, checked ? count - 1 : count + 1)
  }

  return (
    <Button
      onClick={handleClick}
      variant="secondary"
      className={cn(
        'grid items-center overflow-hidden rounded-full leading-none transition-all select-none dark:bg-slate-600',
        checked ? 'text-orange-500' : 'text-slate-500 dark:text-slate-100',
        count ? 'grid-cols-[auto_1fr] gap-x-1' : 'grid-cols-[auto_0fr] gap-x-0'
      )}
      size="xs"
    >
      {children}
      {!!count && (
        <span className="min-w-0 text-xs">
          {import.meta.env.FIREFOX ? <span className="tabular-nums">{count}</span> : <NumberFlow value={count} />}
        </span>
      )}
    </Button>
  )
}

LikeButton.Icon = LikeButtonIcon

LikeButton.displayName = 'LikeButton'

export default LikeButton
