import { createElement } from '@/utils'

export interface Position {
  x: number
  y: number
  selectionStart: number
  selectionEnd: number
}

const getCursorPosition = (target: HTMLInputElement | HTMLTextAreaElement) => {
  return new Promise<Position>((resolve, reject) =>
    requestIdleCallback(() => {
      try {
        const value = target.value

        const inputWrapper = createElement<HTMLDivElement>(
          `<div style="position: fixed; z-index: calc(-infinity); width: 0; height: 0; overflow: hidden; visibility: hidden; pointer-events: none;"></div>`
          // `<div id="input-wrapper" style="position: fixed"></div>`
        )
        const copyInput = createElement<HTMLDivElement>(`<div contenteditable></div>`)

        inputWrapper.appendChild(copyInput)
        target.ownerDocument.body.appendChild(inputWrapper)

        const { left, top, width, height } = target.getBoundingClientRect()

        const isEmptyOrBreakEnd = /(\n|\s*$)/.test(value)
        copyInput.textContent = isEmptyOrBreakEnd ? `${value}\u200b` : value

        const copyStyle = getComputedStyle(target)

        for (const key of copyStyle) {
          Reflect.set(copyInput.style, key, copyStyle[key as keyof CSSStyleDeclaration])
        }

        if (target.tagName === 'INPUT') {
          copyInput.style.lineHeight = copyStyle.height
        }

        copyInput.style.overflow = 'auto'

        copyInput.style.width = `${width}px`
        copyInput.style.height = `${height}px`
        copyInput.style.boxSizing = 'border-box'
        copyInput.style.margin = '0'
        copyInput.style.position = 'fixed'
        copyInput.style.top = `${top}px`
        copyInput.style.left = `${left}px`
        copyInput.style.pointerEvents = 'none'

        // sync scroll
        copyInput.scrollTop = target.scrollTop
        copyInput.scrollLeft = target.scrollLeft

        const selectionStart = target.selectionStart!
        const selectionEnd = target.selectionEnd!

        const range = new Range()
        range.setStart(copyInput.childNodes[0], selectionStart)
        range.setEnd(copyInput.childNodes[0], isEmptyOrBreakEnd ? selectionEnd + 1 : selectionEnd)

        const { x, y } = range.getBoundingClientRect()

        target.ownerDocument.body.removeChild(inputWrapper)

        resolve({ x, y, selectionStart, selectionEnd })
      } catch (error) {
        reject(error)
      }
    })
  )
}

export default getCursorPosition
