import { Button } from '@/components/ui/Button'
import { createElement } from '@/utils'
import { ImageIcon } from 'lucide-react'

export interface ImageButtonProps {
  onSelect?: (file: File) => void
  disabled?: boolean
}

const ImageButton = ({ onSelect, disabled }: ImageButtonProps) => {
  const handleClick = () => {
    const input = createElement<HTMLInputElement>(`<input type="file" accept="image/png,image/jpeg,image/webp" />`)

    input.addEventListener(
      'change',
      async (e: Event) => {
        onSelect?.((e.target as HTMLInputElement).files![0])
      },
      { once: true }
    )

    input.click()
  }

  return (
    <Button disabled={disabled} onClick={handleClick} variant="ghost" size="icon" className="dark:text-white">
      <ImageIcon size={20} />
    </Button>
  )
}

ImageButton.displayName = 'ImageButton'

export default ImageButton
