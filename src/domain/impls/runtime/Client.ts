import type { RuntimeServer, RuntimeSnapshot } from '@/runtime/Contract'
import { DocumentClient, type ProjectionApplier } from '@/runtime/DocumentClient'
import { PageLink } from '@/runtime/PageLink'

export const pageDomain = document.location.origin

/**
 * One Page instance talks to the Runtime host through ordinary extension messages. There is no
 * long-lived port to lose: the browser starts a suspended Background before delivering the next
 * message, and the host is either already alive or recreated by the Background.
 */
const link = new PageLink(pageDomain)

const client = new DocumentClient({
  coordinator: { registerPage: (payload) => link.attachPage(payload) },
  server: link,
  domain: pageDomain
})

// A content-free invalidation: the Page always pulls its own current snapshot.
link.onStateChanged(() => client.invalidate())

// Returning to a visible tab is an explicit user ingress. It is the only additional read trigger
// and it also refreshes a tab that was hidden while the Background was suspended.
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') client.invalidate()
})

/** Every Page-facing Runtime call is an ordinary request/response with browser-owned caller facts. */
export const server: RuntimeServer = link

export const whenReady = (callback: () => void) => client.whenReady(callback)
export const whenHostPhase = (callback: Parameters<typeof client.whenHostPhase>[0]) => client.whenHostPhase(callback)
export const whenFailure = (callback: Parameters<typeof client.whenFailure>[0]) => client.whenFailure(callback)
export const initClient = (): Promise<RuntimeSnapshot | null> => client.init()
export const detachClient = () => {
  client.detach()
  link.bye()
}
export const getSnapshot = (): RuntimeSnapshot => client.snapshot()
export const registerApplier = (stage: 'chat' | 'persistence' | 'world', applier: ProjectionApplier) =>
  client.registerApplier(stage, applier)
