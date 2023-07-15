import { type FC } from 'react'
import { Button } from '@/components/ui/Button'

const AppButton: FC = () => {
  return (
    <Button className="fixed bottom-20 right-10 z-top h-10 w-10 select-none rounded-full text-red-300 ">ICON</Button>
  )
}

export default AppButton
