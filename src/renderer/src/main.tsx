// Base tokens and primitives first: component stylesheets are imported through
// the tree below and must be able to override them.
import './styles/global.css'

import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './App'

const container = document.getElementById('root')
if (!container) throw new Error('Root container is missing from index.html')

createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>
)
