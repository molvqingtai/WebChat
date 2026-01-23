export const getRootNode = () => {
  return document.querySelector(__NAME__)?.shadowRoot?.querySelector('#app') || document.body
}

export default getRootNode
