import { type FC } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import remarkBreaks from 'remark-breaks'
import { cn } from '@/utils'
import { ScrollArea, ScrollBar } from '@/components/ui/ScrollArea'

export interface MarkdownProps {
  children?: string
  className?: string
}

const safeProtocol = /^(https?|ircs?|mailto|xmpp|data)$/i

/**
 * https://github.com/remarkjs/react-markdown/blob/baad6c53764e34c4ead41e2eaba176acfc87538a/lib/index.js#L293
 */
const urlTransform = (value: string) => {
  // Same as:
  // <https://github.com/micromark/micromark/blob/929275e/packages/micromark-util-sanitize-uri/dev/index.js#L34>
  // But without the `encode` part.
  const colon = value.indexOf(':')
  const questionMark = value.indexOf('?')
  const numberSign = value.indexOf('#')
  const slash = value.indexOf('/')

  if (
    // If there is no protocol, it’s relative.
    colon < 0 ||
    // If the first colon is after a `?`, `#`, or `/`, it’s not a protocol.
    (slash > -1 && colon > slash) ||
    (questionMark > -1 && colon > questionMark) ||
    (numberSign > -1 && colon > numberSign) ||
    // It is a protocol, it should be allowed.
    safeProtocol.test(value.slice(0, colon))
  ) {
    return value
  }

  return ''
}

const Markdown: FC<MarkdownProps> = ({ children = '', className }) => {
  return (
    <ReactMarkdown
      urlTransform={urlTransform}
      components={{
        h1: ({ className, ...props }) => (
          <h1 className={cn('my-2 mt-0 font-semibold text-2xl dark:text-slate-50', className)} {...props} />
        ),
        h2: ({ className, ...props }) => (
          <h2 className={cn('mb-2 mt-0 font-semibold dark:text-slate-50', className)} {...props} />
        ),
        h3: ({ className, ...props }) => (
          <h3 className={cn('mb-2 mt-0 font-semibold dark:text-slate-50', className)} {...props} />
        ),
        h4: ({ className, ...props }) => (
          <h4 className={cn('mb-2 mt-0 font-semibold dark:text-slate-50', className)} {...props} />
        ),
        img: ({ className, alt, ...props }) => (
          <img className={cn('my-2 max-w-[100%] rounded', className)} alt={alt} {...props} />
        ),
        strong: ({ className, ...props }) => <strong className={cn('dark:text-slate-50', className)} {...props} />,
        a: ({ className, ...props }) => (
          <a
            className={cn('text-blue-500', className)}
            target={props.href || '_blank'}
            rel="noopener noreferrer"
            {...props}
          />
        ),
        ul: ({ className, ...props }) => {
          Reflect.deleteProperty(props, 'ordered')
          return <ul className={cn('text-sm [&:not([depth="0"])]:my-0 ', className)} {...props} />
        },
        input: ({ className, ...props }) => <input className={cn('my-0', className)} {...props} />,
        table: ({ className, ...props }) => (
          <div className="my-2 w-full">
            <ScrollArea scrollLock={false}>
              <table className={cn('my-0 w-full rounded-md', className)} {...props} />
              <ScrollBar orientation="horizontal" />
            </ScrollArea>
          </div>
        ),
        tr: ({ className, ...props }) => {
          return <tr className={cn('m-0 border-t p-0 even:bg-muted', className)} {...props} />
        },
        th: ({ className, ...props }) => {
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
        },
        pre: ({ className, ...props }) => <pre className={cn('my-2', className)} {...props} />,
        /**
         * TODO: Code highlight
         * @see https://github.com/remarkjs/react-markdown/issues/680
         * @see https://shiki.style/guide/install#usage
         *
         */
        code: ({ className, ...props }) => (
          <ScrollArea className="overscroll-y-auto" scrollLock={false}>
            <code className={cn('text-sm', className)} {...props}></code>
            <ScrollBar orientation="horizontal" />
          </ScrollArea>
        )
      }}
      remarkPlugins={[remarkGfm, remarkBreaks]}
      className={cn(className, 'prose prose-sm prose-slate break-words dark:text-slate-50')}
    >
      {children}
    </ReactMarkdown>
  )
}

Markdown.displayName = 'Markdown'

export { Markdown }
