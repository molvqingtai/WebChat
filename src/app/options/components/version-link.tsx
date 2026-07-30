import type { FC } from 'react'
import { browser } from '#imports'
import { Button } from '@/components/ui/button'
import { version } from '@/../package.json'
import { CHANGELOG_PAGE_PATH } from '@/constants/changelog'

const VersionLink: FC = () => {
  return (
    <Button
      asChild
      size="lg"
      variant="ghost"
      className="text-primary fixed top-2 right-4 rounded-full px-3 text-base font-medium"
    >
      <a href={browser.runtime.getURL(CHANGELOG_PAGE_PATH)}>Version: v{version}</a>
    </Button>
  )
}

VersionLink.displayName = 'VersionLink'

export default VersionLink
