import { type FC, memo, useState } from 'react'
import NoticeItem from './notice-item'
import type { SystemNoticeMessage } from '@/domain/MessageList'

export interface NoticeGroupProps {
  notices: readonly SystemNoticeMessage[]
  first?: boolean
  last?: boolean
}

const NoticeGroup: FC<NoticeGroupProps> = memo(({ notices, first, last }) => {
  const [expanded, setExpanded] = useState(false)
  const visible = expanded ? notices : notices.slice(-1)

  return visible.map((notice, index) => {
    const isLatest = notice.id === notices.at(-1)?.id
    return (
      <NoticeItem
        key={notice.id}
        data={notice}
        count={isLatest ? notices.length : undefined}
        expanded={expanded}
        onExpandedChange={isLatest ? setExpanded : undefined}
        className={`${first && index === 0 ? 'pt-4' : ''} ${last && index === visible.length - 1 ? 'pb-4' : ''}`}
      />
    )
  })
})

NoticeGroup.displayName = 'NoticeGroup'

export default NoticeGroup
