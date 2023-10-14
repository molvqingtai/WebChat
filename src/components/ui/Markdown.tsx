import { type FC } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import remarkBreaks from 'remark-breaks'
import { cn } from '@/utils'

export interface MarkdownProps {
  children?: string
  className?: string
}

const Markdown: FC<MarkdownProps> = ({ children = '', className }) => {
  return (
    <ReactMarkdown
      components={{
        h1: ({ className, ...props }) => (
          <h1 className={cn('mb-2 mt-0 font-semibold text-2xl', className)} {...props} />
        ),
        h2: ({ className, ...props }) => <h2 className={cn('mb-2 mt-0 font-semibold', className)} {...props} />,
        img: ({ className, alt, ...props }) => (
          <img className={cn('my-2 max-w-[50%]', className)} alt={alt} {...props} />
        ),
        ul: ({ className, ...props }) => {
          Reflect.deleteProperty(props, 'ordered')
          return <ul className={cn('text-sm [&:not([depth="0"])]:my-0 ', className)} {...props} />
        },
        input: ({ className, ...props }) => <input className={cn('my-0', className)} {...props} />,
        table: ({ className, ...props }) => (
          <div className="my-4 w-full overflow-y-auto">
            <table className={cn('my-0 w-full rounded-md', className)} {...props} />
          </div>
        ),
        tr: ({ className, ...props }) => {
          // fix: spell it as lowercase `isheader` warning
          Reflect.deleteProperty(props, 'isHeader')
          return <tr className={cn('m-0 border-t p-0 even:bg-muted', className)} {...props} />
        },
        th: ({ className, ...props }) => {
          // fix: spell it as lowercase `isheader` warning
          Reflect.deleteProperty(props, 'isHeader')
          return (
            <th
              className={cn(
                'border px-3 py-2 text-left font-bold [&[align=center]]:text-center [&[align=right]]:text-right',
                className
              )}
              {...props}
            />
          )
        },
        td: ({ className, ...props }) => {
          return (
            <td
              className={cn(
                'border px-3 py-2 text-left [&[align=center]]:text-center [&[align=right]]:text-right',
                className
              )}
              {...props}
            />
          )
        }
      }}
      remarkPlugins={[remarkGfm, remarkBreaks]}
      className={cn(className, 'prose prose-sm prose-slate break-words')}
    >
      {children}
    </ReactMarkdown>
  )
}

Markdown.displayName = 'Markdown'

export { Markdown }
