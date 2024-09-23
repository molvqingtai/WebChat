import { Remesh } from 'remesh'
import ToastModule from './modules/Toast'

const ToastDomain = Remesh.domain({
  name: 'ToastDomain',
  impl: (domain) => {
    return ToastModule(domain)
  }
})

export default ToastDomain
