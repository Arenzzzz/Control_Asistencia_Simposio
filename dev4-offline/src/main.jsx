import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
// Fuente del diseño, incluida en la app para que funcione sin internet
import '@fontsource/plus-jakarta-sans/latin-400.css'
import '@fontsource/plus-jakarta-sans/latin-500.css'
import '@fontsource/plus-jakarta-sans/latin-600.css'
import '@fontsource/plus-jakarta-sans/latin-700.css'
import './index.css'
import App from './App.jsx'
import { ajustarDiaPorFecha } from './config'

// Antes de mostrar nada, el celular se pone en el día del simposio que toca
ajustarDiaPorFecha()

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
