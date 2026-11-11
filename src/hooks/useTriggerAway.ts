import type { RefCallback } from 'react'
import { useCallback, useRef } from 'react'

export type Events = Array<keyof GlobalEventHandlersEventMap>

/**
 * @see https://github.com/streamich/react-use/pull/2528
 */
const useTriggerAway = <T extends Element = Element, E extends Event = Event>(
  events: Events,
  callback: (event: E) => void
) => {
  const handleRef = useRef<T | null>(null)

  const handler = useCallback(
    (event: SafeAny) => {
      const rootNode = handleRef.current?.getRootNode()
      if (!handleRef.current?.contains(event.target) && event.target.shadowRoot !== rootNode) {
        callback(event)
      }
    },
    [callback]
  )

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
        events.forEach(() =>
          events.forEach((eventName) => {
            document.removeEventListener(eventName, handler)
            if (isInShadow) rootNode.removeEventListener(eventName, handler)
          })
        )
      }
      if (node) {
        const rootNode = node.getRootNode()
        const isInShadow = rootNode instanceof ShadowRoot
        events.forEach((eventName) => {
          document.addEventListener(eventName, handler)
          if (isInShadow) rootNode.addEventListener(eventName, handler)
        })
      }
      handleRef.current = node
    },
    [events, handler]
  )

  return { setRef }
}

export default useTriggerAway
