import type { RemeshStore } from 'remesh'
import AppFeedbackDomain from '@/domain/AppFeedback'
import type { SendLifecycle } from '@/domain/externs/SendLifecycle'

interface DocumentLifecycleDeps {
  store: RemeshStore
  sendLifecycle: SendLifecycle
  /** Composition-provided lease operations supplied by the composition root (the owner only awaits completion). */
  initLease: () => Promise<unknown>
  detachLease: () => void
}

interface DocumentLifecycleOwner {
  bind: (deps: DocumentLifecycleDeps) => void
  dispose: () => void
}

/**
 * The one Content composition document-lifecycle owner. It coordinates page-scoped Runtime feedback,
 * active sends, ClientLease ownership, and restoration for terminal exit, BFCache suspension, and
 * BFCache restoration. `beforeunload`/`pagehide`/`pageshow` feed this owner only; no Domain, component,
 * feedback adapter, or watchdog independently owns whether the document may attach or present state.
 *
 * Ordering per authority: on departure the owner first silences page feedback and removes the current
 * readiness presentation, then cancels page-owned work and releases the ClientLease exactly once, so
 * cleanup cannot create or update `webchat-runtime-readiness`. On persisted `pageshow` it starts exactly
 * one current attach/init and resumes feedback from the current Runtime snapshot. Terminal exits have no
 * restoration path. All transitions are idempotent.
 */
export const createDocumentLifecycleOwner = (): DocumentLifecycleOwner => {
  let documentState: 'active' | 'suspended' | 'ended' = 'active'
  // A restore generation is invalidated by any later suspend/terminal-exit/dispose, so a late restore
  // completion can never resume feedback or re-activate an ended/discarded document.
  let restoreGeneration = 0
  let deps: DocumentLifecycleDeps | null = null
  const feedbackDomain = () => deps!.store.getDomain(AppFeedbackDomain())

  const silenceFeedback = () => {
    deps!.store.send(feedbackDomain().command.SilenceFeedbackCommand())
  }
  const cleanupOnce = () => {
    deps!.sendLifecycle.cancelActiveSends()
    deps!.detachLease()
  }
  const invalidateRestore = () => {
    restoreGeneration += 1
  }
  const suspend = () => {
    // Only an active document may suspend. Restore returns the document to active immediately on
    // pageshow, so a persisted hide landing during restore-pending is caught here; a duplicate hide
    // while already suspended must no-op (at most one release per cycle).
    if (!deps || documentState !== 'active') return
    documentState = 'suspended'
    invalidateRestore()
    silenceFeedback()
    cleanupOnce()
  }
  const end = () => {
    if (!deps || documentState === 'ended') return
    documentState = 'ended'
    invalidateRestore()
    silenceFeedback()
    cleanupOnce()
  }
  const restore = () => {
    if (!deps || documentState !== 'suspended') return
    const generation = restoreGeneration
    // The browser has already shown this document: it is visible now. Enter active immediately and start
    // exactly one current attach/init. On completion (success or failure) feedback resumes aligned to the
    // current Runtime truth, unless a later suspend/terminal-exit/dispose invalidated this generation.
    documentState = 'active'
    deps!.initLease().then(
      () => {
        if (restoreGeneration !== generation || documentState !== 'active') return
        deps!.store.send(feedbackDomain().command.ResumeFeedbackCommand())
      },
      () => {
        // A visible document never stays silently wedged: a failed re-attach still resumes feedback so
        // the page presents the real current truth (e.g. unavailable) through the existing rules. The
        // rejection is consumed; only a later suspend/end/dispose can suppress this completion.
        if (restoreGeneration !== generation || documentState !== 'active') return
        deps!.store.send(feedbackDomain().command.ResumeFeedbackCommand())
      }
    )
  }
  const onBeforeUnload = () => {
    // Feedback becomes silent before any page-local readiness change; cleanup ownership stays with
    // pagehide (which alone knows whether the document is suspended or terminal).
    if (deps) silenceFeedback()
  }
  const onPageHide = (event: PageTransitionEvent) => {
    if (event.persisted) suspend()
    else end()
  }
  const onPageShow = (event: PageTransitionEvent) => {
    if (event.persisted) restore()
  }
  window.addEventListener('beforeunload', onBeforeUnload)
  window.addEventListener('pagehide', onPageHide)
  window.addEventListener('pageshow', onPageShow)
  return {
    bind: (bound: DocumentLifecycleDeps) => {
      deps = bound
    },
    dispose: () => {
      window.removeEventListener('beforeunload', onBeforeUnload)
      window.removeEventListener('pagehide', onPageHide)
      window.removeEventListener('pageshow', onPageShow)
      // Dispose is terminal for this document generation: any in-flight restore completion must not
      // resume feedback on a discarded page.
      invalidateRestore()
      documentState = 'ended'
    }
  }
}
