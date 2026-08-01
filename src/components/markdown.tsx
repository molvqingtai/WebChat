import { Children, isValidElement, type ComponentProps, type FC, type ReactNode, useContext, useRef } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import remarkBreaks from 'remark-breaks'
import { cn, safeUrl } from '@/utils'
import { ScrollArea, ScrollBar } from '@/components/ui/scroll-area'
import { MediaPreviewContext } from '@/components/media-preview'

export interface MarkdownProps {
  children?: string
  className?: string
}

/**
 * Sanitize URL to prevent XSS attacks
 * Supports http/https URLs, data URLs (for images), mailto, xmpp, and relative URLs
 * https://github.com/remarkjs/react-markdown/blob/baad6c53764e34c4ead41e2eaba176acfc87538a/lib/index.js#L293
 */
const urlTransform = (value: string) => safeUrl(value)

interface MessageImageProps extends Omit<ComponentProps<'img'>, 'src'> {
  src?: string
}

const textContent = (children: ReactNode): string =>
  Children.toArray(children)
    .map((child) => {
      if (typeof child === 'string' || typeof child === 'number') return String(child)
      return isValidElement<{ children?: ReactNode }>(child) ? textContent(child.props.children) : ''
    })
    .join('')

const MessageImage: FC<MessageImageProps> = ({ src, alt = '', className, ...props }) => {
  const openPreview = useContext(MediaPreviewContext)
  const buttonRef = useRef<HTMLButtonElement>(null)
  const imageRef = useRef<HTMLImageElement>(null)

  if (!src) return null
  const label = alt.trim() ? `Preview ${alt}` : 'Preview image'

  return (
    <button
      ref={buttonRef}
      type="button"
      aria-label={label}
      title={label}
      className="peer img-gap not-prose my-2 block cursor-zoom-in border-0 bg-transparent p-0"
      onClick={() => {
        const activator = buttonRef.current
        const transitionElement = imageRef.current
        if (activator && transitionElement) openPreview?.({ src, alt, activator, transitionElement })
      }}
    >
      <img
        ref={imageRef}
        src={src}
        alt={alt}
        className={cn('block rounded', className)}
        style={{
          maxInlineSize: '70cqi',
          maxBlockSize: '70cqi',
          inlineSize: 'auto',
          blockSize: 'auto',
          objectFit: 'contain'
        }}
        {...props}
      />
    </button>
  )
}

const Markdown: FC<MarkdownProps> = ({ children = '', className }) => {
  return (
    <div
      className={cn(className, 'prose prose-sm prose-slate wrap-break-word dark:text-slate-50')}
      style={{ containerType: 'inline-size' }}
    >
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
          img: ({ node: _node, className, alt, src, ...props }) => (
            <MessageImage className={className} alt={alt} src={src} {...props} />
          ),
          strong: ({ className, ...props }) => <strong className={cn('dark:text-slate-50', className)} {...props} />,
          a: ({ node: _node, className, href, children, ...props }) => {
            // Check if link is an image URL
            const isImage = href && /\.(jpg|jpeg|png|gif|webp|svg|bmp|ico)$/i.test(href)
            return isImage ? (
              <MessageImage src={href} alt={textContent(children)} className={className} />
            ) : (
              <a
                className={cn('text-blue-500', className)}
                href={href}
                target={href}
                rel="noopener noreferrer"
                {...props}
              >
                {children}
              </a>
            )
          },
          br: ({ className, ...props }) => <br className={cn('peer-[.img-gap]:hidden', className)} {...props} />,
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
                  'border px-3 py-2 text-left font-bold [[align=center]]:text-center [[align=right]]:text-right',
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
                  'border px-3 py-2 text-left [[align=center]]:text-center [[align=right]]:text-right',
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
      >
        {children}
      </ReactMarkdown>
    </div>
  )
}

Markdown.displayName = 'Markdown'

export { Markdown }
