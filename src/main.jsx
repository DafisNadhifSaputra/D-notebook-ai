import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.jsx'
import { registerSW } from 'virtual:pwa-register'

// Register service worker
const updateSW = registerSW({
  onNeedRefresh() {
    if (confirm('Versi baru tersedia. Muat ulang?')) {
      updateSW(true)
    }
  },
  onOfflineReady() {
    console.log('Aplikasi siap digunakan dalam mode offline')
  },
})

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
