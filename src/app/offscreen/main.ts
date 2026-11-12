import { startHost } from '@/runtime/host'

// Chrome/Edge: the Runtime lives here because WebRTC needs a document. The service worker only
// creates this page; pages talk to it directly.
startHost()
