import datacub from '@datacub/web'
import { useState } from 'react'
import { createRoot } from 'react-dom/client'

// pk_test_ keys work on localhost. Copy yours from datacub, Settings → Integrations.
datacub.init(import.meta.env.VITE_DATACUB_KEY ?? 'pk_test_YOUR_KEY')

function App() {
  const [done, setDone] = useState(false)

  async function signUp() {
    await new Promise((r) => setTimeout(r, 200)) // your API call
    datacub.track('signup_completed', { method: 'email' })
    setDone(true)
  }

  return done ? (
    <h1>Welcome</h1>
  ) : (
    <button type="button" onClick={signUp}>
      Sign up
    </button>
  )
}

const root = document.getElementById('root')
if (root) createRoot(root).render(<App />)
