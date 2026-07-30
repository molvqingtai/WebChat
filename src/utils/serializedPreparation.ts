const preparations = new Map<string, Promise<void>>()

export const serializePreparation = (identity: string, prepare: () => Promise<void>): Promise<void> => {
  const current = preparations.get(identity)
  if (current) return current

  const preparation = Promise.resolve().then(() => {
    const locks = typeof navigator === 'undefined' ? undefined : navigator.locks
    if (!locks) {
      console.error('[WebChat] Persistence preparation coordination unavailable')
      throw new Error('Persistence preparation coordination unavailable')
    }
    return locks.request(`webchat-persistence:${identity}`, prepare)
  })
  preparations.set(identity, preparation)
  void preparation
    .finally(() => {
      if (preparations.get(identity) === preparation) preparations.delete(identity)
    })
    .catch(() => {})
  return preparation
}
