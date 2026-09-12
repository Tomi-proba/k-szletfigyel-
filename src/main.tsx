import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { HashRouter } from 'react-router-dom'
import './index.css'
import App from './App.tsx'
import { AuthProvider } from './hooks/useAuth.tsx'

// HashRouter (not BrowserRouter): the app is served from a plain static
// host and also loaded from a local file:// path in the desktop build,
// neither of which can be configured with a server-side SPA fallback rewrite.
createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <HashRouter>
      <AuthProvider>
        <App />
      </AuthProvider>
    </HashRouter>
  </StrictMode>,
)
