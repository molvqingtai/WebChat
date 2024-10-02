import { FC } from 'react'
import { Button } from '@/components/ui/Button'
import Link from '@/components/Link'
import { version } from '@/../package.json'

const VersionLink: FC = () => {
  return (
    <Button
      size="lg"
      variant="ghost"
      className="fixed right-4 top-2 rounded-full px-3 text-base font-medium text-primary"
    >
      <Link href="https://github.com/molvqingtai/WebChat/releases">Version: v{version}</Link>
    </Button>
  )
}

VersionLink.displayName = 'VersionLink'

export default VersionLink
