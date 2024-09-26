import { FC } from 'react'
import { Button } from '@/components/ui/Button'
import { GitHubLogoIcon } from '@radix-ui/react-icons'

const BadgeList: FC = () => {
  return (
    <div className="fixed inset-x-1 bottom-6 mx-auto flex w-fit font-sans">
      <Button asChild size="lg" variant="ghost" className="rounded-full px-3 text-xl font-semibold text-primary">
        <a href="https://github.com/molvqingtai/WebChat" target="https://github.com/molvqingtai/WebChat">
          <GitHubLogoIcon className="mr-1 size-6"></GitHubLogoIcon>
          Github
        </a>
      </Button>
    </div>
  )
}

BadgeList.displayName = 'BadgeList'

export default BadgeList
