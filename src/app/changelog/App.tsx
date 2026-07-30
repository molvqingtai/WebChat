import { CircleDot, Code2, Tag } from 'lucide-react'
import { useEffect, type ComponentType, type ReactNode } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import remarkBreaks from 'remark-breaks'
import type { ReleaseLinks, ReleaseNotes } from '@/changelog/ReleaseNotes'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'

export interface ChangelogViewProps {
  version: string
  release: ReleaseNotes | null
  links: ReleaseLinks
}

export interface ChangelogAppProps extends ChangelogViewProps {
  onRendered: () => Promise<void>
}

const safeHttpsUrl = (value: string | undefined) => {
  if (!value) return undefined
  try {
    const url = new URL(value)
    return url.protocol === 'https:' ? url.href : undefined
  } catch {
    return undefined
  }
}

const ReleaseMarkdown = ({ children }: { children: string }) => (
  <ReactMarkdown
    skipHtml
    remarkPlugins={[remarkGfm, remarkBreaks]}
    urlTransform={(value) => safeHttpsUrl(value) ?? ''}
    components={{
      h1: ({ children, ...props }) => (
        <h2 className="text-foreground mt-8 mb-3 text-xl font-semibold first:mt-0" {...props}>
          {children}
        </h2>
      ),
      h2: ({ children, ...props }) => (
        <h2 className="text-foreground mt-8 mb-3 text-xl font-semibold first:mt-0" {...props}>
          {children}
        </h2>
      ),
      h3: ({ children, ...props }) => (
        <h2 className="text-foreground mt-8 mb-3 text-xl font-semibold first:mt-0" {...props}>
          {children}
        </h2>
      ),
      h4: ({ children, ...props }) => (
        <h3 className="text-foreground mt-6 mb-2 text-base font-semibold" {...props}>
          {children}
        </h3>
      ),
      p: (props) => <p className="text-muted-foreground my-3 leading-6" {...props} />,
      ul: (props) => <ul className="text-muted-foreground my-3 space-y-2 pl-5" {...props} />,
      ol: (props) => <ol className="text-muted-foreground my-3 space-y-2 pl-5" {...props} />,
      li: (props) => <li className="pl-1 leading-6 marker:text-emerald-500" {...props} />,
      code: (props) => (
        <code className="bg-muted text-foreground rounded px-1.5 py-0.5 font-mono text-[0.9em]" {...props} />
      ),
      pre: (props) => <pre className="bg-muted my-4 overflow-x-auto border-l-2 border-sky-600 p-4" {...props} />,
      blockquote: (props) => (
        <blockquote className="text-muted-foreground my-4 border-l-2 border-emerald-500 pl-4" {...props} />
      ),
      a: ({ href, children, ...props }) => {
        const safeHref = safeHttpsUrl(href)
        if (!safeHref) return <span>{children}</span>
        return (
          <a
            {...props}
            href={safeHref}
            target="_blank"
            rel="noopener noreferrer"
            className="font-mono font-medium text-sky-700 underline decoration-sky-300 underline-offset-4 hover:text-sky-900 focus-visible:rounded-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-600 dark:text-sky-400 dark:hover:text-sky-300"
          >
            {children}
          </a>
        )
      },
      img: () => null,
      table: (props) => (
        <div className="my-5 overflow-x-auto">
          <table className="w-full border-collapse text-left text-sm" {...props} />
        </div>
      ),
      th: (props) => <th className="border-border border-b px-3 py-2 font-semibold" {...props} />,
      td: (props) => <td className="border-border border-b px-3 py-2" {...props} />
    }}
  >
    {children}
  </ReactMarkdown>
)

interface ActionLinkProps {
  href: string
  icon: ComponentType<{ className?: string; 'aria-hidden'?: boolean }>
  children: ReactNode
}

const ActionLink = ({ href, icon: Icon, children }: ActionLinkProps) => (
  <Button asChild variant="outline" size="lg" className="h-10 w-full motion-reduce:transition-none">
    <a href={href} target="_blank" rel="noopener noreferrer">
      <Icon aria-hidden className="size-4 text-emerald-600 dark:text-emerald-400" />
      <span>{children}</span>
    </a>
  </Button>
)

export const ChangelogView = ({ version, release, links }: ChangelogViewProps) => (
  <main className="bg-background text-foreground min-h-screen">
    <div className="mx-auto w-full max-w-3xl px-4 py-6 sm:px-8 sm:py-8">
      <header className="flex flex-col items-center text-center">
        <img src="/logo.png" alt="" className="size-12 rounded-md" width="48" height="48" />
        <h1 aria-label={`WebChat v${version}`} className="mt-3 text-2xl font-semibold wrap-break-word sm:text-3xl">
          WebChat
        </h1>
        <div className="mt-2 flex flex-wrap items-center justify-center gap-2">
          <Badge variant="secondary" className="font-mono">
            v{version}
          </Badge>
          {release?.date ? (
            <Badge asChild variant="outline" className="font-mono">
              <time dateTime={release.date}>{release.date}</time>
            </Badge>
          ) : null}
        </div>
      </header>

      <article aria-label={`Release notes for WebChat ${version}`} className="pt-6">
        {release ? (
          <ReleaseMarkdown>{release.body}</ReleaseMarkdown>
        ) : (
          <div>
            <h2 className="mb-2 text-xl font-semibold">Release notes unavailable</h2>
            <p className="text-muted-foreground max-w-2xl leading-6">
              Release notes are unavailable in this build. WebChat v{version} is installed, and the release record is
              still available from the links below.
            </p>
          </div>
        )}
      </article>

      <nav
        aria-label="Changelog links"
        className="border-border mt-8 grid grid-cols-1 gap-3 border-t pt-6 sm:grid-cols-3"
      >
        <ActionLink href={links.repository} icon={Code2}>
          Repository
        </ActionLink>
        <ActionLink href={links.release} icon={Tag}>
          Release v{version}
        </ActionLink>
        <ActionLink href={links.issues} icon={CircleDot}>
          Report an issue
        </ActionLink>
      </nav>
    </div>
  </main>
)

export const ChangelogApp = ({ onRendered, ...view }: ChangelogAppProps) => {
  useEffect(() => {
    void onRendered()
  }, [onRendered])

  useEffect(() => {
    const media = window.matchMedia('(prefers-color-scheme: dark)')
    const syncTheme = () => document.documentElement.classList.toggle('dark', media.matches)
    syncTheme()
    media.addEventListener('change', syncTheme)
    return () => media.removeEventListener('change', syncTheme)
  }, [])

  return <ChangelogView {...view} />
}
