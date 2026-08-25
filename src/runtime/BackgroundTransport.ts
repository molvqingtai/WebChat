import type { RoomTransport } from '@/runtime/RoomTransport'

/** Firefox owns its direct transport in Background; only Chromium requests the Offscreen proxy. */
export const selectBackgroundTransport = async (
  firefox: boolean,
  ensureChromiumTransport: () => Promise<RoomTransport>
): Promise<RoomTransport | undefined> => (firefox ? undefined : ensureChromiumTransport())
