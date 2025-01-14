export const getRootNode = () => {
  return document.querySelector(__NAME__)?.shadowRoot?.querySelector('#root') || document.body
}

export default getRootNode
