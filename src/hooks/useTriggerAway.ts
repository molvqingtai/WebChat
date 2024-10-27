import { RefCallback, useCallback, useRef } from 'react'

export type Events = Array<keyof GlobalEventHandlersEventMap>

/**
 * @see https://github.com/streamich/react-use/pull/2528
 */
const useTriggerAway = <E extends Event = Event>(events: Events, callback: (event: E) => void) => {
  const handleRef = useRef<HTMLElement | null>(null)

  const handler = (event: SafeAny) => {
    const rootNode = handleRef.current?.getRootNode()
    !handleRef.current?.contains(event.target) && event.target.shadowRoot !== rootNode && callback(event)
  }

  /**
   * When events are captured outside the component, events that occur in shadow DOM will target the host element
   * so additional event listeners need to be added for shadowDom
   *
   *  document       shadowDom            target
   *    |                |                   |
   *    |- on(document) -|-  on(shadowRoot) -|
   */
  const setRef: RefCallback<HTMLElement | null> = useCallback(
    (node) => {
      if (handleRef.current) {
        const rootNode = handleRef.current.getRootNode()
        const isInShadow = rootNode instanceof ShadowRoot
        events.forEach(() => {
          for (const eventName of events) {
            document.removeEventListener(eventName, handler)
            isInShadow && rootNode.removeEventListener(eventName, handler)
          }
        })
      }
      if (node) {
        const rootNode = node.getRootNode()
        const isInShadow = rootNode instanceof ShadowRoot
        events.forEach((eventName) => {
          document.addEventListener(eventName, handler)
          isInShadow && rootNode.addEventListener(eventName, handler)
        })
      }
      handleRef.current = node
    },
    [handler]
  )

  return { setRef }
}

export default useTriggerAway
