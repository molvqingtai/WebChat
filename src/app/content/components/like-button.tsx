import { type FC, type ReactNode } from 'react'
import { Button } from '@/components/ui/button'
import { cn } from '@/utils'
import NumberFlow from '@number-flow/react'

export interface LikeButtonProps {
  count: number
  checked: boolean
  onToggle?: () => void
  children: ReactNode
}

const LikeButton: FC<LikeButtonProps> = ({ checked, count, onToggle, children }) => {
  return (
    <Button
      onClick={() => onToggle?.()}
      aria-pressed={checked}
      variant="secondary"
      className={cn(
        'grid items-center overflow-hidden rounded-full leading-none transition-all select-none dark:bg-slate-600',
        count > 0 ? 'text-orange-500' : 'text-slate-500 dark:text-slate-100',
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

LikeButton.displayName = 'LikeButton'

export default LikeButton
