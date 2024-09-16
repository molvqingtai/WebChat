import { format as formatDate } from 'date-fns'
import { type FC } from 'react'
import { Slot } from '@radix-ui/react-slot'

export interface FormatDateProps {
  date: Date | number | string
  format?: string
  asChild?: boolean
  className?: string
}

const FormatDate: FC<FormatDateProps> = ({ date, format = 'yyyy/MM/dd HH:mm:ss', asChild = false, ...props }) => {
  const Comp = asChild ? Slot : 'div'
  return <Comp {...props}>{formatDate(date, format)}</Comp>
}

FormatDate.displayName = 'FormatDate'
export default FormatDate
