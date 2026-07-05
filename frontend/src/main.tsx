import React from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './app/App'
import { I18nProvider } from './i18n/I18nProvider'
import './styles/theme.css'
import './styles/global.css'
import './styles/landing-login.css'
import './styles/learner-mapping.css'
import './styles/results.css'

createRoot(document.getElementById('root') as HTMLElement).render(
  <React.StrictMode>
    <I18nProvider>
      <App />
    </I18nProvider>
  </React.StrictMode>
)