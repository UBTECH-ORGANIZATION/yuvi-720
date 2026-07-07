import React from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './app/App'
import { I18nProvider } from './i18n/I18nProvider'
import { BrainProvider } from './providers/BrainProvider'
import { CompanionProvider } from './providers/CompanionProvider'
import './styles/tokens.css'
import './styles/theme.css'
import './styles/global.css'
import './components/primitives/primitives.css'
import './styles/landing-login.css'
import './styles/learner-mapping.css'
import './styles/results.css'
// Responsive foundation loads LAST so its breakpoint overrides win everywhere.
import './styles/responsive.css'

createRoot(document.getElementById('root') as HTMLElement).render(
  <React.StrictMode>
    <I18nProvider>
      <BrainProvider>
        <CompanionProvider>
          <App />
        </CompanionProvider>
      </BrainProvider>
    </I18nProvider>
  </React.StrictMode>
)