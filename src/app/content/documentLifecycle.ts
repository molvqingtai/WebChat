import type { RemeshStore } from 'remesh'
import AppFeedbackDomain from '@/domain/AppFeedback'

interface DocumentLifecycleDeps {
  store: RemeshStore
  startRuntime: () => Promise<boolean | null>
  stopRuntime: () => void
}

/**
 * Leaving the page (unload or bfcache) closes the Runtime connection and silences feedback;
 * coming back from bfcache reconnects. Everything else follows from the connection state.
 */
export const bindDocumentLifecycle = ({ store, startRuntime, stopRuntime }: DocumentLifecycleDeps) => {
  const feedback = store.getDomain(AppFeedbackDomain())
  const silence = () => store.send(feedback.command.SilenceFeedbackCommand())
  const onPageHide = () => {
    silence()
    stopRuntime()
  }
  const onPageShow = (event: PageTransitionEvent) => {
    if (!event.persisted) return
    void startRuntime()
      .catch(() => {})
      .finally(() => store.send(feedback.command.ResumeFeedbackCommand()))
  }
  window.addEventListener('beforeunload', silence)
  window.addEventListener('pagehide', onPageHide)
  window.addEventListener('pageshow', onPageShow)
  return () => {
    window.removeEventListener('beforeunload', silence)
    window.removeEventListener('pagehide', onPageHide)
    window.removeEventListener('pageshow', onPageShow)
  }
}
