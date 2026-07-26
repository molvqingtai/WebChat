import { type FC, memo, useState } from 'react'
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion'
import NoticeItem from './notice-item'
import type { SystemNoticeMessage } from '@/domain/MessageList'

export interface NoticeGroupProps {
  notices: readonly SystemNoticeMessage[]
  first?: boolean
  last?: boolean
}

const NoticeGroup: FC<NoticeGroupProps> = memo(({ notices, first, last }) => {
  const [expanded, setExpanded] = useState(false)
  const reduceMotion = useReducedMotion()
  const latest = notices.at(-1)
  if (!latest) return null

  const history = notices.slice(0, -1)
  const transition = reduceMotion ? { duration: 0 } : { duration: 0.2, ease: [0.22, 1, 0.36, 1] as const }

  return (
    <div className={`${first ? 'pt-4' : ''} ${last ? 'pb-4' : ''}`}>
      <AnimatePresence initial={false}>
        {expanded ? (
          <motion.div
            key="notice-history"
            className="overflow-hidden"
            initial={reduceMotion ? false : { height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={transition}
          >
            {history.map((notice) => (
              <NoticeItem key={notice.id} data={notice} />
            ))}
          </motion.div>
        ) : null}
      </AnimatePresence>
      <NoticeItem data={latest} expanded={expanded} onExpandedChange={setExpanded} />
    </div>
  )
})

NoticeGroup.displayName = 'NoticeGroup'

export default NoticeGroup
