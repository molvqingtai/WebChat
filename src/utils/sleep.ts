export const sleep = (ms: number): Promise<void> => new Promise((resolve) => globalThis.setTimeout(resolve, ms))
