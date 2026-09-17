import { createRoot } from 'react-dom/client'
import '@fontsource-variable/inter'
import '@fontsource-variable/jetbrains-mono'
import '@fontsource-variable/caveat'
import './styles/base.css'
import './styles/layout.css'
import './styles/editor.css'
import './styles/views.css'
import './styles/canvas.css'
import { App } from './App.jsx'
import { applyPrefs } from './store/prefs.js'

applyPrefs()
createRoot(document.getElementById('root')).render(<App />)
