import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const CONTENT_ENTRY = path.resolve(import.meta.dirname, 'index.tsx')

const AUTHORIZATION_HOSTS = [
  'accounts.google.com',
  'login.microsoftonline.com',
  'login.live.com',
  'appleid.apple.com',
  'openauth.alipay.com',
  'auth.alipay.com',
  'wx.tenpay.com',
  'pay.weixin.qq.com',
  'checkout.stripe.com',
  'pay.google.com'
]

const EXISTING_EXCLUSIONS = ['*://localhost/*', '*://127.0.0.1/*', '*://*.csdn.net/*', '*://*.csdn.com/*']

const readPatterns = async (): Promise<string[]> => {
  const source = await readFile(CONTENT_ENTRY, 'utf8')
  const match = source.match(/excludeMatches:\s*\[([\s\S]*?)\]/)
  if (!match) throw new Error('content entry excludeMatches declaration missing')
  return Array.from(match[1].matchAll(/'([^']+)'/g), (entry) => entry[1])
}

const readInclusionPatterns = async (): Promise<string[]> => {
  const source = await readFile(CONTENT_ENTRY, 'utf8')
  const match = source.match(/\n\s*matches:\s*\[([\s\S]*?)\]/)
  if (!match) throw new Error('content entry matches declaration missing')
  return Array.from(match[1].matchAll(/'([^']+)'/g), (entry) => entry[1])
}

const matchPattern = (pattern: string, url: string): boolean => {
  const [scheme, hostAndPath] = pattern.split('://')
  const target = new URL(url)
  if (scheme !== '*' && target.protocol !== `${scheme}:`) return false
  if (scheme === '*' && target.protocol !== 'http:' && target.protocol !== 'https:') return false
  const host = hostAndPath.slice(0, hostAndPath.indexOf('/'))
  const path = hostAndPath.slice(hostAndPath.indexOf('/'))
  const hostMatches = host.startsWith('*.')
    ? target.hostname === host.slice(2) || target.hostname.endsWith(`.${host.slice(2)}`)
    : target.hostname === host
  if (!hostMatches) return false
  if (path === '/*') return true
  return target.pathname + target.search + target.hash === path
}

const isExcluded = (patterns: string[], url: string): boolean => patterns.some((pattern) => matchPattern(pattern, url))

describe('content-script authorization host exclusion', () => {
  it('declares exactly ten host-wide https exclusions for the selected authorization subdomains', async () => {
    const patterns = await readPatterns()
    for (const host of AUTHORIZATION_HOSTS) {
      expect(patterns).toContain(`https://${host}/*`)
    }
    expect(patterns.filter((pattern) => AUTHORIZATION_HOSTS.some((host) => pattern.includes(host)))).toHaveLength(
      AUTHORIZATION_HOSTS.length
    )
  })

  it('preserves every existing exclusion and the broad https inclusion rule', async () => {
    const patterns = await readPatterns()
    for (const existing of EXISTING_EXCLUSIONS) {
      expect(patterns).toContain(existing)
    }
    expect(await readInclusionPatterns()).toEqual(['https://*/*'])
  })

  it('excludes every path on each selected authorization host', async () => {
    const patterns = await readPatterns()
    for (const host of AUTHORIZATION_HOSTS) {
      expect(isExcluded(patterns, `https://${host}/`)).toBe(true)
      expect(isExcluded(patterns, `https://${host}/authorize?client_id=x&redirect_uri=y#frag`)).toBe(true)
      expect(isExcluded(patterns, `https://${host}/a/b/c/d.shtml`)).toBe(true)
    }
  })

  it('keeps apex, generic www, sibling, and child hosts eligible', async () => {
    const patterns = await readPatterns()
    const nearMisses = [
      'google.com',
      'www.google.com',
      'mail.google.com',
      'child.accounts.google.com',
      'microsoftonline.com',
      'www.microsoftonline.com',
      'live.com',
      'www.live.com',
      'apple.com',
      'www.appleid.apple.com',
      'alipay.com',
      'www.alipay.com',
      'tenpay.com',
      'qq.com',
      'weixin.qq.com',
      'stripe.com',
      'www.stripe.com',
      'dashboard.stripe.com'
    ]
    for (const host of nearMisses) {
      expect(isExcluded(patterns, `https://${host}/oauth/authorize`)).toBe(false)
    }
  })

  it('keeps removed provider, enterprise IdP, and wildcard-only hosts eligible', async () => {
    const patterns = await readPatterns()
    const removedHosts = [
      'id.twitch.tv',
      'oauth.telegram.org',
      'auth.atlassian.com',
      'payments.amazon.com',
      'auth.klarna.com',
      'pay.klarna.com',
      'checkoutshopper-live.adyen.com',
      'pay.checkout.com',
      '3ds.checkout.com',
      'gateway.95516.com',
      'cashier.95516.com',
      'connect.stripe.com',
      'hooks.stripe.com',
      'verify.stripe.com',
      'checkout.link.com',
      'tenant.auth0.com',
      'tenant.okta.com',
      'tenant.okta-emea.com',
      'tenant.oktapreview.com',
      'tenant.onelogin.com',
      'tenant.duosecurity.com',
      'tenant.authing.cn',
      'github.com',
      'gitlab.com',
      'discord.com',
      'slack.com',
      'dropbox.com',
      'reddit.com',
      'paypal.com',
      'open.weixin.qq.com',
      'graph.qq.com',
      'gitee.com'
    ]
    for (const host of removedHosts) {
      expect(isExcluded(patterns, `https://${host}/oauth2/authorize`)).toBe(false)
    }
  })

  it('keeps the existing localhost, loopback, and CSDN exclusions effective', async () => {
    const patterns = await readPatterns()
    expect(isExcluded(patterns, 'http://localhost/')).toBe(true)
    expect(isExcluded(patterns, 'http://localhost:3000/page')).toBe(true)
    expect(isExcluded(patterns, 'https://127.0.0.1/')).toBe(true)
    expect(isExcluded(patterns, 'https://www.csdn.net/article/123')).toBe(true)
    expect(isExcluded(patterns, 'https://blog.csdn.com/')).toBe(true)
    expect(isExcluded(patterns, 'https://csdn.net/')).toBe(true)
  })

  it('keeps every exclusion pattern free of path-specific rules', async () => {
    const patterns = await readPatterns()
    for (const pattern of patterns) {
      expect(pattern).toMatch(/^(?:\*|https):\/\/[^/]+\/\*$/)
    }
  })
})
