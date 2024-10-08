import { type RefObject, useEffect, useRef } from 'react'

export type Events = Array<keyof GlobalEventHandlersEventMap>

/**
 * Waiting for PR merge
 * @see https://github.com/streamich/react-use/pull/2528
 */
const useClickAway = <E extends Event = Event>(
  ref: RefObject<HTMLElement | null>,
  onClickAway: (event: E) => void,
  events: Events = ['mousedown', 'touchstart']
) => {
  const savedCallback = useRef(onClickAway)
  useEffect(() => {
    savedCallback.current = onClickAway
  }, [onClickAway])
  useEffect(() => {
    const { current: el } = ref
    if (!el) return

    const rootNode = el.getRootNode()
    const isInShadow = rootNode instanceof ShadowRoot

    /**
     * When events are captured outside the component, events that occur in shadow DOM will target the host element
     * so additional event listeners need to be added for shadowDom
     *
     *  document       shadowDom            target
     *    |                |                   |
     *    |- on(document) -|-  on(shadowRoot) -|
     */
    const handler = (event: SafeAny) => {
      !el.contains(event.target) && event.target.shadowRoot !== rootNode && savedCallback.current(event)
    }
    for (const eventName of events) {
      // eslint-disable-next-line @eslint-react/web-api/no-leaked-event-listener
      document.addEventListener(eventName, handler)
      // eslint-disable-next-line @eslint-react/web-api/no-leaked-event-listener
      isInShadow && rootNode.addEventListener(eventName, handler)
    }
    return () => {
      for (const eventName of events) {
        document.removeEventListener(eventName, handler)
        isInShadow && rootNode.removeEventListener(eventName, handler)
      }
    }
  }, [events, ref])
}

export default useClickAway
