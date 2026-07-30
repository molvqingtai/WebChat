import { GitHubLogoIcon } from '@radix-ui/react-icons'
import { CircleDot, Tag } from 'lucide-react'
import { useEffect, type ComponentType, type ReactNode } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import remarkBreaks from 'remark-breaks'
import type { ReleaseLinks, ReleaseNotes } from '@/changelog/ReleaseNotes'

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
        <h2 className="mt-10 mb-4 text-2xl font-semibold text-slate-950 dark:text-white" {...props}>
          {children}
        </h2>
      ),
      h2: ({ children, ...props }) => (
        <h2 className="mt-10 mb-4 text-2xl font-semibold text-slate-950 dark:text-white" {...props}>
          {children}
        </h2>
      ),
      h3: ({ children, ...props }) => (
        <h2 className="mt-10 mb-4 text-2xl font-semibold text-slate-950 dark:text-white" {...props}>
          {children}
        </h2>
      ),
      h4: ({ children, ...props }) => (
        <h3 className="mt-8 mb-3 text-lg font-semibold text-slate-900 dark:text-slate-100" {...props}>
          {children}
        </h3>
      ),
      p: (props) => <p className="my-4 leading-7 text-slate-700 dark:text-slate-300" {...props} />,
      ul: (props) => <ul className="my-4 space-y-3 pl-5 text-slate-700 dark:text-slate-300" {...props} />,
      ol: (props) => <ol className="my-4 space-y-3 pl-5 text-slate-700 dark:text-slate-300" {...props} />,
      li: (props) => <li className="pl-1 leading-7 marker:text-emerald-500" {...props} />,
      code: (props) => (
        <code className="rounded bg-slate-200/70 px-1.5 py-0.5 font-mono text-[0.9em] dark:bg-slate-800" {...props} />
      ),
      pre: (props) => (
        <pre className="my-5 overflow-x-auto border-l-2 border-sky-600 bg-slate-100 p-4 dark:bg-slate-900" {...props} />
      ),
      blockquote: (props) => (
        <blockquote className="my-5 border-l-2 border-emerald-500 pl-4 text-slate-600 dark:text-slate-400" {...props} />
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
        <div className="my-6 overflow-x-auto">
          <table className="w-full border-collapse text-left text-sm" {...props} />
        </div>
      ),
      th: (props) => (
        <th className="border-b border-slate-300 px-3 py-2 font-semibold dark:border-slate-700" {...props} />
      ),
      td: (props) => <td className="border-b border-slate-200 px-3 py-2 dark:border-slate-800" {...props} />
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
  <a
    href={href}
    target="_blank"
    rel="noopener noreferrer"
    className="group flex min-h-11 items-center gap-3 border-b border-slate-200 py-3 text-sm font-medium text-slate-700 transition-colors hover:text-sky-700 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-sky-600 motion-reduce:transition-none sm:border-b-0 sm:py-0 dark:border-slate-800 dark:text-slate-300 dark:hover:text-sky-400"
  >
    <Icon
      aria-hidden
      className="size-4 text-emerald-600 transition-colors group-hover:text-sky-600 motion-reduce:transition-none dark:text-emerald-400"
    />
    <span>{children}</span>
  </a>
)

export const ChangelogView = ({ version, release, links }: ChangelogViewProps) => (
  <main className="min-h-screen bg-slate-50 text-slate-950 dark:bg-slate-950 dark:text-white">
    <div className="mx-auto w-full max-w-3xl px-5 py-8 sm:px-8 sm:py-12">
      <header className="flex flex-col gap-6 border-b border-slate-200 pb-8 sm:flex-row sm:items-center sm:justify-between dark:border-slate-800">
        <div className="flex min-w-0 items-center gap-4">
          <img src="/logo.png" alt="WebChat" className="size-14 shrink-0 rounded-md" width="56" height="56" />
          <div className="min-w-0">
            <p className="mb-1 text-sm font-medium text-emerald-700 dark:text-emerald-400">Changelog</p>
            <h1 className="text-3xl font-semibold wrap-break-word sm:text-4xl">WebChat v{version}</h1>
          </div>
        </div>
        {release?.date ? (
          <time dateTime={release.date} className="font-mono text-sm text-slate-500 dark:text-slate-400">
            {release.date}
          </time>
        ) : null}
      </header>

      <section className="relative py-10 pl-8 sm:py-12 sm:pl-12" data-release-spine="true">
        <div className="absolute top-0 bottom-0 left-1 w-0.5 bg-emerald-500" aria-hidden />
        <div
          className="absolute top-12 left-[-3px] size-2.5 rounded-full border-2 border-slate-50 bg-sky-600 dark:border-slate-950"
          aria-hidden
        />
        <article aria-label={`Release notes for WebChat ${version}`}>
          {release ? (
            <ReleaseMarkdown>{release.body}</ReleaseMarkdown>
          ) : (
            <div className="py-2">
              <h2 className="mb-3 text-2xl font-semibold">Release notes unavailable</h2>
              <p className="max-w-xl leading-7 text-slate-600 dark:text-slate-300">
                Release notes are unavailable in this build. WebChat v{version} is installed, and the release record is
                still available from the links below.
              </p>
            </div>
          )}
        </article>
      </section>

      <nav
        aria-label="Changelog links"
        className="border-t border-slate-200 pt-2 sm:flex sm:items-center sm:justify-between sm:gap-6 sm:pt-6 dark:border-slate-800"
      >
        <ActionLink href={links.repository} icon={GitHubLogoIcon}>
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
