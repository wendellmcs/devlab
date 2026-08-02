import { createRoot } from 'react-dom/client'

import '@xterm/xterm/css/xterm.css'
import './styles.css'
import { App } from './App.tsx'

const raiz = document.getElementById('raiz')
if (raiz === null) throw new Error('elemento #raiz não encontrado')

// Sem StrictMode de propósito: o duplo-mount do modo estrito abriria duas
// sessões de `docker exec` por terminal a cada render de desenvolvimento.
createRoot(raiz).render(<App />)
