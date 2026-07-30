import React from 'react'
import ReactDOM from 'react-dom/client'
import { browser } from '#imports'
import changelog from '../../../CHANGELOG.md?raw'
import { bugs, homepage } from '../../../package.json'
import { acknowledgeCurrentChangelog } from '@/changelog/Browser'
import { createReleaseLinks, extractTopRelease } from '@/changelog/ReleaseNotes'
import { ChangelogApp } from './App'
import '@/assets/styles/tailwind.css'

const version = browser.runtime.getManifest().version
const parsedRelease = extractTopRelease(changelog)
const release = parsedRelease?.version === version ? parsedRelease : null
const links = createReleaseLinks(homepage, bugs.url, version)
const acknowledgeRendered = () => acknowledgeCurrentChangelog(browser)

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ChangelogApp version={version} release={release} links={links} onRendered={acknowledgeRendered} />
  </React.StrictMode>
)
