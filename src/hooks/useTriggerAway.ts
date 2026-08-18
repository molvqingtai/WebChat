import type { RefCallback } from 'react'
import { useCallback, useRef, useLayoutEffect } from 'react'

export type Events = Array<keyof GlobalEventHandlersEventMap>

/**
 * @see https://github.com/streamich/react-use/pull/2528
 */
const useTriggerAway = <T extends Element = Element, E extends Event = Event>(
  events: Events,
  callback: (event: E) => void
) => {
  const handleRef = useRef<T | null>(null)

  // 1. Memoize the callback safely using useLayoutEffect (Concurrent Mode safe)
  const savedCallback = useRef(callback)
  useLayoutEffect(() => {
    savedCallback.current = callback
  }, [callback])

  // 2. Stable handler reference
  const handler = useCallback((event: SafeAny) => {
    const rootNode = handleRef.current?.getRootNode()
    if (!handleRef.current?.contains(event.target) && event.target.shadowRoot !== rootNode) {
      savedCallback.current(event)
    }
  }, [])

  // 3. Serialize events to a primitive string so inline arrays don't break memoization
  const eventsStr = events.join(',')

  /**
   * When events are captured outside the component, events that occur in shadow DOM will target the host element
   * so additional event listeners need to be added for shadowDom
   *
   *  document       shadowDom            target
   *    |                |                   |
   *    |- on(document) -|-  on(shadowRoot) -|
   */
  const setRef: RefCallback<T> = useCallback(
    (node) => {
      if (handleRef.current) {
        const rootNode = handleRef.current.getRootNode()
        const isInShadow = rootNode instanceof ShadowRoot
        const eventNames = eventsStr ? (eventsStr.split(',') as Events) : []
        eventNames.forEach((eventName) => {
          document.removeEventListener(eventName, handler)
          if (isInShadow) {
            rootNode.removeEventListener(eventName, handler)
          }
        })
      }

      if (node) {
        const rootNode = node.getRootNode()
        const isInShadow = rootNode instanceof ShadowRoot
        const eventNames = eventsStr ? (eventsStr.split(',') as Events) : []
        eventNames.forEach((eventName) => {
          document.addEventListener(eventName, handler)
          if (isInShadow) {
            rootNode.addEventListener(eventName, handler)
          }
        })
      }
      handleRef.current = node
    },
    [handler, eventsStr]
  )

  return { setRef }
}

export default useTriggerAway
