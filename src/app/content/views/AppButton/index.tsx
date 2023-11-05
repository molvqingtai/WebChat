import { type ReactNode, type FC } from 'react'
import { Button } from '@/components/ui/Button'

export interface AppButtonProps {
  children?: ReactNode
}

const AppButton: FC<AppButtonProps> = ({ children }) => {
  return (
    <Button className="fixed bottom-5 right-5 z-top h-10 w-10 select-none rounded-full bg-blue-400 text-xs">
      {children}
    </Button>
  )
}

AppButton.displayName = 'AppButton'

export default AppButton
