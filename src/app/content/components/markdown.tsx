import {
  Children,
  isValidElement,
  type ComponentProps,
  type FC,
  type ReactNode,
  useContext,
  useLayoutEffect,
  useRef
} from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import remarkBreaks from 'remark-breaks'
import { cn, safeUrl } from '@/utils'
import { ScrollArea, ScrollBar } from '@/components/ui/scroll-area'
import { MEDIA_PREVIEW_TRANSITION_PART, MediaPreviewContext } from './media-preview'

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

interface MessageImageResourceProps extends Omit<MessageImageProps, 'src'> {
  source: string
}

interface MessageImageObjectUrl {
  value: string
  cleanupToken: object | null
}

const imageDataUrlToBlob = (source: string) => {
  const separator = source.indexOf(',')
  if (separator < 0) return null
  const [mediaType, ...parameters] = source.slice(5, separator).split(';')
  if (!mediaType?.toLowerCase().startsWith('image/')) return null

  try {
    const encoded = source.slice(separator + 1)
    if (!parameters.some((parameter) => parameter.toLowerCase() === 'base64')) {
      return new Blob([decodeURIComponent(encoded)], { type: mediaType })
    }
    const decoded = atob(encoded)
    const bytes = Uint8Array.from(decoded, (char) => char.charCodeAt(0))
    return new Blob([bytes], { type: mediaType })
  } catch {
    return null
  }
}

const textContent = (children: ReactNode): string =>
  Children.toArray(children)
    .map((child) => {
      if (typeof child === 'string' || typeof child === 'number') return String(child)
      return isValidElement<{ children?: ReactNode }>(child) ? textContent(child.props.children) : ''
    })
    .join('')

const MessageImageResource: FC<MessageImageResourceProps> = ({ source, alt = '', className, ...props }) => {
  const openPreview = useContext(MediaPreviewContext)
  const buttonRef = useRef<HTMLButtonElement>(null)
  const imageRef = useRef<HTMLImageElement>(null)
  const objectUrlRef = useRef<MessageImageObjectUrl | null>(null)

  useLayoutEffect(() => {
    const image = imageRef.current
    if (!image) return
    let resource = objectUrlRef.current
    if (!resource) {
      const blob = imageDataUrlToBlob(source)
      if (!blob) return
      resource = {
        value: URL.createObjectURL(blob),
        cleanupToken: null
      }
      objectUrlRef.current = resource
    }
    resource.cleanupToken = null
    image.src = resource.value
    return () => {
      const cleanupToken = {}
      resource.cleanupToken = cleanupToken
      // StrictMode replays effects without ending the mounted image lifecycle.
      queueMicrotask(() => {
        if (resource.cleanupToken !== cleanupToken) return
        objectUrlRef.current = null
        URL.revokeObjectURL(resource.value)
      })
    }
  }, [source])

  const label = alt.trim() ? `Preview ${alt}` : 'Preview image'

  return (
    <button
      ref={buttonRef}
      type="button"
      aria-label={label}
      title={label}
      className="peer img-gap not-prose my-2 block cursor-zoom-in border-0 bg-transparent p-0"
      onClick={() => {
        const src = objectUrlRef.current?.value
        const activator = buttonRef.current
        const transitionElement = imageRef.current
        if (src && activator && transitionElement) openPreview?.({ src, alt, activator, transitionElement })
      }}
    >
      <img
        ref={imageRef}
        alt={alt}
        part={MEDIA_PREVIEW_TRANSITION_PART}
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

const MessageImage: FC<MessageImageProps> = ({ src, ...props }) => {
  if (!src || !/^data:image\//i.test(src)) return null
  return <MessageImageResource key={src} source={src} {...props} />
}

const MarkdownImage = ({ node: _node, className, alt, src, ...props }: ComponentProps<'img'> & { node?: unknown }) => (
  <MessageImage className={className} alt={alt} src={src} {...props} />
)

const MarkdownLink = ({
  node: _node,
  className,
  href,
  children,
  ...props
}: ComponentProps<'a'> & { node?: unknown }) => {
  const isImage = href && /^data:image\//i.test(href)
  return isImage ? (
    <MessageImage src={href} alt={textContent(children)} className={className} />
  ) : (
    <a className={cn('text-blue-500', className)} href={href} target={href} rel="noopener noreferrer" {...props}>
      {children}
    </a>
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
          h1: ({ className, children, ...props }) => (
            <h1 className={cn('my-2 mt-0 font-semibold text-2xl dark:text-slate-50', className)} {...props}>
              {children}
            </h1>
          ),
          h2: ({ className, children, ...props }) => (
            <h2 className={cn('mb-2 mt-0 font-semibold dark:text-slate-50', className)} {...props}>
              {children}
            </h2>
          ),
          h3: ({ className, children, ...props }) => (
            <h3 className={cn('mb-2 mt-0 font-semibold dark:text-slate-50', className)} {...props}>
              {children}
            </h3>
          ),
          h4: ({ className, children, ...props }) => (
            <h4 className={cn('mb-2 mt-0 font-semibold dark:text-slate-50', className)} {...props}>
              {children}
            </h4>
          ),
          img: MarkdownImage,
          strong: ({ className, ...props }) => <strong className={cn('dark:text-slate-50', className)} {...props} />,
          a: MarkdownLink,
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
