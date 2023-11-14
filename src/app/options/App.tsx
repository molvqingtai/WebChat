import { useRef, useState } from 'react'
import { useClickAway } from 'react-use'
import wxtLogo from '/wxt.svg'
import reactLogo from '@/assets/react.svg'
import './App.css'

function App() {
  const [count, setCount] = useState(0)
  const menuRef = useRef<HTMLDivElement>(null)
  useClickAway(
    menuRef,
    (...params) => {
      console.log(params)

      // setOpen(false)
    },
    ['click']
  )

  return (
    <>
      <div>
        <a href="https://wxt.dev" target="_blank" rel="noreferrer">
          <img src={wxtLogo} className="logo" alt="WXT logo" />
        </a>
        <a href="https://react.dev" target="_blank" rel="noreferrer">
          <img src={reactLogo} className="logo react" alt="React logo" />
        </a>
      </div>
      <h1 ref={menuRef}>
        <button> WXT + React</button>
      </h1>
      <div className="card">
        <button onClick={() => setCount((count) => count + 1)}>count is {count}</button>
        <p>
          Edit <code>src/App.tsx</code> and save to test HMR
        </p>
      </div>
      <p className="read-the-docs">Click on the WXT and React logos to learn more</p>
    </>
  )
}

export default App
