import type { FC } from 'react'
import { Button } from '@/components/ui/button'
import Link from '@/components/link'
import { version } from '@/../package.json'

const VersionLink: FC = () => {
  return (
    <Button
      size="lg"
      variant="ghost"
      className="text-primary fixed top-2 right-4 rounded-full px-3 text-base font-medium"
    >
      <Link href="https://github.com/molvqingtai/WebChat/releases">Version: v{version}</Link>
    </Button>
  )
}

VersionLink.displayName = 'VersionLink'

export default VersionLink
